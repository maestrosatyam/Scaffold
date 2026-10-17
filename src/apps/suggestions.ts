// Suggestion review — renders SuggestionsOut (review_suggestions) for the LEARNER: the routine
// a coach proposed, what changes, and big Yes / Not now buttons that call decide_suggestion.
// Nothing a coach suggests takes effect until the person says yes.
import './shared/base.css';
import './shared/device.css';
import './suggestions.css';
import { pictogram } from './pictograms.ts';
import { brandMark } from './shared/brand.ts';
import { html, mount, plural, raw, type Html } from './shared/dom.ts';
import { personName } from './shared/format.ts';
import { connectView, markRendered, ToolError } from './shared/host.ts';
import { icon } from './shared/icons.ts';
import { fitStage, fitText, fontsReady } from './shared/stage.ts';
import type { DecideResult, Suggestion, SuggestionsResult } from './shared/types.ts';

type Decision = DecideResult['decision'];

const stage = document.getElementById('stage')!;
let queue: Suggestion[] = [];
let busy: Decision | null = null;
let error: string | null = null;
let decided: { result: DecideResult; suggestion: Suggestion } | null = null;

const view = connectView<SuggestionsResult>({
  name: 'suggestions',
  theme: 'device',
  onResult: (r) => {
    queue = r.suggestions.filter((s) => s.status === 'pending');
    decided = null;
    error = null;
    render();
  },
  onToolError: (m) => {
    error = m;
    render();
  },
  onContext: () => refit(),
});
const refit = fitStage(view);

function header(s: Suggestion | null, position: string | null): Html {
  const who = s ? personName(s.proposed_by) : null;
  return html`<header class="top">
    <div class="routine">
      ${who ? html`<span class="avatar" aria-hidden="true">${who.name.slice(0, 1)}</span><span>Suggestion from <b>${who.name}</b>${who.role ? html`<span class="role"> · ${who.role}</span>` : ''}</span>` : html`${brandMark()}<span>Suggestions</span>`}
    </div>
    ${position ? html`<span class="count">${position}</span>` : ''}
  </header>`;
}

function chips(s: Suggestion): Html {
  if (s.is_new) return html`<span class="chip new">${icon('plus')}New routine</span>`;
  const out: Html[] = [];
  if (s.added.length) out.push(html`<span class="chip added">${icon('plus')}${s.added.length} added</span>`);
  if (s.changed.length) out.push(html`<span class="chip changed">${icon('edit')}${s.changed.length} changed</span>`);
  if (s.removed.length) out.push(html`<span class="chip removed">${icon('minus')}${s.removed.length} removed</span>`);
  if (!out.length) out.push(html`<span class="chip">No step changes</span>`);
  return html`${out}`;
}

function stepList(s: Suggestion): Html {
  const added = new Set(s.is_new ? [] : s.added);
  const changed = new Set(s.changed);
  return html`<ol class="steps" aria-label="Steps in ${s.routine_name}">
    ${s.steps.map((st, i) => {
      const tag = added.has(st.title) ? html`<span class="row-tag added">New</span>` : changed.has(st.title) ? html`<span class="row-tag changed">Changed</span>` : '';
      return html`<li class="step ${added.has(st.title) ? 'is-added' : changed.has(st.title) ? 'is-changed' : ''}">
        <span class="n" aria-hidden="true">${i + 1}</span>
        <span class="tile">${raw(pictogram(st.pictogram))}</span>
        <span class="txt"><span class="t">${st.title}${tag}</span><span class="cue">${st.cue}</span></span>
      </li>`;
    })}
    ${s.removed.map(
      (t) => html`<li class="step is-removed"><span class="n" aria-hidden="true">${icon('minus')}</span><span class="txt"><span class="t"><s>${t}</s><span class="row-tag removed">Removed</span></span></span></li>`,
    )}
  </ol>`;
}

const decideButton = (d: Decision, label: string, cls: string, aria: string): Html =>
  html`<button type="button" class="btn ${cls}" data-decision="${d}" aria-label="${aria}" ${busy ? 'disabled' : ''} ${busy === d ? 'aria-busy="true"' : ''}>${icon(d === 'approved' ? 'check' : 'x')}<span>${label}</span></button>`;

function proposal(s: Suggestion): Html {
  const who = personName(s.proposed_by).name;
  return html`<main class="sug enter">
      <section class="about">
        <div class="chips">${chips(s)}</div>
        <h1 class="name">${s.routine_name}</h1>
        <p class="meta">${plural(s.steps.length, 'step')}</p>
        ${s.note ? html`<figure class="note"><blockquote>${s.note}</blockquote><figcaption>— ${who}</figcaption></figure>` : ''}
      </section>
      <section class="list">${stepList(s)}</section>
    </main>
    <footer class="actions">
      ${error ? html`<p class="pill error err" role="alert"><span class="pill-ic">${icon('alert')}</span><span>${error}</span></p>` : ''}
      ${decideButton('declined', 'Not now', 'btn-secondary', `Not now: do not add ${s.routine_name}`)}
      ${decideButton('approved', 'Yes, add it', 'btn-primary', `Yes, add it: approve ${s.routine_name}`)}
    </footer>`;
}

