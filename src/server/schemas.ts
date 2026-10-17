// Wire schemas (snake_case) for tool outputs, plus mappers from the internal read models.

import * as z from 'zod';
import { LEVELS, type LevelChange } from '../core/model.ts';
import type { IndependenceReport, StepView } from '../core/views.ts';

export const LevelEnum = z.enum(LEVELS);

export const SPEECH_DESC =
  'Say this to the user exactly as written, word for word. Learners rely on hearing identical wording every time; do not paraphrase, shorten or add to it.';

export const StepViewOut = z.object({
  run_id: z.string(),
  routine_id: z.string(),
  routine_name: z.string(),
  step_id: z.string().describe('Stable id of the current step; pass it to step_done / need_help'),
  index: z.number().int(),
  total: z.number().int(),
  done_count: z.number().int(),
  title: z.string(),
  pictogram: z.string(),
  level: LevelEnum.describe('Support level used right now'),
  base_level: LevelEnum.describe('Support level the person has earned for this step'),
  prompt: z.string().describe('Verbatim prompt for this level; empty when the person does the step on their own'),
  must: z.boolean(),
  est_sec: z.number().int(),
  is_last: z.boolean(),
});

export const LevelChangeOut = z.object({
  step_id: z.string(),
  title: z.string(),
  at: z.string(),
  from: LevelEnum,
  to: LevelEnum,
  cause: z.enum(['faded', 'support-added', 'coach-set']),
  reason: z.string(),
});

export const StepResultOut = z.object({
  speech: z.string().describe(SPEECH_DESC),
  run: z.object({
    run_id: z.string(),
    routine_id: z.string(),
    routine_name: z.string(),
    status: z.enum(['active', 'finished', 'abandoned']),
    done: z.number().int(),
    total: z.number().int(),
    started_at: z.string(),
    finished_at: z.string().nullable(),
    devices: z.array(z.string()),
  }),
  step: StepViewOut.nullable().describe('Current step, or null when the routine is finished'),
  duplicate: z.boolean().describe('True when this exact request was already applied (safe retry)'),
  level_changes: z.array(LevelChangeOut).describe('Support-level changes caused by this call'),
  skipped: z.array(z.string()).describe('Titles of steps skipped by this call'),
  summary: z
    .object({
      finished_at: z.string(),
      on_own: z.number().int().describe('Steps done with no prompt and no help'),
      total: z.number().int(),
      faded: z.array(z.string()).describe('Titles of steps that will get fewer prompts from now on'),
    })
    .nullable()
    .describe('Present when the routine just finished'),
});

export const RoutinesOut = z.object({
  speech: z.string().describe(SPEECH_DESC),
  routines: z.array(
    z.object({
      routine_id: z.string(),
      name: z.string(),
      version: z.number().int(),
      step_count: z.number().int(),
      independent_steps: z.number().int(),
      active_run_id: z.string().nullable(),
    }),
  ),
});

export const ReportOut = z.object({
  speech: z.string().describe(SPEECH_DESC),
  person_name: z.string(),
  routine_id: z.string(),
  routine_name: z.string(),
  version: z.number().int(),
  headline: z.string(),
  independent_steps: z.number().int(),
  total_steps: z.number().int(),
  first_words: z.number().int().nullable(),
  last_words: z.number().int().nullable(),
  seeded_runs: z.number().int().describe('Runs that are synthetic demo history'),
  live_runs: z.number().int(),
  runs: z.array(
    z.object({
      run_id: z.string(),
      started_at: z.string(),
      finished_at: z.string().nullable(),
      prompts: z.number().int(),
      words: z.number().int(),
      helps: z.number().int(),
      unaided_steps: z.number().int(),
      total_steps: z.number().int(),
      minutes: z.number().int().nullable(),
      seeded: z.boolean(),
    }),
  ),
  steps: z.array(
    z.object({
      step_id: z.string(),
      title: z.string(),
      pictogram: z.string(),
      level: LevelEnum,
      independence: z.number().int(),
      needs_attention: z.boolean(),
      unaided_streak: z.number().int(),
      next_prompt: z.string(),
      changes: z.array(LevelChangeOut.omit({ step_id: true, title: true })),
    }),
  ),
  attention: z.array(z.object({ step_id: z.string(), title: z.string(), reason: z.string() })),
});

