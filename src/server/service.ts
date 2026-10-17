// Application service: loads a person's projected state, runs a pure command, appends the
// resulting events with optimistic concurrency, and applies them to the cached projection.
// Commands are retried on ConcurrencyError so concurrent devices converge instead of clobbering.

import { randomBytes } from 'node:crypto';
import { apply, emptyState, type Ctx } from '../core/engine.ts';
import type { NewEvent, PersonState } from '../core/model.ts';
import { ConcurrencyError, type EventStore } from '../store/store.ts';

export interface Clock {
  now(): Date;
  readonly mode: 'real' | 'demo' | 'fixed';
}

export const realClock: Clock = { now: () => new Date(), mode: 'real' };

export function fixedClock(start: Date | string, stepMs = 0): Clock & { advance(ms: number): void; set(d: Date | string): void } {
  let t = new Date(start).getTime();
  return {
    mode: 'fixed',
    now() {
      const d = new Date(t);
      t += stepMs;
      return d;
    },
    advance(ms: number) {
      t += ms;
    },
    set(d: Date | string) {
      t = new Date(d).getTime();
    },
  };
}

export const shortId = (prefix: string): string => `${prefix}-${randomBytes(5).toString('hex')}`;

export interface ServiceOptions {
  store: EventStore;
  clock: Clock;
  timeZone: string;
  newId?: (prefix: string) => string;
}

export type Listener = (personId: string, events: readonly import('../core/model.ts').ScaffoldEvent[]) => void;

export class ScaffoldService {
  readonly store: EventStore;
  readonly clock: Clock;
  readonly timeZone: string;
  private readonly newId: (prefix: string) => string;
  private cache = new Map<string, PersonState>();
  private locks = new Map<string, Promise<unknown>>();
  private listeners = new Set<Listener>();
  /** Per-person demo clock anchors: wall time runs normally from a chosen local start time. */
  private anchors = new Map<string, { anchorMs: number; startedMs: number }>();

  constructor(opts: ServiceOptions) {
    this.store = opts.store;
    this.clock = opts.clock;
    this.timeZone = opts.timeZone;
    this.newId = opts.newId ?? shortId;
  }

  /** "Now" for a person: their demo anchor if one is set, else the service clock. */
  now(personId: string): Date {
    const a = this.anchors.get(personId);
    if (!a) return this.clock.now();
    return new Date(a.anchorMs + (this.clock.now().getTime() - a.startedMs));
  }

  anchorClock(personId: string, anchorMs: number): void {
    this.anchors.set(personId, { anchorMs, startedMs: this.clock.now().getTime() });
  }

  clockMode(personId: string): 'real' | 'demo' | 'fixed' {
    return this.anchors.has(personId) ? 'demo' : this.clock.mode;
  }

  onEvents(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Current projection, caught up with any events other instances appended. */
  async state(personId: string): Promise<PersonState> {
    let s = this.cache.get(personId);
    if (!s) {
      s = emptyState(personId);
      this.cache.set(personId, s);
    }
    const newer = await this.store.load(personId, s.lastSeq);
    for (const e of newer) apply(s, e, { timeZone: this.timeZone });
    return s;
  }

  invalidate(personId: string): void {
    this.cache.delete(personId);
  }

  /**
   * Run a command under a per-person in-process lock, with optimistic-concurrency retry against
   * the store (for multi-instance deployments). `decide` must be pure: it may run more than once.
   */
  async execute<T>(
    personId: string,
    actorId: string,
    decide: (state: PersonState, ctx: Ctx) => { events: NewEvent[]; result: T },
  ): Promise<{ result: T; state: PersonState }> {
    const prev = this.locks.get(personId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const chained = prev.then(() => mine);
    this.locks.set(personId, chained);
    await prev.catch(() => undefined);
    try {
      for (let attempt = 0; ; attempt++) {
        const state = await this.state(personId);
        const ctx: Ctx = { now: this.now(personId).toISOString(), actorId, newId: this.newId };
        const { events, result } = decide(state, ctx);
        if (events.length === 0) return { result, state };
        try {
          const stamped = await this.store.append(personId, events, state.lastSeq);
          for (const e of stamped) apply(state, e, { timeZone: this.timeZone });
          for (const l of this.listeners) l(personId, stamped);
          return { result, state };
        } catch (err) {
          if (err instanceof ConcurrencyError && attempt < 4) {
            this.invalidate(personId);
            continue;
          }
          throw err;
        }
      }
    } finally {
      release();
      if (this.locks.get(personId) === chained) this.locks.delete(personId);
    }
  }
}
