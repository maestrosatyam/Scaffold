// Scaffold domain model.
//
// Everything the coach knows is derived from an append-only, per-person event log.
// No randomness and no wall-clock reads live in this module: callers pass `at` timestamps,
// which keeps replay byte-for-byte deterministic (see engine.ts / projection).

/** Support levels, ordered from MOST support to LEAST support. */
export const LEVELS = ['full', 'partial', 'cue', 'independent'] as const;
export type Level = (typeof LEVELS)[number];

export const levelIndex = (l: Level): number => LEVELS.indexOf(l);
/** One step less support (fading). Saturates at `independent`. */
export const fadeOne = (l: Level): Level => LEVELS[Math.min(levelIndex(l) + 1, LEVELS.length - 1)]!;
/** One step more support (escalation). Saturates at `full`. */
export const supportOne = (l: Level): Level => LEVELS[Math.max(levelIndex(l) - 1, 0)]!;

export interface StepPrompts {
  /** Most explicit wording: every sub-action spelled out. */
  full: string;
  /** Shorter reminder of the whole step. */
  partial: string;
  /** One- or two-word cue. */
  cue: string;
}

export interface StepDef {
  id: string;
  title: string;
  /** Key into the pictogram set shipped with the MCP Apps (see src/apps/pictograms.ts). */
  pictogram: string;
  prompts: StepPrompts;
  /** Must-do steps are never dropped when the person is running late. */
  must: boolean;
  /** Typical duration in seconds; used for check-ins and time replanning. */
  estSec: number;
}

export interface MasteryPolicy {
  /** Consecutive unaided completions at the current level before fading one level. */
  fadeAfter: number;
  /** Consecutive aided runs before adding one level of support back. */
  supportAfter: number;
}

export const DEFAULT_POLICY: MasteryPolicy = { fadeAfter: 3, supportAfter: 2 };

export interface RoutineDef {
  routineId: string;
  name: string;
  /** Spoken aliases the router / Alexa can match, e.g. "morning", "get ready". */
  aliases: string[];
  steps: StepDef[];
  policy: MasteryPolicy;
}

export type Role = 'learner' | 'coach';

export interface Actor {
  personId: string; // whose data is being acted on
  actorId: string; // who is acting
  role: Role;
  displayName: string;
}

// ---------------------------------------------------------------------------------------------
// Events (the only source of truth)
// ---------------------------------------------------------------------------------------------

interface EventBase {
  /** Monotonic per-person sequence number assigned by the store. */
  seq: number;
  at: string; // ISO-8601
  actorId: string;
  /** Marks events produced by the demo seeder so reports can label them honestly. */
  seeded?: boolean;
  /**
   * Id of the command that produced this event. Lets a retry after an ambiguous commit
   * (write succeeded, response lost) recognise its own events instead of applying twice.
   */
  cmd?: string;
}

/** Demo-only clock: wall time runs normally, offset so "now" started at a chosen local time. */
export interface DemoClock {
  anchorMs: number;
  startedMs: number;
}

export type ScaffoldEvent =
  | (EventBase & { type: 'person.registered'; personId: string; displayName: string; coachIds: string[]; demoClock?: DemoClock })
  | (EventBase & { type: 'routine.published'; routine: RoutineDef; version: number; proposalId?: string })
  | (EventBase & {
      type: 'change.proposed';
      proposalId: string;
      routine: RoutineDef;
      baseVersion: number | null;
      note: string;
      proposedBy: string;
    })
  | (EventBase & { type: 'change.decided'; proposalId: string; decision: 'approved' | 'declined' })
  | (EventBase & { type: 'run.started'; runId: string; routineId: string; version: number; device: string })
  | (EventBase & { type: 'step.helped'; runId: string; stepId: string; from: Level; to: Level })
  | (EventBase & { type: 'step.completed'; runId: string; stepId: string; idempotencyKey: string; bulk?: boolean })
  | (EventBase & { type: 'step.skipped'; runId: string; stepId: string; reason: 'late' | 'asked' })
  | (EventBase & { type: 'run.resumed'; runId: string; device: string })
  | (EventBase & { type: 'run.finished'; runId: string })
  | (EventBase & { type: 'run.abandoned'; runId: string; reason: string })
  | (EventBase & {
      type: 'level.set';
      routineId: string;
      stepId: string;
      level: Level;
      reason: string;
    });

export type EventType = ScaffoldEvent['type'];
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
/** An event before the store has assigned it a sequence number. */
export type NewEvent = DistributiveOmit<ScaffoldEvent, 'seq'>;

/**
 * A record with no prototype: user-controlled keys such as "constructor" or "__proto__" are plain
 * keys here and can never reach Object.prototype or the global Object.
 */
export const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

// ---------------------------------------------------------------------------------------------
// Projections (pure functions of the log; never persisted as truth)
// ---------------------------------------------------------------------------------------------

export interface LevelChange {
  at: string;
  from: Level;
  to: Level;
  cause: 'faded' | 'support-added' | 'coach-set';
  /** Human-readable, deterministic explanation. */
  reason: string;
  /** Runs whose outcomes triggered the change. */
  evidenceRunIds: string[];
}

export interface StepStats {
  routineId: string;
  stepId: string;
  level: Level;
  /** Consecutive unaided completions since the last level change. */
  unaidedStreak: number;
  /** Consecutive aided runs (help or skip) since the last level change. */
  aidedStreak: number;
  streakRunIds: string[];
  changes: LevelChange[];
  /** Set when support had to be added back; cleared when it fades again. */
  needsAttention: boolean;
}

export type StepRunStatus = 'pending' | 'done' | 'skipped';

export interface StepRun {
  stepId: string;
  /** True once the step has been the current step (so its prompt was actually given). */
  presented: boolean;
  skipReason?: 'late' | 'asked';
  /** The level the step was first presented at in this run (the person's baseline). */
  baseLevel: Level;
  /** Current level within this run, after any help requests. */
  level: Level;
  helps: number;
  status: StepRunStatus;
  completedAt?: string;
}

export interface Run {
  runId: string;
  routineId: string;
  version: number;
  startedAt: string;
  lastActivityAt: string;
  devices: string[];
  status: 'active' | 'finished' | 'abandoned';
  steps: StepRun[];
  /** idempotency key -> stepId, so a retried complete_step never double-advances. */
  completionKeys: Record<string, string>;
  finishedAt?: string;
  seeded: boolean;
}

export interface Proposal {
  proposalId: string;
  routine: RoutineDef;
  baseVersion: number | null;
  note: string;
  proposedBy: string;
  proposedAt: string;
  status: 'pending' | 'approved' | 'declined';
  decidedAt?: string;
}

export interface AuditEntry {
  seq: number;
  at: string;
  actorId: string;
  what: string;
}

export interface PersonState {
  personId: string;
  displayName: string;
  coachIds: string[];
  demoClock: DemoClock | null;
  /** Routine ids in publish order (default routine = first). */
  routineOrder: string[];
  /** Recently applied command ids (bounded), for ambiguous-commit detection. */
  recentCmds: string[];
  routines: Record<string, { current: RoutineDef; version: number; history: number[] }>;
  proposals: Record<string, Proposal>;
  runs: Record<string, Run>;
  runOrder: string[];
  /** Every published version, so past runs can be rebuilt exactly as presented. */
  versions: Record<string, Record<number, RoutineDef>>;
  stats: Record<string, StepStats>; // key: `${routineId}/${stepId}`
  audit: AuditEntry[];
  lastSeq: number;
}

export const statKey = (routineId: string, stepId: string): string => `${routineId}/${stepId}`;
