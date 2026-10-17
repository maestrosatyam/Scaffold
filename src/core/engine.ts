// Scaffold engine: a pure projection of the event log plus pure command functions.
//
//   state' = project(state, event)            (no I/O, no clock, no randomness)
//   events = command(state, args, now, ids)   (decides; never mutates)
//
// The fading policy lives in `applyOutcome`. Because the log is the only truth, the coach-facing
// explanation of *why* a step is at its level is just the list of LevelChange records the
// projection produced — replaying the same log always yields the same levels and the same words.

import {
  DEFAULT_POLICY,
  fadeOne,
  supportOne,
  statKey,
  type Level,
  type LevelChange,
  type MasteryPolicy,
  type NewEvent,
  type PersonState,
  type RoutineDef,
  type Run,
  type ScaffoldEvent,
  type StepDef,
  type StepRun,
  type StepStats,
} from './model.ts';

export type DomainErrorCode =
  | 'not_found'
  | 'no_active_run'
  | 'run_not_active'
  | 'step_mismatch'
  | 'forbidden'
  | 'invalid'
  | 'conflict';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'DomainError';
  }
}

/** Runs idle longer than this are treated as abandoned when a new one starts. */
export const STALE_RUN_MS = 3 * 60 * 60 * 1000;

export function emptyState(personId: string): PersonState {
  return {
    personId,
    displayName: personId,
    coachIds: [],
    routines: {},
    proposals: {},
    runs: {},
    runOrder: [],
    versions: {},
    stats: {},
    audit: [],
    lastSeq: 0,
  };
}

export function routineVersion(state: PersonState, routineId: string, version: number): RoutineDef {
  const def = state.versions[routineId]?.[version];
  if (!def) throw new DomainError('not_found', `Routine ${routineId} v${version} not found`);
  return def;
}

function ensureStats(state: PersonState, routineId: string, stepId: string): StepStats {
  const key = statKey(routineId, stepId);
  let s = state.stats[key];
  if (!s) {
    s = {
      routineId,
      stepId,
      level: 'full',
      unaidedStreak: 0,
      aidedStreak: 0,
      streakRunIds: [],
      changes: [],
      needsAttention: false,
    };
    state.stats[key] = s;
  }
  return s;
}

const fmtDay = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(new Date(iso));

/**
 * The fading policy. Deterministic, one level at a time, never skips a level.
 * - unaided completion: streak++; after `fadeAfter` in a row -> one level LESS support.
 * - aided run (help used): after `supportAfter` in a row -> one level MORE support, flag for coach.
 */
export function applyOutcome(
  stats: StepStats,
  policy: MasteryPolicy,
  outcome: 'unaided' | 'aided',
  runId: string,
  at: string,
  runDay: (runId: string) => string,
): LevelChange | null {
  const days = (ids: string[]) => ids.map(runDay).join(', ');
  if (outcome === 'unaided') {
    if (stats.aidedStreak > 0) stats.aidedStreak = 0;
    if (stats.unaidedStreak === 0) stats.streakRunIds = [];
    stats.unaidedStreak += 1;
    stats.streakRunIds.push(runId);
    if (stats.unaidedStreak >= policy.fadeAfter && stats.level !== 'independent') {
      const from = stats.level;
      const to = fadeOne(from);
      const change: LevelChange = {
        at,
        from,
        to,
        cause: 'faded',
        reason: `Faded from ${from} to ${to} after ${policy.fadeAfter} runs in a row without help (${days(stats.streakRunIds)}).`,
        evidenceRunIds: [...stats.streakRunIds],
      };
      stats.level = to;
      stats.unaidedStreak = 0;
      stats.streakRunIds = [];
      stats.needsAttention = false;
      stats.changes.push(change);
      return change;
    }
    return null;
  }
  // aided
  if (stats.unaidedStreak > 0) stats.unaidedStreak = 0;
  if (stats.aidedStreak === 0) stats.streakRunIds = [];
  stats.aidedStreak += 1;
  stats.streakRunIds.push(runId);
  if (stats.aidedStreak >= policy.supportAfter && stats.level !== 'full') {
    const from = stats.level;
    const to = supportOne(from);
    const change: LevelChange = {
      at,
      from,
      to,
      cause: 'support-added',
      reason: `Added support back (${from} to ${to}) because help was needed in ${policy.supportAfter} runs in a row (${days(stats.streakRunIds)}).`,
      evidenceRunIds: [...stats.streakRunIds],
    };
    stats.level = to;
    stats.aidedStreak = 0;
    stats.streakRunIds = [];
    stats.needsAttention = true;
    stats.changes.push(change);
    return change;
  }
  return null;
}

