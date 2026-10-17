// Deterministic checks a coach's routine must pass before the learner is asked to approve it.
// The rules encode prompting practice, not taste: e.g. a cue should be a recognisable fragment of
// the fuller prompt, so the person can connect the short reminder to what they learned.

import * as z from 'zod';
import { wordCount } from './views.ts';
import type { RoutineDef } from './model.ts';

export interface Issue {
  severity: 'error' | 'warning';
  stepId?: string;
  message: string;
}

export const StepDefSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,31}$/, 'starts with a letter; lowercase letters, digits and dashes')
    .describe('Stable step id, e.g. "load-machine"'),
  title: z.string().min(1).max(40),
  pictogram: z.string().min(1).max(32).describe('Pictogram key, e.g. "toothbrush", "shirt", "washer"'),
  prompts: z.object({
    full: z.string().min(1).max(400).describe('Most explicit wording'),
    partial: z.string().min(1).max(200).describe('Shorter reminder'),
    cue: z.string().min(1).max(60).describe('One to four words'),
  }),
  must: z.boolean().default(true).describe('Must-do steps are never dropped when running late'),
  estSec: z.number().int().min(5).max(3600).describe('Typical duration in seconds'),
});

export const PolicySchema = z.object({
  fadeAfter: z.number().int().min(1).max(10).default(3),
  supportAfter: z.number().int().min(1).max(10).default(2),
});

export const RoutineDefSchema = z.object({
  routineId: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, 'starts with a letter; lowercase letters, digits and dashes'),
  name: z.string().min(1).max(40),
  aliases: z
    .array(
      z
        .string()
        .min(1)
        .max(40)
        .refine((a) => a.toLowerCase().replace(/[^a-z0-9]/g, '').length >= 2, 'aliases need at least two letters or digits'),
    )
    .max(8)
    .default([]),
  steps: z.array(StepDefSchema).min(1).max(15),
  policy: PolicySchema.default({ fadeAfter: 3, supportAfter: 2 }),
});

const STOP = new Set(['the', 'a', 'an', 'and', 'your', 'you', 'to', 'of', 'on', 'in', 'it', 'with', 'from', 'then', 'put', 'take']);
const contentWords = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));

export function validateRoutine(r: RoutineDef, knownPictograms?: ReadonlySet<string>): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set<string>();
  for (const s of r.steps) {
    if (ids.has(s.id)) issues.push({ severity: 'error', stepId: s.id, message: `Step id "${s.id}" is used twice.` });
    ids.add(s.id);
    const full = wordCount(s.prompts.full);
    const partial = wordCount(s.prompts.partial);
    const cue = wordCount(s.prompts.cue);
    if (cue > 4) issues.push({ severity: 'warning', stepId: s.id, message: `Cue for "${s.title}" has ${cue} words; keep cues to 4 or fewer.` });
    if (partial >= full) issues.push({ severity: 'warning', stepId: s.id, message: `Short prompt for "${s.title}" is not shorter than the full prompt.` });
    if (cue >= partial) issues.push({ severity: 'warning', stepId: s.id, message: `Cue for "${s.title}" is not shorter than the short prompt.` });
    if (full > 45) issues.push({ severity: 'warning', stepId: s.id, message: `Full prompt for "${s.title}" is ${full} words; split the step so each prompt stays under about 20 seconds of speech.` });
    const fuller = new Set([...contentWords(s.prompts.full), ...contentWords(s.prompts.partial)].flatMap((w) => [w, w.replace(/s$/, '')]));
    const orphan = contentWords(s.prompts.cue).filter((w) => !fuller.has(w) && !fuller.has(w.replace(/s$/, '')) && ![...fuller].some((f) => f.includes(w)));
    if (orphan.length) {
      issues.push({
        severity: 'warning',
        stepId: s.id,
        message: `Cue word${orphan.length > 1 ? 's' : ''} "${orphan.join('", "')}" for "${s.title}" never appear in the fuller prompts, so the cue may not be recognised.`,
      });
    }
    if (knownPictograms && !knownPictograms.has(s.pictogram)) {
      issues.push({ severity: 'warning', stepId: s.id, message: `No pictogram named "${s.pictogram}"; a generic one will be shown.` });
    }
  }
  if (!r.steps.some((s) => s.must)) issues.push({ severity: 'warning', message: 'No step is marked must-do; running late could drop everything.' });
  const total = r.steps.reduce((a, s) => a + s.estSec, 0);
  if (total > 2 * 3600) issues.push({ severity: 'warning', message: 'This routine takes over two hours; consider splitting it.' });
  return issues;
}
