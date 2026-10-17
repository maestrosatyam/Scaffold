#!/usr/bin/env node
// Renders the demo video's title/story cards, callouts and burned-in caption plates (HTML -> PNG
// with Chromium), using the product's design tokens (src/ui/tokens.css) and typeface.
//
//   node scripts/video/render-cards.mjs        (after the take: needs build/timeline.json)
//
// Writes $ASSETS/build/cards/*.png, $ASSETS/build/captions/*.png and $ASSETS/build/captions.json
// (caption chunks with times; the assembler turns them into an overlay track and the .srt).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const ASSETS = resolve(process.env.ASSETS ?? join(root, '../submission/VIDEO_ASSETS'));
const BUILD = join(ASSETS, 'build');
const CARDS = join(BUILD, 'cards');
const CAPS = join(BUILD, 'captions');
const HTML = join(BUILD, 'html');
for (const d of [CARDS, CAPS, HTML]) {
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
}
const tl = JSON.parse(readFileSync(join(BUILD, 'timeline.json'), 'utf8'));

// ------------------------------------------------------------------ shared look

const fontDir = join(root, 'node_modules/@fontsource/atkinson-hyperlegible/files');
const font = (w, style = 'normal') => pathToFileURL(join(fontDir, `atkinson-hyperlegible-latin-${w}-${style}.woff2`)).href;
const tokens = readFileSync(join(root, 'src/ui/tokens.css'), 'utf8').replace(/@import[^;]+;/g, '');
const BASE_CSS = `
@font-face { font-family: 'Atkinson Hyperlegible'; font-weight: 400; src: url(${font(400)}) format('woff2'); }
@font-face { font-family: 'Atkinson Hyperlegible'; font-weight: 700; src: url(${font(700)}) format('woff2'); }
@font-face { font-family: 'Atkinson Hyperlegible'; font-weight: 400; font-style: italic; src: url(${font(400, 'italic')}) format('woff2'); }
${tokens}
* { box-sizing: border-box; }
html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; }
body { font-family: var(--font); color: var(--dev-text); -webkit-font-smoothing: antialiased; }
body.bg {
  background:
    radial-gradient(1300px 760px at 14% -12%, rgb(46 196 182 / 13%), transparent 62%),
    radial-gradient(1000px 700px at 104% 112%, rgb(70 120 210 / 11%), transparent 60%),
    #07111c;
}
body.clear { background: transparent; }
.kicker { font-size: 22px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: var(--teal); }
.muted { color: #9fb3c8; }
.hide { opacity: 0; }
`;
const logo = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
  <rect x="4" y="5" width="24" height="5" rx="2.5" fill="#2ec4b6"/><rect x="4" y="13.5" width="17" height="5" rx="2.5" fill="#2ec4b6" fill-opacity=".65"/>
  <rect x="4" y="22" width="10" height="5" rx="2.5" fill="#2ec4b6" fill-opacity=".35"/></svg>`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ------------------------------------------------------------------ cards

const title = () => `<body class="bg"><style>
  .wrap { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding-bottom: 80px; }
  h1 { margin: 6px 0 0; font-size: 132px; letter-spacing: 1px; line-height: 1; }
  p { margin: 0; font-size: 44px; color: #c7d4e1; }
  .sub { margin-top: 40px; font-size: 24px; color: #7d93a9; letter-spacing: .4px; }
</style><div class="wrap">${logo(150)}<h1>Scaffold</h1><p>The routine coach designed to be needed less.</p>
<div class="sub">An MCP server for Alexa+ that fades its prompts as a routine is learned</div></div></body>`;

const problem = (state) => `<body class="bg"><style>
  .wrap { position: absolute; left: 150px; right: 150px; top: 110px; }
  .row { margin-top: 44px; transition: none; }
  .who { font-size: 50px; line-height: 1.28; font-weight: 700; max-width: 1500px; margin-top: 26px; }
  .ladder { display: flex; align-items: center; gap: 18px; }
  .rung { padding: 16px 28px; border-radius: 18px; font-size: 32px; font-weight: 700; color: #0b1b2b; }
  .arrow { font-size: 34px; color: #557089; }
  .rung.full { background: var(--lvl-full); } .rung.partial { background: var(--lvl-partial); } .rung.cue { background: var(--lvl-cue); } .rung.ind { background: var(--lvl-independent); }
  .line { font-size: 34px; color: #c7d4e1; margin-top: 22px; }
  .line b { color: #fff; }
  .same { display: flex; gap: 22px; margin-top: 20px; }
  .note { flex: 1; border-radius: 18px; background: #10223a; border: 1px solid #24435f; padding: 18px 22px; }
  .note .d { font-size: 20px; color: #9fb3c8; font-weight: 700; letter-spacing: .5px; }
  .note .q { font-size: 30px; margin-top: 6px; }
  .tag { font-size: 18px; color: #7d93a9; margin-left: 10px; font-weight: 400; }
</style><div class="wrap">
  <div class="kicker">The problem</div>
  <div class="who">Adults with intellectual disability, brain injury or executive‑function difficulty often learn daily routines from spoken prompts, step by step.</div>
  <div class="row ${state >= 2 ? '' : 'hide'}">
    <div class="ladder"><span class="rung full">Full prompt</span><span class="arrow">→</span><span class="rung partial">Short prompt</span><span class="arrow">→</span><span class="rung cue">Cue</span><span class="arrow">→</span><span class="rung ind">On their own</span></div>
    <div class="line">Good coaching <b>fades</b> prompts as each step is learned. Without fading, people become <b>prompt-dependent</b>.</div>
  </div>
  <div class="row ${state >= 3 ? '' : 'hide'}">
    <div class="line" style="margin-top:0"><b>A fixed voice reminder never fades</b> <span class="tag">(illustration)</span></div>
    <div class="same">${['Day 1', 'Day 10', 'Day 21'].map((d) => `<div class="note"><div class="d">${d} · 7:10 AM</div><div class="q">“Time to brush your teeth.”</div></div>`).join('')}</div>
  </div>
</div></body>`;

const ms1 = (n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
const arch = (state) => {
  const m = tl.serverMetrics?.total;
  const lat = m ? `Server p50 ${ms1(m.p50)} ms · p95 ${ms1(m.p95)} ms` : 'Server latency: milliseconds';
  const chips = [
    [lat, 'vs the 500 ms Alexa+ budget · measured in this recording'],
    ['4 MCP Apps cards', 'step card, report, suggestions, progress · Echo Show 768×480'],
    ['Role-scoped tools', 'learner 11 · coach 6 · separate tokens'],
    ['Retry-safe ids', 'a re-sent step_done never skips a step'],
    ['Unit · property · protocol · browser tests', 'engine, stores, MCP over HTTP, Playwright e2e'],
    ['Runs locally', 'zero keys · no paid services'],
  ];
  return `<body class="bg"><style>
  .wrap { position: absolute; left: 130px; right: 130px; top: 96px; }
  .diagram { display: grid; grid-template-columns: 470px 1fr 760px; align-items: stretch; margin-top: 30px; }
  .box { border-radius: 26px; padding: 26px 30px; background: #0c1a29; border: 1.5px solid #24435f; }
  .box h2 { margin: 0; font-size: 44px; }
  .box .sub { font-size: 24px; color: #9fb3c8; margin-top: 2px; }
  .box ul { margin: 18px 0 0; padding-left: 24px; font-size: 25px; line-height: 1.4; color: #c7d4e1; }
  .box ul li { margin-bottom: 6px; }
  .wire { display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 0 18px; text-align: center; }
  .wire .proto { font-size: 30px; font-weight: 700; color: #fff; }
  .wire .tr { font-size: 22px; color: #9fb3c8; margin-top: 4px; }
  .wire .bar { width: 100%; height: 6px; border-radius: 3px; margin: 16px 0; background: linear-gradient(90deg, #2ec4b6, #7fd1c7); position: relative; }
  .wire .bar::before, .wire .bar::after { content: ''; position: absolute; top: -9px; border: 12px solid transparent; }
  .wire .bar::before { left: -14px; border-right-color: #2ec4b6; } .wire .bar::after { right: -14px; border-left-color: #7fd1c7; }
  .wire .msgs { font-family: var(--mono); font-size: 19px; color: #7fd1c7; }
  .scaffold { border-color: #2ec4b6; background: linear-gradient(160deg, #0f2a35, #0c1a29 60%); }
  .scaffold h2 { display: flex; align-items: center; gap: 14px; }
  .tiles { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-top: 20px; }
  .tile { border-radius: 16px; background: #13283d; border: 1px solid #24435f; padding: 16px 16px; }
  .tile b { display: block; font-size: 24px; line-height: 1.2; }
  .tile span { display: block; font-size: 19px; color: #9fb3c8; margin-top: 8px; line-height: 1.3; }
  .chips { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 30px; }
  .chip { border-radius: 16px; padding: 14px 20px; background: #10223a; border: 1px solid #24435f; }
  .chip b { font-size: 25px; } .chip span { display: block; font-size: 18px; color: #9fb3c8; margin-top: 3px; }
</style><div class="wrap">
  <div class="kicker">How it’s built</div>
  <div class="diagram">
    <div class="box"><h2>Alexa+</h2><div class="sub">or any MCP client</div>
      <ul><li>The language model: understands Sam, picks the tool</li><li>Speaks Scaffold’s <code style="font-family:var(--mono);font-size:22px;color:#7fd1c7">speech</code> verbatim</li><li>Shows the MCP Apps card on Echo Show</li></ul></div>
    <div class="wire"><div class="proto">MCP 2025-11-25</div><div class="tr">Streamable HTTP</div><div class="bar"></div><div class="msgs">tools/call<br>resources/read ui://</div></div>
    <div class="box scaffold ${state >= 2 ? '' : 'hide'}"><h2>${logo(44)} Scaffold MCP server</h2><div class="sub">keeps the books</div>
      <div class="tiles">
        <div class="tile"><b>Append-only event log</b><span>every done, help and level change; reports are replays</span></div>
        <div class="tile"><b>Deterministic fading</b><span>3 unaided runs: one rung less. 2 helped runs: support back</span></div>
        <div class="tile"><b>No LLM at runtime</b><span>same state, same words, every time</span></div>
      </div></div>
  </div>
  <div class="chips ${state >= 3 ? '' : 'hide'}">${chips.map(([b, s]) => `<div class="chip"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('')}</div>
</div></body>`;
};

const close = () => `<body class="bg"><style>
  .wrap { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding-bottom: 120px; }
  h1 { margin: 4px 0 0; font-size: 112px; line-height: 1; }
  p { margin: 0; font-size: 40px; color: #c7d4e1; }
  .labels { display: flex; gap: 18px; margin-top: 46px; }
  .pill { padding: 12px 22px; border-radius: 999px; font-size: 25px; font-weight: 700; border: 1.5px solid rgb(255 181 71 / 60%); background: rgb(255 181 71 / 10%); color: #ffd08a; }
  .fine { margin-top: 26px; font-size: 20px; color: #7d93a9; }
</style><div class="wrap">${logo(120)}<h1>Scaffold</h1><p>The routine coach designed to be needed less.</p>
<div class="labels"><span class="pill">Simulated Alexa+ surface — not Amazon software</span><span class="pill">All data shown is synthetic</span></div>
<div class="fine">Recorded from the live app on localhost · voices synthesized locally with Kokoro-82M (Apache-2.0)</div></div></body>`;

// ------------------------------------------------------------------ callouts (transparent overlays)

const CALLOUTS = {
  live: { x: 800, y: 92, text: 'LIVE · real MCP server + client on localhost', dot: '#5bd08a' },
  'sam-voice': { x: 800, y: 92, text: 'Sam’s voice is synthesized · lines go in as text', dot: '#ffb547' },
  seeded: { x: 325, y: 236, text: '21 seeded synthetic runs + 1 live run', dot: '#2ec4b6' },
};
const callout = ({ x, y, text, dot }) => `<body class="clear"><style>
  .c { position: absolute; left: ${x}px; top: ${y}px; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 12px; white-space: nowrap;
       padding: 11px 22px; border-radius: 999px; background: rgb(6 14 24 / 90%); border: 1.5px solid rgb(127 209 199 / 55%);
       font-size: 22px; font-weight: 700; color: #f4f7fa; box-shadow: 0 10px 30px rgb(0 0 0 / 35%); }
  .c i { width: 11px; height: 11px; border-radius: 50%; background: ${dot}; box-shadow: 0 0 0 4px ${dot}33; }
</style><div class="c"><i></i>${esc(text)}</div></body>`;

// ------------------------------------------------------------------ captions

const SPEAKER = { narrator: null, assistant: 'Scaffold', sam: 'Sam' };
const MAXC = 84;

/** Break a long sentence into balanced one-line pieces, preferring breaks after , : ; */
function splitLong(text, maxc) {
  if (text.length <= maxc) return [text];
  const target = text.length / Math.ceil(text.length / maxc);
  const groups = [];
  let cur = '';
  for (const w of text.split(' ')) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && (next.length > maxc || (cur.length >= target * 0.75 && /[,:;]$/.test(cur)) || cur.length >= target * 1.12)) {
      groups.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) groups.push(cur);
  return groups;
}

/** Split one voiced line into caption chunks timed from its per-sentence audio. */
function chunks(e) {
  const sents = e.text.match(/[^.!?]+[.!?]+["”]?(\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [e.text];
  const ends = e.sentenceEnds ?? [];
  const playMs = e.dur * 1000;
  let spans;
  if (ends.length === sents.length) {
    spans = sents.map((s, i) => ({ text: s, a: i ? ends[i - 1] : 0, b: ends[i] }));
  } else {
    const total = sents.reduce((n, s) => n + s.length, 0);
    let acc = 0;
    spans = sents.map((s) => {
      const a = acc;
      acc += (s.length / total) * playMs;
      return { text: s, a, b: acc };
    });
  }
  spans = spans.filter((s) => s.a < playMs - 150).map((s) => ({ ...s, b: Math.min(s.b, playMs) }));
  // Merge short neighbours, split long ones at commas / colons.
  const merged = [];
  for (const s of spans) {
    const last = merged.at(-1);
    if (last && last.text.length + s.text.length + 1 <= 62) merged.push({ text: `${merged.pop().text} ${s.text}`, a: last.a, b: s.b });
    else merged.push({ ...s });
  }
  const out = [];
  for (const s of merged) {
    const groups = splitLong(s.text, MAXC);
    const total = groups.reduce((n, g) => n + g.length, 0);
    let t = s.a;
    for (const g of groups) {
      const d = ((s.b - s.a) * g.length) / total;
      out.push({ text: g, a: t, b: t + d });
      t += d;
    }
  }
  const cutTail = e.cut ? '…' : '';
  return out.map((c, i) => ({ text: i === out.length - 1 && cutTail && !/[.!?]$/.test(c.text) ? c.text + cutTail : c.text, start: e.t + c.a / 1000, end: e.t + c.b / 1000 }));
}

const capHtml = (who, text) => `<body class="clear" style="height:150px"><style>
  html, body { height: 150px; }
  .band { position: absolute; left: 0; right: 0; bottom: 16px; display: flex; justify-content: center; }
  .p { max-width: 1560px; padding: 12px 28px 13px; border-radius: 16px; background: rgb(5 12 20 / 84%); border: 1px solid rgb(127 151 175 / 22%);
       font-size: 31px; line-height: 1.32; color: #f4f7fa; text-align: center; box-shadow: 0 8px 26px rgb(0 0 0 / 30%); }
  .who { display: inline-block; margin-right: 14px; padding: 2px 11px 3px; border-radius: 8px; font-size: 20px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; vertical-align: 4px; }
  .who.assistant { color: #2ec4b6; background: rgb(46 196 182 / 14%); } .who.sam { color: #ffd08a; background: rgb(255 181 71 / 14%); }
</style><div class="band"><div class="p">${SPEAKER[who] ? `<span class="who ${who}">${SPEAKER[who]}</span>` : ''}${esc(text)}</div></div></body>`;

// ------------------------------------------------------------------ render

function chromiumPath() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const r = join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(r) ? readdirSync(r).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  return dirs.map((d) => join(r, d, 'chrome-linux64/chrome')).find(existsSync);
}
function playwrightCore() {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;
  const npx = join(homedir(), '.npm/_npx');
  return readdirSync(npx).map((d) => join(npx, d, 'node_modules/playwright-core')).find((p) => existsSync(join(p, 'package.json')));
}
const { chromium } = createRequire(join(playwrightCore(), 'package.json'))('playwright-core');
const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

async function render(name, body, { out = CARDS, clear = false, height = 1080 } = {}) {
  const file = join(HTML, `${name}.html`);
  writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head>${body}</html>`);
  await page.setViewportSize({ width: 1920, height });
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  const png = join(out, `${name}.png`);
  await page.screenshot({ path: png, omitBackground: clear });
  return png;
}

await render('title', title());
for (const s of [1, 2, 3]) await render(`problem-${s}`, problem(s));
for (const s of [1, 2, 3]) await render(`arch-${s}`, arch(s));
await render('close', close());
for (const [id, c] of Object.entries(CALLOUTS)) await render(`callout-${id}`, callout(c), { clear: true });

const caps = [];
for (const e of tl.events) {
  if (e.type !== 'line' || e.muted || !e.file) continue;
  for (const c of chunks(e)) caps.push({ ...c, who: e.who, burn: !!e.burn });
}
caps.sort((a, b) => a.start - b.start);
let n = 0;
for (const c of caps) {
  if (!c.burn) continue;
  c.file = `captions/cap-${String(++n).padStart(3, '0')}.png`;
  await render(`cap-${String(n).padStart(3, '0')}`, capHtml(c.who, c.text), { out: CAPS, clear: true, height: 150 });
}
await render('blank', '<body class="clear" style="height:150px"></body>', { out: CAPS, clear: true, height: 150 });
writeFileSync(join(BUILD, 'captions.json'), JSON.stringify(caps, null, 2));

// ------------------------------------------------------------------ thumbnail (1280x720): a real frame from the take + title
const help = tl.events.find((e) => e.type === 'mark' && e.name === 'bag-help');
const src = join(BUILD, 'thumb-src.png');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(tl.masterStart + help.t + 1.6), '-i', join(BUILD, 'master.mp4'), '-frames:v', '1', '-vf', 'crop=1000:640:226:142', src]);
const thumb = `<body class="bg" style="width:1280px;height:720px"><style>
  html, body { width: 1280px; height: 720px; }
  .l { position: absolute; left: 64px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; gap: 14px; }
  h1 { margin: 6px 0 0; font-size: 84px; line-height: 1; }
  p { margin: 0; font-size: 34px; line-height: 1.2; color: #c7d4e1; }
  .ladder { display: flex; gap: 8px; margin-top: 18px; }
  .ladder span { padding: 7px 12px; border-radius: 10px; font-size: 18px; font-weight: 700; color: #0b1b2b; }
  .shot { position: absolute; right: 44px; top: 50%; transform: translateY(-50%); width: 700px; border-radius: 22px; box-shadow: 0 30px 70px rgb(0 0 0 / 55%), 0 0 0 1px #24435f; }
  .tag { margin-top: 22px; font-size: 17px; color: #ffd08a; font-weight: 700; }
</style><div class="l">${logo(78)}<h1>Scaffold</h1><p>The routine coach designed to be needed less</p>
<div class="ladder"><span style="background:var(--lvl-full)">Full</span><span style="background:var(--lvl-partial)">Short</span><span style="background:var(--lvl-cue)">Cue</span><span style="background:var(--lvl-independent)">On their own</span></div>
<div class="tag">Alexa+ MCP server · simulated surface · synthetic data</div></div>
<img class="shot" src="${pathToFileURL(src).href}"></body>`;
writeFileSync(join(HTML, 'thumbnail.html'), `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head>${thumb}</html>`);
await page.setViewportSize({ width: 1280, height: 720 });
await page.goto(pathToFileURL(join(HTML, 'thumbnail.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(ASSETS, 'thumbnail.png') });
await browser.close();
console.log(`cards: ${readdirSync(CARDS).length} · captions: ${caps.length} chunks (${n} burned)`);
