// UI glyphs (24×24, stroke = currentColor). Pictograms for routine steps live in ../pictograms.ts.
import { raw, type Html } from './dom.ts';

const P: Record<string, string> = {
  help: '<circle cx="12" cy="12" r="9.25"/><path d="M9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.9-2.6 2.3-2.6 4.2"/><path d="M12 17.6v.01" stroke-width="3"/>',
  repeat: '<path d="M19.5 10.5A7.7 7.7 0 0 0 5.6 7.4L4 9"/><path d="M4 4v5h5"/><path d="M4.5 13.5a7.7 7.7 0 0 0 13.9 3.1L20 15"/><path d="M20 20v-5h-5"/>',
  check: '<path d="M5 12.8l4.4 4.4L19.2 7.4"/>',
  fewer: '<path d="M4.5 12.5l4.2 4.2L19.5 6"/>',
  more: '<path d="M12 5v14M5 12h14"/>',
  coach: '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M13.5 7l3 3"/>',
  skip: '<path d="M5 6l6 6-6 6"/><path d="M13 6l6 6-6 6"/>',
  alert: '<path d="M12 3.8 2.8 19.5h18.4z"/><path d="M12 10v4.2"/><path d="M12 17v.01" stroke-width="3"/>',
  info: '<circle cx="12" cy="12" r="9.25"/><path d="M12 11v5.5"/><path d="M12 7.8v.01" stroke-width="3"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  down: '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>',
  up: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  edit: '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/>',
};

export type IconName = keyof typeof P;

export function icon(name: IconName, cls = 'ic'): Html {
  return raw(
    `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${P[name]}</svg>`,
  );
}
