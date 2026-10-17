#!/usr/bin/env node
// Records the Scaffold demo-video take from the LIVE app (real server, real MCP client, real
// clicks). The script is the director: it plays the story beat by beat through window.scaffold
// and real mouse clicks, waits for every voice line, and logs a timeline of every beat.
//
//   1. node scripts/record-demo.mjs --dry     capture every line the take will voice (incl. the
//                                             assistant's verbatim speech from the server)
//                                             -> $ASSETS/build/lines.json
//   2. (synthesize the lines: scripts/video/tts.py)       -> $ASSETS/build/audio/manifest.json
//   3. node scripts/record-demo.mjs           the real take -> $ASSETS/build/master.mp4 (from
//                                             Playwright's screencast frames, constant 30 fps),
//                                             $ASSETS/build/take-playwright.webm (recordVideo),
//                                             $ASSETS/build/timeline.json
//
// The page's speaker is replaced (window.scaffold.setSpeaker) so the device "speaks" for exactly
// as long as the pre-rendered WAV of exactly that text; the WAVs are mixed in afterwards
// (scripts/video/mix.py) at the timestamps logged here.
//
// Env: BASE (default http://127.0.0.1:8787), ASSETS (default ../submission/VIDEO_ASSETS),
//      PLAYWRIGHT_CORE (a playwright-core package dir; default: first one in ~/.npm/_npx),
//      CHROMIUM (browser binary; default: newest ~/.cache/ms-playwright/chromium-*), NO_GPU=1,
//      SHOTS=dir (dry run: screenshot every mark into dir).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
const ASSETS = resolve(process.env.ASSETS ?? join(here, '../../submission/VIDEO_ASSETS'));
const BUILD = join(ASSETS, 'build');
const DRY = process.argv.includes('--dry');
const SHOTS = process.env.SHOTS ? resolve(process.env.SHOTS) : null;
const FPS = 30;
mkdirSync(BUILD, { recursive: true });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const key = (voice, text) => `${voice}|${text}`;

// ------------------------------------------------------------------ playwright + chromium

function loadChromium() {
  let dir = process.env.PLAYWRIGHT_CORE;
  if (!dir) {
    const npx = join(homedir(), '.npm/_npx');
    for (const d of existsSync(npx) ? readdirSync(npx) : []) {
      const p = join(npx, d, 'node_modules/playwright-core');
      if (existsSync(join(p, 'package.json'))) dir = p;
    }
  }
  if (!dir) throw new Error('playwright-core not found; set PLAYWRIGHT_CORE');
  return createRequire(join(dir, 'package.json'))('playwright-core').chromium;
}

function chromiumPath() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  for (const d of dirs) {
    const p = join(root, d, 'chrome-linux64/chrome');
    if (existsSync(p)) return p;
  }
  return undefined;
}

// ------------------------------------------------------------------ screencast -> constant-fps H.264

/** Writes Playwright screencast frames (JPEG, wall-clock timestamps) as a constant 30 fps video. */
class FrameEncoder {
  constructor(file) {
    this.file = file;
    this.queue = [];
    this.last = null;
    this.t0 = null;
    this.n = 0;
    this.frames = 0;
    this.proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', '-c:v', 'libx264', '-preset', 'superfast', '-crf', '13', '-pix_fmt', 'yuv420p', '-g', String(FPS * 2), '-y', file], { stdio: ['pipe', 'inherit', 'inherit'] });
    this.closed = new Promise((r) => this.proc.on('close', r));
    this.timer = setInterval(() => this.pump(Date.now() - 900), 40);
  }
  onFrame(f) {
    if (this.t0 === null) this.t0 = f.timestamp;
    this.queue.push({ ts: f.timestamp, data: f.data });
    this.frames++;
  }
  /** Emit every output frame whose time is before `horizon` (frames can arrive a few hundred ms late). */
  pump(horizon) {
    if (this.t0 === null) return;
    while (this.t0 + (this.n * 1000) / FPS <= horizon) {
      const ft = this.t0 + (this.n * 1000) / FPS;
      while (this.queue.length && this.queue[0].ts <= ft) this.last = this.queue.shift();
      if (this.last) this.proc.stdin.write(this.last.data);
      this.n++;
    }
  }
  /** Seconds into the output video for a wall-clock time (ms). */
  at(epochMs) {
    return (epochMs - this.t0) / 1000;
  }
  async stop() {
    clearInterval(this.timer);
    await sleep(1000);
    this.pump(Date.now() - 50);
    this.proc.stdin.end();
    await this.closed;
  }
}

