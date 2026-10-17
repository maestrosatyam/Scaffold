#!/usr/bin/env node
// Assembles the final demo video with ffmpeg: the live take (build/master.mp4) + card and
// callout overlays (build/cards) + burned-in caption plates (build/captions) + the voice track
// (build/voice.wav, loudness-normalised to -16 LUFS). Also writes the .srt and the timeline.
//
//   node scripts/video/assemble.mjs [--qa]
//
// Outputs (in $ASSETS): scaffold-demo.mp4, scaffold-demo.srt, timeline.json; with --qa, frames
// at every beat in build/qa/*.png.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(process.env.ASSETS ?? join(here, '../../../submission/VIDEO_ASSETS'));
const BUILD = join(ASSETS, 'build');
const OUT = join(ASSETS, 'scaffold-demo.mp4');
const tl = JSON.parse(readFileSync(join(BUILD, 'timeline.json'), 'utf8'));
const caps = JSON.parse(readFileSync(join(BUILD, 'captions.json'), 'utf8'));
const D = tl.duration;
const r3 = (x) => Math.round(x * 1000) / 1000;

// ------------------------------------------------------------------ 1. voice loudness (two-pass EBU R128)

const LN = 'loudnorm=I=-16:TP=-1.5:LRA=11';
const measure = (file, pre = '') => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', `${pre}${LN}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  return JSON.parse(r.stderr.slice(r.stderr.lastIndexOf('{')));
};
// Gain to about -16 LUFS through a peak limiter, then a linear two-pass loudnorm for the exact target.
const m0 = measure(join(BUILD, 'voice.wav'));
const gain = (-16 - Number(m0.input_i)).toFixed(2);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(BUILD, 'voice.wav'), '-af', `aresample=48000,volume=${gain}dB,alimiter=limit=0.79:attack=3:release=60:level=false`, '-ar', '48000', '-c:a', 'pcm_f32le', join(BUILD, 'voice-lim.wav')]);
const meas = measure(join(BUILD, 'voice-lim.wav'));
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(BUILD, 'voice-lim.wav'), '-af', `${LN}:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true`, '-ar', '48000', '-c:a', 'pcm_s16le', join(BUILD, 'voice-norm.wav')]);
const m2 = measure(join(BUILD, 'voice-norm.wav'));
console.log(`voice: ${m0.input_i} LUFS -> +${gain} dB, limiter -> ${meas.input_i} LUFS -> loudnorm -> ${m2.input_i} LUFS, true peak ${m2.input_tp} dBTP`);

// ------------------------------------------------------------------ 2. overlays from the timeline

const ev = tl.events;
const overlays = []; // { png, start, end, fin, fout }
const FADE = 0.5;
for (const e of ev.filter((x) => x.type === 'card' && x.state === 'in')) {
  const out = ev.find((x) => x.type === 'card' && x.id === e.id && x.state === 'out' && x.t >= e.t);
  const last = e.id === 'close';
  const end = last ? D + 0.1 : out.t + FADE / 2;
  const states = ev.filter((x) => x.type === 'card-state' && x.id === e.id);
  if (!states.length) overlays.push({ png: `cards/${e.id}.png`, start: Math.max(0, e.t - FADE / 2), end, fin: e.id === 'title' ? 0.6 : FADE, fout: last ? 0 : FADE });
  states.forEach((s, i) => {
    const start = i === 0 ? Math.max(0, e.t - FADE / 2) : s.t - 0.2;
    overlays.push({ png: `cards/${e.id}-${s.state}.png`, start, end, fin: i === 0 ? FADE : 0.45, fout: last ? 0 : FADE });
  });
}
for (const e of ev.filter((x) => x.type === 'callout')) overlays.push({ png: `cards/callout-${e.id}.png`, start: e.t, end: Math.min(D, e.t + e.dur), fin: 0.35, fout: 0.35 });
overlays.sort((a, b) => a.start - b.start);

// Burned caption plates as one variable-frame-rate track (concat demuxer), blank between plates.
const burned = caps.filter((c) => c.burn);
for (let i = 0; i < burned.length; i++) {
  const c = burned[i];
  const next = burned[i + 1];
  c.show = Math.max(0, c.start - 0.05);
  c.hide = Math.min(next ? next.start - 0.05 : D, Math.max(c.end + 0.3, c.show + 0.9));
}
let list = 'ffconcat version 1.0\n';
let t = 0;
for (const c of burned) {
  if (c.show > t + 0.001) list += `file 'captions/blank.png'\nduration ${r3(c.show - t)}\n`;
  list += `file '${c.file}'\nduration ${r3(c.hide - Math.max(t, c.show))}\n`;
  t = c.hide;
}
list += `file 'captions/blank.png'\nduration ${r3(Math.max(0.1, D - t + 1))}\nfile 'captions/blank.png'\n`;
writeFileSync(join(BUILD, 'captions.ffconcat'), list);

// ------------------------------------------------------------------ 3. ffmpeg

const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y', '-ss', String(tl.masterStart), '-t', String(r3(D)), '-i', join(BUILD, 'master.mp4'), '-i', join(BUILD, 'voice-norm.wav')];
for (const o of overlays) args.push('-loop', '1', '-framerate', '30', '-t', String(r3(o.end - o.start)), '-i', join(BUILD, o.png));
args.push('-f', 'concat', '-safe', '0', '-i', join(BUILD, 'captions.ffconcat'));
const capIn = 2 + overlays.length;

