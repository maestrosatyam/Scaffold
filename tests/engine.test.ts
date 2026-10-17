import { describe, expect, it } from 'vitest';
import {
  DomainError,
  apply,
  applyOutcome,
  cmdComplete,
  cmdDecide,
  cmdHelp,
  cmdPropose,
  cmdStartRun,
  emptyState,
  findRoutine,
  planForTime,
  project,
  type Ctx,
} from '../src/core/engine.ts';
import { LEVELS, levelIndex, type NewEvent, type PersonState, type ScaffoldEvent, type StepStats } from '../src/core/model.ts';
import { finishFacts, finishSpeech, startSpeech } from '../src/core/speech.ts';
import { independenceReport, stepView } from '../src/core/views.ts';
import { LAUNDRY_TEMPLATE, MORNING, OUTCOMES, buildSeedEvents } from '../src/demo/seed.ts';

const TZ = 'America/Los_Angeles';

function harness() {
  const events: ScaffoldEvent[] = [];
  const state = emptyState('sam');
  let t = Date.parse('2026-10-18T14:00:00Z');
  let n = 0;
  const ctx = (): Ctx => ({ now: new Date((t += 30_000)).toISOString(), actorId: 'sam', newId: (p) => `${p}-${++n}` });
  const push = (es: NewEvent[]) => {
    for (const e of es) {
      const full = { ...e, seq: events.length + 1 } as ScaffoldEvent;
      events.push(full);
      apply(state, full, { timeZone: TZ });
    }
  };
  push([
    { type: 'person.registered', personId: 'sam', displayName: 'Sam', coachIds: ['priya'], at: ctx().now, actorId: 'sam' },
    { type: 'routine.published', routine: MORNING, version: 1, at: ctx().now, actorId: 'sam' },
  ]);
  return { events, state, ctx, push, advanceDays: (d: number) => (t += d * 86_400_000) };
}

/** Runs the whole morning routine once; `helpOn` steps ask for help once. */
function runOnce(h: ReturnType<typeof harness>, helpOn: string[] = []) {
  const s = cmdStartRun(h.state, h.ctx(), { device: 'bedroom' });
  h.push(s.events);
  for (const step of MORNING.steps) {
    if (helpOn.includes(step.id)) h.push(cmdHelp(h.state, h.ctx(), { runId: s.runId }).events);
    h.push(cmdComplete(h.state, h.ctx(), { runId: s.runId, stepId: step.id, idempotencyKey: `${s.runId}/${step.id}` }).events);
  }
  h.advanceDays(1);
  return s.runId;
}

describe('fading policy', () => {
  it('fades one level after 3 consecutive unaided runs, and never skips a level', () => {
    const h = harness();
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      runOnce(h);
      seen.push(h.state.stats['morning/teeth']!.level);
    }
    expect(seen).toEqual(['full', 'full', 'partial', 'partial', 'partial', 'cue', 'cue', 'cue', 'independent', 'independent', 'independent', 'independent']);
    const changes = h.state.stats['morning/teeth']!.changes;
    for (const c of changes) expect(levelIndex(c.to) - levelIndex(c.from)).toBe(1);
  });

  it('adds support back after 2 consecutive aided runs and flags the step', () => {
    const h = harness();
    for (let i = 0; i < 9; i++) runOnce(h);
    expect(h.state.stats['morning/bag']!.level).toBe('independent');
    runOnce(h, ['bag']);
    expect(h.state.stats['morning/bag']!.level).toBe('independent');
    runOnce(h, ['bag']);
    const st = h.state.stats['morning/bag']!;
    expect(st.level).toBe('cue');
    expect(st.needsAttention).toBe(true);
    expect(st.changes.at(-1)!.cause).toBe('support-added');
    expect(st.changes.at(-1)!.reason).toMatch(/help was needed in 2 runs in a row/);
  });

  it('an aided run breaks an unaided streak (no fade on 2+aided+1)', () => {
    const h = harness();
    runOnce(h);
    runOnce(h);
    runOnce(h, ['face']);
    runOnce(h);
    expect(h.state.stats['morning/face']!.level).toBe('full');
  });

  it('property: random outcome sequences keep invariants (bounded, one level per change, replay-deterministic)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let trial = 0; trial < 200; trial++) {
      const stats: StepStats = { routineId: 'r', stepId: 's', level: LEVELS[Math.floor(rnd() * 4)]!, unaidedStreak: 0, aidedStreak: 0, streakRunIds: [], changes: [], needsAttention: false };
      const fadeAfter = 1 + Math.floor(rnd() * 4);
      const supportAfter = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < 40; i++) {
        const before = stats.level;
        const change = applyOutcome(stats, { fadeAfter, supportAfter }, rnd() < 0.6 ? 'unaided' : 'aided', `r${i}`, '2026-10-01T00:00:00Z', (id) => id);
        expect(LEVELS).toContain(stats.level);
        expect(Math.abs(levelIndex(stats.level) - levelIndex(before))).toBeLessThanOrEqual(1);
        if (change) expect(change.from).toBe(before);
        else expect(stats.level).toBe(before);
      }
    }
  });
});