export const ExplainOut = z.object({
  speech: z.string().describe(SPEECH_DESC),
  step_id: z.string(),
  title: z.string(),
  level: LevelEnum,
  next_prompt: z.string(),
  unaided_streak: z.number().int(),
  aided_streak: z.number().int(),
  runs_until_fade: z.number().int().nullable().describe('Unaided runs still needed before the next fade; null if already independent'),
  needs_attention: z.boolean(),
  changes: z.array(LevelChangeOut.omit({ step_id: true, title: true })),
});

export const IssueOut = z.object({ severity: z.enum(['error', 'warning']), step_id: z.string().nullable(), message: z.string() });

export const SuggestionOut = z.object({
  proposal_id: z.string(),
  routine_id: z.string(),
  routine_name: z.string(),
  is_new: z.boolean(),
  status: z.enum(['pending', 'approved', 'declined']),
  note: z.string(),
  proposed_by: z.string(),
  proposed_at: z.string(),
  steps: z.array(z.object({ step_id: z.string(), title: z.string(), pictogram: z.string(), cue: z.string(), full: z.string() })),
  added: z.array(z.string()),
  removed: z.array(z.string()),
  changed: z.array(z.string()),
});

export const SuggestionsOut = z.object({ speech: z.string().describe(SPEECH_DESC), suggestions: z.array(SuggestionOut) });

export const ProposeOut = z.object({
  speech: z.string().describe(SPEECH_DESC),
  accepted: z.boolean(),
  proposal_id: z.string().nullable(),
  issues: z.array(IssueOut),
});

export const DecideOut = z.object({
  speech: z.string().describe(SPEECH_DESC),
  proposal_id: z.string(),
  decision: z.enum(['approved', 'declined']),
  routine_name: z.string(),
  published_version: z.number().int().nullable(),
});

export const SetLevelOut = z.object({ speech: z.string().describe(SPEECH_DESC), step_id: z.string(), title: z.string(), level: LevelEnum });

export const ProgressOut = z.object({
  speech: z.string().describe(SPEECH_DESC),
  routine_name: z.string(),
  independent_steps: z.number().int(),
  total_steps: z.number().int(),
  runs_finished: z.number().int(),
  steps: z.array(z.object({ step_id: z.string(), title: z.string(), pictogram: z.string(), level: LevelEnum })),
});

export function stepViewOut(v: StepView): z.infer<typeof StepViewOut> {
  return {
    run_id: v.runId,
    routine_id: v.routineId,
    routine_name: v.routineName,
    step_id: v.stepId,
    index: v.index,
    total: v.total,
    done_count: v.doneCount,
    title: v.title,
    pictogram: v.pictogram,
    level: v.level,
    base_level: v.baseLevel,
    prompt: v.prompt,
    must: v.must,
    est_sec: v.estSec,
    is_last: v.isLast,
  };
}

const changeOut = (c: LevelChange) => ({ at: c.at, from: c.from, to: c.to, cause: c.cause, reason: c.reason });
export { changeOut };

export function reportOut(r: IndependenceReport, speech: string): z.infer<typeof ReportOut> {
  return {
    speech,
    person_name: r.personName,
    routine_id: r.routineId,
    routine_name: r.routineName,
    version: r.version,
    headline: r.headline,
    independent_steps: r.independentSteps,
    total_steps: r.totalSteps,
    first_words: r.firstWords,
    last_words: r.lastWords,
    seeded_runs: r.seededRuns,
    live_runs: r.liveRuns,
    runs: r.runs.map((x) => ({
      run_id: x.runId,
      started_at: x.startedAt,
      finished_at: x.finishedAt,
      prompts: x.prompts,
      words: x.words,
      helps: x.helps,
      unaided_steps: x.unaidedSteps,
      total_steps: x.totalSteps,
      minutes: x.minutes,
      seeded: x.seeded,
    })),
    steps: r.steps.map((s) => ({
      step_id: s.stepId,
      title: s.title,
      pictogram: s.pictogram,
      level: s.level,
      independence: s.independence,
      needs_attention: s.needsAttention,
      unaided_streak: s.unaidedStreak,
      next_prompt: s.nextPrompt,
      changes: s.changes.map(changeOut),
    })),
    attention: r.attention.map((a) => ({ step_id: a.stepId, title: a.title, reason: a.reason })),
  };
}