const f = ['[0:v]setpts=PTS-STARTPTS,fps=30,format=yuv420p[v0]'];
let cur = 'v0';
overlays.forEach((o, i) => {
  const len = o.end - o.start;
  const fades = [o.fin ? `fade=t=in:st=0:d=${o.fin}:alpha=1` : null, o.fout ? `fade=t=out:st=${r3(len - o.fout)}:d=${o.fout}:alpha=1` : null].filter(Boolean).join(',');
  f.push(`[${i + 2}:v]format=rgba${fades ? `,${fades}` : ''},setpts=PTS-STARTPTS+${r3(o.start)}/TB[o${i}]`);
  f.push(`[${cur}][o${i}]overlay=0:0:eof_action=pass:format=auto[v${i + 1}]`);
  cur = `v${i + 1}`;
});
f.push(`[${capIn}:v]format=rgba,setpts=PTS-STARTPTS[cap]`);
f.push(`[${cur}][cap]overlay=0:930:eof_action=pass:format=auto[vc]`);
f.push(`[vc]fade=t=in:st=0:d=0.6,fade=t=out:st=${r3(D - 0.9)}:d=0.9,format=yuv420p[vout]`);
f.push(`[1:a]atrim=0:${r3(D)},afade=t=out:st=${r3(D - 0.9)}:d=0.9,aformat=channel_layouts=stereo[aout]`);
writeFileSync(join(BUILD, 'filtergraph.txt'), f.join(';\n'));
args.push('-filter_complex_script', join(BUILD, 'filtergraph.txt'), '-map', '[vout]', '-map', '[aout]', '-t', String(r3(D)));
args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-metadata', 'title=Scaffold — the routine coach designed to be needed less (demo)', '-metadata:s:a:0', 'language=eng', OUT);
console.log(`ffmpeg: ${overlays.length} overlays, ${burned.length} caption plates, ${r3(D)} s`);
execFileSync('ffmpeg', args, { stdio: 'inherit' });

// ------------------------------------------------------------------ 4. srt + timeline

const ts = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const LABEL = { narrator: '', assistant: 'SCAFFOLD: ', sam: 'SAM: ' };
const srtCaps = caps.map((c) => ({ ...c }));
srtCaps.forEach((c, i) => {
  const next = srtCaps[i + 1];
  c.srtEnd = Math.min(next ? next.start - 0.02 : D, Math.max(c.end + 0.25, c.start + 0.9));
});
writeFileSync(join(ASSETS, 'scaffold-demo.srt'), srtCaps.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.srtEnd)}\n${LABEL[c.who]}${c.text}\n`).join('\n'));

const beats = ev
  .filter((e) => ['line', 'card', 'card-state', 'callout', 'mark', 'click', 'turn', 'camera', 'scroll'].includes(e.type))
  .map((e) => {
    if (e.type === 'line') return { t: e.t, end: e.muted ? null : r3(e.t + e.dur), type: 'speech', who: e.who === 'assistant' ? 'assistant (Scaffold, simulated assistant voice)' : e.who, text: e.text, ...(e.cut ? { cutAt: e.dur, fullDuration: e.full } : {}), ...(e.muted ? { voiced: false, note: 'covered by the title card' } : {}) };
    if (e.type === 'turn') return { t: e.t, type: 'mcp-turn', input: e.user ?? `tap ${e.tap} on the card`, tool: e.tool, speech: e.speech };
    if (e.type === 'card') return { t: e.t, type: `card-${e.state}`, card: e.id };
    if (e.type === 'card-state') return { t: e.t, type: 'card-state', card: e.id, state: e.state };
    if (e.type === 'callout') return { t: e.t, end: r3(e.t + e.dur), type: 'callout', id: e.id };
    if (e.type === 'mark') return { t: e.t, type: 'beat', name: e.name };
    if (e.type === 'camera') return { t: e.t, type: 'camera', target: e.selector, scale: e.scale };
    if (e.type === 'scroll') return { t: e.t, type: 'scroll', target: e.selector };
    return { t: e.t, type: 'click', target: e.selector };
  });
writeFileSync(
  join(ASSETS, 'timeline.json'),
  JSON.stringify({ video: 'scaffold-demo.mp4', duration: r3(D), recordedFrom: tl.base, recordedAt: tl.generated, note: 'Times in seconds from the start of scaffold-demo.mp4. Every beat was performed live against the running app; speech lines were placed at these times.', serverMetrics: tl.serverMetrics, beats }, null, 2),
);

const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,r_frame_rate', '-of', 'json', OUT], { encoding: 'utf8' });
console.log(probe);

// ------------------------------------------------------------------ 5. QA frames at each beat

if (process.argv.includes('--qa')) {
  const qa = join(BUILD, 'qa');
  rmSync(qa, { recursive: true, force: true });
  mkdirSync(qa, { recursive: true });
  const marks = ev.filter((e) => e.type === 'mark' || (e.type === 'card' && e.state === 'in') || e.type === 'card-state');
  for (const m of marks) {
    const at = Math.min(D - 0.1, m.t + (m.type === 'mark' ? 1.2 : 1.0));
    const name = `${String(Math.round(at * 10)).padStart(5, '0')}-${m.name ?? `${m.id}${m.state && m.type === 'card-state' ? `-${m.state}` : ''}`}.png`;
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', OUT, '-frames:v', '1', join(qa, name)]);
  }
  console.log(`qa frames: ${qa}`);
}
if (!existsSync(OUT)) process.exit(1);
