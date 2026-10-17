// Wire types for the views, inferred from the server's zod output schemas (type-only imports:
// nothing from the server is bundled into the MCP Apps).
import type * as z from 'zod';
import type { DecideOut, ProgressOut, ReportOut, StepResultOut, SuggestionsOut } from '../../server/schemas.ts';

export type StepResult = z.infer<typeof StepResultOut>;
export type StepInfo = NonNullable<StepResult['step']>;
export type LevelChange = StepResult['level_changes'][number];
export type ReportResult = z.infer<typeof ReportOut>;
export type SuggestionsResult = z.infer<typeof SuggestionsOut>;
export type Suggestion = SuggestionsResult['suggestions'][number];
export type DecideResult = z.infer<typeof DecideOut>;
export type ProgressResult = z.infer<typeof ProgressOut>;
export type Level = StepInfo['level'];

/** Ordered from MOST support to LEAST support (mirrors core/model.ts LEVELS). */
export const LEVELS: readonly Level[] = ['full', 'partial', 'cue', 'independent'];
export const levelIndex = (l: Level): number => LEVELS.indexOf(l);

/** Learner-facing names of the four rungs of the support ladder. */
export const RUNG_LABEL: Record<Level, string> = {
  full: 'Full',
  partial: 'Short',
  cue: 'Cue',
  independent: 'On your own',
};

/** Coach-facing names (match core/views.ts LEVEL_LABEL). */
export const COACH_LEVEL_LABEL: Record<Level, string> = {
  full: 'Full prompt',
  partial: 'Short prompt',
  cue: 'Cue word',
  independent: 'On their own',
};
