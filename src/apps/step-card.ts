// Step card — renders StepResultOut (start_routine, step_done, need_help, repeat_step,
// where_was_i, running_late, skip_step) on an Echo Show-sized dark canvas, with tap fallbacks
// for Done / Help / Repeat that call the same server tools as the voice intents.
import './shared/base.css';
import './shared/device.css';
import './step-card.css';
import { pictogram } from './pictograms.ts';
import { brandMark } from './shared/brand.ts';
import { $, html, mount, plural, raw, type Html } from './shared/dom.ts';
import { clockTime, minutesBetween } from './shared/format.ts';
import { connectView, markRendered, ToolError } from './shared/host.ts';
import { icon, type IconName } from './shared/icons.ts';
import { fitStage, fitText, fontsReady } from './shared/stage.ts';
import { LEVELS, levelIndex, RUNG_LABEL, type LevelChange, type StepInfo, type StepResult } from './shared/types.ts';

type Action = 'done' | 'help' | 'repeat';
type ToastKind = LevelChange['cause'] | 'skipped' | 'error' | 'info';
interface Toast {
  kind: ToastKind;
  text: string;
  more?: number;
}

const stage = document.getElementById('stage')!;
const live = document.getElementById('live')!;

let result: StepResult | null = null;
let previous: StepResult | null = null;
let busy: Action | null = null;
let toast: Toast | null = null;
let flashPrompt = false;

const view = connectView<StepResult>({
  name: 'step-card',
  theme: 'device',
  onResult: (r) => show(r, null),
  onPending: () => {
    if (!result) renderWaiting();
  },
  onToolError: (message) => {
    toast = { kind: 'error', text: message };
    if (result) render();
    else renderWaiting(message);
  },
  onContext: () => refit(),
});
const refit = fitStage(view);

// ------------------------------------------------------------------------------------ toasts

const CHANGE_TEXT: Record<LevelChange['cause'], (title: string) => string> = {
  faded: (t) => `${t}: fewer reminders from now on`,
  'support-added': (t) => `${t}: more help for now`,
  'coach-set': (t) => `${t}: your coach changed the reminders`,
};
const CHANGE_ICON: Record<ToastKind, IconName> = {
  faded: 'fewer',
  'support-added': 'more',
  'coach-set': 'coach',
  skipped: 'skip',
  error: 'alert',
  info: 'info',
};

function toastFor(r: StepResult): Toast | null {
  const changes = r.level_changes;
  if (changes.length) {
    const c = changes[0]!;
    return { kind: c.cause, text: CHANGE_TEXT[c.cause](c.title), more: changes.length - 1 };
  }
  if (r.skipped.length) return { kind: 'skipped', text: `Skipping today: ${r.skipped.join(', ')}` };
  return null;
}

const pill = (t: Toast, extra = ''): Html =>
  html`<div class="pill ${t.kind} ${extra}" role="status">
    <span class="pill-ic">${icon(CHANGE_ICON[t.kind])}</span><span>${t.text}</span>${t.more ? html`<span class="more">+${t.more}</span>` : ''}
  </div>`;

// ------------------------------------------------------------------------------------ pieces

function header(r: StepResult, t: Toast | null): Html {
  const s = r.step;
  const total = s?.total ?? r.run.total;
  const finished = !s;
  const dots = Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    const cls = finished || (s && n < s.index) ? 'done' : s && n === s.index ? 'now' : '';
    return html`<li class="${cls}"></li>`;
  });
  const count = finished ? (r.run.status === 'finished' ? 'All done' : `${r.run.done} of ${total} done`) : `Step ${s!.index} of ${total}`;
  return html`<header class="top">
    ${t ? pill(t, 'toast-in') : html`<div class="routine">${brandMark()}<span>${r.run.routine_name}</span></div>`}
    <div class="progress"><ol class="dots" aria-hidden="true">${dots}</ol><span class="count">${count}</span></div>
  </header>`;
}

function ladder(s: StepInfo, animate: boolean): Html {
  const cur = levelIndex(s.level);
  const base = levelIndex(s.base_level);
  const climbed = cur !== base;
  const pos = (i: number) => `${((i + 0.5) / LEVELS.length) * 100}%`;
  const rungs = LEVELS.map((l, i) => {
    const cls = [
      `l-${l}`,
      i === cur ? 'is-current' : '',
      climbed && i === base ? 'is-base' : '',
      climbed && i > cur && i < base ? 'is-between' : '',
    ].join(' ');
    return html`<span class="rung ${cls}"></span>`;
  });
  const labels = LEVELS.map(
    (l, i) => html`<span class="${i === cur ? 'is-current' : climbed && i === base ? 'is-base' : ''}">${RUNG_LABEL[l]}</span>`,
  );
  const a11y = `Support level: ${RUNG_LABEL[s.level]}${climbed ? `, usually ${RUNG_LABEL[s.base_level]}` : ''}.`;
  return html`<div class="ladder" role="img" aria-label="${a11y}">
    <div class="rungs">${rungs}<span class="thumb ${climbed && animate ? 'climb' : ''}" style="--from:${pos(base)};--to:${pos(cur)};--c:var(--lvl-${s.level})"></span></div>
    <div class="rung-labels" aria-hidden="true">${labels}</div>
  </div>`;
}

