// My progress — renders ProgressOut (my_progress) for the LEARNER: which steps they now do on
// their own, in their own terms. Warm and plain; no scores, no comparisons.
import './shared/base.css';
import './shared/device.css';
import './progress.css';
import { pictogram } from './pictograms.ts';
import { brandMark } from './shared/brand.ts';
import { html, mount, plural, raw } from './shared/dom.ts';
import { connectView, markRendered } from './shared/host.ts';
import { icon } from './shared/icons.ts';
import { fitStage, fontsReady } from './shared/stage.ts';
import { LEVELS, levelIndex, type Level, type ProgressResult } from './shared/types.ts';

const stage = document.getElementById('stage')!;

/** How the learner hears each level described. */
const PLAIN: Record<Level, string> = {
  full: 'Full reminder',
  partial: 'Short reminder',
  cue: 'Just a cue word',
  independent: 'On your own',
};

const view = connectView<ProgressResult>({
  name: 'progress',
  theme: 'device',
  onResult: (r) => render(r),
  onContext: () => refit(),
});
const refit = fitStage(view);

function render(r: ProgressResult): void {
  const n = r.steps.length;
  const cols = n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : 4;
  const own = r.independent_steps;
  const lead =
    own === 0
      ? html`You're learning your ${r.routine_name.toLowerCase()}.`
      : own === n
        ? html`You do <em>every step</em> on your own.`
        : html`You do <em>${own} of ${n} steps</em> on your own.`;
  mount(
    stage,
    html`<header class="top">
        <div class="routine">${brandMark()}<span>${r.routine_name}</span></div>
        <span class="count">${r.runs_finished ? `Finished ${plural(r.runs_finished, 'time')}` : 'Not finished yet'}</span>
      </header>
      <main class="prog enter">
        <div class="lead">
          <h1>${lead}</h1>
          <p>Every time you do a step without help, I say less.</p>
        </div>
        <ul class="grid c${cols}" aria-label="Steps">
          ${r.steps.map((s) => {
            const i = levelIndex(s.level);
            const isOwn = s.level === 'independent';
            return html`<li class="cell ${isOwn ? 'own' : ''} lv-${s.level}">
              <span class="tile">${raw(pictogram(s.pictogram))}${isOwn ? html`<span class="badge-own" aria-hidden="true">${icon('check')}</span>` : ''}</span>
              <span class="txt">
                <span class="t">${s.title}</span>
                <span class="lvl"><span class="pips" aria-hidden="true">${LEVELS.map((_, k) => html`<i class="${k <= i ? 'on' : ''}"></i>`)}</span>${PLAIN[s.level]}</span>
              </span>
            </li>`;
          })}
        </ul>
      </main>`,
  );
  void fontsReady.then(() => markRendered(`progress:${own}/${n}`));
}

mount(stage, html`<main class="wait"><span class="breath" aria-hidden="true"></span><p>One moment…</p></main>`);
markRendered('waiting');
