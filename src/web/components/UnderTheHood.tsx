// "Under the hood": the live MCP JSON-RPC trace (every message this page exchanged with the
// server), the person's append-only event log, protocol version and latency against the budget.
import { useMemo, useState } from 'preact/hooks';
import type { ServerEvent } from '../lib/api.ts';
import { trace, type TraceEntry } from '../lib/mcp.ts';
import { linkClick } from '../lib/nav.ts';
import { clockStore, eventsStore, metricsStore, type Session } from '../lib/session.ts';
import { useStore } from '../lib/store.ts';
import { fmtTime } from './Header.tsx';
import { ChevronIcon } from './icons.tsx';
import { JsonView } from './JsonView.tsx';

const BUDGET_MS = 500;
const ms1 = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

const short = (v: unknown): string => {
  if (typeof v === 'string') return v.length > 28 ? `"${v.slice(0, 26)}…"` : JSON.stringify(v);
  if (v && typeof v === 'object') return Array.isArray(v) ? `[${v.length}]` : '{…}';
  return String(v);
};

function kindOf(e: TraceEntry): string {
  if (e.status === 'error') return 'k-error';
  if (e.method === 'tools/call') return 'k-call';
  if (e.method === 'tools/list') return 'k-list';
  if (e.method === 'resources/read') return 'k-read';
  return 'k-init';
}

function summary(e: TraceEntry): string {
  const req = e.request as { params?: Record<string, unknown> };
  const res = (e.response as { result?: Record<string, unknown>; error?: { message?: string } } | undefined) ?? undefined;
  if (res?.error) return `error: ${res.error.message ?? JSON.stringify(res.error)}`;
  switch (e.method) {
    case 'initialize': {
      const pv = (res?.result?.protocolVersion as string | undefined) ?? (req.params?.protocolVersion as string);
      const si = res?.result?.serverInfo as { name?: string; version?: string } | undefined;
      return `protocolVersion ${pv}${si ? ` → ${si.name} ${si.version}` : ''}`;
    }
    case 'tools/list': {
      const tools = res?.result?.tools as { name: string }[] | undefined;
      return tools ? `→ ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}` : 'listing tools…';
    }
    case 'resources/read': {
      const c = (res?.result?.contents as { mimeType?: string; text?: string }[] | undefined)?.[0];
      return c ? `→ ${c.mimeType} · ${Math.round((c.text?.length ?? 0) / 1024)} KB` : 'reading…';
    }
    case 'tools/call': {
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      const a = Object.entries(args).map(([k, v]) => `${k}: ${short(v)}`).join(', ');
      if (!res) return `(${a})`;
      const sc = res.result?.structuredContent as { speech?: string } | undefined;
      if (res.result?.isError) {
        const t = (res.result.content as { text?: string }[] | undefined)?.[0]?.text;
        return `(${a}) → isError: ${t}`;
      }
      return `(${a}) → ${sc?.speech === '' ? 'speech: "" (silent)' : `“${sc?.speech ?? ''}”`}`;
    }
    default:
      return e.status === 'sent' ? 'notification' : '';
  }
}

