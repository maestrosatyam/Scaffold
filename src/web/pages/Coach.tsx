// Coach view (Priya, an occupational therapist): a coach-role MCP client for the same person.
// Live run status (from the event log), the independence report (rendered by the server's
// independence-report MCP App), per-step explanations and overrides, and routine suggestions.
import type { CallToolResult } from '@modelcontextprotocol/client';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PICTOGRAM_KEYS } from '../../apps/pictogram-keys.ts';
import { fmtTime } from '../components/Header.tsx';
import { RefreshIcon } from '../components/icons.tsx';
import type { ServerEvent } from '../lib/api.ts';
import { AppHost } from '../lib/apphost.tsx';
import { speechOf } from '../lib/mcp.ts';
import { clockStore, eventsStore, nudgeEvents, type Session } from '../lib/session.ts';
import { useStore } from '../lib/store.ts';
import { LEVEL_LABEL, LEVELS, type ExplainOut, type Level, type ProposeOut, type ReportOut, type RoutinesOut, type SuggestionOut } from '../lib/types.ts';
import { DEFAULT_NOTE, LAUNDRY_TEMPLATE, type RoutineDraft } from '../fixtures/laundry.ts';

type Tab = 'today' | 'steps' | 'suggest';
const REPORT_URI = 'ui://scaffold/independence-report.html';

const sc = <T,>(r: CallToolResult | null | undefined): T | null => (r && !r.isError ? ((r.structuredContent as T | undefined) ?? null) : null);

export function LevelChip({ level }: { level: Level }) {
  return <span class={`lvl ${level}`}>{LEVEL_LABEL[level]}</span>;
}

// ------------------------------------------------------------------ live run from the event log

interface LiveStep {
  id: string;
  title: string;
  state: 'done' | 'helped' | 'skipped' | 'current' | 'pending';
  helps: number;
}
interface LiveRun {
  runId: string;
  routineId: string;
  startedAt: string;
  lastAt: string;
  devices: string[];
  status: 'active' | 'finished' | 'abandoned';
  seeded: boolean;
  steps: LiveStep[];
  helps: number;
  done: number;
}

function deriveLiveRun(events: ServerEvent[], order: Record<string, { id: string; title: string }[]>): LiveRun | null {
  let start: ServerEvent | undefined;
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.type === 'run.started') { start = events[i]; break; }
  if (!start?.runId) return null;
  const mine = events.filter((e) => e.runId === start!.runId);
  const routineId = String(start.routineId);
  const completed = new Set(mine.filter((e) => e.type === 'step.completed').map((e) => e.stepId!));
  const skipped = new Set(mine.filter((e) => e.type === 'step.skipped').map((e) => e.stepId!));
  const helps: Record<string, number> = {};
  for (const e of mine) if (e.type === 'step.helped') helps[e.stepId!] = (helps[e.stepId!] ?? 0) + 1;
  const devices: string[] = [];
  for (const e of mine) if ((e.type === 'run.started' || e.type === 'run.resumed') && e.device && devices.at(-1) !== e.device) devices.push(e.device);
  const known = order[routineId] ?? [];
  const ids = known.length ? known : [...new Set(mine.filter((e) => e.stepId).map((e) => e.stepId!))].map((id) => ({ id, title: id }));
  let currentSet = false;
  const status = mine.some((e) => e.type === 'run.finished') ? 'finished' : mine.some((e) => e.type === 'run.abandoned') ? 'abandoned' : 'active';
  const steps: LiveStep[] = ids.map(({ id, title }) => {
    const h = helps[id] ?? 0;
    if (completed.has(id)) return { id, title, state: h ? 'helped' : 'done', helps: h };
    if (skipped.has(id)) return { id, title, state: 'skipped', helps: h };
    if (!currentSet && status === 'active') {
      currentSet = true;
      return { id, title, state: 'current', helps: h };
    }
    return { id, title, state: 'pending', helps: h };
  });
  return {
    runId: start.runId,
    routineId,
    startedAt: start.at,
    lastAt: mine.at(-1)!.at,
    devices,
    status,
    seeded: !!start.seeded,
    steps,
    helps: Object.values(helps).reduce((a, b) => a + b, 0),
    done: steps.filter((s) => s.state === 'done' || s.state === 'helped' || s.state === 'skipped').length,
  };
}

