// Single-series line chart: words of prompting planned per morning, one point per day.
// Specs: 2px line, ~10% area wash, hairline solid grid, ring-marked highlighted days,
// crosshair + tooltip that snaps to the nearest day, and a table view for non-visual access.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface WordsPoint {
  label: string;
  sub: string;
  words: number;
  highlight?: boolean;
}

const SERIES = '#22ab9e'; // validated for the dark chart surface (lightness band + 3:1 contrast)
const GRID = '#1b3249';
const SURFACE = '#0c1a29';

export function WordsChart({ points, height = 170 }: { points: WordsPoint[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(1000);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(320, Math.round(el.getBoundingClientRect().width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const pad = { l: 40, r: 26, t: 14, b: 28 };
  const max = Math.max(50, Math.ceil(Math.max(...points.map((p) => p.words), 0) / 50) * 50);
  const x = (i: number) => pad.l + (points.length <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: max / 50 + 1 }, (_, i) => i * 50);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.words).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  // Direct x labels: ends and highlighted days always; periodic ones only where they cannot collide.
  const keyIdx = points.map((p, i) => i === 0 || i === points.length - 1 || !!p.highlight);
  const showLabel = (i: number) => keyIdx[i] || (i % 5 === 0 && !keyIdx.some((k, j) => k && Math.abs(j - i) <= 2));

  const onMove = (e: PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !points.length) return;
    const px = e.clientX - r.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };
  const hp = hover !== null ? points[hover] : null;

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <svg
        class="spark"
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`Words of prompting planned per morning, from ${points[0]?.words ?? 0} on ${points[0]?.label ?? ''} to ${points.at(-1)?.words ?? 0} ${points.at(-1)?.label ?? ''}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setHover((h) => Math.min(points.length - 1, (h ?? -1) + 1));
          if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? points.length) - 1));
        }}
        onBlur={() => setHover(null)}
        style={{ display: 'block', outline: 'none' }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} stroke-width="1" />
            <text x={pad.l - 10} y={y(t) + 4} text-anchor="end" font-size="12" fill="#7d93a9" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {t}
            </text>
          </g>
        ))}
        <path d={area} fill={SERIES} fill-opacity="0.1" />
        <path d={line} fill="none" stroke={SERIES} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        {points.map((p, i) =>
          showLabel(i) ? (
            <text key={`l${i}`} x={x(i)} y={H - 8} text-anchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} font-size="12" fill={p.highlight ? '#c7d4e1' : '#7d93a9'} font-weight={p.highlight ? '700' : '400'}>
              {p.label}
            </text>
          ) : null,
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} stroke="#9fb3c8" stroke-width="1" />}
        {points.map((p, i) =>
          p.highlight || i === hover ? <circle key={`m${i}`} cx={x(i)} cy={y(p.words)} r="5" fill={SERIES} stroke={SURFACE} stroke-width="2" /> : null,
        )}
      </svg>
      {hp && hover !== null && (
        <div
          role="status"
          style={{
            position: 'absolute',
            left: `${Math.min(W - 90, Math.max(90, x(hover)))}px`,
            top: `${Math.max(0, y(hp.words) - 14)}px`,
            transform: 'translate(-50%, -100%)',
            background: '#132536',
            border: '1px solid #24435f',
            borderRadius: '10px',
            padding: '7px 10px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 10px 24px -10px rgb(0 0 0 / 60%)',
          }}
        >
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f4f7fa' }}>{hp.words} words</div>
          <div style={{ fontSize: '12px', color: '#9fb3c8', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '2px', background: SERIES, display: 'inline-block' }} />
            {hp.label} · {hp.sub}
          </div>
        </div>
      )}
      <details style={{ marginTop: '4px', fontSize: '13px', color: '#9fb3c8' }}>
        <summary style={{ cursor: 'pointer' }}>View as table</summary>
        <table style={{ marginTop: '8px', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '3px 12px 3px 0' }}>Day</th>
              <th style={{ textAlign: 'left', padding: '3px 12px 3px 0' }}>Date</th>
              <th style={{ textAlign: 'right', padding: '3px 0' }}>Words planned</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.label}>
                <td style={{ padding: '2px 12px 2px 0' }}>{p.label}</td>
                <td style={{ padding: '2px 12px 2px 0' }}>{p.sub}</td>
                <td style={{ padding: '2px 0', textAlign: 'right' }}>{p.words}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Tiny trend for a stat tile: de-emphasis line, accent dot on the tile's own day. */
export function MiniTrend({ values, at }: { values: number[]; at: number }) {
  const W = 120;
  const H = 30;
  const max = Math.max(1, ...values);
  const x = (i: number) => 3 + (i * (W - 6)) / Math.max(1, values.length - 1);
  const y = (v: number) => 4 + (1 - v / max) * (H - 8);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={d} fill="none" stroke="#3b5a78" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx={x(at)} cy={y(values[at] ?? 0)} r="4" fill={SERIES} stroke={SURFACE} stroke-width="2" />
    </svg>
  );
}
