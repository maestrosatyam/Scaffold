// Independence report — renders ReportOut (independence_report, coach role) for an
// occupational therapist: headline, words-per-run chart (synthetic history clearly marked),
// per-step support levels with the recorded reason for every change, and attention callouts.
import './shared/base.css';
import './shared/coach.css';
import './independence-report.css';
import { pictogram } from './pictograms.ts';
import { wordsChart } from './report-chart.ts';
import { brandMark } from './shared/brand.ts';
import { html, mount, plural, raw, type Html } from './shared/dom.ts';
import { shortDate } from './shared/format.ts';
import { connectView, markRendered } from './shared/host.ts';
import { icon } from './shared/icons.ts';
import { fontsReady } from './shared/stage.ts';
import { COACH_LEVEL_LABEL, LEVELS, levelIndex, type ReportResult } from './shared/types.ts';

type StepRow = ReportResult['steps'][number];
type Change = StepRow['changes'][number];

const page = document.getElementById('page')!;

const view = connectView<ReportResult>({
  name: 'independence-report',
  theme: 'host',
  onResult: (r) => render(r),
  onPending: () => {
    if (!page.dataset.loaded) mount(page, html`<p class="loading">Preparing the report…</p>`);
  },
  onToolError: (m) => mount(page, html`<p class="loading">${m}</p>`),
});

const sentences = (s: string): string[] => s.match(/[^.!?]+[.!?]+(\s|$)/g)?.map((x) => x.trim()) ?? [s];

function kpis(r: ReportResult): Html {
  const n = r.runs.length;
  const delta = n >= 2 && r.first_words && r.last_words !== null ? Math.round(((r.last_words - r.first_words) / r.first_words) * 100) : null;
  const pct = r.total_steps ? r.independent_steps / r.total_steps : 0;
  return html`<section class="kpis" aria-label="Summary">
    <div class="kpi card">
      <p class="kpi-label">Prompting in the latest run</p>
      <p class="kpi-value">${r.last_words ?? '—'}<span class="unit"> words</span></p>
      <p class="kpi-sub">
        ${delta !== null
          ? html`<span class="badge ${delta <= 0 ? 'good' : 'warn'}">${icon(delta <= 0 ? 'down' : 'up')}${Math.abs(delta)}%</span> from ${r.first_words} in the first run`
          : 'Not enough runs to compare yet'}
      </p>
    </div>
    <div class="kpi card">
      <p class="kpi-label">Done without prompts</p>
      <p class="kpi-value">${r.independent_steps}<span class="unit"> of ${r.total_steps} steps</span></p>
      <div class="kpi-meter" role="img" aria-label="${Math.round(pct * 100)}% of steps">
        ${Array.from({ length: r.total_steps }, (_, i) => html`<i class="${i < r.independent_steps ? 'on' : ''}"></i>`)}
      </div>
    </div>
    <div class="kpi card">
      <p class="kpi-label">Finished runs</p>
      <p class="kpi-value">${n}</p>
      <p class="kpi-sub"><b>${r.live_runs} live</b> · ${r.seeded_runs} synthetic demo</p>
    </div>
  </section>`;
}

function attention(r: ReportResult): Html {
  if (!r.attention.length) return html``;
  return html`<section class="attention" aria-label="Needs attention">
    ${r.attention.map((a) => {
      const st = r.steps.find((s) => s.step_id === a.step_id);
      return html`<div class="callout">
        <span class="callout-ic">${icon('alert')}</span>
        <div>
          <p class="callout-title"><b>${a.title}</b> needs attention</p>
          <p class="callout-why">${a.reason}</p>
          ${st?.next_prompt ? html`<p class="callout-next">Next time Scaffold will say: “${st.next_prompt}”</p>` : ''}
        </div>
      </div>`;
    })}
  </section>`;
}

const CAUSE_ICON = { faded: 'down', 'support-added': 'up', 'coach-set': 'edit' } as const;
const CAUSE_TEXT = { faded: 'Less support', 'support-added': 'More support', 'coach-set': 'Set by coach' } as const;

function change(c: Change, tz?: string): Html {
  return html`<li class="chg ${c.cause}">
    <span class="chg-ic" title="${CAUSE_TEXT[c.cause]}">${icon(CAUSE_ICON[c.cause])}</span>
    <div>
      <p class="chg-top"><b>${COACH_LEVEL_LABEL[c.from]} → ${COACH_LEVEL_LABEL[c.to]}</b><span class="sr-only"> (${CAUSE_TEXT[c.cause]})</span> <time datetime="${c.at}">${shortDate(c.at, tz)}</time></p>
      <p class="chg-why">${c.reason}</p>
    </div>
  </li>`;
}

function streak(s: StepRow, tz?: string): string {
  if (s.unaided_streak) return `${plural(s.unaided_streak, 'run')} in a row unaided`;
  const last = s.changes.at(-1);
  if (last) return `At this level since ${shortDate(last.at, tz)}`;
  return 'No unaided runs yet';
}

