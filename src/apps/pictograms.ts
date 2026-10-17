// Original pictograms for Scaffold, drawn for this project (no third-party icon sets).
//
// Style: AAC picture-card look — bold flat shapes, one heavy rounded ink outline, 2–3 brand
// colours from src/ui/tokens.css. 64×64 viewBox, content inside ~4..60.
// Colours are CSS custom properties with literal fallbacks, so the SVG renders correctly both
// inside the MCP Apps (which may retheme via --pg-*) and anywhere else it is inlined.
import { PICTOGRAM_KEYS, type PictogramKey } from './pictogram-keys.ts';

const INK = 'var(--pg-ink,#10243a)';
const TEAL = 'var(--pg-teal,#2ec4b6)';
const AMBER = 'var(--pg-amber,#ffb547)';
const PAPER = 'var(--pg-paper,#ffffff)';
const SOFT = 'var(--pg-soft,#bfece6)';
const SKIN = 'var(--pg-skin,#ffd9a3)';
const GREEN = 'var(--pg-green,#5bd08a)';
const ROSE = 'var(--pg-rose,#ff8a7a)';

/** Filled shape with the shared ink outline. */
const f = (c: string) => `style="fill:${c}"`;
/** Ink-only detail line (no fill). */
const L = (w = 3) => `style="fill:none;stroke-width:${w}"`;
/** Solid ink fill without outline (small details). */
const DOT = `style="fill:${INK};stroke:none"`;

