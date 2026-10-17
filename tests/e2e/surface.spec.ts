// AC-17 and basic accessibility, on every page of the simulator: the "simulated, not Amazon" label
// is visible, there is no Alexa logo, and lightweight a11y checks pass in the page and in every
// MCP App iframe (axe-core is not a dependency, so these are hand-rolled page.evaluate checks).
import type { Frame, Page } from '@playwright/test';
import { appReady, expect, open, say, SIM_LABEL, test } from './fixtures.ts';

const PAGES: { name: string; path: string; ready?: (page: Page) => Promise<void> }[] = [
  {
    name: 'simulator (with a step card on screen)',
    path: '/',
    ready: async (page) => {
      await say(page, 'start my morning');
      await appReady(page, 'bedroom');
    },
  },
  { name: 'director view', path: '/?layout=split' },
  { name: 'device kiosk', path: '/device' },
  {
    name: 'coach view',
    path: '/coach',
    ready: async (page) => {
      await expect(page.locator('[data-testid="coach-report"] .apphost')).toHaveAttribute('data-status', 'ready');
    },
  },
  {
    name: 'time machine',
    path: '/time-machine',
    ready: async (page) => {
      await expect(page.locator('.tm-col .apphost[data-status="ready"]')).toHaveCount(4, { timeout: 20_000 });
    },
  },
];

interface A11yIssues {
  url: string;
  unnamedButtons: string[];
  imagesWithoutAlt: string[];
  unlabelledFields: string[];
  alexaBranding: string[];
}