// ------------------------------------------------------------------ the director

class Director {
  constructor(page, manifest) {
    this.page = page;
    this.manifest = manifest;
    this.lines = new Map();
    this.timeline = [];
    this.missing = [];
    this.speaks = [];
    this.policy = () => ({});
    this.burn = false;
    this.zoomed = false;
    this.startEpoch = null;
  }

  pause(ms) {
    return sleep(DRY ? Math.min(ms, 120) : ms);
  }

  /** Register a line for synthesis (dry run) and return its audio (take). */
  audio(voice, text, tts) {
    if (!this.lines.has(key(voice, text))) this.lines.set(key(voice, text), { voice, text, ...(tts ? { tts } : {}) });
    if (DRY) return { file: null, ms: 0, sentenceEnds: [0] };
    const a = this.manifest[key(voice, text)];
    if (!a) {
      this.missing.push(key(voice, text));
      console.error(`!! no audio for ${voice}: ${JSON.stringify(text)}`);
      return { file: null, ms: 600 + text.split(/\s+/).length * 330, sentenceEnds: [] };
    }
    return a;
  }

  log(entry) {
    const e = { epoch: Date.now(), ...entry };
    this.timeline.push(e);
    return e;
  }

  async mark(name) {
    this.log({ type: 'mark', name });
    if (name === 'start') this.startEpoch = Date.now();
    if (SHOTS) await this.page.screenshot({ path: join(SHOTS, `${String(this.timeline.length).padStart(3, '0')}-${name}.png`) });
  }

  /** Narrator line; resolves when it has been spoken (plus `after` ms). */
  async narrate(text, { tts, after = 380 } = {}) {
    const a = this.audio('narrator', text, tts);
    this.log({ type: 'line', who: 'narrator', text, file: a.file, dur: a.ms / 1000, sentenceEnds: a.sentenceEnds, burn: true });
    await this.pause(a.ms + after);
  }

  /** Sam speaks (synthesized voice), then the words go to the live simulator as text. */
  async sam(text, { after = 110, tail = 420, room } = {}) {
    const a = this.audio('sam', text);
    this.log({ type: 'line', who: 'sam', text, file: a.file, dur: a.ms / 1000, sentenceEnds: a.sentenceEnds, burn: this.burn });
    await this.pause(a.ms + after);
    const turn = await this.page.evaluate(
      async ({ u, room }) => {
        const t = await window.scaffold.say(u, { source: 'api', ...(room ? { room } : {}) });
        return { id: t.id, tool: t.tool ?? null, speech: t.speech, silent: t.silent, isError: !!t.result?.isError };
      },
      { u: text, room },
    );
    this.log({ type: 'turn', user: text, tool: turn.tool, speech: turn.speech, silent: turn.silent, isError: turn.isError });
    if (turn.isError) console.error(`!! tool error for ${JSON.stringify(text)}: ${turn.speech}`);
    await this.waitSpoken(turn.id, turn.speech, tail);
    return turn;
  }

  /** Called from the page's speaker: returns how long the device should "speak" (ms). */
  onSpeak(text, meta) {
    const p = this.policy(text, meta) ?? {};
    const a = this.audio('assistant', text);
    let ms = a.ms;
    if (p.sentences && a.sentenceEnds?.[p.sentences - 1] !== undefined) ms = Math.min(a.ms, a.sentenceEnds[p.sentences - 1] + 140);
    const rec = { text, meta, at: Date.now(), end: 0 };
    if (p.mute) {
      this.log({ type: 'line', who: 'assistant', text, muted: true, room: meta?.room });
      rec.end = Date.now() + (p.waitMs ?? 300);
      this.speaks.push(rec);
      return DRY ? 0 : (p.waitMs ?? 300);
    }
    this.log({ type: 'line', who: 'assistant', text, file: a.file, dur: ms / 1000, full: a.ms / 1000, cut: ms < a.ms, sentenceEnds: a.sentenceEnds, burn: this.burn, room: meta?.room });
    const wait = ms + (p.tail ?? 0);
    rec.end = Date.now() + wait;
    this.speaks.push(rec);
    return DRY ? 0 : wait;
  }