const ICONS: Record<PictogramKey, string> = {
  toothbrush: `
    <g transform="rotate(-38 32 32)">
      <rect x="2" y="34" width="44" height="9" rx="4.5" ${f(TEAL)}/>
      <rect x="36" y="22" width="22" height="13" rx="3" ${f(PAPER)}/>
      <path d="M42 23v11M47.5 23v11M53 23v11" ${L(2.5)}/>
      <path d="M36.5 22c0-6 3-8.5 6-8.5 2.5 0 3 2.5 6 2.5s3.5-3 6-3c2.5 0 3.5 3 3.5 9z" ${f(SOFT)}/>
      <circle cx="10" cy="38.5" r="1.8" ${DOT}/>
    </g>`,
  'face-wash': `
    <circle cx="27" cy="37" r="20" ${f(SKIN)}/>
    <path d="M17 35c1.6 1.8 4.4 1.8 6 0M31 35c1.6 1.8 4.4 1.8 6 0" ${L(2.6)}/>
    <path d="M20.5 45c3.6 3.4 9.4 3.4 13 0" ${L(2.6)}/>
    <path d="M51 5c3.6 5 5.4 8.2 5.4 10.6a5.4 5.4 0 0 1-10.8 0C45.6 13.2 47.4 10 51 5z" ${f(TEAL)}/>
    <path d="M57 26c2.6 3.6 3.9 5.9 3.9 7.6a3.9 3.9 0 0 1-7.8 0c0-1.7 1.3-4 3.9-7.6z" ${f(TEAL)}/>
    <path d="M41 21c2.4 3.3 3.6 5.4 3.6 7a3.6 3.6 0 0 1-7.2 0c0-1.6 1.2-3.7 3.6-7z" ${f(SOFT)}/>`,
  shirt: `
    <path d="M23 8 11 13 3.5 26l9 5.5 4-5V57h31V26.5l4 5 9-5.5L53 13 41 8c-1.4 4.4-4.8 7-9 7s-7.6-2.6-9-7z" ${f(TEAL)}/>
    <path d="M23 8c1.4 4.4 4.8 7 9 7s7.6-2.6 9-7" ${f(PAPER)}/>
    <path d="M16.5 26.5V36M47.5 26.5V36" ${L(2.5)}/>
    <rect x="36" y="27" width="7" height="7" rx="1.5" ${f(SOFT)}/>`,
  cereal: `
    <rect x="44" y="1" width="6.5" height="30" rx="3.25" transform="rotate(32 47 16)" ${f(PAPER)}/>
    <circle cx="15" cy="30" r="4.6" ${f(AMBER)}/>
    <circle cx="24" cy="26.5" r="4.6" ${f(AMBER)}/>
    <circle cx="33" cy="29" r="4.6" ${f(AMBER)}/>
    <circle cx="42" cy="26" r="4.6" ${f(AMBER)}/>
    <circle cx="50" cy="30" r="4.2" ${f(AMBER)}/>
    <path d="M4 32h56c0 13.5-12.5 23-28 23S4 45.5 4 32z" ${f(TEAL)}/>
    <path d="M10 40.5h44" ${L(2.5)}/>
    <rect x="22" y="54" width="20" height="6" rx="3" ${f(TEAL)}/>`,
  backpack: `
    <path d="M24 14v-3.5C24 6.5 27 4 32 4s8 2.5 8 6.5V14" ${L(3.2)}/>
    <rect x="12" y="13" width="40" height="46" rx="12" ${f(AMBER)}/>
    <path d="M12 30h40" ${L(2.6)}/>
    <rect x="19" y="36" width="26" height="17" rx="5" ${f(PAPER)}/>
    <path d="M19 43h26" ${L(2.4)}/>
    <rect x="29" y="40" width="6" height="6" rx="1.5" ${f(TEAL)}/>
    <path d="M22 21.5h20" ${L(2.4)}/>`,
  key: `
    <g transform="rotate(-35 32 32)">
      <rect x="43" y="35" width="5" height="10" rx="1.5" ${f(AMBER)}/>
      <rect x="51" y="35" width="5" height="7" rx="1.5" ${f(AMBER)}/>
      <rect x="22" y="28" width="38" height="8" rx="3" ${f(AMBER)}/>
      <circle cx="16" cy="32" r="13" ${f(AMBER)}/>
      <circle cx="12" cy="32" r="4.5" ${f(PAPER)}/>
    </g>`,
  basket: `
    <rect x="12" y="11" width="21" height="17" rx="4" transform="rotate(-14 22 19)" ${f(AMBER)}/>
    <path d="M36 27V12a3 3 0 0 1 3-3h5a3 3 0 0 1 3 3v7h5a4.5 4.5 0 0 1 4.5 4.5V27z" ${f(PAPER)}/>
    <path d="M9 30h46l-5.5 27h-35z" ${f(TEAL)}/>
    <rect x="5" y="24" width="54" height="9" rx="4.5" ${f(TEAL)}/>
    <path d="M22 39v11M32 39v11M42 39v11" ${L(3)}/>`,
  washer: `
    <rect x="8" y="4" width="48" height="56" rx="8" ${f(PAPER)}/>
    <path d="M8 17h48" ${L(2.6)}/>
    <circle cx="16" cy="10.5" r="2.6" ${f(AMBER)}/>
    <rect x="35" y="8.5" width="14" height="4.5" rx="2" ${f(TEAL)}/>
    <circle cx="32" cy="38" r="15" ${f(SOFT)}/>
    <path d="M20.6 40c3.6-3 7.6-3 11.4 0s7.8 3 11.4 0a11.4 11.4 0 0 1-22.8 0z" style="fill:${TEAL};stroke:none"/>
    <circle cx="32" cy="38" r="11.4" ${L(2.6)}/>
    <path d="M26 31.5a8 8 0 0 1 5-3" style="fill:none;stroke:${PAPER};stroke-width:2.6"/>`,
  detergent: `
    <rect x="21" y="4" width="16" height="8" rx="2.5" ${f(AMBER)}/>
    <path d="M23 12h12v5h7c6 0 10 4 10 10v28c0 2.8-2.2 5-5 5H17c-2.8 0-5-2.2-5-5V25c0-4.4 3.6-8 8-8h3z" ${f(TEAL)}/>
    <path d="M44 24h2c1.7 0 3 1.3 3 3v6c0 1.7-1.3 3-3 3h-2z" ${f(PAPER)}/>
    <rect x="17" y="34" width="24" height="18" rx="4" ${f(PAPER)}/>
    <path d="M29 37.5c2.6 3.4 3.9 5.6 3.9 7.2a3.9 3.9 0 0 1-7.8 0c0-1.6 1.3-3.8 3.9-7.2z" ${f(TEAL)}/>`,
  'start-button': `
    <circle cx="32" cy="32" r="27" ${f(PAPER)}/>
    <circle cx="32" cy="32" r="19" ${f(GREEN)}/>
    <path d="M27 22.5 43 32l-16 9.5z" ${f(PAPER)}/>
    <path d="M32 5v4M32 55v4M5 32h4M55 32h4" ${L(2.6)}/>`,
  shower: `
    <path d="M12 60V18c0-7 5-12 12-12h6c6 0 10 4.5 10 10v3" ${L(3.6)}/>
    <path d="M31 19h18l5 9H26z" ${f(AMBER)}/>
    <path d="M30 37.5c2.2 3 3.3 4.9 3.3 6.3a3.3 3.3 0 0 1-6.6 0c0-1.4 1.1-3.3 3.3-6.3z" ${f(TEAL)}/>
    <path d="M40 34.5c2.2 3 3.3 4.9 3.3 6.3a3.3 3.3 0 0 1-6.6 0c0-1.4 1.1-3.3 3.3-6.3z" ${f(TEAL)}/>
    <path d="M50 37.5c2.2 3 3.3 4.9 3.3 6.3a3.3 3.3 0 0 1-6.6 0c0-1.4 1.1-3.3 3.3-6.3z" ${f(TEAL)}/>
    <path d="M35 49c2.2 3 3.3 4.9 3.3 6.3a3.3 3.3 0 0 1-6.6 0c0-1.4 1.1-3.3 3.3-6.3z" ${f(SOFT)}/>
    <path d="M45 49c2.2 3 3.3 4.9 3.3 6.3a3.3 3.3 0 0 1-6.6 0c0-1.4 1.1-3.3 3.3-6.3z" ${f(SOFT)}/>`,
  bed: `
    <rect x="4" y="15" width="9" height="43" rx="3" ${f(AMBER)}/>
    <rect x="51" y="31" width="9" height="27" rx="3" ${f(AMBER)}/>
    <rect x="13" y="40" width="38" height="11" rx="2" ${f(PAPER)}/>
    <rect x="15" y="30.5" width="15" height="9.5" rx="4.75" ${f(PAPER)}/>
    <path d="M27 51V39c0-2.8 2.2-5 5-5h19v17z" ${f(TEAL)}/>
    <path d="M27 40.5h24" ${L(2.6)}/>`,
  cup: `
    <path d="M22 15c-2.5-3 2.5-5 0-9M31 15c-2.5-3 2.5-5 0-9M40 15c-2.5-3 2.5-5 0-9" ${L(2.6)}/>
    <path d="M45 28h3.5a7.5 7.5 0 0 1 0 15H45" style="fill:none;stroke-width:9.5"/>
    <path d="M45 28h3.5a7.5 7.5 0 0 1 0 15H45" style="fill:none;stroke:${TEAL};stroke-width:3.5"/>
    <path d="M10 21h36v27c0 5.5-4.5 10-10 10H20c-5.5 0-10-4.5-10-10z" ${f(TEAL)}/>
    <rect x="11.5" y="31" width="33" height="7" style="fill:${PAPER};stroke:none"/>
    <path d="M10 21h36v27c0 5.5-4.5 10-10 10H20c-5.5 0-10-4.5-10-10z" style="fill:none"/>`,
  plate: `
    <circle cx="32" cy="32" r="19" ${f(PAPER)}/>
    <circle cx="32" cy="32" r="11.5" ${f(SOFT)}/>
    <path d="M7 8v12c0 2.8 2 4.5 4 4.5S15 22.8 15 20V8M11 8v48" ${L(3)}/>
    <path d="M53 56V8c3.8 2.2 6 7 6 14 0 4.4-1.8 7.4-6 8" ${f(AMBER)}/>`,
  shoe: `
    <path d="M5 44c0-8 2.5-14 7-14h12l8-8c3-2.6 7.2-2 9 1.4 3.6 7 9.6 10 13.6 12 2.6 1.3 4.4 3.6 4.4 6.6V46H5z" ${f(TEAL)}/>
    <rect x="3" y="44" width="58" height="9" rx="4.5" ${f(PAPER)}/>
    <path d="M28 27.5l5 5M33 24l5 5" ${L(2.4)}/>
    <path d="M5 36h14" ${L(2.4)}/>`,
  bus: `
    <rect x="13" y="51" width="9" height="9" rx="2.5" ${f(INK)}/>
    <rect x="42" y="51" width="9" height="9" rx="2.5" ${f(INK)}/>
    <rect x="8" y="4" width="48" height="50" rx="9" ${f(AMBER)}/>
    <rect x="14" y="10" width="36" height="7" rx="2" ${f(PAPER)}/>
    <rect x="14" y="21" width="36" height="16" rx="3" ${f(SOFT)}/>
    <circle cx="18.5" cy="45" r="3.4" ${f(PAPER)}/>
    <circle cx="45.5" cy="45" r="3.4" ${f(PAPER)}/>
    <path d="M27 45h10" ${L(2.6)}/>
    <path d="M4 20v8M60 20v8" ${L(3.2)}/>`,
  phone: `
    <rect x="16" y="3" width="32" height="58" rx="7" ${f(PAPER)}/>
    <rect x="21" y="11" width="22" height="38" rx="2.5" ${f(TEAL)}/>
    <path d="M28 7h8" ${L(2.4)}/>
    <circle cx="32" cy="55" r="2.6" ${f(SOFT)}/>
    <path d="M25 19h10M25 25h14M25 31h8" style="fill:none;stroke:${PAPER};stroke-width:2.6"/>`,
  broom: `
    <rect x="28.5" y="2" width="7" height="34" rx="3.5" ${f(PAPER)}/>
    <path d="M18 40h28l7 18H11z" ${f(AMBER)}/>
    <rect x="18" y="33" width="28" height="8" rx="2.5" ${f(TEAL)}/>
    <path d="M22 46l-2 9M32 46v9M42 46l2 9" ${L(2.4)}/>`,
  clock: `
    <path d="M7 19a9 9 0 0 1 13-11z" ${f(AMBER)}/>
    <path d="M57 19a9 9 0 0 0-13-11z" ${f(AMBER)}/>
    <path d="M17 52l-4 6M47 52l4 6" ${L(3.4)}/>
    <circle cx="32" cy="34" r="23" ${f(TEAL)}/>
    <circle cx="32" cy="34" r="16.5" ${f(PAPER)}/>
    <path d="M32 24.5V34l7 4.5" ${L(3.4)}/>
    <circle cx="32" cy="34" r="2" ${DOT}/>`,
  step: `
    <path d="M5 58V47h13V36h13V25h13V14h14v44z" ${f(TEAL)}/>
    <path d="M18 47v11M31 36v22M44 25v33" ${L(2.4)}/>
    <path d="M51 14V3" ${L(3)}/>
    <path d="M51 3.5h10l-3 4 3 4H51" ${f(AMBER)}/>`,
};

const FALLBACK = `
  <rect x="9" y="9" width="46" height="46" rx="11" ${f(SOFT)}/>
  <path d="M20.5 33.5l7.5 7.5 15.5-17" style="fill:none;stroke-width:5"/>`;

export const hasPictogram = (key: string): key is PictogramKey => (PICTOGRAM_KEYS as readonly string[]).includes(key);

/**
 * Inline SVG for a pictogram key (falls back to a generic task card for unknown keys).
 * Decorative by default; pass `label` to expose it to assistive tech as an image.
 */
export function pictogram(key: string, label?: string): string {
  const body = hasPictogram(key) ? ICONS[key] : FALLBACK;
  const a11y = label ? `role="img" aria-label="${label.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}"` : 'aria-hidden="true"';
  return `<svg class="pg" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" ${a11y} focusable="false" data-pictogram="${hasPictogram(key) ? key : 'fallback'}"><g style="stroke:${INK};stroke-width:3;stroke-linecap:round;stroke-linejoin:round">${body}</g></svg>`;
}

export { PICTOGRAM_KEYS };
