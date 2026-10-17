// Screenshots of every view, rendered inside the dev harness (real AppBridge host, sandboxed
// iframe, fixtures recorded from the real server). Also fails on any console error.
//
//   node scripts/build-apps.ts --dev
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core CHROMIUM=/path/to/chrome \
//     node src/apps/dev/screenshot.ts [outDir] [filter]
//
// playwright-core is not a project dependency (disk budget); point PLAYWRIGHT_CORE at any copy
// (e.g. an npx cache) and CHROMIUM at an installed Chromium/headless-shell binary.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pictogram, PICTOGRAM_KEYS } from '../pictograms.ts';

const root = resolve(fileURLToPath(import.meta.url), '../../../..');
const dist = join(root, 'dist');
const outDir = resolve(process.argv[2] ?? join(root, '../evidence/screenshots/apps'));
const filter = process.argv[3] ?? '';
const pwPath = process.env.PLAYWRIGHT_CORE;
if (!pwPath) throw new Error('Set PLAYWRIGHT_CORE to a playwright-core package directory');
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped optional tool
const { chromium } = createRequire(join(pwPath, 'package.json'))('playwright-core') as { chromium: any };

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const p = join(dist, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  if (!p.startsWith(dist) || !existsSync(p)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' }).end(readFileSync(p));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

interface Shot {
  name: string;
  scenario: string;
  width?: number;
  theme?: string;
  /** Click these [data-action] / selectors inside the view, in order, before the screenshot. */
  clicks?: string[];
  reduced?: boolean;
  /** Settle time after render (ms) so entrance animations have finished. */
  settle?: number;
}

const SHOTS: Shot[] = [
  { name: '01-step-cue', scenario: 'cue' },
  { name: '02-step-cue-helped-climb', scenario: 'cue-helped' },
  { name: '03-step-partial', scenario: 'partial' },
  { name: '04-step-full-after-help', scenario: 'full-helped' },
  { name: '05-step-on-your-own', scenario: 'start-own' },
  { name: '06-step-faded-toast', scenario: 'fade-toast' },
  { name: '07-step-running-late', scenario: 'late' },
  { name: '08-finished-support-added', scenario: 'finished-support', settle: 1900 },
  { name: '09-finished-faded', scenario: 'finished-faded', settle: 1900 },
  { name: '10-tap-help-then-done', scenario: 'cue', clicks: ['[data-action=help]', '[data-action=done]'] },
  { name: '11-step-cue-reduced-motion', scenario: 'cue-helped', reduced: true },
  { name: '12-step-cue-narrow-host', scenario: 'cue-helped', width: 560 },
  { name: '13-step-error-toast', scenario: 'cue-helped', clicks: ['[data-action=help]'] },
  { name: '20-report', scenario: 'report' },
  { name: '21-report-later', scenario: 'report-later' },
  { name: '22-report-dark', scenario: 'report-dark' },
  { name: '23-report-why-open', scenario: 'report', clicks: ['details.why summary'] },
  { name: '30-suggestion-new', scenario: 'suggest-new' },
  { name: '31-suggestion-changed', scenario: 'suggest-changed' },
  { name: '32-suggestion-approved', scenario: 'suggest-new', clicks: ['[data-decision=approved]'] },
  { name: '33-suggestion-declined', scenario: 'suggest-changed', clicks: ['[data-decision=declined]'] },
  { name: '34-suggestions-empty', scenario: 'suggest-empty' },
  { name: '40-progress', scenario: 'progress' },
  { name: '41-progress-later', scenario: 'progress-later' },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const problems: string[] = [];
for (const shot of SHOTS.filter((s) => s.name.includes(filter))) {
  const width = shot.width ?? 768;
  const ctx = await browser.newContext({
    viewport: { width, height: 480 },
    deviceScaleFactor: 2,
    reducedMotion: shot.reduced ? 'reduce' : 'no-preference',
    timezoneId: 'America/Los_Angeles',
    locale: 'en-US',
  });
  const page = await ctx.newPage();
  page.on('console', (m: { type(): string; text(): string }) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${shot.name}: console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e: Error) => problems.push(`${shot.name}: pageerror: ${e.message}`));
  const url = `http://127.0.0.1:${port}/apps-dev/dev-harness.html?shot=1&scenario=${shot.scenario}&width=${width}${shot.theme ? `&theme=${shot.theme}` : ''}`;
  await page.goto(url);
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  if (!frame) throw new Error('no frame');
  await frame.waitForSelector('html[data-rendered]:not([data-rendered=waiting])', { timeout: 10000 });
  for (const sel of shot.clicks ?? []) {
    const before = await frame.evaluate(() => document.documentElement.dataset.rendered);
    await frame.click(sel);
    await frame
      .waitForFunction((b: string | undefined) => document.documentElement.dataset.rendered !== b, before, { timeout: 4000 })
      .catch(() => undefined);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(shot.settle ?? 1500);
  const el = await page.$('#device');
  await el!.screenshot({ path: join(outDir, `${shot.name}.png`) });
  const h = await page.evaluate(() => document.querySelector('iframe')!.getBoundingClientRect().height);
  console.log(`${shot.name}.png  (${width}×${Math.round(h)})`);
  await ctx.close();
}
if ('50-pictograms'.includes(filter) || !filter) {
  // Contact sheet of every pictogram: on the device picture-card tile, and small on a light surface.
  const keys = [...PICTOGRAM_KEYS, 'unknown-key'];
  const page = await browser.newPage({ viewport: { width: 1040, height: 600 }, deviceScaleFactor: 2 });
  await page.setContent(`<body style="margin:0;background:#0b1b2b;font:600 13px system-ui,sans-serif;color:#9fb3c8">
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:18px 14px;padding:22px">
    ${keys.map((k) => `<div style="text-align:center"><div style="background:#f4f7fa;border-radius:24px;padding:14px;width:112px;height:112px;margin:auto;box-shadow:0 10px 24px rgb(0 0 0/35%)">${pictogram(k)}</div><div style="margin-top:8px">${k === 'unknown-key' ? 'fallback' : k}</div></div>`).join('')}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;padding:16px 22px;background:#fff">${keys.map((k) => `<div style="width:44px;height:44px;background:#eef3f6;border-radius:10px;padding:5px">${pictogram(k)}</div>`).join('')}</div>
  </body>`);
  await page.screenshot({ path: join(outDir, '50-pictograms.png'), fullPage: true });
  console.log('50-pictograms.png');
  await page.close();
}
await browser.close();
server.close();
if (problems.length) {
  console.log('\nConsole problems:\n' + problems.join('\n'));
  process.exitCode = 1;
} else console.log('\nNo console errors or warnings.');