function TraceRow({ e, latest }: { e: TraceEntry; latest: boolean }) {
  const [open, setOpen] = useState(false);
  const slow = (e.ms ?? 0) > BUDGET_MS;
  return (
    <div class={`rpc ${latest ? 'latest' : ''}`}>
      <button class="rpc-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class={`arrow ${kindOf(e)}`} aria-hidden="true">
          {e.direction === 'in' ? '←' : '→'}
        </span>
        <span class="rpc-main">
          <span class="rpc-line">
            {e.target && e.method === 'tools/call' ? <span class="rpc-tool">{e.target}</span> : <span class="rpc-tool">{e.method}</span>}
            {e.method === 'tools/call' && <span class="rpc-method">tools/call</span>}
            <span class={`tag ${e.role}`}>{e.role}</span>
            {e.origin === 'view' && <span class="tag view">MCP App</span>}
            {e.status === 'tool-error' && <span class="tag err">isError</span>}
            {e.status === 'error' && <span class="tag err">error</span>}
          </span>
          <span class="rpc-sum">{summary(e)}</span>
        </span>
        <span class={`rpc-ms ${e.status === 'pending' ? 'pending' : slow ? 'slow' : ''}`}>
          {e.status === 'pending' ? '…' : e.status === 'sent' ? 'sent' : `${e.ms} ms`}
        </span>
      </button>
      {open && (
        <div class="rpc-body">
          <div>
            <h4>Request</h4>
            <JsonView value={e.request} open={3} />
          </div>
          {e.response !== undefined && (
            <div>
              <h4>Response</h4>
              <JsonView value={e.response} open={3} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function evClass(type: string): string {
  if (type.startsWith('run.')) return 't-run';
  if (type === 'step.helped') return 't-help';
  if (type.startsWith('step.')) return 't-step';
  if (type.startsWith('level.')) return 't-level';
  if (type.startsWith('change.')) return 't-change';
  return 't-other';
}

const shortId = (id?: string) => (id ? id.replace(/^(run|prop|proposal)-/, '').slice(-6) : '');

export function eventSummary(e: ServerEvent): string {
  switch (e.type) {
    case 'run.started':
      return `${e.routineId} on ${e.device} · ${shortId(e.runId)}`;
    case 'run.resumed':
      return `on ${e.device} · ${shortId(e.runId)}`;
    case 'run.finished':
      return shortId(e.runId);
    case 'run.abandoned':
      return `${e.reason}`;
    case 'step.completed':
      return `${e.stepId}${e.bulk ? ' (all done)' : ''}`;
    case 'step.helped':
      return `${e.stepId}: ${e.from} → ${e.to}`;
    case 'step.skipped':
      return `${e.stepId} (${e.reason})`;
    case 'level.set':
      return `${e.stepId} → ${e.level}: “${e.reason}”`;
    case 'change.proposed':
      return `${e.routine?.name ?? ''} by ${String(e.proposedBy ?? '').split(' (')[0]}`;
    case 'change.decided':
      return `${e.decision}`;
    case 'routine.published':
      return `${e.routine?.name ?? ''} v${e.version}`;
    case 'person.registered':
      return String(e.displayName ?? '');
    default:
      return '';
  }
}

function EventLog() {
  const events = useStore(eventsStore);
  const clock = useStore(clockStore);
  const [showSeeded, setShowSeeded] = useState(false);
  const live = events.filter((e) => !e.seeded);
  const seededCount = events.length - live.length;
  const shown = (showSeeded ? events.slice(-160) : live).slice().reverse();
  const tz = clock?.timeZone ?? 'UTC';
  return (
    <>
      {shown.length === 0 && <div class="empty">No live events yet. Say “start my morning”. Each tool call appends events to this person’s log.</div>}
      {shown.map((e) => (
        <div class="ev" key={e.seq}>
          <span class="ev-seq">#{e.seq}</span>
          <span class="ev-main">
            <span class={`ev-type ${evClass(e.type)}`}>{e.type}</span>
            <span class="ev-sum">{eventSummary(e)}</span>
            {e.seeded && <span class="tag seeded" style={{ marginLeft: '8px' }}>seeded</span>}
          </span>
          <span class="ev-time">{fmtTime(new Date(e.at), tz, showSeeded ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
        </div>
      ))}
      {seededCount > 0 && (
        <div class="ev-divider">
          {seededCount} seeded events below this line are 21 days of synthetic history, generated by the real engine and marked <code>seeded: true</code>.{' '}
          <button class="btn-ghost" style={{ marginTop: '8px' }} onClick={() => setShowSeeded(!showSeeded)}>
            {showSeeded ? 'Hide seeded history' : 'Show seeded history'}
          </button>
        </div>
      )}
    </>
  );
}

function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

export function UnderTheHood({ session, collapsed, onToggle }: { session: Session; collapsed: boolean; onToggle: () => void }) {
  const entries = useStore(trace);
  const events = useStore(eventsStore);
  const metrics = useStore(metricsStore);
  const [tab, setTab] = useState<'trace' | 'events'>('trace');
  const [plumbing, setPlumbing] = useState(true);
  const calls = entries.filter((e) => e.method === 'tools/call' && e.ms !== undefined);
  const rtt95 = Math.round(pct(calls.map((c) => c.ms!), 95));
  const visible = useMemo(() => (plumbing ? entries : entries.filter((e) => e.method === 'tools/call')).slice().reverse(), [entries, plumbing]);
  const latestCall = visible.find((e) => e.method === 'tools/call');
  const liveEvents = events.filter((e) => !e.seeded).length;
  const p95 = metrics?.total.p95 ?? 0;

  return (
    <aside class="hood" aria-label="Under the hood">
      <div class="hood-head">
        <h2>Under the hood</h2>
        <span class="sub">real MCP traffic from this page</span>
        <button class="btn-ghost hood-toggle" onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? 'Show under the hood panel' : 'Hide under the hood panel'}>
          <ChevronIcon dir={collapsed ? 'left' : 'right'} />
        </button>
        {collapsed && <span class="hood-rail">Under the hood</span>}
      </div>
      <div class="hood-body">
        <div class="stats">
          <div class="stat">
            <div class="stat-k">MCP protocol</div>
            <div class="stat-v">{session.learner.protocolVersion ?? '—'}</div>
            <div class="stat-s">Streamable HTTP</div>
          </div>
          <div class="stat" title="Server-side tool handler latency (GET /api/debug/metrics) against the 500 ms round-trip budget">
            <div class="stat-k">Server p50 · p95</div>
            <div class="stat-v">{metrics && metrics.total.count ? `${ms1(metrics.total.p50)} · ${ms1(metrics.total.p95)} ms` : '—'}</div>
            <div class="budget" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (p95 / BUDGET_MS) * 100)}%`, background: p95 > BUDGET_MS ? 'var(--rose)' : undefined }} />
            </div>
            <div class="stat-s">of {BUDGET_MS} ms budget</div>
          </div>
          <div class="stat" title="Browser-measured round trip for tools/call (p95), including network">
            <div class="stat-k">Round trip</div>
            <div class="stat-v">{calls.length ? `${rtt95} ms` : '—'}</div>
            <div class="stat-s">p95 · {calls.length} calls</div>
          </div>
        </div>
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'trace'} onClick={() => setTab('trace')}>
            JSON-RPC trace <span class="count">{entries.length}</span>
          </button>
          <button role="tab" aria-selected={tab === 'events'} onClick={() => setTab('events')}>
            Event log <span class="count">{liveEvents}</span>
          </button>
        </div>
        {tab === 'trace' && (
          <div class="hood-filter">
            <label>
              <input type="checkbox" checked={plumbing} onChange={(e) => setPlumbing((e.target as HTMLInputElement).checked)} /> show handshake &amp; resources/read
            </label>
          </div>
        )}
        <div class="hood-list" role="tabpanel">
          {tab === 'trace' ? (
            visible.length ? (
              visible.map((e) => <TraceRow key={e.id} e={e} latest={e === latestCall} />)
            ) : (
              <div class="empty">No MCP traffic yet.</div>
            )
          ) : (
            <EventLog />
          )}
        </div>
        <div class="hood-foot">
          <strong>Replay:</strong> the person’s state is an append-only event log. The coach report and the{' '}
          <a href="/time-machine" onClick={linkClick}>
            Time machine
          </a>{' '}
          are pure replays of it — nothing is stored twice.
        </div>
      </div>
    </aside>
  );
}
