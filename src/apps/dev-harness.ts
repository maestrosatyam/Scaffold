// Dev harness: plays an MCP Apps HOST for one view at a time, using the real AppBridge from
// @modelcontextprotocol/ext-apps. The view runs in a sandboxed iframe (allow-scripts only, opaque
// origin — like a real host) and receives tool input/results from fixtures recorded from the real
// server (src/apps/fixtures.ts). Button taps are answered by a small stub "server" that replays the
// recorded flow, so the tap fallbacks can be exercised end to end.
//
//   node scripts/build-apps.ts --dev && open dist/apps-dev/dev-harness.html
//   ?view=step-card&scenario=cue-helped&theme=dark&width=768&shot=1
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import * as F from './fixtures.ts';
import type { FlowStep } from './fixtures.ts';
import type { StepResult, SuggestionsResult } from './shared/types.ts';

type View = 'step-card' | 'independence-report' | 'suggestions' | 'progress';
type ToolCall = (name: string, args: Record<string, unknown>) => Promise<CallResult>;
interface CallResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [k: string]: unknown;
}
interface Scenario {
  id: string;
  view: View;
  label: string;
  tool: string;
  input: Record<string, unknown>;
  result: { speech: string } & Record<string, unknown>;
  server?: () => ToolCall;
  theme?: 'light' | 'dark';
}

const ok = (structured: { speech: string } & Record<string, unknown>): CallResult => ({
  content: [{ type: 'text', text: structured.speech || '(no speech: the person is doing this step on their own)' }],
  structuredContent: structured,
});
const fail = (text: string): CallResult => ({ isError: true, content: [{ type: 'text', text }] });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Replays a recorded step flow: each tap returns the next recorded result for that tool + step. */
function flowServer(flow: FlowStep[], start: StepResult): () => ToolCall {
  return () => {
    let cur = start;
    const key = JSON.stringify(start);
    let i = flow.findIndex((f) => JSON.stringify(f.result) === key) + 1; // 0 when start is not in the flow
    return async (name, args) => {
      await wait(350); // feel of a network round trip
      if (name === 'repeat_step') {
        const s = cur.step;
        const speech = s ? (s.level === 'independent' ? `You're on ${s.title.toLowerCase()}. Say help if you want a reminder.` : s.prompt) : 'That routine is finished.';
        return ok({ ...cur, speech, level_changes: [], skipped: [], duplicate: false });
      }
      const j = flow.findIndex((f, k) => k >= i && f.tool === name && (!args.step_id || f.args.step_id === args.step_id));
      if (j < 0) {
        if (name === 'step_done' && cur.step && args.step_id !== cur.step.step_id) return ok({ ...cur, duplicate: true, level_changes: [] });
        return fail(name === 'need_help' ? "That's every detail I have for this step." : 'That step is already finished.');
      }
      i = j + 1;
      cur = flow[j]!.result;
      return ok(cur);
    };
  };
}

function suggestionsServer(initial: SuggestionsResult): () => ToolCall {
  return () => {
    const pending = new Set(initial.suggestions.filter((s) => s.status === 'pending').map((s) => s.proposal_id));
    return async (name, args) => {
      await wait(450);
      if (name === 'decide_suggestion') {
        const id = String(args.proposal_id);
        const sug = initial.suggestions.find((s) => s.proposal_id === id);
        if (!sug || !pending.has(id)) return fail('That suggestion was already decided.');
        pending.delete(id);
        const base = args.decision === 'approved' ? F.decideApproved : F.decideDeclined;
        const speech =
          args.decision === 'approved'
            ? `Done. ${sug.routine_name} is ready. Say "start ${sug.routine_name.toLowerCase()}" when you want to try it.`
            : base.speech;
        return ok({ ...base, speech, proposal_id: id, decision: args.decision as 'approved' | 'declined', routine_name: sug.routine_name });
      }
      if (name === 'review_suggestions') {
        const rest = initial.suggestions.filter((s) => pending.has(s.proposal_id));
        return ok({ speech: rest.length ? 'Next suggestion.' : 'There are no suggestions waiting.', suggestions: rest });
      }
      return fail(`Unknown tool ${name}`);
    };
  };
}

const flow = F.morningFlow;
const step = (id: string, label: string, r: StepResult, tool = 'step_done'): Scenario => ({
  id,
  view: 'step-card',
  label,
  tool,
  input: r.step ? { run_id: r.run.run_id, step_id: r.step.step_id } : { run_id: r.run.run_id },
  result: r,
  server: flowServer(flow, r),
});
const onlyChanged: SuggestionsResult = { ...F.suggestions, suggestions: F.suggestions.suggestions.filter((s) => !s.is_new) };