describe('runs', () => {
  it('step_done is idempotent: a retried completion never double-advances', () => {
    const h = harness();
    const s = cmdStartRun(h.state, h.ctx(), { device: 'bedroom' });
    h.push(s.events);
    const first = cmdComplete(h.state, h.ctx(), { runId: s.runId, stepId: 'teeth', idempotencyKey: 'k1' });
    h.push(first.events);
    const retry = cmdComplete(h.state, h.ctx(), { runId: s.runId, stepId: 'teeth', idempotencyKey: 'k1' });
    expect(retry.duplicate).toBe(true);
    expect(retry.events).toHaveLength(0);
    // Same step id with a different key is also a no-op (step already done)
    const again = cmdComplete(h.state, h.ctx(), { runId: s.runId, stepId: 'teeth', idempotencyKey: 'k2' });
    expect(again.duplicate).toBe(true);
    expect(stepView(h.state, h.state.runs[s.runId]!)!.stepId).toBe('face');
  });

  it('rejects completing a future step out of order', () => {
    const h = harness();
    const s = cmdStartRun(h.state, h.ctx(), { device: 'bedroom' });
    h.push(s.events);
    expect(() => cmdComplete(h.state, h.ctx(), { runId: s.runId, stepId: 'door', idempotencyKey: 'x' })).toThrow(DomainError);
  });

  it('starting again while a run is active resumes it (cross-device) instead of restarting', () => {
    const h = harness();
    const a = cmdStartRun(h.state, h.ctx(), { device: 'bedroom' });
    h.push(a.events);
    h.push(cmdComplete(h.state, h.ctx(), { runId: a.runId, stepId: 'teeth', idempotencyKey: 'k' }).events);
    const b = cmdStartRun(h.state, h.ctx(), { device: 'kitchen' });
    expect(b.resumed).toBe(true);
    expect(b.runId).toBe(a.runId);
    h.push(b.events);
    expect(h.state.runs[a.runId]!.devices).toEqual(['bedroom', 'kitchen']);
  });

  it('help escalates one level per request and saturates at full', () => {
    const h = harness();
    for (let i = 0; i < 9; i++) runOnce(h);
    const s = cmdStartRun(h.state, h.ctx(), { device: 'bedroom' });
    h.push(s.events);
    const levels: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = cmdHelp(h.state, h.ctx(), { runId: s.runId });
      h.push(r.events);
      levels.push(r.to);
    }
    expect(levels).toEqual(['cue', 'partial', 'full', 'full', 'full']);
  });

  it('"all done" bulk-completes only steps already at independent', () => {
    const h = harness();
    for (let i = 0; i < 9; i++) runOnce(h, i >= 6 ? ['door'] : []);
    // door has been aided at the end -> not independent
    const s = cmdStartRun(h.state, h.ctx(), { device: 'bedroom' });
    h.push(s.events);
    const r = cmdComplete(h.state, h.ctx(), { runId: s.runId, stepId: 'teeth', idempotencyKey: 'all', allRemaining: true });
    h.push(r.events);
    expect(r.completed).toEqual(['teeth', 'face', 'dress', 'breakfast', 'bag']);
    expect(stepView(h.state, h.state.runs[s.runId]!)!.stepId).toBe('door');
  });

  it('running late keeps must-do steps and drops optional ones that do not fit', () => {
    const h = harness();
    const s = cmdStartRun(h.state, h.ctx(), { device: 'bedroom' });
    h.push(s.events);
    const plan = planForTime(h.state, s.runId, 10);
    expect(plan.drop.map((d) => d.id)).toEqual(['breakfast']);
    expect(plan.keep.every((k) => k.must)).toBe(true);
  });
});

