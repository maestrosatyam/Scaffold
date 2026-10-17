// Read models derived from PersonState: what a device shows/speaks, and what a coach reads.

import { currentStepIndex, routineVersion } from './engine.ts';
import { LEVELS, levelIndex, supportOne, type Level, type LevelChange, type PersonState, type Run, type StepDef } from './model.ts';

/** The exact words for a step at a level. `independent` is deliberately silent. */
export function promptFor(step: StepDef, level: Level): string {
  return level === 'independent' ? '' : step.prompts[level];
}

export const wordCount = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);

export interface StepView {
  runId: string;
  routineId: string;
  routineName: string;
  stepId: string;
  /** 1-based position. */
  index: number;
  total: number;
  doneCount: number;
  title: string;
  pictogram: string;
  /** Level used right now (after any help in this run). */
  level: Level;
  /** Level the person started this step at today (their learned baseline). */
  baseLevel: Level;
  /** Verbatim prompt for this level ('' when independent). Must not be paraphrased. */
  prompt: string;
  must: boolean;
  estSec: number;
  isLast: boolean;
}

export function stepView(state: PersonState, run: Run, at?: number): StepView | null {
  const idx = at ?? currentStepIndex(run);
  if (idx < 0 || idx >= run.steps.length) return null;
  const def = routineVersion(state, run.routineId, run.version);
  const sr = run.steps[idx]!;
  const sd = def.steps.find((s) => s.id === sr.stepId)!;
  return {
    runId: run.runId,
    routineId: run.routineId,
    routineName: def.name,
    stepId: sd.id,
    index: idx + 1,
    total: run.steps.length,
    doneCount: run.steps.filter((s) => s.status === 'done').length,
    title: sd.title,
    pictogram: sd.pictogram,
    level: sr.level,
    baseLevel: sr.baseLevel,
    prompt: promptFor(sd, sr.level),
    must: sd.must,
    estSec: sd.estSec,
    isLast: run.steps.slice(idx + 1).every((s) => s.status !== 'pending'),
  };
}

// ---------------------------------------------------------------------------------------------
// Coach report
// ---------------------------------------------------------------------------------------------

export interface RunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  status: Run['status'];
  /** Number of spoken prompts (presentations above `independent`, plus each help). */
  prompts: number;
  /** Total words of prompting spoken — the clearest single measure of support load. */
  words: number;
  helps: number;
  unaidedSteps: number;
  totalSteps: number;
  minutes: number | null;
  seeded: boolean;
}

export function summarizeRun(state: PersonState, run: Run): RunSummary {
  const def = routineVersion(state, run.routineId, run.version);
  let prompts = 0;
  let words = 0;
  let helps = 0;
  let unaided = 0;
  for (const sr of run.steps) {
    const sd = def.steps.find((s) => s.id === sr.stepId)!;
    let level = sr.baseLevel;
    // Steps dropped before they ever became current (e.g. running late) were never spoken.
    if (!sr.presented) continue;
    if (level !== 'independent') {
      prompts += 1;
      words += wordCount(promptFor(sd, level));
    }
    for (let h = 0; h < sr.helps; h++) {
      level = supportOne(level);
      prompts += 1;
      words += wordCount(promptFor(sd, level));
    }
    helps += sr.helps;
    if (sr.status === 'done' && sr.helps === 0) unaided += 1;
  }
  const end = run.finishedAt ?? null;
  return {
    runId: run.runId,
    startedAt: run.startedAt,
    finishedAt: end,
    status: run.status,
    prompts,
    words,
    helps,
    unaidedSteps: unaided,
    totalSteps: run.steps.length,
    minutes: end ? Math.round((Date.parse(end) - Date.parse(run.startedAt)) / 60000) : null,
    seeded: run.seeded,
  };
}

export interface StepSummary {
  stepId: string;
  title: string;
  pictogram: string;
  level: Level;
  /** 0 = full support … 3 = independent. */
  independence: number;
  needsAttention: boolean;
  unaidedStreak: number;
  changes: LevelChange[];
  /** Prompt the person will hear next time. */
  nextPrompt: string;
}

export interface IndependenceReport {
  personName: string;
  routineId: string;
  routineName: string;
  version: number;
  runs: RunSummary[];
  steps: StepSummary[];
  independentSteps: number;
  totalSteps: number;
  firstWords: number | null;
  lastWords: number | null;
  seededRuns: number;
  liveRuns: number;
  headline: string;
  attention: { stepId: string; title: string; reason: string }[];
}

export function independenceReport(state: PersonState, routineId: string, sinceIso?: string): IndependenceReport {
  const entry = state.routines[routineId];
  if (!entry) throw new Error(`Unknown routine ${routineId}`);
  const def = entry.current;
  const runs = state.runOrder
    .map((id) => state.runs[id]!)
    .filter((r) => r.routineId === routineId && r.status === 'finished')
    .filter((r) => !sinceIso || r.startedAt >= sinceIso)
    .map((r) => summarizeRun(state, r));
  const steps: StepSummary[] = def.steps.map((s) => {
    const st = state.stats[`${routineId}/${s.id}`]!;
    return {
      stepId: s.id,
      title: s.title,
      pictogram: s.pictogram,
      level: st.level,
      independence: levelIndex(st.level),
      needsAttention: st.needsAttention,
      unaidedStreak: st.unaidedStreak,
      changes: st.changes,
      nextPrompt: promptFor(s, st.level),
    };
  });
  const independentSteps = steps.filter((s) => s.level === 'independent').length;
  const firstWords = runs[0]?.words ?? null;
  const lastWords = runs.at(-1)?.words ?? null;
  const attention = steps
    .filter((s) => s.needsAttention)
    .map((s) => ({ stepId: s.stepId, title: s.title, reason: s.changes.at(-1)?.reason ?? 'Support was added back.' }));
  const parts: string[] = [];
  if (runs.length >= 2 && firstWords !== null && lastWords !== null) {
    if (lastWords < firstWords) parts.push(`Spoken prompting fell from ${firstWords} words to ${lastWords} words per run over ${runs.length} runs.`);
    else if (lastWords > firstWords) parts.push(`Spoken prompting rose from ${firstWords} words to ${lastWords} words per run over ${runs.length} runs.`);
    else parts.push(`Spoken prompting stayed at ${firstWords} words per run over ${runs.length} runs.`);
  }
  parts.push(`${independentSteps} of ${def.steps.length} steps are now done without prompts.`);
  if (attention.length) parts.push(`${attention.length} step${attention.length > 1 ? 's need' : ' needs'} attention: ${attention.map((a) => a.title).join(', ')}.`);
  return {
    personName: state.displayName,
    routineId,
    routineName: def.name,
    version: entry.version,
    runs,
    steps,
    independentSteps,
    totalSteps: def.steps.length,
    firstWords,
    lastWords,
    seededRuns: runs.filter((r) => r.seeded).length,
    liveRuns: runs.filter((r) => !r.seeded).length,
    headline: parts.join(' '),
    attention,
  };
}

export const LEVEL_LABEL: Record<Level, string> = {
  full: 'Full prompt',
  partial: 'Short prompt',
  cue: 'Cue word',
  independent: 'On their own',
};

export { LEVELS };
