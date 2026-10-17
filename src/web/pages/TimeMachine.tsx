// Time machine: the first step of Sam's morning as Scaffold would have presented it on Day 1,
// Day 10, Day 21 (seeded synthetic history) and Today, replayed from the event log
// (GET /api/demo/replay) and rendered by the very same step-card MCP App as the live device.
import type { CallToolResult } from '@modelcontextprotocol/client';
import { useEffect, useState } from 'preact/hooks';
import { DeviceFrame } from '../components/DeviceFrame.tsx';
import { MiniTrend, WordsChart } from '../components/WordsChart.tsx';
import { PlayIcon } from '../components/icons.tsx';
import { getReplay, type ReplayDay } from '../lib/api.ts';
import { AppHost } from '../lib/apphost.tsx';
import type { Session } from '../lib/session.ts';
import { LEVEL_LABEL, type Level, type ReportOut, type StepResultOut } from '../lib/types.ts';
import { speak, voiceState } from '../lib/voice.ts';
import { MORNING_META } from '../fixtures/laundry.ts';

const STEP_URI = 'ui://scaffold/step-card.html';
const ROUTINE_NAME = 'Morning routine';

/** Mirrors startSpeech() in src/core/speech.ts — used only for "Today", which the replay API leaves without speech. */
function startSpeechLike(level: Level, prompt: string, index: number, total: number): string {
  if (level === 'independent') return `Okay, ${ROUTINE_NAME.toLowerCase()}. I'm here if you need me.`;
  const line = level === 'full' ? `Step ${index} of ${total}. ${prompt}` : prompt;
  return level === 'full' ? `Let's do your ${ROUTINE_NAME.toLowerCase()}. ${line}` : line;
}

interface Column {
  key: string;
  title: string;
  date: string;
  day: ReplayDay;
  dayIndex: number;
  level: Level;
  speech: string;
  result: CallToolResult;
}

function buildColumn(day: ReplayDay, dayIndex: number, title: string, first: ReportOut['steps'][number], total: number, tz: string): Column {
  const level = ((day.firstStep?.level ?? day.levels[first.step_id]) as Level) ?? 'full';
  const prompt = day.firstStep ? day.firstStep.prompt : level === first.level ? first.next_prompt : '';
  const speech = day.speech ?? startSpeechLike(level, prompt, 1, total);
  const meta = MORNING_META[first.step_id] ?? { pictogram: first.pictogram, must: true, estSec: 120 };
  const runId = day.isToday ? 'replay-today' : `replay-day-${day.day}`;
  const sc: StepResultOut = {
    speech,
    run: { run_id: runId, routine_id: 'morning', routine_name: ROUTINE_NAME, status: 'active', done: 0, total, started_at: day.date, finished_at: null, devices: ['bedroom'] },
    step: {
      run_id: runId,
      routine_id: 'morning',
      routine_name: ROUTINE_NAME,
      step_id: first.step_id,
      index: 1,
      total,
      done_count: 0,
      title: day.firstStep?.title ?? first.title,
      pictogram: first.pictogram || meta.pictogram,
      level,
      base_level: level,
      prompt: level === 'independent' ? '' : prompt,
      must: meta.must,
      est_sec: meta.estSec,
      is_last: false,
    },
    duplicate: false,
    level_changes: [],
    skipped: [],
  };
  return {
    key: runId,
    title,
    date: new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }).format(new Date(day.date)),
    day,
    dayIndex,
    level,
    speech,
    result: { content: [{ type: 'text', text: speech || '(no speech: the person is doing this step on their own)' }], structuredContent: sc as unknown as Record<string, unknown> },
  };
}