const button = (action: Action, label: string, ic: IconName, cls: string): Html =>
  html`<button type="button" class="btn ${cls}" data-action="${action}" ${busy ? 'disabled' : ''} ${busy === action ? 'aria-busy="true"' : ''}>${icon(ic)}<span>${label}</span></button>`;

function promptedStep(s: StepInfo, enter: boolean, animateClimb: boolean): Html {
  const climbed = s.level !== s.base_level;
  return html`<main class="main ${enter ? 'enter' : ''}">
      <figure class="tile">${raw(pictogram(s.pictogram, s.title))}</figure>
      <section class="copy">
        <div class="title-row">
          <h1 class="title">${s.title}</h1>
          ${climbed ? html`<span class="tag-help">${icon('up')}More help today</span>` : ''}
        </div>
        <p class="prompt ${flashPrompt ? 'flash' : ''}" id="prompt">${s.prompt}</p>
        ${ladder(s, animateClimb)}
      </section>
    </main>
    <footer class="actions">
      ${button('help', 'Help', 'help', 'btn-secondary')}
      ${button('repeat', 'Repeat', 'repeat', 'btn-secondary')}
      ${button('done', 'Done', 'check', 'btn-primary')}
    </footer>`;
}

function ownStep(s: StepInfo, enter: boolean): Html {
  return html`<main class="own ${enter ? 'enter' : ''}">
      <div class="halo"><figure class="tile">${raw(pictogram(s.pictogram, s.title))}</figure></div>
      <p class="step-name">${s.title}</p>
      <h1 class="gotit">You've got this.</h1>
      <p class="own-chip"><span class="mini" aria-hidden="true"><i></i><i></i><i></i><i></i></span>On your own</p>
    </main>
    <footer class="actions two">
      ${button('help', 'Help', 'help', 'btn-ghost')}
      ${button('done', 'Done', 'check', 'btn-primary')}
    </footer>`;
}

/** Steps done with no prompt and no help. The finish speech states it; prefer a structured field if the server adds one. */
function onOwnCount(r: StepResult): number | null {
  const run = r.run as StepResult['run'] & { on_own?: number; unaided?: number };
  if (typeof run.on_own === 'number') return run.on_own;
  if (typeof run.unaided === 'number') return run.unaided;
  const all = /All (\d+) steps on your own/.exec(r.speech);
  if (all) return Number(all[1]);
  const some = /(\d+) of (\d+) steps on your own/.exec(r.speech);
  return some ? Number(some[1]) : null;
}

function finished(r: StepResult): Html {
  const tz = view.timeZone();
  const at = r.run.finished_at ?? r.run.started_at;
  const mins = r.run.finished_at ? minutesBetween(r.run.started_at, r.run.finished_at) : 0;
  const own = onOwnCount(r);
  const total = r.run.total;
  const name = r.run.routine_name;
  const stat =
    own && own > 0
      ? html`<div class="own-stat">
          <span class="pips" aria-hidden="true">${Array.from({ length: total }, (_, i) => html`<i class="${i < own ? 'on' : ''}"></i>`)}</span>
          <p class="num">${own === total ? html`<b>All ${total} steps</b> on your own` : html`<b>${own} of ${total} steps</b> on your own`}</p>
        </div>`
      : html`<div class="own-stat"><p class="num"><b>${plural(r.run.done, 'step')}</b> done</p></div>`;
  const changes = r.level_changes.map((c) => pill({ kind: c.cause, text: CHANGE_TEXT[c.cause](c.title) }));
  return html`<main class="done-wrap">
      <div class="seal" aria-hidden="true">
        <svg viewBox="0 0 184 184"><circle class="ring-bg" cx="92" cy="92" r="85"/><circle class="ring" cx="92" cy="92" r="85"/><path class="tick" d="M58 95l23 23 46-50"/></svg>
      </div>
      <div class="done-copy">
        <h1>${name} done</h1>
        <p class="when">Finished at ${clockTime(at, tz)}${mins >= 1 ? html` · ${plural(mins, 'minute')}` : ''}</p>
        ${stat}
        ${changes.length ? html`<div class="changes">${changes}</div>` : ''}
      </div>
    </main>
    <footer class="closing">${brandMark()}<span>See you next time.</span></footer>`;
}

