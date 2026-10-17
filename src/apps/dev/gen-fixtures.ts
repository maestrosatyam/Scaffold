// Regenerates src/apps/fixtures.ts from a REAL Scaffold server, so the dev harness and the
// screenshots exercise exactly the structuredContent the tools return.
//
//   SCAFFOLD_STORE=memory PORT=8790 node src/server/main.ts &
//   node src/apps/dev/gen-fixtures.ts [http://127.0.0.1:8790]
//
// Each run uses fresh demo sandboxes (21 days of synthetic history, clock anchored at 07:24).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAUNDRY_TEMPLATE, MORNING } from '../../demo/seed.ts';

const base = process.argv[2] ?? 'http://127.0.0.1:8790';
const out = resolve(fileURLToPath(import.meta.url), '../../fixtures.ts');

type Json = Record<string, any>;
let rpcId = 0;
async function sandbox(): Promise<{ learner: string; coach: string }> {
  const r = (await (await fetch(`${base}/api/demo/sandbox`, { method: 'POST' })).json()) as Json;
  return { learner: r.learnerToken, coach: r.coachToken };
}
async function call(token: string, name: string, args: Json = {}): Promise<Json> {
  const res = await fetch(`${base}/mcp-json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const j = (await res.json()) as Json;
  if (j.error || j.result?.isError) throw new Error(`${name}: ${JSON.stringify(j.error ?? j.result)}`);
  return j.result.structuredContent as Json;
}

interface FlowStep {
  tool: string;
  args: Json;
  result: Json;
}

// ---- 1. A live morning run on top of the seeded history, asking for help on non-independent steps.
const a = await sandbox();
const morningStart = await call(a.learner, 'start_routine', { routine: 'morning', device: 'bedroom' });
const morningFlow: FlowStep[] = [];
let cur = morningStart;
const helped = new Set<string>();
while (cur.step) {
  const s = cur.step;
  if (s.level !== 'independent' && !helped.has(s.step_id)) {
    helped.add(s.step_id);
    const args = { run_id: s.run_id, step_id: s.step_id };
    cur = await call(a.learner, 'need_help', args);
    morningFlow.push({ tool: 'need_help', args, result: cur });
  }
  const args = { run_id: cur.step.run_id, step_id: cur.step.step_id };
  cur = await call(a.learner, 'step_done', args);
  morningFlow.push({ tool: 'step_done', args, result: cur });
}
const report = await call(a.coach, 'independence_report', {});
await call(a.coach, 'suggest_routine', { routine: LAUNDRY_TEMPLATE, note: "Let's try laundry on Saturdays, like we practised." });
const changed = structuredClone(MORNING);
changed.steps.splice(1, 0, {
  id: 'water',
  title: 'Drink water',
  pictogram: 'cup',
  must: false,
  estSec: 60,
  prompts: {
    full: 'Take the tall glass from the shelf. Fill it with cold water from the tap and drink it all.',
    partial: 'Drink a full glass of water.',
    cue: 'Glass of water.',
  },
});
const bag = changed.steps.find((s) => s.id === 'bag')!;
bag.prompts = {
  full: 'Open your bag. Put in your lunch box from the fridge, your bus pass from the hook, your phone and your keys. Zip the bag closed.',
  partial: 'Pack your lunch box, bus pass, phone and keys in your bag.',
  cue: 'Lunch, pass, phone, keys.',
};
await call(a.coach, 'suggest_routine', { routine: changed, note: 'A glass of water helps with your headaches. Keys go in the bag now.' });
const suggestions = await call(a.learner, 'review_suggestions', {});
const progress = await call(a.learner, 'my_progress', {});
const firstId = suggestions.suggestions[0].proposal_id;
const decideApproved = await call(a.learner, 'decide_suggestion', { proposal_id: firstId, decision: 'approved' });
const secondId = suggestions.suggestions[1].proposal_id;
const decideDeclined = await call(a.learner, 'decide_suggestion', { proposal_id: secondId, decision: 'declined' });
const suggestionsEmpty = await call(a.learner, 'review_suggestions', {});

// ---- 2. Three unaided runs in a row: steps fade mid-run (toast) and at the finish.
const b = await sandbox();
const fadeFlows: { start: Json; flow: FlowStep[] }[] = [];
for (let i = 0; i < 3; i++) {
  const start = await call(b.learner, 'start_routine', { routine: 'morning', device: 'kitchen' });
  const flow: FlowStep[] = [];
  let r = start;
  while (r.step) {
    const args = { run_id: r.step.run_id, step_id: r.step.step_id };
    r = await call(b.learner, 'step_done', args);
    flow.push({ tool: 'step_done', args, result: r });
  }
  fadeFlows.push({ start, flow });
}
const lateStart = await call(b.learner, 'start_routine', { routine: 'morning' });
const late = await call(b.learner, 'running_late', { run_id: lateStart.run.run_id, minutes_left: 5 });
const reportLater = await call(b.coach, 'independence_report', {});
const progressLater = await call(b.learner, 'my_progress', {});

const fadeRun = fadeFlows[1]!;
const fadeMid = fadeRun.flow.find((f) => f.result.level_changes.length)!.result;
const finalRun = fadeFlows[2]!;
const finishedFaded = finalRun.flow.at(-1)!.result;

const fixtures = {
  morningStart,
  morningFlow,
  stepCue: morningFlow.find((f) => f.result.step?.step_id === 'dress' && f.tool === 'step_done')!.result,
  stepCueHelped: morningFlow.find((f) => f.tool === 'need_help' && f.args.step_id === 'dress')!.result,
  stepPartial: morningFlow.find((f) => f.result.step?.step_id === 'bag' && f.tool === 'step_done')!.result,
  stepFullHelped: morningFlow.find((f) => f.tool === 'need_help' && f.args.step_id === 'bag')!.result,
  finishedSupportAdded: morningFlow.at(-1)!.result,
  fadeMid,
  finishedFaded,
  late,
  report,
  reportLater,
  suggestions,
  suggestionsEmpty,
  decideApproved,
  decideDeclined,
  progress,
  progressLater,
};

const header = `// GENERATED by src/apps/dev/gen-fixtures.ts from a real Scaffold server (demo sandboxes with
// 21 days of synthetic history). Do not edit by hand; regenerate instead.
import type { DecideResult, ProgressResult, ReportResult, StepResult, SuggestionsResult } from './shared/types.ts';

export interface FlowStep {
  tool: string;
  args: Record<string, unknown>;
  result: StepResult;
}
`;
const typed: Record<string, string> = {
  morningFlow: 'FlowStep[]',
  report: 'ReportResult',
  reportLater: 'ReportResult',
  suggestions: 'SuggestionsResult',
  suggestionsEmpty: 'SuggestionsResult',
  decideApproved: 'DecideResult',
  decideDeclined: 'DecideResult',
  progress: 'ProgressResult',
  progressLater: 'ProgressResult',
};
const body = Object.entries(fixtures)
  .map(([k, v]) => `export const ${k}: ${typed[k] ?? 'StepResult'} = ${JSON.stringify(v, null, 2)};\n`)
  .join('\n');
writeFileSync(out, `${header}\n${body}`);
console.log(`wrote ${out}`);
