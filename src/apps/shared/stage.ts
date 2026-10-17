// Fixed 768×480 design canvas, uniformly zoomed to the iframe width (and to a fixed container
// height when the host imposes one). CSS `zoom` (unlike transform) changes layout size, so the
// App's auto-resize reports the real rendered height to the host.
import type { ViewHandle } from './host.ts';

export const STAGE_W = 768;
export const STAGE_H = 480;

export function fitStage(view: ViewHandle, base = { w: STAGE_W, h: STAGE_H }): () => void {
  const apply = () => {
    const w = document.documentElement.clientWidth || window.innerWidth || base.w;
    const dims = view.context()?.containerDimensions as { height?: number } | undefined;
    let z = w / base.w;
    if (dims && typeof dims.height === 'number' && dims.height > 0) z = Math.min(z, dims.height / base.h);
    z = Math.min(Math.max(z, 0.4), 3);
    document.documentElement.style.setProperty('--zoom', z.toFixed(4));
  };
  apply();
  window.addEventListener('resize', apply);
  return apply;
}

/**
 * Shrinks an element's font size until its content fits its box (deterministic: same text and
 * box always give the same size). Starts from `max` and steps down to `min`.
 */
export function fitText(el: HTMLElement, max: number, min: number): number {
  let size = max;
  el.style.fontSize = `${size}px`;
  while (size > min && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
    size -= 1;
    el.style.fontSize = `${size}px`;
  }
  return size;
}

/** Resolves once both bundled font weights are ready, so text measurement is final. */
export const fontsReady: Promise<void> = (async () => {
  try {
    await Promise.all([
      document.fonts.load('400 32px "Atkinson Hyperlegible"'),
      document.fonts.load('700 32px "Atkinson Hyperlegible"'),
    ]);
    await document.fonts.ready;
  } catch {
    /* measuring with the fallback font is still fine */
  }
})();