export function TimeMachine({ session }: { session: Session }) {
  const [days, setDays] = useState<ReplayDay[] | null>(null);
  const [cols, setCols] = useState<Column[]>([]);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const tz = session.sandbox.timeZone;

  useEffect(() => {
    void (async () => {
      try {
        const [{ days }, rep] = await Promise.all([getReplay(session.sandbox.learnerToken), session.coach.callTool('independence_report', { routine: 'morning' }, 'coach')]);
        const report = rep.structuredContent as unknown as ReportOut;
        const first = report.steps[0]!;
        const total = report.total_steps;
        const seeded = days.filter((d) => !d.isToday);
        const pick = (n: number) => seeded.find((d) => d.day === n) ?? seeded.at(-1)!;
        const today = days.find((d) => d.isToday) ?? days.at(-1)!;
        const idx = (d: ReplayDay) => days.indexOf(d);
        const d1 = pick(1);
        const d10 = pick(10);
        const d21 = pick(Math.min(21, seeded.length));
        setDays(days);
        setCols([
          buildColumn(d1, idx(d1), `Day ${d1.day}`, first, total, tz),
          buildColumn(d10, idx(d10), `Day ${d10.day}`, first, total, tz),
          buildColumn(d21, idx(d21), `Day ${d21.day}`, first, total, tz),
          buildColumn(today, idx(today), 'Today', first, total, tz),
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [session]);

  const play = async () => {
    for (const c of cols) {
      setPlaying(c.key);
      const t0 = performance.now();
      const silent = !c.speech || c.level === 'independent';
      await speak(c.speech, { room: 'time-machine', turnId: 0 });
      const minMs = voiceState.get().muted || silent ? 2600 : 900;
      const left = minMs - (performance.now() - t0);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
    }
    setPlaying(null);
  };

  const values = days?.map((d) => d.plannedWords) ?? [];
  const highlights = new Set(cols.map((c) => c.dayIndex));

  return (
    <div class="tm">
      <div class="tm-head">
        <div>
          <div class="replay-badge">Replay of seeded synthetic history · not real usage</div>
          <h1>Time machine: the same first step, three weeks apart</h1>
          <p>
            How Scaffold would open Sam’s morning on each day, replayed from the event log. Days 1–21 are synthetic history the real fading engine produced from scripted outcomes; Today is your live sandbox. Every screen is the same
            step-card MCP App the device uses.
          </p>
        </div>
        <button class="btn" onClick={() => void play()} disabled={!cols.length || playing !== null} style={{ padding: '11px 18px', fontSize: '15px' }}>
          <PlayIcon /> {playing ? 'Playing…' : 'Hear the fade'}
        </button>
      </div>
      {error && <div class="boot-card err">Could not load the replay: <code>{error}</code></div>}
      {!cols.length && !error && (
        <div class="boot-card">
          <span class="spinner" /> Replaying the event log…
        </div>
      )}
      <div class="tm-grid">
        {cols.map((c) => (
          <section key={c.key} class={`tm-col ${c.day.isToday ? 'today' : ''} ${playing === c.key ? 'playing' : ''}`} aria-label={`${c.title}, ${c.date}`}>
            <div class="tm-col-head">
              <h2>{c.title}</h2>
              <span>
                {c.date}
                {c.day.seeded ? ' · seeded' : c.day.isToday ? ' · live' : ''}
              </span>
            </div>
            <div style={{ width: '100%', aspectRatio: '816 / 554', display: 'flex', justifyContent: 'center' }}>
              <DeviceFrame maxScale={0.62} label={`Step card on ${c.title}`}>
                <AppHost mcp={session.learner} uri={STEP_URI} title={`Step card, ${c.title}`} toolName="start_routine" toolArgs={{ routine: 'morning', device: 'bedroom' }} result={c.result} theme="dark" width={768} height={480} surface="replay" readOnly timeZone={tz} />
              </DeviceFrame>
            </div>
            <div class="row" style={{ justifyContent: 'space-between' }}>
              <span class={`lvl ${c.level}`}>{LEVEL_LABEL[c.level]}</span>
              <MiniTrend values={values} at={c.dayIndex} />
            </div>
            <div class={`tm-speech ${c.level === 'independent' ? 'silent' : ''}`}>{c.level === 'independent' ? `“${c.speech}” — then silence: Sam does “${(c.result.structuredContent as unknown as StepResultOut).step?.title ?? 'this step'}” unprompted.` : `“${c.speech}”`}</div>
            <div class="tm-words">
              <b>{c.day.plannedWords}</b>
              <span>words of prompting planned for the whole morning</span>
            </div>
            <div class="tm-levels" aria-label="Support level of each step that day">
              {Object.entries(c.day.levels).map(([id, l]) => (
                <span key={id} class={`lvl ${l}`} title={`${id}: ${LEVEL_LABEL[l as Level]}`}>
                  {id}
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>
      {days && (
        <div class="tm-chart">
          <h3>Words of prompting Scaffold plans per morning</h3>
          <p>Sum of the prompt words at each step’s support level, day by day. Falls as steps fade; rises where support was added back (the bag step, days 19–21).</p>
          <WordsChart
            height={140}
            points={days.map((d, i) => ({
              label: d.isToday ? 'Today' : `Day ${d.day}`,
              sub: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: tz }).format(new Date(d.date)) + (d.seeded ? ' · seeded' : ''),
              words: d.plannedWords,
              highlight: highlights.has(i),
            }))}
          />
        </div>
      )}
    </div>
  );
}
