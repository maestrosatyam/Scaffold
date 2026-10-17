// Amazon DynamoDB event store (used when SCAFFOLD_STORE=dynamodb, e.g. on AWS Lambda).
//
// Table: partition key `pk` (S) = personId, sort key `seq` (N). One item per event.
// Optimistic concurrency: every new item is written with `attribute_not_exists(pk)` inside one
// TransactWriteItems call, so if another writer already took seq N+1 the whole append fails
// with TransactionCanceled -> ConcurrencyError, and the service re-reads and retries.
// Reads page through Query results (LastEvaluatedKey) so long histories are never truncated.
// Demo sandbox streams carry a `ttl` attribute (epoch seconds) so DynamoDB TTL deletes them.

import {
  DynamoDBClient,
  QueryCommand,
  TransactWriteItemsCommand,
  BatchWriteItemCommand,
  type AttributeValue,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import { createHash } from 'node:crypto';
import type { NewEvent, ScaffoldEvent } from '../core/model.ts';
import { ConcurrencyError, type EventStore, type ReplaceOptions } from './store.ts';

const MAX_TRANSACT = 100;

export class DynamoStore implements EventStore {
  readonly kind = 'dynamodb';
  readonly client: DynamoDBClient;
  readonly table: string;
  /** Expiry (epoch ms) per sandbox stream, learned from replace(); later appends inherit it. */
  private expiries = new Map<string, number>();

  constructor(client: DynamoDBClient, table: string) {
    this.client = client;
    this.table = table;
  }

  static fromEnv(env: NodeJS.ProcessEnv): DynamoStore {
    const table = env.SCAFFOLD_TABLE;
    if (!table) throw new Error('SCAFFOLD_TABLE must be set when SCAFFOLD_STORE=dynamodb');
    return new DynamoStore(new DynamoDBClient(env.DYNAMODB_ENDPOINT ? { endpoint: env.DYNAMODB_ENDPOINT } : {}), table);
  }

  async load(personId: string, afterSeq = 0): Promise<ScaffoldEvent[]> {
    const out: ScaffoldEvent[] = [];
    let start: Record<string, AttributeValue> | undefined;
    do {
      const page = await this.client.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: 'pk = :p AND seq > :s',
          ExpressionAttributeValues: { ':p': { S: personId }, ':s': { N: String(afterSeq) } },
          ConsistentRead: true,
          ExclusiveStartKey: start,
        }),
      );
      for (const item of page.Items ?? []) {
        out.push(JSON.parse(item.body!.S!) as ScaffoldEvent);
        if (item.ttl?.N) this.expiries.set(personId, Number(item.ttl.N) * 1000);
      }
      start = page.LastEvaluatedKey;
    } while (start);
    return out;
  }

  private item(personId: string, e: ScaffoldEvent): Record<string, AttributeValue> {
    const exp = this.expiries.get(personId);
    return {
      pk: { S: personId },
      seq: { N: String(e.seq) },
      type: { S: e.type },
      at: { S: e.at },
      body: { S: JSON.stringify(e) },
      ...(exp ? { ttl: { N: String(Math.ceil(exp / 1000)) } } : {}),
    };
  }

  async append(personId: string, events: readonly NewEvent[], expectedLastSeq: number): Promise<ScaffoldEvent[]> {
    if (events.length > MAX_TRANSACT - 1) throw new Error(`Cannot append more than ${MAX_TRANSACT} events at once`);
    const stamped = events.map((e, i) => ({ ...e, seq: expectedLastSeq + i + 1 }) as ScaffoldEvent);
    try {
      // Deterministic idempotency token: a retry of the same logical append (same stream position,
      // same command) is recognised by DynamoDB within its 10-minute idempotency window.
      const token = createHash('sha256')
        .update(`${personId}|${expectedLastSeq}|${JSON.stringify(stamped.map((e) => [e.type, e.cmd ?? '', e.at]))}`)
        .digest('hex')
        .slice(0, 36);
      await this.client.send(
        new TransactWriteItemsCommand({
          ClientRequestToken: token,
          TransactItems: [
            // Prove seq N is the current tail (no gaps), then claim N+1..N+k.
            ...(expectedLastSeq > 0
              ? [{ ConditionCheck: { TableName: this.table, Key: { pk: { S: personId }, seq: { N: String(expectedLastSeq) } }, ConditionExpression: 'attribute_exists(pk)' } }]
              : []),
            ...stamped.map((e) => ({
              Put: { TableName: this.table, Item: this.item(personId, e), ConditionExpression: 'attribute_not_exists(pk)' },
            })),
          ],
        }),
      );
    } catch (err) {
      if (err instanceof TransactionCanceledException || (err as { name?: string }).name === 'TransactionCanceledException') {
        throw new ConcurrencyError(personId, expectedLastSeq, -1);
      }
      throw err;
    }
    return stamped;
  }

  async replace(personId: string, events: readonly ScaffoldEvent[], opts: ReplaceOptions = {}): Promise<void> {
    const existing = await this.load(personId);
    if (opts.expiresAtMs) this.expiries.set(personId, opts.expiresAtMs);
    else this.expiries.delete(personId);
    const requests = [
      ...existing.map((e) => ({ DeleteRequest: { Key: { pk: { S: personId }, seq: { N: String(e.seq) } } } })),
      ...events.map((e) => ({ PutRequest: { Item: this.item(personId, e) } })),
    ];
    // Deletes of seq N and puts of seq N cannot share a batch; run all deletes first.
    const deletes = requests.filter((r) => 'DeleteRequest' in r);
    const puts = requests.filter((r) => 'PutRequest' in r);
    for (const group of [deletes, puts]) {
      for (let i = 0; i < group.length; i += 25) {
        let pending: typeof group | undefined = group.slice(i, i + 25);
        for (let attempt = 0; pending && pending.length && attempt < 8; attempt++) {
          const res = await this.client.send(new BatchWriteItemCommand({ RequestItems: { [this.table]: pending } }));
          pending = res.UnprocessedItems?.[this.table] as typeof group | undefined;
          if (pending?.length) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
        }
        if (pending?.length) throw new Error(`DynamoDB left ${pending.length} items unprocessed`);
      }
    }
  }
}