export interface ProjectionOptions {
  timeZone: string;
}

/** Applies one event to the state in place. Exposed for incremental projection. */
export function apply(state: PersonState, e: ScaffoldEvent, opts: ProjectionOptions): void {
  const dayOf = (iso: string) => fmtDay(iso, opts.timeZone);
  state.lastSeq = e.seq;
  const audit = (what: string) => state.audit.push({ seq: e.seq, at: e.at, actorId: e.actorId, what });
  switch (e.type) {
    case 'person.registered': {
      state.displayName = e.displayName;
      state.coachIds = [...e.coachIds];
      audit(`Registered ${e.displayName}; coaches with access: ${e.coachIds.join(', ') || 'none'}`);
      return;
    }
    case 'routine.published': {
      const r = e.routine;
      const versions = (state.versions[r.routineId] ??= {});
      versions[e.version] = r;
      const existing = state.routines[r.routineId];
      state.routines[r.routineId] = {
        current: r,
        version: e.version,
        history: [...(existing?.history ?? []), e.version],
      };
      for (const step of r.steps) ensureStats(state, r.routineId, step.id);
      audit(`Published routine "${r.name}" v${e.version} (${r.steps.length} steps)`);
      return;
    }
    case 'change.proposed': {
      state.proposals[e.proposalId] = {
        proposalId: e.proposalId,
        routine: e.routine,
        baseVersion: e.baseVersion,
        note: e.note,
        proposedBy: e.proposedBy,
        proposedAt: e.at,
        status: 'pending',
      };
      audit(`${e.proposedBy} proposed ${e.baseVersion === null ? 'new routine' : 'changes to'} "${e.routine.name}"`);
      return;
    }
    case 'change.decided': {
      const p = state.proposals[e.proposalId];
      if (p) {
        p.status = e.decision;
        p.decidedAt = e.at;
        audit(`${e.decision === 'approved' ? 'Approved' : 'Declined'} proposal for "${p.routine.name}"`);
      }
      return;
    }
    case 'run.started': {
      const def = routineVersion(state, e.routineId, e.version);
      const steps: StepRun[] = def.steps.map((s) => {
        const level = ensureStats(state, e.routineId, s.id).level;
        return { stepId: s.id, baseLevel: level, level, helps: 0, status: 'pending' };
      });
      const run: Run = {
        runId: e.runId,
        routineId: e.routineId,
        version: e.version,
        startedAt: e.at,
        lastActivityAt: e.at,
        devices: [e.device],
        status: 'active',
        steps,
        completionKeys: {},
        seeded: !!e.seeded,
      };
      state.runs[e.runId] = run;
      state.runOrder.push(e.runId);
      return;
    }
    case 'step.helped': {
      const { run, step } = locate(state, e.runId, e.stepId);
      step.level = e.to;
      step.helps += 1;
      run.lastActivityAt = e.at;
      return;
    }
    case 'step.completed': {
      const { run, step } = locate(state, e.runId, e.stepId);
      step.status = 'done';
      step.completedAt = e.at;
      run.completionKeys[e.idempotencyKey] = e.stepId;
      run.lastActivityAt = e.at;
      const def = routineVersion(state, run.routineId, run.version);
      const stats = ensureStats(state, run.routineId, e.stepId);
      const change = applyOutcome(
        stats,
        def.policy ?? DEFAULT_POLICY,
        step.helps > 0 ? 'aided' : 'unaided',
        run.runId,
        e.at,
        (id) => dayOf(state.runs[id]?.startedAt ?? e.at),
      );
      if (change) {
        const title = def.steps.find((s) => s.id === e.stepId)?.title ?? e.stepId;
        audit(`"${title}": ${change.reason}`);
      }
      return;
    }
    case 'step.skipped': {
      const { run, step } = locate(state, e.runId, e.stepId);
      step.status = 'skipped';
      run.lastActivityAt = e.at;
      // A skip is not evidence either way, but it does break an unaided streak.
      const stats = ensureStats(state, run.routineId, e.stepId);
      stats.unaidedStreak = 0;
      return;
    }
    case 'run.resumed': {
      const run = state.runs[e.runId];
      if (run) {
        run.lastActivityAt = e.at;
        if (!run.devices.includes(e.device)) run.devices.push(e.device);
      }
      return;
    }
    case 'run.finished': {
      const run = state.runs[e.runId];
      if (run) {
        run.status = 'finished';
        run.finishedAt = e.at;
      }
      return;
    }
    case 'run.abandoned': {
      const run = state.runs[e.runId];
      if (run) run.status = 'abandoned';
      return;
    }
    case 'level.set': {
      const stats = ensureStats(state, e.routineId, e.stepId);
      if (stats.level !== e.level) {
        stats.changes.push({
          at: e.at,
          from: stats.level,
          to: e.level,
          cause: 'coach-set',
          reason: `Set by ${e.actorId}: ${e.reason}`,
          evidenceRunIds: [],
        });
      }
      stats.level = e.level;
      stats.unaidedStreak = 0;
      stats.aidedStreak = 0;
      stats.streakRunIds = [];
      stats.needsAttention = false;
      audit(`Set level of ${e.stepId} to ${e.level}: ${e.reason}`);
      return;
    }
  }
}

