// Read-only REST helpers (demo sandbox, debug trace, metrics, replay). All state changes go
// through MCP tools; these endpoints only create sandboxes and expose traces.

export interface Sandbox {
  personId: string;
  learnerToken: string;
  coachToken: string;
  today: string;
  timeZone: string;
  clock: string;
  seededEvents?: number;
  createdAt?: number;
}

export interface ServerInfo {
  name: string;
  protocol: string;
  store: string;
  timeZone: string;
  demo: boolean;
  now: string;
  clock: string;
}

export interface ServerEvent {
  seq: number;
  type: string;
  at: string;
  actorId: string;
  seeded?: boolean;
  runId?: string;
  stepId?: string;
  routineId?: string;
  device?: string;
  reason?: string;
  level?: string;
  from?: string;
  to?: string;
  decision?: string;
  proposalId?: string;
  bulk?: boolean;
  routine?: { name: string; routineId: string; steps: unknown[] };
  version?: number;
  [k: string]: unknown;
}

export interface MetricsSnapshot {
  total: { count: number; p50: number; p95: number; max: number };
  tools: Record<string, { count: number; p50: number; p95: number }>;
}

export interface ReplayDay {
  day: number;
  date: string;
  isToday: boolean;
  levels: Record<string, string>;
  firstStep: { title: string; level: string; prompt: string } | null;
  speech: string | null;
  plannedWords: number;
  seeded: boolean;
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function getJson<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  if (!res.ok) throw new HttpError(res.status, `${init.method ?? 'GET'} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export const createSandbox = () => getJson<Sandbox>('/api/demo/sandbox', undefined, { method: 'POST' });
export const getInfo = (token?: string) => getJson<ServerInfo>('/api/info', token);
export const getEvents = (token: string, after: number) => getJson<{ personId: string; events: ServerEvent[] }>(`/api/debug/events?after=${after}`, token);
export const getMetrics = () => getJson<MetricsSnapshot>('/api/debug/metrics');
export const getReplay = (token: string) => getJson<{ personId: string; days: ReplayDay[] }>('/api/demo/replay', token);
