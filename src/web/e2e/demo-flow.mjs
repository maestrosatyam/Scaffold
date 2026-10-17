// End-to-end demo flow for the simulator, driven through window.scaffold (deterministic) and real
// clicks where it matters (room switcher, coach tabs, MCP App card buttons).
//
//   BASE=http://127.0.0.1:8787 OUT=../evidence/screenshots/web node src/web/e2e/demo-flow.mjs
//
// Uses an installed Playwright (PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs to override) and an
// already-downloaded Chromium (CHROMIUM=/path/to/chrome); never downloads browsers.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
const OUT = resolve(process.env.OUT ?? '../evidence/screenshots/web');
mkdirSync(OUT, { recursive: true });

async function loadPlaywright() {
  if (process.env.PLAYWRIGHT_MODULE) return import(process.env.PLAYWRIGHT_MODULE);
  try {
    return await import('playwright');
  } catch {
    const npx = join(homedir(), '.npm/_npx');
    for (const d of existsSync(npx) ? readdirSync(npx) : []) {
      const p = join(npx, d, 'node_modules/playwright/index.mjs');
      if (existsSync(p)) return import(p);
    }
    throw new Error('Playwright not found; set PLAYWRIGHT_MODULE');
  }
}

function chromiumPath() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort() : [];
  for (const d of dirs.reverse()) {
    const p = join(root, d, 'chrome-linux64/chrome');
    if (existsSync(p)) return p;
  }
  return undefined;
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
const mcpRequests = [];
page.on('request', (r) => {
  if (r.url().endsWith('/mcp') && r.method() === 'POST') mcpRequests.push({ headers: r.headers(), body: r.postData() });
});

const log = [];
const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  log.push(`screenshot ${name}.png`);
};
const say = async (text) => {
  const t = await page.evaluate(async (u) => {
    const turn = await window.scaffold.say(u);
    return { tool: turn.tool ?? null, speech: turn.speech, silent: turn.silent, intent: turn.intent, isError: !!turn.result?.isError };
  }, text);
  log.push(`say ${JSON.stringify(text)} -> ${t.tool ?? 'reply'}${t.isError ? ' (isError)' : ''}: ${t.silent ? '[silent]' : JSON.stringify(t.speech)}`);
  return t;
};
const appReady = (room) =>
  page.waitForFunction((r) => !!document.querySelector(`[data-room-screen="${r}"] .screen-layer[data-active="true"] .apphost[data-status="ready"]`), room, { timeout: 15000 });

await page.goto(`${BASE}/?mute=1`);
await page.waitForFunction(() => window.scaffold?.ready === true, null, { timeout: 30000 });
await shot('01-simulator-idle');

await say('start my morning');
await appReady('bedroom');
await shot('02-start-morning');

for (let i = 0; i < 2; i++) await say('done');
await shot('03-dress-cue');
await say('ho gaya');
await say('done');
await shot('04-bag-partial');
await say('help');
await shot('05-bag-help');

// Expand the newest tools/call in the trace for a close-up.
await page.locator('.rpc.latest .rpc-head').first().click();
await shot('06-trace-expanded');
await page.locator('.rpc.latest .rpc-head').first().click();

await page.click('[data-room="kitchen"]');
await shot('07-kitchen-idle');
await say('where was I?');
await appReady('kitchen');
await shot('08-kitchen-resume');

// Tap the card's own Done button: a real mouse click inside the MCP App iframe. The view calls
// tools/call through AppBridge, the host proxies it to the server with the same MCP client.
const tapCard = async (room, action) => {
  const handle = await page.$(`[data-room-screen="${room}"] .screen-layer[data-active="true"] iframe`);
  const frame = await handle.contentFrame();
  const r = await frame.evaluate((a) => {
    const b = document.querySelector(`button[data-action="${a}"]`);
    if (!b) return null;
    const x = b.getBoundingClientRect();
    return { x: x.x + x.width / 2, y: x.y + x.height / 2, w: innerWidth };
  }, action);
  if (!r) return false;
  const box = await handle.boundingBox();
  const k = box.width / r.w;
  const before = await page.evaluate(() => window.scaffold.turns().length);
  await page.mouse.click(box.x + r.x * k, box.y + r.y * k);
  await page.waitForFunction((n) => window.scaffold.turns().length > n && !window.scaffold.turns().at(-1).pending, before, { timeout: 8000 });
  const t = await page.evaluate(() => { const t = window.scaffold.turns().at(-1); return { source: t.source, tool: t.tool, speech: t.speech }; });
  log.push(`tap ${action} on the ${room} card -> ${t.tool} (source ${t.source}): ${JSON.stringify(t.speech)}`);
  return t.source === 'card';
};
const tapped = await tapCard('kitchen', 'done');
await shot('09-after-bag');
let fin = await say('all done');
if (fin.tool !== 'step_done' || !/done at/.test(fin.speech)) fin = await say('done');
await shot('10-finished');

await page.click('.nav a[href="/coach"]');
await page.waitForSelector('[data-testid="coach-report"] .apphost[data-status="ready"]', { timeout: 15000 });
await shot('11-coach-report');
await page.click('[data-tab="suggest"]');
await page.click('[data-testid="send-suggestion"]');
await page.waitForSelector('[data-testid="suggest-result"]', { timeout: 10000 });
await shot('12-coach-suggest');
await page.click('[data-tab="steps"]');
await shot('13-coach-steps');

await page.click('.nav a[href="/"]');
await page.waitForSelector('.device', { timeout: 10000 });
await page.click('[data-room="bedroom"]');
await say('any suggestions?');
await shot('14-suggestions');
await say('yes');
await shot('15-approved');
await say('start laundry');
await shot('16-start-laundry');

await page.click('.nav a[href="/?layout=split"]');
await shot('17-director-split');
await page.click('.nav a[href="/time-machine"]');
await page.waitForFunction(() => document.querySelectorAll('.tm-col .apphost[data-status="ready"]').length >= 4, null, { timeout: 20000 });
await shot('18-time-machine');

// Protocol check: the browser client's initialize offers 2025-11-25 and later requests carry it.
const init = mcpRequests.find((r) => r.body?.includes('"initialize"'));
const later = mcpRequests.find((r) => r.body?.includes('"tools/call"'));
const negotiated = await page.evaluate(() => window.scaffold.protocolVersion());
const traceInit = await page.evaluate(() => window.scaffold.trace().find((e) => e.method === 'initialize')?.response?.result?.protocolVersion);

const summary = {
  base: BASE,
  initializeOffered: init ? JSON.parse(init.body).params?.protocolVersion : null,
  initializeNegotiated: traceInit,
  clientNegotiated: negotiated,
  mcpProtocolVersionHeader: later?.headers['mcp-protocol-version'] ?? null,
  finishedSpeech: fin.speech,
  cardTap: tapped,
  consoleErrors,
  log,
};
writeFileSync(join(OUT, 'demo-flow.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
process.exit(consoleErrors.length ? 1 : 0);