/** Runs inside a frame: buttons need an accessible name, images need alt, fields need a label. */
function auditFrame(): A11yIssues {
  const visible = (el: Element) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && (r.width > 0 || r.height > 0) && !el.closest('[aria-hidden="true"]');
  };
  const text = (el: Element): string => {
    let out = '';
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
      else if (n instanceof Element && n.getAttribute('aria-hidden') !== 'true' && getComputedStyle(n).display !== 'none') {
        if (n instanceof HTMLImageElement) out += n.alt;
        else if (n instanceof SVGElement && n.tagName.toLowerCase() === 'svg') out += n.getAttribute('aria-label') ?? n.querySelector('title')?.textContent ?? '';
        else out += text(n);
      }
    });
    return out;
  };
  const byIds = (ids: string | null) =>
    (ids ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
  const name = (el: Element) => (byIds(el.getAttribute('aria-labelledby')) || el.getAttribute('aria-label') || text(el) || el.getAttribute('title') || (el as HTMLInputElement).value || '').trim();
  const describe = (el: Element) => el.outerHTML.slice(0, 160).replace(/\s+/g, ' ');

  const unnamedButtons = [...document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a[href]')]
    .filter(visible)
    .filter((el) => !name(el))
    .map(describe);

  const imagesWithoutAlt = [
    ...[...document.querySelectorAll('img')].filter((img) => !img.hasAttribute('alt')),
    // Icons exposed as images (role="img", including inline SVG) must be named; decorative ones are aria-hidden.
    ...[...document.querySelectorAll('[role="img"]')].filter((el) => visible(el) && !name(el) && !el.querySelector('title')),
  ].map(describe);

  const unlabelledFields = [...document.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]), select, textarea')]
    .filter(visible)
    .filter((el) => {
      const id = el.getAttribute('id');
      const forLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      return !(forLabel || el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title'));
    })
    .map(describe);

  // No Alexa logo / Amazon artwork: no image or icon named or sourced as such.
  const alexaBranding = [...document.querySelectorAll('img, svg, [role="img"], picture source')]
    .filter((el) => /alexa|amazon/i.test([el.getAttribute('src'), el.getAttribute('srcset'), el.getAttribute('alt'), el.getAttribute('aria-label'), el.querySelector?.('title')?.textContent].join(' ')))
    .map(describe);

  return { url: location.href.slice(0, 80), unnamedButtons, imagesWithoutAlt, unlabelledFields, alexaBranding };
}

async function auditAllFrames(page: Page): Promise<A11yIssues[]> {
  const out: A11yIssues[] = [];
  for (const f of page.frames() as Frame[]) {
    if (f.isDetached()) continue;
    out.push(await f.evaluate(auditFrame));
  }
  return out;
}

interface TabStop {
  el: string;
  visible: boolean;
}

/**
 * Runs in every frame after each Tab: describes the focused element of the innermost focused
 * document and whether focusing it visibly changed it or one of its 3 nearest ancestors (outline,
 * box-shadow ring, border or background), e.g. `.say-form:focus-within` around the text box.
 */
function focusedHere(n: number): (TabStop & { again: boolean }) | null {
  if (!document.hasFocus()) return null;
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body || el.tagName === 'IFRAME') return null;
  const again = el.hasAttribute('data-e2e-tab');
  const desc = `${location.protocol === 'about:' ? '[iframe] ' : ''}${el.outerHTML.slice(0, 120).replace(/\s+/g, ' ')}`;
  if (!again) el.setAttribute('data-e2e-tab', String(n));
  const chain = [el, el.parentElement, el.parentElement?.parentElement, el.parentElement?.parentElement?.parentElement].filter((x): x is HTMLElement => !!x);
  const saved = chain.map((x) => x.style.transition);
  chain.forEach((x) => (x.style.transition = 'none'));
  const look = () =>
    chain
      .map((x) => {
        const s = getComputedStyle(x);
        const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}` : 'none';
        return [outline, s.boxShadow, s.borderTopColor, s.borderBottomColor, s.backgroundColor].join('|');
      })
      .join(' / ');
  const focused = look();
  el.blur();
  const plain = look();
  el.focus({ preventScroll: true });
  chain.forEach((x, i) => (x.style.transition = saved[i] ?? ''));
  const r = el.getBoundingClientRect();
  return { el: desc, visible: focused !== plain && r.width > 0 && r.height > 0, again };
}

/** Tab through the whole page once (until focus returns to an element already visited). */
async function walkTabStops(page: Page, max = 120): Promise<TabStop[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const stops: TabStop[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    let hit: (TabStop & { again: boolean }) | null = null;
    for (const f of page.frames()) {
      if (f.isDetached()) continue;
      hit = (await f.evaluate(focusedHere, i).catch(() => null)) ?? hit;
    }
    if (!hit) continue;
    if (hit.again) break;
    stops.push({ el: hit.el, visible: hit.visible });
  }
  return stops;
}

for (const p of PAGES) {
  test(`${p.name}: "${SIM_LABEL}" label, no Alexa logo, basic accessibility`, async ({ page }) => {
    await open(page, p.path);
    await p.ready?.(page);

    await test.step('the simulated-surface label is visible', async () => {
      const label = page.getByText(SIM_LABEL, { exact: true });
      await expect(label).toBeVisible();
      await expect(label).toBeInViewport();
    });

    await test.step('document has a lang and a title', async () => {
      expect(await page.evaluate(() => document.documentElement.lang)).toMatch(/^[a-z]{2}(-[A-Za-z]{2})?$/);
      expect((await page.title()).length).toBeGreaterThan(0);
    });

    await test.step('no Alexa logo; every button/link named; images have alt; fields labelled (page + MCP App iframes)', async () => {
      const issues = await auditAllFrames(page);
      expect(issues.length).toBeGreaterThan(0);
      const flat = (k: keyof Omit<A11yIssues, 'url'>) => issues.flatMap((i) => i[k].map((b) => `${i.url}: ${b}`));
      expect(flat('alexaBranding'), 'Alexa/Amazon artwork').toEqual([]);
      expect(flat('unnamedButtons'), 'buttons/links without an accessible name').toEqual([]);
      expect(flat('imagesWithoutAlt'), 'images without alt').toEqual([]);
      expect(flat('unlabelledFields'), 'form fields without a label').toEqual([]);
    });

    await test.step("Playwright's accessible-name computation agrees for every visible button", async () => {
      const buttons = page.getByRole('button');
      const n = await buttons.count();
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        const b = buttons.nth(i);
        if (await b.isVisible()) await expect(b).toHaveAccessibleName(/\S/);
      }
    });

    await test.step('keyboard focus is visible on every tab stop (page and MCP App iframes)', async () => {
      const stops = await walkTabStops(page);
      test.info().annotations.push({ type: 'tab stops', description: `${stops.length} (${stops.filter((x) => x.el.startsWith('[iframe]')).length} inside MCP App iframes)` });
      expect(stops.length, 'Tab reaches focusable elements').toBeGreaterThan(3);
      expect(stops.filter((r) => !r.visible), 'tab stops without a visible focus indicator').toEqual([]);
    });
  });
}

test('the accessibility checks themselves catch a nameless button, an image without alt and an unlabelled field', async ({ page }) => {
  await page.setContent(`<!doctype html><html><body>
    <button id="ok">Save</button><button id="bad"><svg aria-hidden="true" width="10" height="10"></svg></button>
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="5" height="5">
    <input id="field"><label>Named <input></label>
    <a href="#x" style="outline:none">plain link</a></body></html>`);
  const [issues] = await auditAllFrames(page);
  expect(issues?.unnamedButtons).toHaveLength(1);
  expect(issues?.imagesWithoutAlt).toHaveLength(1);
  expect(issues?.unlabelledFields).toHaveLength(1);
  const stops = await walkTabStops(page);
  expect(stops.length).toBe(5);
  expect(stops.filter((s) => !s.visible).map((s) => s.el)).toEqual([expect.stringContaining('plain link')]);
});