  /** Wait until the assistant has finished speaking for a turn (no-op for silent turns). */
  async waitSpoken(turnId, speech, tail = 420) {
    if (!speech) return this.pause(tail);
    const t0 = Date.now();
    let rec;
    while (!(rec = this.speaks.find((s) => s.meta?.turnId === turnId)) && Date.now() - t0 < 4000) await sleep(15);
    if (!rec) throw new Error(`no speech arrived for turn ${turnId}: ${speech}`);
    await sleep(rec.end - Date.now());
    await this.pause(tail);
  }

  /** Wait for `n` speech records after index `from` (time machine playback). */
  async waitSpeaks(from, n, tail = 0) {
    const t0 = Date.now();
    while (this.speaks.length < from + n && Date.now() - t0 < 60000) await sleep(20);
    const last = this.speaks[from + n - 1];
    if (!last) throw new Error('time machine playback did not speak');
    await sleep(last.end - Date.now());
    await this.pause(tail);
  }

  /** A full-screen card (rendered separately) covers the take while `body` runs. */
  async card(id, body, { hidden } = {}) {
    this.log({ type: 'card', id, state: 'in' });
    const work = hidden ? hidden() : Promise.resolve();
    await body();
    await work;
    this.log({ type: 'card', id, state: 'out' });
  }

  cardState(id, state) {
    this.log({ type: 'card-state', id, state });
  }

  callout(id, ms) {
    this.log({ type: 'callout', id, dur: ms / 1000 });
  }

  /** Camera move: scale the whole page around an element (CSS transform on #app, eased). */
  async zoom(selector, scale, { ms = 900, dx = 0, dy = 0 } = {}) {
    await this.page.evaluate(
      ({ selector, scale, ms, dx, dy }) => {
        const app = document.getElementById('app');
        const cur = JSON.parse(app.dataset.cam ?? '{"tx":0,"ty":0,"s":1}');
        const r = document.querySelector(selector).getBoundingClientRect();
        const base = { x: (r.x - cur.tx) / cur.s, y: (r.y - cur.ty) / cur.s, w: r.width / cur.s, h: r.height / cur.s };
        const W = innerWidth;
        const H = innerHeight;
        let tx = W / 2 - (base.x + base.w / 2 + dx) * scale;
        let ty = H / 2 - (base.y + base.h / 2 + dy) * scale;
        tx = Math.min(0, Math.max(W - W * scale, tx));
        ty = Math.min(0, Math.max(H - H * scale, ty));
        app.style.transformOrigin = '0 0';
        app.style.transition = `transform ${ms}ms cubic-bezier(0.45, 0, 0.2, 1)`;
        app.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
        app.dataset.cam = JSON.stringify({ tx, ty, s: scale });
      },
      { selector, scale, ms, dx, dy },
    );
    this.zoomed = scale !== 1;
    this.log({ type: 'camera', selector, scale });
    await this.pause(ms + 80);
  }

  async zoomOut(ms = 800) {
    await this.page.evaluate((ms) => {
      const app = document.getElementById('app');
      app.style.transition = `transform ${ms}ms cubic-bezier(0.45, 0, 0.2, 1)`;
      app.style.transform = 'none';
      app.dataset.cam = '{"tx":0,"ty":0,"s":1}';
    }, ms);
    this.zoomed = false;
    this.log({ type: 'camera', selector: null, scale: 1 });
    await this.pause(ms + 80);
  }