function stepRow(s: StepRow, tz?: string): Html {
  const filled = levelIndex(s.level) + 1;
  const newestFirst = [...s.changes].reverse();
  return html`<li class="step-row ${s.needs_attention ? 'attn' : ''}">
    <div class="tile-sm">${raw(pictogram(s.pictogram))}</div>
    <div class="step-main">
      <div class="step-top">
        <h3>${s.title}</h3>
        ${s.needs_attention ? html`<span class="badge warn">${icon('alert')}Needs attention</span>` : ''}
      </div>
      <p class="next">${s.next_prompt ? html`Next time: “${s.next_prompt}”` : html`Next time: <i>silent</i> — done on their own`}</p>
    </div>
    <div class="lvl">
      <div class="seg4 ${s.level}" aria-hidden="true">${LEVELS.map((_, i) => html`<i class="${i < filled ? 'on' : ''}"></i>`)}</div>
      <p class="lvl-label">${COACH_LEVEL_LABEL[s.level]}</p>
      <p class="lvl-streak">${streak(s, tz)}</p>
    </div>
    ${s.changes.length
      ? html`<details class="why">
          <summary><span>Why?</span><span class="why-count">${plural(s.changes.length, 'change')}</span>${icon('chevron', 'ic why-chev')}</summary>
          <ol class="chg-list">${newestFirst.map((c) => change(c, tz))}</ol>
        </details>`
      : html`<p class="why-none">No level changes yet</p>`}
  </li>`;
}

function table(r: ReportResult, tz?: string): Html {
  return html`<details class="table-view">
    <summary>Show runs as a table</summary>
    <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Date</th><th scope="col">Source</th><th scope="col" class="n">Words</th><th scope="col" class="n">Prompts</th><th scope="col" class="n">Helps</th><th scope="col" class="n">Unaided</th></tr></thead>
        <tbody>
          ${[...r.runs].reverse().map(
            (x) => html`<tr><td>${shortDate(x.started_at, tz)}</td><td>${x.seeded ? 'Synthetic' : html`<b>Live</b>`}</td><td class="n">${x.words}</td><td class="n">${x.prompts}</td><td class="n">${x.helps}</td><td class="n">${x.unaided_steps}/${x.total_steps}</td></tr>`,
          )}
        </tbody>
      </table>
    </div>
  </details>`;
}

function render(r: ReportResult): void {
  const tz = view.timeZone();
  const [lead, ...rest] = sentences(r.headline);
  page.dataset.loaded = '1';
  mount(
    page,
    html`<header class="head">
        <p class="eyebrow">${brandMark()}Independence report</p>
        <h1 class="who">${r.person_name} · ${r.routine_name} <span class="ver">version ${r.version}</span></h1>
        <p class="lead">${lead}</p>
        ${rest.length ? html`<p class="lead-rest">${rest.join(' ')}</p>` : ''}
      </header>
      ${r.seeded_runs
        ? html`<p class="honesty"><span class="swatch" aria-hidden="true"></span><span><b>Synthetic demo history: ${plural(r.seeded_runs, 'run')}.</b> ${r.seeded_runs} of ${r.runs.length} runs were generated by the demo seeder, not by real use. They are hatched in the chart.</span></p>`
        : ''}
      ${kpis(r)}
      ${attention(r)}
      <section class="card chart-card">
        <div class="card-head">
          <h2 class="section-title">Words spoken per run</h2>
          <p class="muted">Total words of prompting Scaffold said in each finished run. Lower means the person needed less support.</p>
        </div>
        ${r.runs.length
          ? html`<div class="chart" id="chart" tabindex="0" aria-label="Chart of words per run. Use the left and right arrow keys to read each run."></div>
              <div class="chart-key" aria-hidden="true">
                <span><i class="k-seeded"></i>Synthetic demo run</span><span><i class="k-live"></i>Live run</span>
                <span class="hint">Hover or use ← → for each run</span>
              </div>
              ${table(r, tz)}`
          : html`<p class="empty">No finished runs yet.</p>`}
      </section>
      <section class="card steps">
        <div class="card-head steps-head">
          <div>
            <h2 class="section-title">Steps</h2>
            <p class="muted">Support level now and the recorded reason for every change.</p>
          </div>
          <div class="seg-legend" aria-hidden="true"><span class="seg4 mini"><i class="on"></i><i></i><i></i><i></i></span>Full prompt<span class="arrow">→</span><span class="seg4 mini"><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i></span>On their own</div>
        </div>
        <ul class="step-list">${r.steps.map((s) => stepRow(s, tz))}</ul>
      </section>
      <footer class="fine">Task metrics only: Scaffold makes no clinical judgement. Levels change by a fixed rule, and every change is listed with the runs that caused it.</footer>`,
  );
  const chartEl = document.getElementById('chart');
  void fontsReady.then(() => {
    if (chartEl) wordsChart(chartEl, r.runs, tz);
    markRendered(`report:${r.routine_id}:${r.runs.length}`);
  });
}

mount(page, html`<p class="loading">Preparing the report…</p>`);
