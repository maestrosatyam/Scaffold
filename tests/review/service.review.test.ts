// Adversarial review: ScaffoldService (projection cache, per-person lock, optimistic retry).
import { describe, expect, it } from 'vitest';
import { cmdHelp, cmdSkip, cmdStartRun, project } from '../../src/core/engine.ts';
import type { NewEvent } from '../../src/core/model.ts';
import { buildSeedEvents, localYmd } from '../../src/demo/seed.ts';
import { ScaffoldService, realClock } from '../../src/server/service.ts';
import { ConcurrencyError, MemoryStore } from '../../src/store/store.ts';
import { LatencyStore, TZ, call, connect, sandbox, startApp } from './helpers.ts';

const seed = () => buildSeedEvents({ today: localYmd(Date.now(), TZ), timeZone: TZ });

describe('projection cache', () => {
  it('R-05: two concurrent state() reads on a cold cache apply every event once (not twice)', async () => {
    const store = new MemoryStore();
    const events = seed();
    await store.replace('sam', events);
    const svc = new ScaffoldService({ store, clock: realClock, timeZone: TZ });
    const [s] = await Promise.all([svc.state('sam'), svc.state('sam')]);
    const truth = project('sam', events, { timeZone: TZ });
    expect(s.runOrder).toHaveLength(truth.runOrder.length); // 21, not 42
    expect(s.audit).toHaveLength(truth.audit.length);
    expect(Object.fromEntries(Object.entries(s.stats).map(([k, v]) => [k, v.level]))).toEqual(
      Object.fromEntries(Object.entries(truth.stats).map(([k, v]) => [k, v.level])),
    );
  });

  it('R-05: over HTTP with a network-latency store (DynamoDB behind main.ts), two parallel reads corrupt support levels', async () => {
    const app = await startApp({ store: new LatencyStore(15) });
    try {
      const sb = await sandbox(app.base);
      const a = await connect(app.base, sb.learnerToken);
      const b = await connect(app.base, sb.learnerToken);
      const coach = await connect(app.base, sb.coachToken);
      // e.g. the step card and the progress view loading at the same time
      await Promise.all([call(a, 'list_routines'), call(b, 'my_progress')]);
      const rep = (await call(coach, 'independence_report', { routine: 'morning' })).sc;
      expect(rep.seeded_runs).toBe(21);
      // Seeded truth: teeth/face/breakfast independent, dress cue, bag partial, door cue.
      expect(rep.steps.map((s: { level: string }) => s.level)).toEqual(['independent', 'independent', 'cue', 'independent', 'partial', 'cue']);
      await Promise.all([a.close(), b.close(), coach.close()]);
    } finally {
      await app.close();
    }
  });
});

describe('optimistic retry', () => {
  /** A store whose first append commits but reports a conflict, like a DynamoDB TransactWriteItems
   *  that succeeded server-side, timed out, and was retried by the SDK (no ClientRequestToken). */
  class AmbiguousCommitStore extends MemoryStore {
    armed = false;
    override async append(personId: string, events: readonly NewEvent[], expectedLastSeq: number) {
      const out = await super.append(personId, events, expectedLastSeq);
      if (this.armed) {
        this.armed = false;
        throw new ConcurrencyError(personId, expectedLastSeq, expectedLastSeq + events.length);
      }
      return out;
    }
  }

  it('R-06: an ambiguous commit followed by retry does not skip a second step', async () => {
    const store = new AmbiguousCommitStore();
    await store.replace('sam', seed());
    const svc = new ScaffoldService({ store, clock: realClock, timeZone: TZ });
    const { result: runId } = await svc.execute('sam', 'sam', (s, ctx) => {
      const r = cmdStartRun(s, ctx, { routineRef: 'morning', device: 'echo' });
      return { events: r.events, result: r.runId };
    });
    store.armed = true;
    const { state } = await svc.execute('sam', 'sam', (s, ctx) => ({ events: cmdSkip(s, ctx, { runId, reason: 'asked' }), result: null }));
    const skipped = state.runs[runId]!.steps.filter((x) => x.status === 'skipped').map((x) => x.stepId);
    expect(skipped).toEqual(['teeth']); // the person said "skip" once
  });

  it('R-06: an ambiguous commit followed by retry does not add two levels of help for one "help"', async () => {
    const store = new AmbiguousCommitStore();
    await store.replace('sam', seed());
    const svc = new ScaffoldService({ store, clock: realClock, timeZone: TZ });
    const { result: runId } = await svc.execute('sam', 'sam', (s, ctx) => {
      const r = cmdStartRun(s, ctx, { routineRef: 'morning', device: 'echo' });
      return { events: r.events, result: r.runId };
    });
    store.armed = true;
    const { state } = await svc.execute('sam', 'sam', (s, ctx) => {
      const r = cmdHelp(s, ctx, { runId });
      return { events: r.events, result: r };
    });
    expect(state.runs[runId]!.steps[0]!.helps).toBe(1);
  });
});