  /** Smoothly scroll a scrollable element so `top` (px within its content) is at its top. */
  async scrollTo(selector, top, ms = 1400) {
    await this.page.evaluate(
      ({ selector, top, ms, dry }) =>
        new Promise((done) => {
          const el = document.querySelector(selector);
          const from = el.scrollTop;
          const to = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight));
          if (dry) {
            el.scrollTop = to;
            return done();
          }
          const t0 = performance.now();
          const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
          const step = (now) => {
            const k = Math.min(1, (now - t0) / ms);
            el.scrollTop = from + (to - from) * ease(k);
            if (k < 1) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        }),
      { selector, top, ms, dry: DRY },
    );
    this.log({ type: 'scroll', selector, top });
  }

  /** Real mouse click on a button inside the room's MCP App iframe (a tools/call via AppBridge). */
  async tapCard(room, action, { tail = 420 } = {}) {
    const page = this.page;
    const handle = await page.$(`[data-room-screen="${room}"] .screen-layer[data-active="true"] iframe`);
    const frame = await handle.contentFrame();
    const r = await frame.evaluate((a) => {
      const b = document.querySelector(`button[data-action="${a}"]`);
      if (!b) return null;
      const x = b.getBoundingClientRect();
      return { x: x.x + x.width / 2, y: x.y + x.height / 2, w: innerWidth };
    }, action);
    if (!r) throw new Error(`no ${action} button on the ${room} card`);
    const box = await handle.boundingBox();
    const k = box.width / r.w;
    const before = await page.evaluate(() => window.scaffold.turns().length);
    await page.mouse.move(box.x + r.x * k, box.y + r.y * k, { steps: 4 });
    await page.mouse.click(box.x + r.x * k, box.y + r.y * k);
    await page.waitForFunction((n) => window.scaffold.turns().length > n && !window.scaffold.turns().at(-1).pending, before, { timeout: 8000 });
    const t = await page.evaluate(() => {
      const t = window.scaffold.turns().at(-1);
      return { id: t.id, source: t.source, tool: t.tool, speech: t.speech };
    });
    this.log({ type: 'turn', user: null, tap: action, source: t.source, tool: t.tool, speech: t.speech });
    await this.waitSpoken(t.id, t.speech, tail);
    return t;
  }

  async click(selector, { after = 300 } = {}) {
    await this.page.click(selector);
    this.log({ type: 'click', selector });
    await this.pause(after);
  }
}

const appReady = (page, room) => page.waitForFunction((r) => !!document.querySelector(`[data-room-screen="${r}"] .screen-layer[data-active="true"] .apphost[data-status="ready"]`), room, { timeout: 15000 });

async function frameWith(page, selector) {
  for (let i = 0; i < 50; i++) {
    for (const f of page.frames()) {
      try {
        if (await f.$(selector)) return f;
      } catch {
        /* detached */
      }
    }
    await sleep(100);
  }
  throw new Error(`no frame has ${selector}`);
}

/** Scroll target inside `.capp-body` that puts `inner` (selector inside the report iframe) near the top. */
async function reportOffset(page, container, inner, margin = 16) {
  const fr = await frameWith(page, inner);
  const y = await fr.evaluate((s) => document.querySelector(s).getBoundingClientRect().top, inner);
  const el = await fr.frameElement();
  return page.evaluate(
    ({ el, y, container, margin }) => {
      const body = document.querySelector(container);
      const s = body.getBoundingClientRect().width / body.offsetWidth;
      return (el.getBoundingClientRect().top - body.getBoundingClientRect().top) / s + body.scrollTop + y - margin;
    },
    { el, y, container, margin },
  );
}

// ------------------------------------------------------------------ the story (≈2:45)

const N = {
  open: 'This is the same morning, three weeks apart.',
  problem1: 'Adults with cognitive disabilities often learn routines from spoken prompts.',
  problem2: 'Good coaching fades them, or people become prompt-dependent.',
  problem3: 'But a voice reminder says the same thing at 7:10, forever.',
  live: 'Live now: this simulated screen is a real MCP client of the Scaffold server.',
  quiet: 'Learned steps get no prompt at all.',
  help: 'Help adds one rung of support, and the help is recorded.',
  tap: 'Same run, second room. That tap was a real MCP tools call, answered in milliseconds.',
  // coach1 is built from the live report numbers (see story()).
  coach2: 'Pack your bag needs attention, and the reason is written down: help was needed two runs in a row.',
  consent: 'Priya can only suggest. Scaffold checks her Laundry routine, then waits for Sam’s yes.',
  fresh: 'A new routine starts with full prompts.',
  arch1: 'Alexa+, or any MCP client, connects over MCP 2025-11-25.',
  arch2: 'Alexa+ is the language model. Scaffold keeps the books: an append-only event log and a deterministic fading policy. No LLM at runtime.',
  // arch3 includes the measured test count (see story()).
  close: 'Scaffold. Designed to be needed less.',
};
const TTS = {
  [N.problem3]: 'But a voice reminder says the same thing at seven ten, forever.',
  [N.live]: 'Live now: this simulated screen is a real MCP client of the Scaffold server.',
  [N.arch1]: 'Alexa plus, or any MCP client, connects over MCP twenty twenty-five, eleven twenty-five.',
  [N.arch2]: 'Alexa plus is the language model. Scaffold keeps the books: an append-only event log and a deterministic fading policy. No L L M at runtime.',
};