describe('speech', () => {
  it('framing fades with the prompt and is byte-identical for identical state', () => {
    const h = harness();
    const s = cmdStartRun(h.state, h.ctx(), { device: 'bedroom' });
    h.push(s.events);
    const v = stepView(h.state, h.state.runs[s.runId]!)!;
    expect(startSpeech(v, false)).toBe(
      "Let's do your morning routine. Step 1 of 6. Pick up the blue toothbrush. Squeeze a pea-sized bit of toothpaste onto it. Brush the top teeth, then the bottom teeth, then rinse.",
    );
    const replay = project('sam', h.events, { timeZone: TZ });
    expect(startSpeech(stepView(replay, replay.runs[s.runId]!)!, false)).toBe(startSpeech(v, false));
  });

  it('is silent for independent steps and announces fades at the end of a run', () => {
    const h = harness();
    for (let i = 0; i < 8; i++) runOnce(h);
    const runId = runOnce(h);
    const run = h.state.runs[runId]!;
    const titles = Object.fromEntries(MORNING.steps.map((s) => [s.id, s.title]));
    const speech = finishSpeech(finishFacts(h.state, run, titles), TZ);
    expect(speech).toMatch(/^Nice, you're done at \d{1,2}:\d{2} [AP]M\./);
    expect(speech).toMatch(/I'll say less for them from now on/);
    const s = cmdStartRun(h.state, h.ctx(), { device: 'bedroom' });
    h.push(s.events);
    expect(startSpeech(stepView(h.state, h.state.runs[s.runId]!)!, false)).toBe("Okay, morning routine. I'm here if you need me.");
  });
});

describe('suggestions (coach proposes, learner decides)', () => {
  it('nothing changes until the learner approves; approval publishes a version', () => {
    const h = harness();
    const p = cmdPropose(h.state, { ...h.ctx(), actorId: 'priya' }, { routine: LAUNDRY_TEMPLATE, note: 'Try this on Saturday', proposedBy: 'Priya' });
    h.push(p.events);
    expect(findRoutine(h.state, 'laundry')).toBeUndefined();
    h.push(cmdDecide(h.state, h.ctx(), { proposalId: p.proposalId, decision: 'approved' }));
    expect(h.state.routines.laundry!.version).toBe(1);
    expect(cmdDecide(h.state, h.ctx(), { proposalId: p.proposalId, decision: 'approved' })).toEqual([]);
    expect(() => cmdDecide(h.state, h.ctx(), { proposalId: p.proposalId, decision: 'declined' })).toThrow(/already approved/);
  });

  it('rejects a stale suggestion when the routine changed since it was proposed', () => {
    const h = harness();
    const edited = { ...MORNING, steps: MORNING.steps.slice(0, 5) };
    const a = cmdPropose(h.state, h.ctx(), { routine: edited, note: '', proposedBy: 'Priya' });
    h.push(a.events);
    const b = cmdPropose(h.state, h.ctx(), { routine: { ...MORNING, name: 'Mornings' }, note: '', proposedBy: 'Priya' });
    h.push(b.events);
    h.push(cmdDecide(h.state, h.ctx(), { proposalId: a.proposalId, decision: 'approved' }));
    expect(() => cmdDecide(h.state, h.ctx(), { proposalId: b.proposalId, decision: 'approved' })).toThrow(/changed since/);
  });
});

describe('seeded demo history', () => {
  const events = buildSeedEvents({ today: '2026-10-18', timeZone: TZ });
  const state: PersonState = project('sam', events, { timeZone: TZ });

  it('is produced by the real engine and is fully labelled as seeded', () => {
    expect(events.every((e) => e.seeded === true)).toBe(true);
    const report = independenceReport(state, 'morning');
    expect(report.runs).toHaveLength(21);
    expect(report.seededRuns).toBe(21);
    expect(report.liveRuns).toBe(0);
    expect(report.runs.at(-1)!.startedAt.slice(0, 10)).toBe('2026-10-17');
  });

  it('ends in the documented demo state and prompting falls substantially', () => {
    const levels = Object.fromEntries(MORNING.steps.map((s) => [s.id, state.stats[`morning/${s.id}`]!.level]));
    expect(levels).toEqual({ teeth: 'independent', face: 'independent', dress: 'cue', breakfast: 'independent', bag: 'partial', door: 'cue' });
    const r = independenceReport(state, 'morning');
    expect(r.firstWords!).toBeGreaterThan(5 * r.lastWords!);
    expect(r.attention.map((a) => a.stepId)).toEqual(['bag']);
    expect(Object.values(OUTCOMES).every((o) => o.length === 21)).toBe(true);
  });

  it('replay is deterministic', () => {
    const again = buildSeedEvents({ today: '2026-10-18', timeZone: TZ });
    expect(JSON.stringify(again)).toBe(JSON.stringify(events));
  });
});