const SCENARIOS: Scenario[] = [
  { ...step('start-own', 'Start: step on their own', F.morningStart, 'start_routine'), input: { routine: 'morning', device: 'bedroom' } },
  step('cue', 'Cue word', F.stepCue),
  step('cue-helped', 'Cue → help (climb)', F.stepCueHelped, 'need_help'),
  step('partial', 'Short prompt', F.stepPartial),
  step('full-helped', 'Full prompt after help', F.stepFullHelped, 'need_help'),
  step('fade-toast', 'Faded toast mid-run', F.fadeMid),
  step('late', 'Running late (skipped)', F.late, 'running_late'),
  step('finished-support', 'Finished (support added)', F.finishedSupportAdded),
  step('finished-faded', 'Finished (faded)', F.finishedFaded),
  { id: 'report', view: 'independence-report', label: 'Report: after 1 live run', tool: 'independence_report', input: {}, result: F.report },
  { id: 'report-later', view: 'independence-report', label: 'Report: after 3 more runs', tool: 'independence_report', input: {}, result: F.reportLater },
  { id: 'report-dark', view: 'independence-report', label: 'Report (dark host)', tool: 'independence_report', input: {}, result: F.report, theme: 'dark' },
  { id: 'suggest-new', view: 'suggestions', label: 'Suggestion: new routine', tool: 'review_suggestions', input: {}, result: F.suggestions, server: suggestionsServer(F.suggestions) },
  { id: 'suggest-changed', view: 'suggestions', label: 'Suggestion: changes', tool: 'review_suggestions', input: {}, result: onlyChanged, server: suggestionsServer(onlyChanged) },
  { id: 'suggest-empty', view: 'suggestions', label: 'Suggestions: none', tool: 'review_suggestions', input: {}, result: F.suggestionsEmpty },
  { id: 'progress', view: 'progress', label: 'Progress', tool: 'my_progress', input: {}, result: F.progress },
  { id: 'progress-later', view: 'progress', label: 'Progress (later)', tool: 'my_progress', input: {}, result: F.progressLater },
];

// ------------------------------------------------------------------------------------ host UI

const q = new URLSearchParams(location.search);
const shot = q.has('shot');
const scenario = SCENARIOS.find((s) => s.id === q.get('scenario')) ?? SCENARIOS[0]!;
const device = scenario.view === 'step-card' || scenario.view === 'suggestions' || scenario.view === 'progress';
const theme = (q.get('theme') as 'light' | 'dark' | null) ?? scenario.theme ?? (device ? 'dark' : 'light');
const width = Number(q.get('width') ?? 768);

document.body.classList.toggle('shot', shot);
const nav = document.getElementById('scenarios')!;
for (const s of SCENARIOS) {
  const a = document.createElement('a');
  a.href = `?scenario=${s.id}`;
  a.textContent = s.label;
  a.className = s.id === scenario.id ? 'on' : '';
  a.dataset.view = s.view;
  nav.append(a);
}
const logEl = document.getElementById('log')!;
const log = (what: string, data?: unknown) => {
  const li = document.createElement('li');
  li.innerHTML = `<b></b> <code></code>`;
  li.querySelector('b')!.textContent = what;
  li.querySelector('code')!.textContent = data === undefined ? '' : JSON.stringify(data).slice(0, 400);
  logEl.prepend(li);
};

const frame = document.createElement('iframe');
frame.title = `${scenario.view} view`;
frame.setAttribute('sandbox', 'allow-scripts');
frame.style.width = `${width}px`;
frame.style.height = device ? `${Math.round((480 * width) / 768)}px` : '600px';
document.getElementById('device')!.append(frame);
document.getElementById('device')!.dataset.view = scenario.view;

const call = scenario.server?.() ?? (async (name: string) => fail(`The harness has no stub for ${name}`));
const bridge = new AppBridge(
  null,
  { name: 'scaffold-dev-harness', version: '0.1.0' },
  { serverTools: {}, updateModelContext: { text: {} }, logging: {} },
  {
    hostContext: {
      theme,
      displayMode: 'inline',
      availableDisplayModes: ['inline'],
      platform: 'web',
      locale: 'en-US',
      timeZone: 'America/Los_Angeles',
      containerDimensions: { width, maxHeight: 4000 },
      deviceCapabilities: { touch: true, hover: false },
      toolInfo: { tool: { name: scenario.tool, inputSchema: { type: 'object' } } },
    },
  },
);
bridge.oncalltool = async (params) => {
  log(`tools/call ${params.name}`, params.arguments);
  const r = await call(params.name, (params.arguments ?? {}) as Record<string, unknown>);
  log(r.isError ? '  → error' : '  → result', r.isError ? r.content : (r.structuredContent as { speech?: string })?.speech);
  return r as never;
};
bridge.onupdatemodelcontext = async (p) => {
  log('ui/update-model-context', p.content);
  return {};
};
bridge.onloggingmessage = (p) => log('log', p);
bridge.onsizechange = ({ height }) => {
  if (height && !device) frame.style.height = `${Math.ceil(height)}px`;
  if (height && device) frame.style.height = `${Math.ceil(height)}px`;
};
bridge.oninitialized = () => {
  log('initialized');
  void bridge.sendToolInput({ arguments: scenario.input });
  setTimeout(() => {
    log(`tool result (${scenario.tool})`, scenario.result.speech);
    void bridge.sendToolResult({ content: [{ type: 'text', text: scenario.result.speech }], structuredContent: scenario.result } as never);
  }, Number(q.get('delay') ?? 120));
};

await bridge.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
frame.src = `../apps/${scenario.view}.html`;
document.documentElement.dataset.harness = 'ready';
