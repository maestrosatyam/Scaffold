// Minimal, dependency-free templating: every interpolated value is HTML-escaped unless it is
// explicitly marked trusted with raw() (only our own SVG/markup). Coach-authored prompt text
// therefore can never inject markup into a card.

export class Html {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]!);

/** Mark trusted markup (our own SVG strings) so html`` does not escape it. */
export const raw = (s: string): Html => new Html(s);

type Value = Html | string | number | boolean | null | undefined | Value[];
const render = (v: Value): string => {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (Array.isArray(v)) return v.map(render).join('');
  if (v instanceof Html) return v.value;
  return esc(v);
};

export function html(strings: TemplateStringsArray, ...values: Value[]): Html {
  let out = strings[0]!;
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1]!;
  });
  return new Html(out);
}

export function mount(el: Element, content: Html): void {
  el.innerHTML = content.value;
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);

/** Plural helper: plural(3, 'step') -> "3 steps". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