function LiveCard({ run, tz, routineName }: { run: LiveRun | null; tz: string; routineName: string }) {
  if (!run)
    return (
      <div class="card">
        <div class="kicker">Live</div>
        <div class="status-line">No routine yet today</div>
      </div>
    );
  const live = run.status === 'active' && !run.seeded;
  const cur = run.steps.find((s) => s.state === 'current');
  const where = run.devices.map((d) => d[0]!.toUpperCase() + d.slice(1));
  return (
    <div class="card" data-testid="coach-live">
      <div class="card-head">
        <span class="kicker">{run.seeded ? 'Last run (seeded history)' : live ? 'Live now' : 'Today'}</span>
        <span class="row" style={{ gap: '6px', fontSize: '12.5px', color: 'var(--ink-2)' }}>
          <span class={`live-dot ${live ? '' : 'off'}`} aria-hidden="true" />
          {live ? 'in progress' : run.status}
        </span>
      </div>
      <div class="status-line">{routineName}</div>
      <div class="status-meta">
        {live && cur ? `Step ${run.done + 1} of ${run.steps.length} · ${cur.title}` : `${run.done} of ${run.steps.length} steps`}
        {where.length ? ` · ${where.join(' → ')}` : ''}
      </div>
      <div class="status-meta">
        Started {fmtTime(new Date(run.startedAt), tz)}
        {run.status === 'finished' ? ` · finished ${fmtTime(new Date(run.lastAt), tz)}` : ''} · {run.helps === 0 ? 'no help asked' : `${run.helps} help${run.helps > 1 ? 's' : ''} asked`}
      </div>
      <ol class="timeline" aria-label="Steps in this run">
        {run.steps.map((s) => (
          <li key={s.id} class={s.state === 'current' ? 'current' : ''}>
            <span class={`tl-icon ${s.state}`} aria-hidden="true">
              {s.state === 'done' || s.state === 'helped' ? '✓' : s.state === 'skipped' ? '–' : ''}
            </span>
            <span>{s.title}</span>
            <span class="tl-note">
              {s.state === 'current' ? 'now' : s.state === 'helped' ? `help ×${s.helps}` : s.state === 'skipped' ? 'skipped today' : s.state === 'done' ? 'no help' : ''}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------ the phone app

export function CoachApp({ session }: { session: Session }) {
  const call = (name: string, args: Record<string, unknown> = {}) => session.coach.callTool(name, args, 'coach');
  const events = useStore(eventsStore);
  const clock = useStore(clockStore);
  const tz = clock?.timeZone ?? session.sandbox.timeZone;
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get('tab') as Tab) || 'today');
  const [routineId, setRoutineId] = useState('morning');
  const [report, setReport] = useState<CallToolResult | null>(null);
  const [reportSeq, setReportSeq] = useState(0);
  const [routines, setRoutines] = useState<RoutinesOut | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionOut[]>([]);
  const [orders, setOrders] = useState<Record<string, { id: string; title: string }[]>>({});
  const seen = useRef(0);

  const refreshReport = async (rid = routineId) => {
    const r = await call('independence_report', { routine: rid });
    setReport(r);
    setReportSeq((x) => x + 1);
    const rep = sc<ReportOut>(r);
    if (rep) setOrders((o) => ({ ...o, [rep.routine_id]: rep.steps.map((s) => ({ id: s.step_id, title: s.title })) }));
  };
  const refreshRoutines = async () => setRoutines(sc<RoutinesOut>(await call('list_routines')));
  const refreshSuggestions = async () => {
    const list = sc<{ suggestions: SuggestionOut[] }>(await call('list_suggestions'))?.suggestions ?? [];
    setSuggestions(list);
    setOrders((o) => {
      const next = { ...o };
      for (const s of list) if (s.status === 'approved' && !next[s.routine_id]) next[s.routine_id] = s.steps.map((x) => ({ id: x.step_id, title: x.title }));
      return next;
    });
  };

  useEffect(() => {
    void (async () => {
      await refreshReport();
      await refreshRoutines();
      await refreshSuggestions();
    })();
  }, []);

  // React to new events in the person's log (polled ~1 s): refresh only what changed.
  useEffect(() => {
    if (!events.length) return;
    const last = events.at(-1)!.seq;
    if (seen.current === 0) {
      seen.current = last;
      return;
    }
    const fresh = events.filter((e) => e.seq > seen.current);
    seen.current = last;
    if (!fresh.length) return;
    const types = new Set(fresh.map((e) => e.type));
    const t = setTimeout(() => {
      if (types.has('run.finished') || types.has('level.set') || types.has('routine.published')) void refreshReport();
      if (types.has('change.proposed') || types.has('change.decided') || types.has('routine.published')) void refreshSuggestions();
      if (types.has('routine.published') || types.has('run.started')) void refreshRoutines();
    }, 250);
    return () => clearTimeout(t);
  }, [events]);

  const rep = sc<ReportOut>(report);
  const liveRun = useMemo(() => deriveLiveRun(events, orders), [events, orders]);
  const routineName = routines?.routines.find((r) => r.routine_id === liveRun?.routineId)?.name ?? (liveRun?.routineId === 'morning' ? 'Morning routine' : liveRun?.routineId ?? '');

  return (
    <div class="phone-screen">
      <span class="phone-notch" aria-hidden="true" />
      <div class="capp-bar">
        <div class="capp-title">
          <span class="avatar" aria-hidden="true">
            S
          </span>
          <span>
            <strong>Sam</strong>
            <span>Coach: Priya (occupational therapist)</span>
          </span>
        </div>
        <div class="capp-tabs" role="tablist" aria-label="Coach sections">
          {(
            [
              ['today', 'Today'],
              ['steps', 'Steps'],
              ['suggest', 'Suggest'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-tab={k}>
              {label}
              {k === 'suggest' && suggestions.some((s) => s.status === 'pending') ? ' •' : ''}
            </button>
          ))}
        </div>
      </div>
      <div class="capp-body">
        {tab === 'today' && (
          <>
            <LiveCard run={liveRun} tz={tz} routineName={routineName} />
            <div class="row" style={{ justifyContent: 'space-between' }}>
              <span class="kicker">Independence report</span>
              <span class="row">
                {(routines?.routines.length ?? 0) > 1 && (
                  <select
                    aria-label="Routine"
                    value={routineId}
                    onChange={(e) => {
                      const v = (e.target as HTMLSelectElement).value;
                      setRoutineId(v);
                      void refreshReport(v);
                    }}
                    style={{ border: '1px solid var(--line)', borderRadius: '8px', padding: '4px 6px', background: '#fff', fontSize: '12.5px' }}
                  >
                    {routines!.routines.map((r) => (
                      <option key={r.routine_id} value={r.routine_id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
                <button class="btn secondary small" onClick={() => void refreshReport()} aria-label="Refresh report">
                  <RefreshIcon /> Refresh
                </button>
              </span>
            </div>
            <div class="report-host" data-testid="coach-report">
              <AppHost
                mcp={session.coach}
                uri={REPORT_URI}
                title="Independence report"
                toolName="independence_report"
                toolArgs={{ routine: routineId }}
                result={report}
                resultSeq={reportSeq}
                theme="light"
                width={undefined}
                minHeight={420}
                surface="coach"
                timeZone={tz}
                onCallTool={(name, args) => call(name, args)}
              />
            </div>
            {rep && (
              <p class="hint" style={{ fontSize: '12px', color: 'var(--ink-3)' }}>
                {rep.seeded_runs} seeded (synthetic) runs · {rep.live_runs} live run{rep.live_runs === 1 ? '' : 's'} from this sandbox. Task metrics only — no clinical judgement.
              </p>
            )}
          </>
        )}
        {tab === 'steps' && <StepsTab session={session} report={rep} onChanged={() => void refreshReport()} />}
        {tab === 'suggest' && <SuggestTab session={session} suggestions={suggestions} onSent={() => void refreshSuggestions()} tz={tz} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ steps: explain + override

function StepsTab({ session, report, onChanged }: { session: Session; report: ReportOut | null; onChanged: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [explain, setExplain] = useState<ExplainOut | null>(null);
  const [level, setLevel] = useState<Level>('partial');
  const [reason, setReason] = useState('New bag and hook by the front door this week.');
  const [toast, setToast] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const rid = report?.routine_id ?? 'morning';

  const load = async (stepId: string) => {
    setSelected(stepId);
    setToast(null);
    const r = await session.coach.callTool('explain_step', { routine: rid, step_id: stepId }, 'coach');
    const e = sc<ExplainOut>(r);
    setExplain(e);
    if (e) setLevel(e.level === 'full' ? 'full' : LEVELS[Math.max(0, LEVELS.indexOf(e.level) - 1)]!);
  };

  useEffect(() => {
    if (!selected && report) {
      const first = report.steps.find((s) => s.needs_attention) ?? report.steps[0];
      if (first) void load(first.step_id);
    }
  }, [report]);

  const apply = async () => {
    if (!selected || reason.trim().length < 3) return;
    setSaving(true);
    const r = await session.coach.callTool('set_step_level', { routine: rid, step_id: selected, level, reason: reason.trim() }, 'coach');
    setSaving(false);
    setToast({ tone: r.isError ? 'err' : 'ok', text: speechOf(r) });
    nudgeEvents();
    await load(selected);
    onChanged();
  };

  if (!report) return <div class="card">Loading steps…</div>;
  return (
    <>
      <div class="card">
        <h3>{report.routine_name}</h3>
        <p class="hint">Tap a step to see why it is at its level. Every change has a deterministic, auditable reason.</p>
        <div class="step-list">
          {report.steps.map((s) => (
            <button key={s.step_id} class="step-pick" aria-pressed={selected === s.step_id} onClick={() => void load(s.step_id)}>
              <span>
                {s.title}
                {s.needs_attention && <span class="attn">needs attention</span>}
              </span>
              <LevelChip level={s.level} />
            </button>
          ))}
        </div>
      </div>
      {explain && (
        <div class="card" key={explain.step_id + explain.level + explain.changes.length}>
          <div class="card-head">
            <h3>{explain.title}</h3>
            <LevelChip level={explain.level} />
          </div>
          <p class="hint">{explain.next_prompt ? `Next time Sam hears: “${explain.next_prompt}”` : 'Next time Scaffold stays silent for this step.'}</p>
          <div class="facts">
            <div class="fact">
              <b>{explain.unaided_streak}</b>
              <span>runs in a row without help</span>
            </div>
            <div class="fact">
              <b>{explain.aided_streak}</b>
              <span>runs in a row with help</span>
            </div>
            <div class="fact">
              <b>{explain.runs_until_fade ?? '—'}</b>
              <span>{explain.runs_until_fade === null ? 'already on their own' : 'more unaided runs to fade'}</span>
            </div>
          </div>
          <div class="kicker" style={{ marginTop: '14px' }}>
            History
          </div>
          <ul class="history">
            {explain.changes.length === 0 && <li>No changes yet.</li>}
            {[...explain.changes].reverse().map((c, i) => (
              <li key={i} class={c.cause}>
                <time>
                  {new Date(c.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: session.sandbox.timeZone })} · {LEVEL_LABEL[c.from]} → {LEVEL_LABEL[c.to]}
                </time>
                {c.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {explain && (
        <div class="card">
          <h3>Set the support level</h3>
          <p class="hint">Coach override, recorded in the audit log with your reason. Sam hears the new level next time.</p>
          <div class="lvl-seg" role="group" aria-label="Support level">
            {LEVELS.map((l) => (
              <button key={l} aria-pressed={level === l} onClick={() => setLevel(l)}>
                {LEVEL_LABEL[l]}
              </button>
            ))}
          </div>
          <label class="field">
            <span>Reason (shown in the report)</span>
            <textarea value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} maxLength={200} />
          </label>
          <div class="row" style={{ marginTop: '10px' }}>
            <button class="btn" disabled={saving || reason.trim().length < 3} onClick={() => void apply()}>
              {saving ? 'Saving…' : `Set to ${LEVEL_LABEL[level].toLowerCase()}`}
            </button>
          </div>
          {toast && <div class={`toast ${toast.tone}`}>{toast.text}</div>}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ suggest a routine

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function SuggestTab({ session, suggestions, onSent, tz }: { session: Session; suggestions: SuggestionOut[]; onSent: () => void; tz: string }) {
  const [draft, setDraft] = useState<RoutineDraft>(() => clone(LAUNDRY_TEMPLATE));
  const [note, setNote] = useState(DEFAULT_NOTE);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<ProposeOut | null>(null);
  const [error, setError] = useState('');

  const patchStep = (i: number, patch: Partial<RoutineDraft['steps'][number]>, prompts?: Partial<RoutineDraft['steps'][number]['prompts']>) =>
    setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch, prompts: { ...s.prompts, ...(prompts ?? {}) } } : s)) }));

  const send = async () => {
    setSending(true);
    setError('');
    setResult(null);
    const r = await session.coach.callTool('suggest_routine', { routine: draft, note }, 'coach');
    setSending(false);
    if (r.isError) {
      setError(speechOf(r));
      return;
    }
    const out = sc<ProposeOut>(r);
    setResult(out);
    nudgeEvents();
    if (out?.accepted) onSent();
  };

  return (
    <>
      <div class="card">
        <h3>Suggest a routine</h3>
        <p class="hint">A task analysis with a three-level prompt ladder per step. Scaffold checks it, then Sam decides by voice. Nothing changes until Sam says yes.</p>
        <div class="row">
          <label class="field grow">
            <span>Routine name</span>
            <input value={draft.name} onInput={(e) => setDraft({ ...draft, name: (e.target as HTMLInputElement).value })} />
          </label>
        </div>
        <label class="field">
          <span>Note read to Sam</span>
          <input value={note} maxLength={200} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
        </label>
        {draft.steps.map((s, i) => (
          <details class="stepdef" key={s.id}>
            <summary>
              <span class="n">{i + 1}</span>
              {s.title}
              <span class="cue">“{s.prompts.cue}”</span>
            </summary>
            <div class="row">
              <label class="field grow">
                <span>Title</span>
                <input value={s.title} onInput={(e) => patchStep(i, { title: (e.target as HTMLInputElement).value })} />
              </label>
              <label class="field" style={{ width: '128px' }}>
                <span>Pictogram</span>
                <select value={s.pictogram} onChange={(e) => patchStep(i, { pictogram: (e.target as HTMLSelectElement).value })}>
                  {PICTOGRAM_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label class="field">
              <span>Full prompt</span>
              <textarea value={s.prompts.full} onInput={(e) => patchStep(i, {}, { full: (e.target as HTMLTextAreaElement).value })} />
            </label>
            <label class="field">
              <span>Short prompt</span>
              <input value={s.prompts.partial} onInput={(e) => patchStep(i, {}, { partial: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="field">
              <span>Cue (1–4 words)</span>
              <input value={s.prompts.cue} onInput={(e) => patchStep(i, {}, { cue: (e.target as HTMLInputElement).value })} />
            </label>
          </details>
        ))}
        <div class="row" style={{ marginTop: '12px' }}>
          <button class="btn" disabled={sending} onClick={() => void send()} data-testid="send-suggestion">
            {sending ? 'Checking…' : 'Check & send to Sam'}
          </button>
          <button class="btn secondary" onClick={() => { setDraft(clone(LAUNDRY_TEMPLATE)); setNote(DEFAULT_NOTE); setResult(null); }}>
            Reset
          </button>
        </div>
        {error && <div class="toast err">{error}</div>}
        {result && (
          <>
            <div class={`toast ${result.accepted ? 'ok' : 'err'}`} data-testid="suggest-result">
              {result.speech}
            </div>
            {result.issues.length > 0 && (
              <ul class="issues" aria-label="Validation issues">
                {result.issues.map((x, i) => (
                  <li key={i} class={x.severity}>
                    <span class="sev">{x.severity}</span>
                    <span>{x.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div class="card" data-testid="suggestions">
        <h3>Sent suggestions</h3>
        {suggestions.length === 0 && <p class="hint">None yet.</p>}
        {[...suggestions].reverse().map((s) => (
          <div class="sug" key={s.proposal_id}>
            <span>
              <strong>{s.routine_name}</strong> · {s.is_new ? `new, ${s.steps.length} steps` : 'changes'}
            </span>
            <span class={`status-pill ${s.status}`}>{s.status === 'pending' ? 'Waiting for Sam' : s.status === 'approved' ? 'Approved' : 'Declined'}</span>
            <small>
              Sent {fmtTime(new Date(s.proposed_at), tz)} by {s.proposed_by.split(' (')[0]}
              {s.note ? ` · “${s.note}”` : ''}
            </small>
          </div>
        ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ standalone page

export function CoachPage({ session }: { session: Session }) {
  const tools = [...session.coach.tools.keys()];
  return (
    <div class="coach-page">
      <div class="coach-aside">
        <div class="kicker">Coach view</div>
        <h1>What Priya sees</h1>
        <p>Priya, Sam’s occupational therapist, sees task metrics: how much prompting each run needed and which steps Sam now does alone. Scaffold makes no clinical judgement.</p>
        <p>This column is a separate MCP client with a coach token for the same sandbox. Changes she suggests wait for Sam’s spoken “yes”.</p>
        <div class="toolset">
          <h2>tools/list for the coach role</h2>
          {tools.map((t) => (
            <code key={t}>{t}</code>
          ))}
        </div>
      </div>
      <div class="phone">
        <CoachApp session={session} />
      </div>
      <div class="coach-aside-right">
        <div class="kicker" style={{ marginBottom: '8px' }}>
          Try it
        </div>
        <ol>
          <li>On the Simulator, say “start my morning” and work through the steps. The live card here follows along.</li>
          <li>Finish the run: the report adds a live run next to the 21 seeded ones.</li>
          <li>Open Suggest, send Laundry, then on the device say “any suggestions?” and “yes”.</li>
        </ol>
      </div>
    </div>
  );
}
