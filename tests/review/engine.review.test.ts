// Adversarial review: pure engine (src/core/engine.ts, views.ts, validate.ts) and the stores.
import { DynamoDBClient, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cmdComplete,
  cmdDecide,
  cmdPropose,
  cmdStartRun,
  emptyState,
  findRoutine,
  planForTime,
  routineVersion,
  apply,
} from '../../src/core/engine.ts';
import type { NewEvent, RoutineDef, ScaffoldEvent } from '../../src/core/model.ts';
import { RoutineDefSchema, validateRoutine } from '../../src/core/validate.ts';
import { independenceReport, promptFor, summarizeRun, wordCount } from '../../src/core/views.ts';
import { LAUNDRY_TEMPLATE, MORNING } from '../../src/demo/seed.ts';
import { DynamoStore } from '../../src/store/dynamo.ts';
import { TZ, harness } from './helpers.ts';

/** Run the morning routine once with no help. */
function unaidedRun(h: ReturnType<typeof harness>) {
  const s = cmdStartRun(h.state, h.ctx(), { routineRef: 'morning', device: 'echo' });
  h.push(s.events);
  for (const step of MORNING.steps) {
    h.push(cmdComplete(h.state, h.ctx(), { runId: s.runId, stepId: step.id, idempotencyKey: `${s.runId}/${step.id}` }).events);
  }
  h.advanceDays(1);
  return s.runId;
}

describe('prototype keys in user-controlled record keys', () => {
  afterEach(() => {
    for (const k of Object.keys(Object)) delete (Object as unknown as Record<string, unknown>)[k];
  });

  const ctorRoutine = () => RoutineDefSchema.parse({ ...LAUNDRY_TEMPLATE, routineId: 'constructor', name: 'Alice private routine' }) as RoutineDef;

  it('R-13: approving a routine with routineId "constructor" (passes RoutineDefSchema) does not write into the global Object constructor', () => {
    const alice = harness('alice');
    const p = cmdPropose(alice.state, alice.ctx(), { routine: ctorRoutine(), note: '', proposedBy: 'Coach' });
    alice.push(p.events);
    alice.push(cmdDecide(alice.state, alice.ctx(), { proposalId: p.proposalId, decision: 'approved' }));
    expect(Object.keys(Object)).toEqual([]); // today: ['1'] — Object[1] === Alice's routine, process-wide
  });

  it("R-13: another person's projection cannot see a \"constructor\" routine they never had", () => {
    const alice = harness('alice');
    const p = cmdPropose(alice.state, alice.ctx(), { routine: ctorRoutine(), note: '', proposedBy: 'Coach' });
    alice.push(p.events);
    alice.push(cmdDecide(alice.state, alice.ctx(), { proposalId: p.proposalId, decision: 'approved' }));
    const bob = emptyState('bob');
    expect(() => routineVersion(bob, 'constructor', 1)).toThrow(/not found/); // today: returns Alice's routine
  });

  it('R-13: a brand-new "constructor" routine is proposed as new (baseVersion null), not as "changes to" an existing one', () => {
    const alice = harness('alice');
    const p = cmdPropose(alice.state, alice.ctx(), { routine: ctorRoutine(), note: '', proposedBy: 'Coach' });
    expect((p.events[0] as Extract<NewEvent, { type: 'change.proposed' }>).baseVersion).toBeNull(); // today: undefined
  });
});

describe('suggestions', () => {
  it('R-14: a stale suggestion can still be declined (otherwise it stays pending and is read out first forever)', () => {
    const h = harness();
    const a = cmdPropose(h.state, h.ctx(), { routine: LAUNDRY_TEMPLATE, note: 'first try', proposedBy: 'Priya' });
    h.push(a.events);
    const b = cmdPropose(h.state, h.ctx(), { routine: { ...LAUNDRY_TEMPLATE, name: 'Laundry v2' }, note: '', proposedBy: 'Priya' });
    h.push(b.events);
    h.push(cmdDecide(h.state, h.ctx(), { proposalId: b.proposalId, decision: 'approved' }));
    // The learner says "not now" to the older one.
    expect(() => h.push(cmdDecide(h.state, h.ctx(), { proposalId: a.proposalId, decision: 'declined' }))).not.toThrow();
    expect(h.state.proposals[a.proposalId]!.status).toBe('declined');
  });
});

describe('fading policy vs. what the tools promise', () => {
  it('R-15: running_late skips "do not count against the person" — a late-day skip must not reset progress toward fading', () => {
    const h = harness();
    unaidedRun(h);
    unaidedRun(h); // breakfast: 2 of 3 unaided runs needed to fade
    const s = cmdStartRun(h.state, h.ctx(), { routineRef: 'morning', device: 'echo' });
    h.push(s.events);
    // running_late with 9 minutes: breakfast (optional, 10 min) is dropped exactly as the tool does it.
    const plan = planForTime(h.state, s.runId, 9);
    expect(plan.drop.map((d) => d.id)).toEqual(['breakfast']);
    h.push(plan.drop.map((d) => ({ type: 'step.skipped' as const, runId: s.runId, stepId: d.id, reason: 'late' as const, at: h.ctx().now, actorId: 'sam' })));
    for (const step of MORNING.steps.filter((x) => x.id !== 'breakfast')) {
      h.push(cmdComplete(h.state, h.ctx(), { runId: s.runId, stepId: step.id, idempotencyKey: `${s.runId}/${step.id}` }).events);
    }
    h.advanceDays(1);
    unaidedRun(h); // third unaided breakfast
    expect(h.state.stats['morning/breakfast']!.level).toBe('partial'); // today: still 'full' (streak reset by the skip)
  });

  it('R-23: an independent step does not accumulate an unbounded streak / evidence list', () => {
    const h = harness();
    for (let i = 0; i < 40; i++) unaidedRun(h);
    const st = h.state.stats['morning/teeth']!;
    expect(st.level).toBe('independent');
    expect(st.streakRunIds.length).toBeLessThanOrEqual(MORNING.policy.fadeAfter); // today: 31 and growing per run
  });
});

