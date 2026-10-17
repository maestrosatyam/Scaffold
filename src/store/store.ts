// Append-only, per-person event store with optimistic concurrency.
//
// `append(personId, events, expectedLastSeq)` succeeds only if the stream's last sequence number
// is still `expectedLastSeq`; otherwise it throws ConcurrencyError and the caller re-reads and
// retries the command. This is what keeps two Echo devices (or two Lambda instances) from
// double-advancing a routine.

import type { NewEvent, ScaffoldEvent } from '../core/model.ts';

export class ConcurrencyError extends Error {
  constructor(personId: string, expected: number, actual: number) {
    super(`Stream ${personId} moved: expected seq ${expected}, found ${actual}`);
    this.name = 'ConcurrencyError';
  }
}

export interface ReplaceOptions {
  expiresAtMs?: number;
}

export interface EventStore {
  readonly kind: string;
  /** Events with seq > afterSeq, in order. */
  load(personId: string, afterSeq?: number): Promise<ScaffoldEvent[]>;
  append(personId: string, events: readonly NewEvent[], expectedLastSeq: number): Promise<ScaffoldEvent[]>;
  /**
   * Replace a stream wholesale (demo seeding only). `expiresAtMs` marks a disposable demo
   * sandbox: stores delete it after that time (DynamoDB TTL, or a sweep in local stores).
   */
  replace(personId: string, events: readonly ScaffoldEvent[], opts?: ReplaceOptions): Promise<void>;
  close?(): Promise<void>;
}

export class MemoryStore implements EventStore {
  readonly kind = 'memory';
  private streams = new Map<string, ScaffoldEvent[]>();
  private expiry = new Map<string, number>();

  async load(personId: string, afterSeq = 0): Promise<ScaffoldEvent[]> {
    return (this.streams.get(personId) ?? []).filter((e) => e.seq > afterSeq).map((e) => structuredClone(e));
  }

  async append(personId: string, events: readonly NewEvent[], expectedLastSeq: number): Promise<ScaffoldEvent[]> {
    const stream = this.streams.get(personId) ?? [];
    const last = stream.at(-1)?.seq ?? 0;
    if (last !== expectedLastSeq) throw new ConcurrencyError(personId, expectedLastSeq, last);
    const stamped = events.map((e, i) => ({ ...structuredClone(e), seq: last + i + 1 }) as ScaffoldEvent);
    this.streams.set(personId, [...stream, ...stamped]);
    return stamped.map((e) => structuredClone(e));
  }

  async replace(personId: string, events: readonly ScaffoldEvent[], opts: ReplaceOptions = {}): Promise<void> {
    const now = Date.now();
    for (const [id, exp] of this.expiry) {
      if (exp < now) {
        this.streams.delete(id);
        this.expiry.delete(id);
      }
    }
    this.streams.set(personId, events.map((e) => structuredClone(e)));
    if (opts.expiresAtMs) this.expiry.set(personId, opts.expiresAtMs);
    else this.expiry.delete(personId);
  }
}
