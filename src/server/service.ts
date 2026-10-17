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
  /** Single-flight catch-up per person, so overlapping reads never race on one projection. */
  private loading = new Map<string, Promise<PersonState>>();
  private locks = new Map<string, Promise<unknown>>();
  private listeners = new Set<Listener>();

  constructor(opts: ServiceOptions) {
    this.store = opts.store;
    this.clock = opts.clock;
    this.timeZone = opts.timeZone;
    this.newId = opts.newId ?? shortId;
  }

  /**
   * "Now" for a person. Demo sandboxes carry a demo clock in their own event stream, so every
   * instance (e.g. every Lambda execution environment) agrees on it without shared memory.
   */
  nowFor(state: PersonState): Date {
    const real = this.clock.now();
    const d = state.demoClock;
    return d ? new Date(d.anchorMs + (real.getTime() - d.startedMs)) : real;
  }

  clockMode(state: PersonState): 'real' | 'demo' | 'fixed' {
    return state.demoClock ? 'demo' : this.clock.mode;
  }

  onEvents(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Current projection, caught up with any events other instances appended. */
  async state(personId: string): Promise<PersonState> {
    const inflight = this.loading.get(personId);
    if (inflight) return inflight;
    const p = (async () => {
      let s = this.cache.get(personId);
      if (!s) {
        s = emptyState(personId);
        this.cache.set(personId, s);
      }
      const newer = await this.store.load(personId, s.lastSeq);
      for (const e of newer) apply(s, e, { timeZone: this.timeZone }); // apply() skips seq <= lastSeq
      return s;
    })();
    this.loading.set(personId, p);
    try {
      return await p;
    } finally {
      if (this.loading.get(personId) === p) this.loading.delete(personId);
    }
  }

  invalidate(personId: string): void {
    this.cache.delete(personId);
  }

  /**
   * Run a command under a per-person in-process lock, with optimistic-concurrency retry against
   * the store (for multi-instance deployments). `decide` must be pure: it may run more than once.
   *
   * Every event is stamped with a command id. If an append "fails" but actually committed (the
   * response was lost and the retry hit the condition check), the re-read state already contains
   * this command's events, so the command is treated as done instead of being applied twice.
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
    const cmd = this.newId('cmd');
    let first: { result: T } | null = null;
    try {
      for (let attempt = 0; ; attempt++) {
        const state = await this.state(personId);
        if (first && state.recentCmds.includes(cmd)) return { result: first.result, state };
        const ctx: Ctx = { now: this.nowFor(state).toISOString(), actorId, newId: this.newId };
        const { events, result } = decide(state, ctx);
        first = { result }; // result of the attempt whose events we are about to write
        if (events.length === 0) return { result, state };
        try {
          const stamped = await this.store.append(personId, events.map((e) => ({ ...e, cmd })), state.lastSeq);
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
