// "Words spoken per run" chart for the independence report: hand-written SVG, no chart library.
// Single series (no legend box; the card title names it). Synthetic demo runs sit on a hatched
// band with a visible label, live runs get solid markers: the encoding never relies on colour.
import { esc } from './shared/dom.ts';
import { dayDate, shortDate } from './shared/format.ts';
import type { ReportResult } from './shared/types.ts';

type RunRow = ReportResult['runs'][number];

const H = 248;
const M = { top: 40, right: 52, bottom: 32, left: 44 };

const niceStep = (raw: number): number => {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
};

/** Consecutive runs sharing the `seeded` flag. */
function segments(runs: RunRow[]): { seeded: boolean; from: number; to: number }[] {
  const out: { seeded: boolean; from: number; to: number }[] = [];
  runs.forEach((r, i) => {
    const last = out.at(-1);
    if (last && last.seeded === r.seeded) last.to = i;
    else out.push({ seeded: r.seeded, from: i, to: i });
  });
  return out;
}

export interface ChartHandle {
  render(): void;
}

export function wordsChart(host: HTMLElement, runs: RunRow[], timeZone?: string): ChartHandle {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'status');
  tip.hidden = true;
  let active = -1;
  let geom: { x: (i: number) => number; y: (v: number) => number } | null = null;

  const render = () => {
    const W = Math.max(320, Math.round(host.clientWidth || 700));
    const n = runs.length;
    const plotW = W - M.left - M.right;
    const plotH = H - M.top - M.bottom;
    const max = Math.max(...runs.map((r) => r.words), 1);
    const step = niceStep(max / 5);
    const yMax = Math.ceil((max * 1.06) / step) * step;
    const gap = n > 1 ? plotW / (n - 1) : plotW;
    const x = (i: number) => M.left + (n > 1 ? i * gap : plotW / 2);
    const y = (v: number) => M.top + plotH - (v / yMax) * plotH;
    geom = { x, y };
    const base = y(0);

    // grid + y ticks
    let grid = '';
    for (let v = 0; v <= yMax + 0.01; v += step) {
      grid += `<line x1="${M.left}" x2="${W - M.right + 8}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
      grid += `<text x="${M.left - 10}" y="${y(v) + 4}" class="tick" text-anchor="end">${v}</text>`;
    }

    // synthetic / live bands
    let bands = '';
    for (const s of segments(runs)) {
      const x0 = Math.max(M.left - 6, x(s.from) - gap / 2);
      const x1 = Math.min(W - M.right + 6, x(s.to) + gap / 2);
      const count = s.to - s.from + 1;
      if (s.seeded) {
        bands += `<rect x="${x0}" y="${M.top - 8}" width="${x1 - x0}" height="${base - M.top + 8}" fill="url(#hatch)" class="band"/>`;
        bands += `<text x="${x0 + 8}" y="${M.top - 16}" class="band-label">Synthetic demo history · ${count} run${count === 1 ? '' : 's'}</text>`;
      } else {
        const wide = x1 - x0 > 130;
        const lx = wide ? x0 + 8 : x1;
        bands += `<rect x="${x0}" y="${M.top - 8}" width="${x1 - x0}" height="${base - M.top + 8}" class="band-live"/>`;
        bands += `<text x="${lx}" y="${M.top - 16}" class="band-label live" text-anchor="${wide ? 'start' : 'end'}">Live · ${count} run${count === 1 ? '' : 's'}</text>`;
      }
    }

    // series
    const pts = runs.map((r, i) => [x(i), y(r.words)] as const);
    const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join('');
    const area = n > 1 ? `${line}L${pts.at(-1)![0].toFixed(1)} ${base}L${pts[0]![0].toFixed(1)} ${base}Z` : '';
    const dots = runs
      .map((r, i) =>
        r.seeded
          ? `<circle cx="${pts[i]![0]}" cy="${pts[i]![1]}" r="3.2" class="dot-seeded"/>`
          : `<circle cx="${pts[i]![0]}" cy="${pts[i]![1]}" r="5.5" class="dot-live"/>`,
      )
      .join('');

    // x labels: first, last and evenly spaced between (never colliding)
    const slots = Math.max(2, Math.min(n, Math.floor(plotW / 92)));
    const idx = new Set<number>([0, n - 1]);
    for (let k = 1; k < slots - 1; k++) idx.add(Math.round((k * (n - 1)) / (slots - 1)));
    const xl = [...idx]
      .filter((i) => i >= 0 && i < n)
      .sort((a, b) => a - b)
      .map((i) => {
        const anchor = i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle';
        const dx = anchor === 'start' ? -4 : anchor === 'end' ? 4 : 0;
        return `<text x="${x(i) + dx}" y="${H - 8}" class="tick" text-anchor="${anchor}">${esc(shortDate(runs[i]!.started_at, timeZone))}</text>`;
      })
      .join('');

    // direct labels: the first and the latest value only
    const first = runs[0]!;
    const last = runs.at(-1)!;
    const labels =
      `<text x="${pts[0]![0] + 9}" y="${pts[0]![1] - 2}" class="val">${first.words}<tspan class="val-unit"> words</tspan></text>` +
      (n > 1 ? `<text x="${pts.at(-1)![0] + 11}" y="${pts.at(-1)![1] + 5}" class="val">${last.words}</text>` : '');

    const seeded = runs.filter((r) => r.seeded).length;
    const aria = `Words of prompting per run: ${first.words} on ${shortDate(first.started_at, timeZone)}${n > 1 ? `, ${last.words} on ${shortDate(last.started_at, timeZone)}` : ''}, ${n} runs (${seeded} synthetic demo, ${n - seeded} live).`;

    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(aria)}">
      <defs>
        <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="7" class="hatch-line"/>
        </pattern>
      </defs>
      ${bands}${grid}
      <path d="${area}" class="area"/>
      <path d="${line}" class="line"/>
      ${dots}${labels}${xl}
      <line class="cross" y1="${M.top - 8}" y2="${base}" x1="0" x2="0" visibility="hidden"/>
      <circle class="hl" r="7" cx="0" cy="0" visibility="hidden"/>
      <rect class="hit" x="${M.left - gap / 2}" y="${M.top - 8}" width="${plotW + gap}" height="${base - M.top + 8}"/>
    </svg>`;
    host.append(tip);
    if (active >= 0) show(active);
  };

  const show = (i: number) => {
    if (!geom || i < 0 || i >= runs.length) return;
    active = i;
    const r = runs[i]!;
    const svg = host.querySelector('svg')!;
    const cx = geom.x(i);
    const cy = geom.y(r.words);
    const cross = svg.querySelector<SVGLineElement>('.cross')!;
    cross.setAttribute('x1', String(cx));
    cross.setAttribute('x2', String(cx));
    cross.setAttribute('visibility', 'visible');
    const hl = svg.querySelector<SVGCircleElement>('.hl')!;
    hl.setAttribute('cx', String(cx));
    hl.setAttribute('cy', String(cy));
    hl.setAttribute('visibility', 'visible');
    tip.replaceChildren();
    const v = document.createElement('strong');
    v.textContent = `${r.words} words`;
    const d = document.createElement('span');
    d.textContent = `${dayDate(r.started_at, timeZone)} · ${r.seeded ? 'synthetic demo run' : 'live run'}`;
    const m = document.createElement('span');
    m.textContent = `${r.prompts} prompt${r.prompts === 1 ? '' : 's'} · ${r.helps} help${r.helps === 1 ? '' : 's'} · ${r.unaided_steps} of ${r.total_steps} steps unaided`;
    tip.append(v, d, m);
    tip.hidden = false;
    const W = host.clientWidth;
    const left = Math.min(Math.max(cx - 118, 0), W - 236);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, cy - 96)}px`;
  };
  const hide = () => {
    active = -1;
    tip.hidden = true;
    host.querySelectorAll('.cross, .hl').forEach((el) => el.setAttribute('visibility', 'hidden'));
  };
  const nearest = (clientX: number) => {
    const svg = host.querySelector('svg');
    if (!svg || !geom) return -1;
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * Number(svg.viewBox.baseVal.width);
    let best = 0;
    runs.forEach((_, i) => {
      if (Math.abs(geom!.x(i) - px) < Math.abs(geom!.x(best) - px)) best = i;
    });
    return best;
  };

  host.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  host.addEventListener('pointerleave', hide);
  host.addEventListener('focus', () => show(active >= 0 ? active : runs.length - 1));
  host.addEventListener('blur', hide);
  host.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = Math.min(runs.length - 1, Math.max(0, (active < 0 ? runs.length - 1 : active) + (e.key === 'ArrowLeft' ? -1 : 1)));
      show(next);
    } else if (e.key === 'Escape') hide();
  });

  let pending = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      const svg = host.querySelector('svg');
      if (!svg || Math.abs(Number(svg.getAttribute('width')) - host.clientWidth) > 1) render();
    });
  }).observe(host);

  render();
  return { render };
}