function stopped(r: StepResult): Html {
  return html`<main class="wait"><p>This ${r.run.routine_name.toLowerCase()} was stopped.</p></main><footer></footer>`;
}

// ------------------------------------------------------------------------------------ render

function liveText(r: StepResult): string {
  const s = r.step;
  if (!s) return r.run.status === 'finished' ? `${r.run.routine_name} done.` : '';
  const where = `Step ${s.index} of ${s.total}: ${s.title}.`;
  return s.level === 'independent' ? `${where} You've got this.` : `${where} ${s.prompt}`;
}

function renderWaiting(message?: string): void {
  stage.className = 'stage';
  mount(
    stage,
    html`<header class="top"><div class="routine">${brandMark()}<span>Scaffold</span></div></header>
      <main class="wait"><span class="breath" aria-hidden="true"></span><p>${message ?? 'One moment…'}</p></main><footer></footer>`,
  );
  markRendered('waiting');
}

function render(): void {
  const r = result!;
  const s = r.step;
  const p = previous?.step;
  const sameStep = !!(s && p && p.step_id === s.step_id && p.run_id === s.run_id);
  const enter = !sameStep;
  const animateClimb = !(sameStep && p!.level === s!.level);
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.action;

  let body: Html;
  if (s) body = s.level === 'independent' ? ownStep(s, enter) : promptedStep(s, enter, animateClimb);
  else if (r.run.status === 'finished') body = finished(r);
  else body = stopped(r);

  stage.className = `stage ${s ? `lv-${s.level}` : r.run.status === 'finished' ? 'is-finished' : ''}`;
  // On the finished card the changes are listed in the body, so the header stays calm.
  mount(stage, html`${header(r, s ? toast : toast?.kind === 'error' ? toast : null)}${body}`);
  flashPrompt = false;
  live.textContent = liveText(r);

  if (focused) $<HTMLButtonElement>(`[data-action="${focused}"]`, stage)?.focus();
  const promptEl = $('#prompt', stage);
  const state = s ? `step:${s.step_id}:${s.level}` : `run:${r.run.status}`;
  if (promptEl) {
    void fontsReady.then(() => {
      if (!promptEl.isConnected) return;
      const len = promptEl.textContent?.length ?? 0;
      fitText(promptEl, len <= 28 ? 52 : len <= 60 ? 44 : len <= 100 ? 40 : 34, 22);
      markRendered(state);
    });
  } else {
    void fontsReady.then(() => markRendered(state));
  }
}

function show(r: StepResult, _origin: Action | null): void {
  previous = result;
  result = r;
  toast = toastFor(r);
  render();
}

// ------------------------------------------------------------------------------------ taps

/** Update button state in place (no re-render, so nothing on screen jumps while waiting). */
function setBusy(action: Action | null): void {
  busy = action;
  stage.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((b) => {
    b.disabled = !!action;
    if (action && b.dataset.action === action) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
  });
}

const LABEL: Record<Action, string> = { done: 'Done', help: 'Help', repeat: 'Repeat' };

async function act(action: Action): Promise<void> {
  const r = result;
  const s = r?.step;
  if (!r || !s || busy) return;
  setBusy(action);
  try {
    const args =
      action === 'repeat' ? { run_id: s.run_id } : { run_id: s.run_id, step_id: s.step_id };
    const tool = action === 'done' ? 'step_done' : action === 'help' ? 'need_help' : 'repeat_step';
    const next = await view.call<StepResult>(tool, args);
    setBusy(null);
    if (action === 'repeat') {
      flashPrompt = true;
      if (!next.step?.prompt && next.speech) toast = { kind: 'info', text: next.speech };
      previous = result;
      result = next;
      render();
    } else {
      show(next, action);
    }
    const now = next.step
      ? `Now on step ${next.step.index} of ${next.step.total}, "${next.step.title}" (run_id ${next.run.run_id}, step_id ${next.step.step_id}, level ${next.step.level}).`
      : `The ${next.run.routine_name} is ${next.run.status}.`;
    view.tellModel(
      `[Scaffold step card] The person tapped ${LABEL[action]} on "${s.title}" instead of speaking. Scaffold's reply, already shown on screen: "${next.speech}". ${now}`,
    );
  } catch (err) {
    setBusy(null);
    toast = { kind: 'error', text: err instanceof ToolError ? err.message : 'Something went wrong. Try again.' };
    render();
  }
}

stage.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (btn && !btn.disabled) void act(btn.dataset.action as Action);
});

renderWaiting();