async function story(d) {
  const page = d.page;
  const narrate = (text, o = {}) => d.narrate(text, { tts: TTS[text], ...o });

  // ---- 1. cold open: the time machine (replay of seeded synthetic history)
  await page.goto(`${BASE}/time-machine?record=1`);
  await page.waitForFunction(() => window.scaffold?.ready === true, null, { timeout: 30000 });
  await page.evaluate(() =>
    window.scaffold.setSpeaker(async (text, meta) => {
      const ms = await window.__recSpeak(text, meta);
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    }),
  );
  await page.waitForFunction(() => document.querySelectorAll('.tm-col .apphost[data-status="ready"]').length >= 4, null, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(DRY ? 200 : 1500);
  await d.mark('start');
  d.burn = true;
  await d.pause(400);
  await narrate(N.open, { after: 150 });
  // Day 1 full prompt (cut after its third sentence), Day 10 cue, Day 21 on their own; "Today" is
  // muted (the title card covers it).
  let tm = 0;
  d.policy = (text, meta) => {
    if (meta?.room !== 'time-machine') return {};
    tm++;
    if (tm === 1) return { sentences: 3, tail: 350 };
    if (tm === 2) return { tail: 550 };
    if (tm === 3) return { tail: 650 };
    return { mute: true, waitMs: 2500 };
  };
  const from = d.speaks.length;
  await d.click('.tm-head button', { after: 0 });
  await d.mark('tm-play');
  await d.waitSpeaks(from, 3);
  await d.card('title', () => d.pause(2300), {
    hidden: async () => {
      await sleep(DRY ? 0 : 800);
      await page.click('.nav a[href="/"]');
      await page.waitForSelector('.device', { timeout: 10000 });
    },
  });
  d.policy = () => ({});

  // ---- 2. problem card (narration), simulator loads underneath
  await d.card('problem', async () => {
    d.cardState('problem', 1);
    await narrate(N.problem1, { after: 200 });
    d.cardState('problem', 2);
    await narrate(N.problem2, { after: 200 });
    d.cardState('problem', 3);
    await narrate(N.problem3, { after: 450 });
  });
  d.burn = false;

  // ---- 3. live run, bedroom
  await d.mark('live');
  d.callout('live', 5200);
  await d.pause(300);
  await narrate(N.live, { after: 250 });
  d.callout('sam-voice', 4800);
  await d.sam('Start my morning.', { tail: 350 });
  await appReady(page, 'bedroom');
  await narrate(N.quiet, { after: 200 });
  await d.sam('Done.', { tail: 300 });
  await d.sam('Done.', { tail: 420 });
  await d.sam('Done.', { tail: 300 });
  await d.sam('Done.', { tail: 400 });
  await d.mark('bag-partial');
  await d.sam('Help.', { tail: 300 });
  await d.mark('bag-help');
  await narrate(N.help, { after: 250 });

  // ---- kitchen: same run, second device; tap Done on the card; under the hood
  await d.click('[data-room="kitchen"]', { after: 500 });
  // "Where was I?" is cut after "Next is pack your bag." — Sam packs the bag and taps Done.
  d.policy = (text) => (text.startsWith("You've done") ? { sentences: 2 } : {});
  await d.sam('Where was I?', { tail: 450 });
  d.policy = () => ({});
  await appReady(page, 'kitchen');
  await d.mark('kitchen-resume');
  await d.tapCard('kitchen', 'done', { tail: 200 });
  await d.mark('card-tap');
  await d.zoom('.hood', 1.32, { ms: 800, dy: -170 });
  await page.locator('.rpc.latest .rpc-head').first().click();
  d.log({ type: 'click', selector: '.rpc.latest .rpc-head' });
  await d.mark('trace-open');
  await narrate(N.tap, { after: 250 });
  await page.locator('.rpc.latest .rpc-head').first().click();
  await d.zoomOut(700);
  await d.sam('Done.', { tail: 600 });
  await d.mark('finished');

  // ---- 4. coach view: independence report (headline + needs attention, seeded vs live)
  await d.click('.nav a[href="/coach"]', { after: 0 });
  await page.waitForSelector('[data-testid="coach-report"] .apphost[data-status="ready"]', { timeout: 15000 });
  // The numbers are read from the live report (its runs table), never typed into the script.
  const fr = await frameWith(page, 'header.head .lead');
  const runs = await fr.evaluate(() =>
    [...document.querySelectorAll('.table-view tbody tr')].map((tr) => {
      const td = [...tr.querySelectorAll('td')].map((x) => x.textContent.trim());
      return { live: td[1] === 'Live', words: Number(td[2]), helps: Number(td[4]) };
    }),
  );
  const seeded = runs.filter((r) => !r.live);
  const live = runs.find((r) => r.live);
  if (!live || seeded.length < 2) throw new Error(`unexpected report runs: ${JSON.stringify(runs)}`);
  const first = seeded.at(-1);
  const lastSeeded = seeded[0];
  const days = seeded.length === 21 ? 'twenty-one' : String(seeded.length);
  const helps = live.helps === 1 ? 'one request' : `${live.helps} requests`;
  const coach1 = `Priya, Sam’s occupational therapist, sees prompting fall from ${first.words} words on day one to ${lastSeeded.words} by day ${days}. Today’s live run, with ${helps} for help, used ${live.words}.`;
  await d.pause(300);
  await d.mark('coach');
  const headTop = await reportOffset(page, '.coach-page .capp-body', 'header.head', 8);
  await Promise.all([
    (async () => {
      await d.zoom('.coach-page .phone', 1.42, { ms: 900, dy: -40 });
      await d.scrollTo('.coach-page .capp-body', headTop, 1100);
    })(),
    (async () => {
      await sleep(DRY ? 0 : 250);
      await narrate(coach1, { after: 200 });
    })(),
  ]);
  await d.mark('coach-headline');
  // Needs attention, with the recorded reason; the "Finished runs: 1 live · 21 synthetic" KPI above it.
  const attTop = await reportOffset(page, '.coach-page .capp-body', '.attention', 340);
  d.callout('seeded', 6200);
  await Promise.all([d.scrollTo('.coach-page .capp-body', attTop, 1100), (async () => {
    await sleep(DRY ? 0 : 500);
    await narrate(N.coach2, { after: 350 });
  })()]);
  await d.mark('coach-attention');
  await d.zoomOut(600);

  // ---- 5. consent: director view (device + coach phone)
  await d.click('.nav a[href="/?layout=split"]', { after: 400 });
  await page.waitForSelector('.split-coach .phone', { timeout: 10000 });
  await d.click('.split-coach [data-tab="suggest"]', { after: 200 });
  await d.zoom('.split-coach .phone', 1.3, { ms: 800, dy: 80 });
  await d.click('.split-coach [data-testid="send-suggestion"]', { after: 0 });
  await page.waitForSelector('.split-coach [data-testid="suggest-result"]', { timeout: 10000 });
  await d.mark('suggest-sent');
  await narrate(N.consent, { after: 250 });
  await d.zoomOut(700);
  await d.sam('Any suggestions?', { tail: 350 });
  await d.mark('suggestions');
  d.policy = (text) => (text.startsWith('Done. Laundry is ready') ? { sentences: 2 } : {});
  await d.sam('Yes.', { tail: 200 });
  d.policy = (text) => (text.startsWith("Let's do your laundry") ? { sentences: 3 } : {});
  await d.sam('Start laundry.', { tail: 250 });
  d.policy = () => ({});
  await d.mark('laundry');
  await narrate(N.fresh, { after: 450 });

  // ---- 6. how it's built (card)
  const arch3 = 'Plus Echo Show cards, role-scoped tools, retry-safe IDs, and unit, property, protocol and browser tests. Zero keys to run it.';
  TTS[arch3] = arch3.replace('IDs', 'I Ds');
  await d.card('arch', async () => {
    d.cardState('arch', 1);
    await narrate(N.arch1, { after: 200 });
    d.cardState('arch', 2);
    await narrate(N.arch2, { after: 200 });
    d.cardState('arch', 3);
    await narrate(arch3, { after: 500 });
  });

  // ---- 7. close (card)
  await d.card('close', async () => {
    await d.pause(200);
    await narrate(N.close, { after: 1800 });
  });
  await d.mark('end');
  const metrics = await page.evaluate(() => fetch('/api/debug/metrics').then((r) => r.json())).catch(() => null);
  return { coach1, arch3, metrics };
}

// ------------------------------------------------------------------ main

const manifestFile = join(BUILD, 'audio/manifest.json');
const manifest = DRY ? {} : existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : null;
if (!manifest) throw new Error(`missing ${manifestFile}: run the dry run and scripts/video/tts.py first`);

const chromium = loadChromium();
const gpu = process.env.NO_GPU ? [] : ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const browser = await chromium.launch({ executablePath: chromiumPath(), args: gpu });
const rawDir = join(BUILD, 'raw-webm');
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
  ...(DRY ? {} : { recordVideo: { dir: rawDir, size: { width: 1920, height: 1080 } } }),
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const d = new Director(page, manifest);
await page.exposeFunction('__recSpeak', (text, meta) => d.onSpeak(text, meta));
const enc = DRY ? null : new FrameEncoder(join(BUILD, 'master.mp4'));
if (enc) await page.screencast.start({ size: { width: 1920, height: 1080 }, quality: 90, onFrame: (f) => enc.onFrame(f) });

let extra;
try {
  extra = await story(d);
} finally {
  if (enc) {
    await page.screencast.stop().catch(() => undefined);
    await enc.stop();
  }
  const video = page.video();
  await ctx.close();
  if (video && !DRY) {
    const p = await video.path();
    renameSync(p, join(BUILD, 'take-playwright.webm'));
    rmSync(rawDir, { recursive: true, force: true });
  }
  await browser.close();
}

if (DRY) {
  // The finish line carries the demo clock's minute, which depends on how long the take runs:
  // synthesize the neighbouring minutes too.
  for (const { voice, text } of [...d.lines.values()]) {
    const fin = /done at (\d+):(\d\d) (AM|PM)/.exec(text);
    if (voice === 'assistant' && fin) {
      for (let k = 0; k <= 14; k++) {
        const mm = Number(fin[2]) + k;
        const v = text.replace(fin[0], `done at ${Number(fin[1]) + Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')} ${fin[3]}`);
        d.audio('assistant', v);
      }
    }
  }
  writeFileSync(join(BUILD, 'lines.json'), JSON.stringify([...d.lines.values()], null, 2));
  console.log(`dry run: ${d.lines.size} lines -> ${join(BUILD, 'lines.json')}`);
  for (const e of d.timeline.filter((e) => e.type === 'turn')) console.log(`  ${e.user ?? `[tap ${e.tap}]`} -> ${e.tool}: ${JSON.stringify(e.speech)}`);
} else {
  const start = enc.at(d.startEpoch);
  const endE = d.timeline.findLast((e) => e.type === 'mark' && e.name === 'end');
  const events = d.timeline.map(({ epoch, ...e }) => ({ t: Math.round((enc.at(epoch) - start) * 1000) / 1000, ...e }));
  const out = {
    generated: new Date().toISOString(),
    base: BASE,
    fps: FPS,
    master: 'build/master.mp4',
    masterStart: Math.round(start * 1000) / 1000,
    duration: Math.round((enc.at(endE.epoch) - start) * 1000) / 1000,
    framesCaptured: enc.frames,
    framesWritten: enc.n,
    consoleErrors: errors,
    missingAudio: d.missing,
    narration: { coach1: extra.coach1, arch3: extra.arch3 },
    serverMetrics: extra.metrics,
    events,
  };
  writeFileSync(join(BUILD, 'timeline.json'), JSON.stringify(out, null, 2));
  console.log(`take: ${out.duration}s (master starts at ${out.masterStart}s), ${enc.frames} frames captured, ${enc.n} written`);
  if (d.missing.length) console.error(`!! ${d.missing.length} lines had no audio — re-run tts.py and the take`);
}
if (errors.length) console.error('console errors:', errors);
process.exit(d.missing.length ? 2 : 0);
