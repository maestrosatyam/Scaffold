import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DynamoDBClient, QueryCommand, TransactWriteItemsCommand, TransactionCanceledException, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterAll, describe, expect, it } from 'vitest';
import type { NewEvent } from '../src/core/model.ts';
import { DynamoStore } from '../src/store/dynamo.ts';
import { SqliteStore } from '../src/store/sqlite.ts';
import { ConcurrencyError, MemoryStore, type EventStore } from '../src/store/store.ts';

const ev = (runId: string): NewEvent => ({ type: 'run.finished', runId, at: '2026-10-18T00:00:00Z', actorId: 'sam' });

const dir = mkdtempSync(join(tmpdir(), 'scaffold-store-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const contract = (name: string, make: () => EventStore) =>
  describe(`${name} store contract`, () => {
    it('appends with sequential seq numbers and loads after a cursor', async () => {
      const s = make();
      const a = await s.append('p', [ev('a'), ev('b')], 0);
      expect(a.map((e) => e.seq)).toEqual([1, 2]);
      await s.append('p', [ev('c')], 2);
      expect((await s.load('p')).map((e) => e.seq)).toEqual([1, 2, 3]);
      expect((await s.load('p', 2)).map((e) => (e as { runId: string }).runId)).toEqual(['c']);
      expect(await s.load('other')).toEqual([]);
    });

    it('rejects a stale expectedLastSeq (optimistic concurrency)', async () => {
      const s = make();
      await s.append('q', [ev('a')], 0);
      await expect(s.append('q', [ev('b')], 0)).rejects.toBeInstanceOf(ConcurrencyError);
      expect(await s.load('q')).toHaveLength(1);
    });

    it('two racing writers: exactly one wins', async () => {
      const s = make();
      const results = await Promise.allSettled([s.append('r', [ev('x')], 0), s.append('r', [ev('y')], 0)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await s.load('r')).toHaveLength(1);
    });

    it('replace swaps a stream wholesale', async () => {
      const s = make();
      await s.append('z', [ev('a'), ev('b')], 0);
      await s.replace('z', [{ ...ev('only'), seq: 1 } as never]);
      expect((await s.load('z')).map((e) => (e as { runId: string }).runId)).toEqual(['only']);
    });
  });

contract('memory', () => new MemoryStore());
contract('sqlite', () => new SqliteStore(join(dir, `t-${Math.random().toString(36).slice(2)}.db`)));

describe('sqlite durability', () => {
  it('survives a reopen (events persist on disk)', async () => {
    const path = join(dir, 'durable.db');
    const a = new SqliteStore(path);
    await a.append('sam', [ev('a'), ev('b')], 0);
    await a.close();
    const b = new SqliteStore(path);
    expect((await b.load('sam')).map((e) => e.seq)).toEqual([1, 2]);
    await b.close();
  });
});

describe('DynamoDB store (AWS SDK v3, mocked client — no AWS account used)', () => {
  const ddb = mockClient(DynamoDBClient);
  const store = new DynamoStore(new DynamoDBClient({ region: 'us-east-1', credentials: { accessKeyId: 'x', secretAccessKey: 'y' } }), 'scaffold-events');

  it('pages through Query results via LastEvaluatedKey', async () => {
    ddb.reset();
    const item = (seq: number) => ({ pk: { S: 'sam' }, seq: { N: String(seq) }, body: { S: JSON.stringify({ ...ev(`r${seq}`), seq }) } });
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [item(1), item(2)], LastEvaluatedKey: { pk: { S: 'sam' }, seq: { N: '2' } } })
      .resolvesOnce({ Items: [item(3)] });
    const out = await store.load('sam');
    expect(out.map((e) => e.seq)).toEqual([1, 2, 3]);
    const calls = ddb.commandCalls(QueryCommand);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.args[0].input.ExclusiveStartKey).toEqual({ pk: { S: 'sam' }, seq: { N: '2' } });
    expect(calls[0]!.args[0].input.ConsistentRead).toBe(true);
  });

  it('writes all events in one conditional transaction', async () => {
    ddb.reset();
    ddb.on(TransactWriteItemsCommand).resolves({});
    const out = await store.append('sam', [ev('a'), ev('b')], 7);
    expect(out.map((e) => e.seq)).toEqual([8, 9]);
    const input = ddb.commandCalls(TransactWriteItemsCommand)[0]!.args[0].input;
    expect(input.TransactItems).toHaveLength(2);
    expect(input.TransactItems![0]!.Put!.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(input.TransactItems![1]!.Put!.Item!.seq).toEqual({ N: '9' });
  });

  it('maps a cancelled transaction (seq already taken) to ConcurrencyError', async () => {
    ddb.reset();
    ddb.on(TransactWriteItemsCommand).rejects(new TransactionCanceledException({ message: 'ConditionalCheckFailed', $metadata: {} }));
    await expect(store.append('sam', [ev('a')], 0)).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('replace retries UnprocessedItems from BatchWriteItem', async () => {
    ddb.reset();
    ddb.on(QueryCommand).resolves({ Items: [] });
    const put = { PutRequest: { Item: { pk: { S: 'sam' }, seq: { N: '1' } } } };
    ddb.on(BatchWriteItemCommand).resolvesOnce({ UnprocessedItems: { 'scaffold-events': [put] } }).resolves({});
    await store.replace('sam', [{ ...ev('a'), seq: 1 } as never]);
    expect(ddb.commandCalls(BatchWriteItemCommand)).toHaveLength(2);
  });
});
