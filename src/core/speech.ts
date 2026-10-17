// What the assistant says. Wording is assembled only from fixed templates and the coach-authored
// prompts, so the same state always produces byte-identical speech (many learners rely on hearing
// the same words every time). The framing fades together with the prompt: full support gets
// "Step 2 of 6.", a cue gets just the cue, independence gets silence.

import type { LevelChange, PersonState, Run } from './model.ts';
import type { StepView } from './views.ts';

const clockTime = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));

export function stepLine(v: StepView): string {
  switch (v.level) {
    case 'full':
      return `Step ${v.index} of ${v.total}. ${v.prompt}`;
    case 'partial':
    case 'cue':
      return v.prompt;
    case 'independent':
      return '';
  }
}

export function startSpeech(v: StepView, resumed: boolean): string {
  if (resumed) return resumeSpeech(v);
  const line = stepLine(v);
  if (!line) return `Okay, ${v.routineName.toLowerCase()}. I'm here if you need me.`;
  return v.level === 'full' ? `Let's do your ${v.routineName.toLowerCase()}. ${line}` : line;
}

export function resumeSpeech(v: StepView): string {
  const where = `You've done ${v.doneCount} of ${v.total}. Next is ${v.title.toLowerCase()}.`;
  const line = stepLine(v);
  return line ? `${where} ${line}` : where;
}

export function nextSpeech(v: StepView | null): string {
  if (!v) return '';
  const line = stepLine(v);
  return line || 'Okay.';
}

export interface FinishFacts {
  finishedAt: string;
  /** Steps done with no prompt and no help. */
  unaided: number;
  total: number;
  fadedTitles: string[];
}

/** Steps whose level faded because of this run (their fade evidence ends with this run). */
export function fadedInRun(state: PersonState, run: Run, titles: Record<string, string>): string[] {
  return run.steps
    .map((sr) => state.stats[`${run.routineId}/${sr.stepId}`])
    .filter((st): st is NonNullable<typeof st> => !!st)
    .filter((st) => {
      const last: LevelChange | undefined = st.changes.at(-1);
      return last?.cause === 'faded' && last.evidenceRunIds.at(-1) === run.runId;
    })
    .map((st) => titles[st.stepId] ?? st.stepId);
}

export function finishFacts(state: PersonState, run: Run, titles: Record<string, string>): FinishFacts {
  return {
    finishedAt: run.finishedAt ?? run.lastActivityAt,
    unaided: run.steps.filter((s) => s.status === 'done' && s.helps === 0 && s.baseLevel === 'independent').length,
    total: run.steps.length,
    fadedTitles: fadedInRun(state, run, titles),
  };
}

export function finishSpeech(f: FinishFacts, timeZone: string): string {
  const parts = [`Nice, you're done at ${clockTime(f.finishedAt, timeZone)}.`];
  if (f.unaided === f.total) parts.push(`All ${f.total} steps on your own.`);
  else if (f.unaided > 0) parts.push(`${f.unaided} of ${f.total} steps on your own.`);
  if (f.fadedTitles.length === 1) parts.push(`You've got ${f.fadedTitles[0]!.toLowerCase()} down, so I'll say less for it from now on.`);
  else if (f.fadedTitles.length > 1) parts.push(`You've got ${f.fadedTitles.length} steps down, so I'll say less for them from now on.`);
  return parts.join(' ');
}

export function helpSpeech(v: StepView, atMax: boolean): string {
  if (atMax) return `${v.prompt} That's every detail I have for this step. Take your time, or say skip.`;
  return v.level === 'full' ? `Step ${v.index} of ${v.total}. ${v.prompt}` : v.prompt;
}

export function repeatSpeech(v: StepView): string {
  return stepLine(v) || `You're on ${v.title.toLowerCase()}. Say help if you want a reminder.`;
}
