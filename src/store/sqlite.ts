// SQLite event store using Node's built-in `node:sqlite` (no native addon to compile).
// The (person_id, seq) primary key makes the optimistic-concurrency check atomic: a racing
// writer that computed the same next seq hits a constraint violation and gets ConcurrencyError.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { NewEvent, ScaffoldEvent } from '../core/model.ts';
import { ConcurrencyError, type EventStore, type ReplaceOptions } from './store.ts';

export class SqliteStore implements EventStore {
  readonly kind = 'sqlite';
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 2000;
      CREATE TABLE IF NOT EXISTS events (
        person_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        at TEXT NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY (person_id, seq)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS stream_expiry (
        person_id TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  async load(personId: string, afterSeq = 0): Promise<ScaffoldEvent[]> {
    const rows = this.db
      .prepare('SELECT body FROM events WHERE person_id = ? AND seq > ? ORDER BY seq')
      .all(personId, afterSeq) as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as ScaffoldEvent);
  }

  private lastSeq(personId: string): number {
    const row = this.db.prepare('SELECT MAX(seq) AS s FROM events WHERE person_id = ?').get(personId) as { s: number | null };
    return row.s ?? 0;
  }

  async append(personId: string, events: readonly NewEvent[], expectedLastSeq: number): Promise<ScaffoldEvent[]> {
    const insert = this.db.prepare('INSERT INTO events (person_id, seq, type, at, body) VALUES (?, ?, ?, ?, ?)');
    const stamped = events.map((e, i) => ({ ...e, seq: expectedLastSeq + i + 1 }) as ScaffoldEvent);
    try {
      this.db.exec('BEGIN IMMEDIATE');
    } catch (err) {
      // Another process holds the write lock past busy_timeout: surface as a retryable conflict.
      if (String(err).includes('SQLITE_BUSY') || String(err).includes('database is locked')) {
        throw new ConcurrencyError(personId, expectedLastSeq, -1);
      }
      throw err;
    }
    try {
      const last = this.lastSeq(personId);
      if (last !== expectedLastSeq) throw new ConcurrencyError(personId, expectedLastSeq, last);
      for (const e of stamped) insert.run(personId, e.seq, e.type, e.at, JSON.stringify(e));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      if (err instanceof ConcurrencyError) throw err;
      if (String(err).includes('UNIQUE') || String(err).includes('PRIMARY KEY')) {
        throw new ConcurrencyError(personId, expectedLastSeq, this.lastSeq(personId));
      }
      throw err;
    }
    return stamped;
  }

  async replace(personId: string, events: readonly ScaffoldEvent[], opts: ReplaceOptions = {}): Promise<void> {
    const insert = this.db.prepare('INSERT INTO events (person_id, seq, type, at, body) VALUES (?, ?, ?, ?, ?)');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Drop expired demo sandboxes.
      const now = Date.now();
      this.db.prepare('DELETE FROM events WHERE person_id IN (SELECT person_id FROM stream_expiry WHERE expires_at < ?)').run(now);
      this.db.prepare('DELETE FROM stream_expiry WHERE expires_at < ?').run(now);
      this.db.prepare('DELETE FROM events WHERE person_id = ?').run(personId);
      if (opts.expiresAtMs) {
        this.db.prepare('INSERT OR REPLACE INTO stream_expiry (person_id, expires_at) VALUES (?, ?)').run(personId, opts.expiresAtMs);
      } else {
        this.db.prepare('DELETE FROM stream_expiry WHERE person_id = ?').run(personId);
      }
      for (const e of events) insert.run(personId, e.seq, e.type, e.at, JSON.stringify(e));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