const reEsc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The spoken reply minus the part the heading already says ("Done. Laundry is ready." / "Okay,"). */
function afterHeading(d: DecideResult, s: Suggestion): string {
  const rest =
    d.decision === 'approved'
      ? d.speech.replace(/^Done\.\s*/, '').replace(new RegExp(`^${reEsc(s.routine_name)} is ready\\.\\s*`, 'i'), '')
      : d.speech.replace(/^Okay,\s*/, '');
  const out = rest.trim() || d.speech;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function outcome(d: DecideResult, s: Suggestion): Html {
  const yes = d.decision === 'approved';
  const more = queue.length;
  return html`<main class="outcome enter">
      <div class="seal ${yes ? 'yes' : 'no'}" aria-hidden="true">${icon(yes ? 'check' : 'minus', 'ic seal-ic')}</div>
      <h1>${yes ? `${s.routine_name} is ready` : 'Okay, not now'}</h1>
      <p class="said">${afterHeading(d, s)}</p>
      ${yes && d.published_version ? html`<p class="ver">Version ${d.published_version} of ${s.routine_name.toLowerCase()} is saved.</p>` : ''}
    </main>
    <footer class="actions one">
      ${more ? html`<button type="button" class="btn btn-secondary" data-next>${icon('chevron')}<span>Next suggestion (${more})</span></button>` : html`<p class="closing">${brandMark()}<span>Nothing else waiting.</span></p>`}
    </footer>`;
}

function render(): void {
  const s = queue[0] ?? null;
  let body: Html;
  if (decided) body = html`${header(decided.suggestion, null)}${outcome(decided.result, decided.suggestion)}`;
  else if (s) body = html`${header(s, queue.length > 1 ? `1 of ${queue.length}` : null)}${proposal(s)}`;
  else
    body = html`${header(null, null)}<main class="outcome"><div class="seal no" aria-hidden="true">${brandMark('ic seal-ic')}</div><h1>No suggestions waiting</h1><p class="said">When your coach suggests a change, it shows up here. Nothing changes until you say yes.</p></main><footer></footer>`;
  mount(stage, body);
  const state = decided ? `decided:${decided.result.decision}` : s ? `proposal:${s.proposal_id}` : 'empty';
  void fontsReady.then(() => {
    layout();
    markRendered(state);
  });
}

/** Fit the routine name, clamp the note to the room left, and mark the list if it scrolls. */
function layout(): void {
  const name = stage.querySelector<HTMLElement>('.name');
  if (name && fitText(name, 42, 30) <= 30 && name.scrollWidth > name.clientWidth + 1) {
    name.classList.add('wrap');
    fitText(name, 34, 24);
  }
  const about = stage.querySelector<HTMLElement>('.about');
  const quote = stage.querySelector<HTMLElement>('.note blockquote');
  if (about && quote) {
    for (let lines = 5; lines >= 1; lines--) {
      quote.style.setProperty('--lines', String(lines));
      if (about.scrollHeight <= about.clientHeight + 1) break;
    }
  }
  const list = stage.querySelector<HTMLElement>('.list');
  list?.classList.toggle('scrolls', list.scrollHeight > list.clientHeight + 1);
}

async function decide(d: Decision): Promise<void> {
  const s = queue[0];
  if (!s || busy) return;
  busy = d;
  error = null;
  stage.querySelectorAll<HTMLButtonElement>('button[data-decision]').forEach((b) => {
    b.disabled = true;
    if (b.dataset.decision === d) b.setAttribute('aria-busy', 'true');
  });
  try {
    const result = await view.call<DecideResult>('decide_suggestion', { proposal_id: s.proposal_id, decision: d });
    queue = queue.slice(1);
    decided = { result, suggestion: s };
    view.tellModel(
      `[Scaffold suggestion card] The person tapped "${d === 'approved' ? 'Yes, add it' : 'Not now'}" for ${s.routine_name} (proposal_id ${s.proposal_id}); decide_suggestion was already called with decision=${d}. Scaffold's reply, shown on screen: "${result.speech}"`,
    );
  } catch (err) {
    error = err instanceof ToolError ? err.message : 'Something went wrong. Try again.';
  }
  busy = null;
  render();
}

stage.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const b = t.closest<HTMLButtonElement>('button[data-decision]');
  if (b && !b.disabled) void decide(b.dataset.decision as Decision);
  if (t.closest('button[data-next]')) {
    decided = null;
    render();
  }
});

mount(stage, html`${header(null, null)}<main class="wait"><span class="breath" aria-hidden="true"></span><p>One moment…</p></main><footer></footer>`);
markRendered('waiting');