function locate(state: PersonState, runId: string, stepId: string): { run: Run; step: StepRun } {
  const run = state.runs[runId];
  if (!run) throw new DomainError('not_found', `Run ${runId} not found`);
  const step = run.steps.find((s) => s.stepId === stepId);
  if (!step) throw new DomainError('not_found', `Step ${stepId} not in run ${runId}`);
  return { run, step };
}

export function project(personId: string, events: readonly ScaffoldEvent[], opts: ProjectionOptions): PersonState {
  const state = emptyState(personId);
  for (const e of events) apply(state, e, opts);
  return state;
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

export function currentStepIndex(run: Run): number {
  return run.steps.findIndex((s) => s.status === 'pending');
}

export function activeRun(state: PersonState, now: string, routineId?: string): Run | undefined {
  for (let i = state.runOrder.length - 1; i >= 0; i--) {
    const run = state.runs[state.runOrder[i]!]!;
    if (run.status !== 'active') continue;
    if (routineId && run.routineId !== routineId) continue;
    if (Date.parse(now) - Date.parse(run.lastActivityAt) > STALE_RUN_MS) continue;
    return run;
  }
  return undefined;
}

/** Resolve a spoken or typed routine reference ("morning", "my morning routine", id). */
export function findRoutine(state: PersonState, ref: string | undefined): RoutineDef | undefined {
  const all = Object.values(state.routines).map((r) => r.current);
  if (!ref) return all[0];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const q = norm(ref).replace(/\b(my|the|routine)\b/g, '').trim();
  return (
    all.find((r) => r.routineId === ref) ??
    all.find((r) => norm(r.name) === q || r.aliases.some((a) => norm(a) === q)) ??
    all.find((r) => q.length > 0 && (norm(r.name).includes(q) || r.aliases.some((a) => q.includes(norm(a)))))
  );
}

// ---------------------------------------------------------------------------------------------
// Commands: return the events to append. They validate against current state but never mutate it.
// ---------------------------------------------------------------------------------------------

export interface Ctx {
  now: string;
  actorId: string;
  newId: (prefix: string) => string;
}

export function cmdStartRun(
  state: PersonState,
  ctx: Ctx,
  args: { routineRef?: string; device: string },
): { events: NewEvent[]; runId: string; resumed: boolean } {
  const routine = findRoutine(state, args.routineRef);
  if (!routine) {
    const names = Object.values(state.routines).map((r) => r.current.name);
    throw new DomainError(
      'not_found',
      names.length ? `I couldn't find that routine. You have: ${names.join(', ')}.` : 'There are no routines yet.',
    );
  }
  const events: NewEvent[] = [];
  const live = activeRun(state, ctx.now, routine.routineId);
  if (live) {
    events.push({ type: 'run.resumed', runId: live.runId, device: args.device, at: ctx.now, actorId: ctx.actorId });
    return { events, runId: live.runId, resumed: true };
  }
  // Close out stale runs of the same routine so reports stay honest.
  for (const id of state.runOrder) {
    const r = state.runs[id]!;
    if (r.status === 'active' && r.routineId === routine.routineId) {
      events.push({ type: 'run.abandoned', runId: id, reason: 'stale', at: ctx.now, actorId: ctx.actorId });
    }
  }
  const runId = ctx.newId('run');
  const version = state.routines[routine.routineId]!.version;
  events.push({
    type: 'run.started',
    runId,
    routineId: routine.routineId,
    version,
    device: args.device,
    at: ctx.now,
    actorId: ctx.actorId,
  });
  return { events, runId, resumed: false };
}

function requireActive(state: PersonState, runId: string): Run {
  const run = state.runs[runId];
  if (!run) throw new DomainError('not_found', `Run ${runId} not found`);
  if (run.status !== 'active') throw new DomainError('run_not_active', `That routine is already ${run.status}.`);
  return run;
}

export function cmdComplete(
  state: PersonState,
  ctx: Ctx,
  args: { runId: string; stepId?: string; idempotencyKey: string; allRemaining?: boolean },
): { events: NewEvent[]; duplicate: boolean; completed: string[] } {
  const existingRun = state.runs[args.runId];
  if (existingRun && existingRun.completionKeys[args.idempotencyKey]) {
    // Retried request (e.g. the assistant re-sent after a timeout): no double advance.
    return { events: [], duplicate: true, completed: [] };
  }
  const run = requireActive(state, args.runId);
  const idx = currentStepIndex(run);
  if (idx < 0) throw new DomainError('conflict', 'All steps are already done.');
  const current = run.steps[idx]!;
  if (args.stepId && args.stepId !== current.stepId) {
    const target = run.steps.find((s) => s.stepId === args.stepId);
    if (!target) throw new DomainError('not_found', `Step ${args.stepId} is not part of this routine.`);
    if (target.status !== 'pending') {
      return { events: [], duplicate: true, completed: [] };
    }
    throw new DomainError('step_mismatch', `The current step is ${current.stepId}, not ${args.stepId}.`);
  }
  const events: NewEvent[] = [];
  const completed: string[] = [];
  const base = { at: ctx.now, actorId: ctx.actorId };
  events.push({ type: 'step.completed', runId: run.runId, stepId: current.stepId, idempotencyKey: args.idempotencyKey, ...base });
  completed.push(current.stepId);
  if (args.allRemaining) {
    // "All done": only steps the person already does on their own may be bulk-completed.
    for (let i = idx + 1; i < run.steps.length; i++) {
      const s = run.steps[i]!;
      if (s.status !== 'pending') continue;
      if (s.level !== 'independent') break;
      events.push({
        type: 'step.completed',
        runId: run.runId,
        stepId: s.stepId,
        idempotencyKey: `${args.idempotencyKey}#${s.stepId}`,
        bulk: true,
        ...base,
      });
      completed.push(s.stepId);
    }
  }
  const remaining = run.steps.filter((s) => s.status === 'pending' && !completed.includes(s.stepId));
  if (remaining.length === 0) events.push({ type: 'run.finished', runId: run.runId, ...base });
  return { events, duplicate: false, completed };
}

export function cmdHelp(
  state: PersonState,
  ctx: Ctx,
  args: { runId: string },
): { events: NewEvent[]; stepId: string; from: Level; to: Level; atMax: boolean } {
  const run = requireActive(state, args.runId);
  const idx = currentStepIndex(run);
  if (idx < 0) throw new DomainError('conflict', 'All steps are already done.');
  const step = run.steps[idx]!;
  const to = supportOne(step.level);
  const atMax = to === step.level;
  // Help at the most explicit level is still recorded: it is evidence that support was needed.
  const events: NewEvent[] = [
    { type: 'step.helped', runId: run.runId, stepId: step.stepId, from: step.level, to, at: ctx.now, actorId: ctx.actorId },
  ];
  return { events, stepId: step.stepId, from: step.level, to, atMax };
}

export function cmdSkip(state: PersonState, ctx: Ctx, args: { runId: string; reason: 'late' | 'asked' }): NewEvent[] {
  const run = requireActive(state, args.runId);
  const idx = currentStepIndex(run);
  if (idx < 0) throw new DomainError('conflict', 'All steps are already done.');
  const events: NewEvent[] = [
    { type: 'step.skipped', runId: run.runId, stepId: run.steps[idx]!.stepId, reason: args.reason, at: ctx.now, actorId: ctx.actorId },
  ];
  if (run.steps.filter((s) => s.status === 'pending').length === 1) {
    events.push({ type: 'run.finished', runId: run.runId, at: ctx.now, actorId: ctx.actorId });
  }
  return events;
}

/**
 * Running late: keep every must-do step, then optional steps in order while they fit.
 * Returns the skip events for the steps that no longer fit.
 */
export function planForTime(
  state: PersonState,
  runId: string,
  minutesLeft: number,
): { keep: StepDef[]; drop: StepDef[]; fitsSec: number; overBySec: number } {
  const run = requireActive(state, runId);
  const def = routineVersion(state, run.routineId, run.version);
  const pending = run.steps.filter((s) => s.status === 'pending').map((s) => def.steps.find((d) => d.id === s.stepId)!);
  const budget = Math.max(0, Math.round(minutesLeft * 60));
  const must = pending.filter((s) => s.must);
  let used = must.reduce((a, s) => a + s.estSec, 0);
  const keepIds = new Set(must.map((s) => s.id));
  for (const s of pending) {
    if (s.must) continue;
    if (used + s.estSec <= budget) {
      keepIds.add(s.id);
      used += s.estSec;
    }
  }
  const keep = pending.filter((s) => keepIds.has(s.id));
  const drop = pending.filter((s) => !keepIds.has(s.id));
  return { keep, drop, fitsSec: used, overBySec: Math.max(0, used - budget) };
}

export function cmdPropose(
  state: PersonState,
  ctx: Ctx,
  args: { routine: RoutineDef; note: string; proposedBy: string },
): { events: NewEvent[]; proposalId: string } {
  const existing = state.routines[args.routine.routineId];
  const proposalId = ctx.newId('prop');
  return {
    proposalId,
    events: [
      {
        type: 'change.proposed',
        proposalId,
        routine: args.routine,
        baseVersion: existing ? existing.version : null,
        note: args.note,
        proposedBy: args.proposedBy,
        at: ctx.now,
        actorId: ctx.actorId,
      },
    ],
  };
}

export function cmdDecide(
  state: PersonState,
  ctx: Ctx,
  args: { proposalId: string; decision: 'approved' | 'declined' },
): NewEvent[] {
  const p = state.proposals[args.proposalId];
  if (!p) throw new DomainError('not_found', 'That suggestion was not found.');
  if (p.status !== 'pending') {
    if (p.status === args.decision) return []; // idempotent repeat
    throw new DomainError('conflict', `That suggestion was already ${p.status}.`);
  }
  const current = state.routines[p.routine.routineId];
  if (current && p.baseVersion !== current.version) {
    throw new DomainError('conflict', 'The routine changed since this was suggested. Ask your coach to suggest it again.');
  }
  const events: NewEvent[] = [
    { type: 'change.decided', proposalId: p.proposalId, decision: args.decision, at: ctx.now, actorId: ctx.actorId },
  ];
  if (args.decision === 'approved') {
    events.push({
      type: 'routine.published',
      routine: p.routine,
      version: (current?.version ?? 0) + 1,
      proposalId: p.proposalId,
      at: ctx.now,
      actorId: ctx.actorId,
    });
  }
  return events;
}
