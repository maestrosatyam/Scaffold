// Browser-side mirrors of the tool output shapes in src/server/schemas.ts (snake_case wire format).

export type Level = 'full' | 'partial' | 'cue' | 'independent';
export const LEVELS: Level[] = ['full', 'partial', 'cue', 'independent'];
export const LEVEL_LABEL: Record<Level, string> = { full: 'Full prompt', partial: 'Short prompt', cue: 'Cue word', independent: 'On their own' };

export interface StepViewOut {
  run_id: string;
  routine_id: string;
  routine_name: string;
  step_id: string;
  index: number;
  total: number;
  done_count: number;
  title: string;
  pictogram: string;
  level: Level;
  base_level: Level;
  prompt: string;
  must: boolean;
  est_sec: number;
  is_last: boolean;
}

export interface StepResultOut {
  speech: string;
  run: {
    run_id: string;
    routine_id: string;
    routine_name: string;
    status: 'active' | 'finished' | 'abandoned';
    done: number;
    total: number;
    started_at: string;
    finished_at: string | null;
    devices: string[];
  };
  step: StepViewOut | null;
  duplicate: boolean;
  level_changes: { step_id: string; title: string; at: string; from: Level; to: Level; cause: string; reason: string }[];
  skipped: string[];
}

export interface ChangeOut {
  at: string;
  from: Level;
  to: Level;
  cause: 'faded' | 'support-added' | 'coach-set';
  reason: string;
}

export interface ReportOut {
  speech: string;
  person_name: string;
  routine_id: string;
  routine_name: string;
  version: number;
  headline: string;
  independent_steps: number;
  total_steps: number;
  first_words: number | null;
  last_words: number | null;
  seeded_runs: number;
  live_runs: number;
  runs: { run_id: string; started_at: string; finished_at: string | null; prompts: number; words: number; helps: number; unaided_steps: number; total_steps: number; minutes: number | null; seeded: boolean }[];
  steps: { step_id: string; title: string; pictogram: string; level: Level; independence: number; needs_attention: boolean; unaided_streak: number; next_prompt: string; changes: ChangeOut[] }[];
  attention: { step_id: string; title: string; reason: string }[];
}

export interface ExplainOut {
  speech: string;
  step_id: string;
  title: string;
  level: Level;
  next_prompt: string;
  unaided_streak: number;
  aided_streak: number;
  runs_until_fade: number | null;
  needs_attention: boolean;
  changes: ChangeOut[];
}

export interface SuggestionOut {
  proposal_id: string;
  routine_id: string;
  routine_name: string;
  is_new: boolean;
  status: 'pending' | 'approved' | 'declined';
  note: string;
  proposed_by: string;
  proposed_at: string;
  steps: { step_id: string; title: string; pictogram: string; cue: string; full: string }[];
  added: string[];
  removed: string[];
  changed: string[];
}

export interface RoutinesOut {
  speech: string;
  routines: { routine_id: string; name: string; version: number; step_count: number; independent_steps: number; active_run_id: string | null }[];
}

export interface ProposeOut {
  speech: string;
  accepted: boolean;
  proposal_id: string | null;
  issues: { severity: 'error' | 'warning'; step_id: string | null; message: string }[];
}