describe('coach report honesty', () => {
  it('R-16: the headline never says prompting "fell" when it rose', () => {
    const h = harness();
    const at = () => h.ctx().now;
    // Coach starts every step at "independent", then has to put full support back.
    h.push(MORNING.steps.map((s) => ({ type: 'level.set' as const, routineId: 'morning', stepId: s.id, level: 'independent' as const, reason: 'start light', at: at(), actorId: 'priya' })));
    unaidedRun(h);
    h.push(MORNING.steps.map((s) => ({ type: 'level.set' as const, routineId: 'morning', stepId: s.id, level: 'full' as const, reason: 'too hard', at: at(), actorId: 'priya' })));
    unaidedRun(h);
    const rep = independenceReport(h.state, 'morning');
    expect(rep.firstWords).toBe(0);
    expect(rep.lastWords!).toBeGreaterThan(0);
    expect(rep.headline).not.toMatch(/fell from 0 words/);
  });

  it('R-24: "words of prompting spoken" does not count steps that running_late dropped before they were ever presented', () => {
    const h = harness();
    const s = cmdStartRun(h.state, h.ctx(), { routineRef: 'morning', device: 'echo' });
    h.push(s.events);
    const plan = planForTime(h.state, s.runId, 0);
    h.push(plan.drop.map((d) => ({ type: 'step.skipped' as const, runId: s.runId, stepId: d.id, reason: 'late' as const, at: h.ctx().now, actorId: 'sam' })));
    for (const step of MORNING.steps.filter((x) => x.must)) {
      h.push(cmdComplete(h.state, h.ctx(), { runId: s.runId, stepId: step.id, idempotencyKey: `${s.runId}/${step.id}` }).events);
    }
    const run = h.state.runs[s.runId]!;
    expect(run.status).toBe('finished');
    const spoken = MORNING.steps.filter((x) => x.must).reduce((a, x) => a + wordCount(promptFor(x, 'full')), 0);
    expect(summarizeRun(h.state, run).words).toBe(spoken); // today: also counts the never-spoken breakfast prompt
  });
});

describe('routine matching', () => {
  it('R-19: an alias that normalises to "" (accepted by RoutineDefSchema, no validation issue) does not capture every request', () => {
    // Fix: the schema now rejects degenerate aliases...
    expect(() => RoutineDefSchema.parse({ ...MORNING, aliases: [...MORNING.aliases, '!!'] })).toThrow(/aliases need at least two/);
    // ...and the matcher ignores them even if one reaches the log by another path.
    const morning = { ...MORNING, aliases: [...MORNING.aliases, '!!'] } as RoutineDef;
    expect(validateRoutine(morning).filter((i) => i.severity === 'error')).toEqual([]);
    const state = emptyState('sam');
    const ev = (e: NewEvent, seq: number) => apply(state, { ...e, seq } as ScaffoldEvent, { timeZone: TZ });
    ev({ type: 'routine.published', routine: morning, version: 1, at: '2026-10-18T14:00:00Z', actorId: 'sam' }, 1);
    ev({ type: 'routine.published', routine: LAUNDRY_TEMPLATE, version: 1, at: '2026-10-18T14:00:00Z', actorId: 'sam' }, 2);
    expect(findRoutine(state, 'do the laundry now')?.routineId).toBe('laundry'); // today: 'morning'
  });
});

describe('DynamoDB optimistic concurrency', () => {
  it('R-22: append() also proves seq N is the current tail (Memory/SQLite reject a stale-high expectedLastSeq; Dynamo would write a gap)', async () => {
    const ddb = mockClient(DynamoDBClient);
    ddb.on(TransactWriteItemsCommand).resolves({});
    const store = new DynamoStore(new DynamoDBClient({ region: 'us-east-1', credentials: { accessKeyId: 'x', secretAccessKey: 'y' } }), 't');
    await store.append('p', [{ type: 'run.finished', runId: 'r', at: '2026-10-18T00:00:00Z', actorId: 'p' }], 5);
    const items = ddb.commandCalls(TransactWriteItemsCommand)[0]!.args[0].input.TransactItems!;
    // Expect a ConditionCheck that item (p, 5) exists, or an equivalent tail check.
    expect(items.some((i) => i.ConditionCheck?.Key?.seq?.N === '5')).toBe(true);
    ddb.restore();
  });
});

describe('default routine selection', () => {
  it('R-27: publishing a routine whose id is all digits (allowed by the schema) does not silently change the default routine', () => {
    const h = harness();
    // Fix: ids must start with a letter now; and default selection follows publish order regardless.
    expect(() => RoutineDefSchema.parse({ ...LAUNDRY_TEMPLATE, routineId: '2', name: 'Pills' })).toThrow();
    const pills = { ...LAUNDRY_TEMPLATE, routineId: '2', name: 'Pills' } as RoutineDef;
    const p = cmdPropose(h.state, h.ctx(), { routine: pills, note: '', proposedBy: 'Priya' });
    h.push(p.events);
    h.push(cmdDecide(h.state, h.ctx(), { proposalId: p.proposalId, decision: 'approved' }));
    // "start my routine" / my_progress / independence_report with no routine argument:
    expect(findRoutine(h.state, undefined)?.routineId).toBe('morning'); // today: '2' (integer keys sort first)
  });
});
