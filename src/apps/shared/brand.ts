// Scaffold brand mark: three bars that thin out — prompts that fade as a step is learned.
import { raw, type Html } from './dom.ts';

export const brandMark = (cls = 'mark'): Html =>
  raw(
    `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
      `<rect x="2" y="3.5" width="20" height="4.2" rx="2.1" fill="#2ec4b6"/>` +
      `<rect x="2" y="9.9" width="13.5" height="4.2" rx="2.1" fill="#2ec4b6" fill-opacity=".62"/>` +
      `<rect x="2" y="16.3" width="7" height="4.2" rx="2.1" fill="#2ec4b6" fill-opacity=".32"/>` +
      `</svg>`,
  );
