// One demo session per browser tab: a private seeded sandbox (POST /api/demo/sandbox), a learner
// MCP client and a coach MCP client for the same person, plus pollers for the event log, latency
// metrics and the demo clock. Tokens live in sessionStorage; a tab opened from this one can borrow
// the same sandbox over a BroadcastChannel, so coach and learner always act on the same person.

import { createSandbox, getEvents, getInfo, getMetrics, HttpError, type MetricsSnapshot, type Sandbox, type ServerEvent } from './api.ts';
import { ScaffoldMcp } from './mcp.ts';
import { Store } from './store.ts';

const KEY = 'scaffold.sandbox.v1';
const CHANNEL = 'scaffold-sandbox';

export interface Session {
  sandbox: Sandbox;
  learner: ScaffoldMcp;
  coach: ScaffoldMcp;
}

export type SessionState = { status: 'loading'; step: string } | { status: 'ready'; session: Session } | { status: 'error'; error: string };

export const sessionStore = new Store<SessionState>({ status: 'loading', step: 'Creating your private demo sandbox' });
export const eventsStore = new Store<ServerEvent[]>([]);
export const metricsStore = new Store<MetricsSnapshot | null>(null);
/** Server demo clock as an offset from the local clock, so the header can tick smoothly. */
export const clockStore = new Store<{ offsetMs: number; timeZone: string; mode: string } | null>(null);

function readStored(): Sandbox | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Sandbox) : null;
  } catch {
    return null;
  }
}

function store(sb: Sandbox): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(sb));
  } catch {
    /* private mode: keep it in memory only */
  }
}

async function isAlive(sb: Sandbox): Promise<boolean> {
  try {
    await getEvents(sb.learnerToken, Number.MAX_SAFE_INTEGER);
    return true;
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) return false;
    throw err;
  }
}

/** Ask other open Scaffold tabs for their sandbox (so a new tab joins the same demo person). */
function askPeers(timeoutMs = 350): Promise<Sandbox | null> {
  if (typeof BroadcastChannel === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const ch = new BroadcastChannel(CHANNEL);
    const done = (v: Sandbox | null) => {
      clearTimeout(timer);
      ch.close();
      resolve(v);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    ch.onmessage = (e) => {
      if (e.data?.type === 'sandbox' && e.data.sandbox?.learnerToken) done(e.data.sandbox as Sandbox);
    };
    ch.postMessage({ type: 'who-has-sandbox' });
  });
}

function answerPeers(sb: Sandbox): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e) => {
    if (e.data?.type === 'who-has-sandbox') ch.postMessage({ type: 'sandbox', sandbox: readStored() ?? sb });
    if (e.data?.type === 'sandbox-reset') location.reload();
  };
}

async function obtainSandbox(forceNew: boolean): Promise<Sandbox> {
  if (!forceNew) {
    const stored = readStored();
    if (stored && (await isAlive(stored))) return stored;
    const peer = await askPeers();
    if (peer && (await isAlive(peer))) return peer;
  }
  sessionStore.set({ status: 'loading', step: 'Seeding 21 days of synthetic history' });
  const sb = await createSandbox();
  return { ...sb, createdAt: Date.now() };
}

let started: Promise<Session> | null = null;

export function startSession(): Promise<Session> {
  started ??= (async () => {
    try {
      const sandbox = await obtainSandbox(false);
      store(sandbox);
      answerPeers(sandbox);
      sessionStore.set({ status: 'loading', step: 'Connecting MCP clients (initialize, tools/list)' });
      const learner = new ScaffoldMcp('learner', sandbox.learnerToken);
      const coach = new ScaffoldMcp('coach', sandbox.coachToken);
      await learner.connect();
      await coach.connect();
      const session = { sandbox, learner, coach };
      sessionStore.set({ status: 'ready', session });
      startPollers(session);
      return session;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sessionStore.set({ status: 'error', error: msg });
      started = null;
      throw err;
    }
  })();
  return started;
}

export async function resetDemo(): Promise<void> {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  const sb = { ...(await createSandbox()), createdAt: Date.now() };
  store(sb);
  if (typeof BroadcastChannel !== 'undefined') {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ type: 'sandbox-reset' });
    ch.close();
  }
  location.reload();
}

// ------------------------------------------------------------------ pollers

let pollersStarted = false;
const MAX_EVENTS = 800;

function startPollers(s: Session): void {
  if (pollersStarted) return;
  pollersStarted = true;
  const token = s.sandbox.learnerToken;
  let lastSeq = 0;
  let busy = false;
  const pollEvents = async () => {
    if (busy) return;
    busy = true;
    try {
      const { events } = await getEvents(token, lastSeq);
      if (events.length) {
        lastSeq = events.at(-1)!.seq;
        eventsStore.set((prev) => {
          const next = [...prev, ...events];
          return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
        });
      }
    } catch {
      /* transient; next tick retries */
    } finally {
      busy = false;
    }
  };
  const pollMetrics = async () => {
    try {
      metricsStore.set(await getMetrics());
    } catch {
      /* ignore */
    }
  };
  const syncClock = async () => {
    try {
      const t0 = Date.now();
      const info = await getInfo(token);
      const rtt = Date.now() - t0;
      clockStore.set({ offsetMs: Date.parse(info.now) - (t0 + rtt / 2), timeZone: info.timeZone, mode: info.clock });
    } catch {
      /* ignore */
    }
  };
  void pollEvents();
  void pollMetrics();
  void syncClock();
  setInterval(pollEvents, 1000);
  setInterval(pollMetrics, 2000);
  window.addEventListener('scaffold:nudge', () => {
    setTimeout(pollEvents, 60);
    setTimeout(pollMetrics, 120);
  });
  setInterval(syncClock, 30_000);
}

/** Force an immediate event poll soon after a tool call (keeps the log feeling live). */
export function nudgeEvents(): void {
  window.dispatchEvent(new Event('scaffold:nudge'));
}
