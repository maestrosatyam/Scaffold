// Browser MCP client for the simulator: a real @modelcontextprotocol/client `Client` over
// Streamable HTTP (initialize -> notifications/initialized -> tools/list -> tools/call ...).
// Every JSON-RPC message that crosses the wire is recorded into an observable trace for the
// "Under the hood" panel, with the round-trip latency of each request.

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { CallToolResult, Implementation, JSONRPCMessage, Tool, Transport, TransportSendOptions } from '@modelcontextprotocol/client';
import { Store } from './store.ts';

export type Role = 'learner' | 'coach';
/** Who initiated a call: the simulated assistant, an MCP App view (card button), the coach UI, or plumbing. */
export type Origin = 'assistant' | 'view' | 'coach' | 'system';

export interface TraceEntry {
  id: number;
  role: Role;
  origin: Origin;
  direction: 'out' | 'in';
  rpcId: string | number | null;
  method: string;
  /** Tool name for tools/call, resource uri for resources/read. */
  target?: string;
  request: unknown;
  response?: unknown;
  status: 'pending' | 'ok' | 'error' | 'tool-error' | 'sent';
  wallTime: number;
  startedAt: number;
  ms?: number;
}

export const trace = new Store<TraceEntry[]>([]);
const MAX_TRACE = 400;
let traceSeq = 0;

type Msg = Record<string, unknown> & { id?: string | number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: unknown };

const stable = (v: unknown): string => JSON.stringify(v ?? {}, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

function targetOf(m: Msg): string | undefined {
  if (m.method === 'tools/call') return String(m.params?.name ?? '');
  if (m.method === 'resources/read') return String(m.params?.uri ?? '');
  return undefined;
}

/** Transport decorator: forwards everything to the real Streamable HTTP transport and records messages. */
class TracingTransport implements Transport {
  onclose?: Transport['onclose'];
  onerror?: Transport['onerror'];
  onmessage?: Transport['onmessage'];
  private readonly inner: StreamableHTTPClientTransport;
  private readonly owner: ScaffoldMcp;

  constructor(inner: StreamableHTTPClientTransport, owner: ScaffoldMcp) {
    this.inner = inner;
    this.owner = owner;
  }

  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }

  get hasPerRequestStream(): boolean | undefined {
    return this.inner.hasPerRequestStream;
  }

  async start(): Promise<void> {
    this.inner.onmessage = (m: JSONRPCMessage) => {
      this.owner.recordIn(m as unknown as Msg);
      this.onmessage?.(m);
    };
    this.inner.onclose = () => this.onclose?.();
    this.inner.onerror = (e) => this.onerror?.(e);
    await this.inner.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const entry = this.owner.recordOut(message as unknown as Msg);
    try {
      await this.inner.send(message, options);
    } catch (err) {
      this.owner.recordFailure(entry, err);
      throw err;
    }
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  setProtocolVersion(version: string): void {
    this.inner.setProtocolVersion?.(version);
  }

  setSupportedProtocolVersions(versions: string[]): void {
    (this.inner as Transport).setSupportedProtocolVersions?.(versions);
  }
}

/**
 * The Scaffold endpoint is stateless Streamable HTTP: every response streams back on its own POST,
 * and the optional standalone SSE stream (GET /mcp) is answered with 405 by design, which the
 * transport treats as "no server-initiated stream". We answer that probe locally with the same 405
 * so the browser console stays free of expected network errors; POSTs go to the server unchanged.
 */
const statelessFetch = (url: string | URL, init?: RequestInit): Promise<Response> =>
  (init?.method ?? 'GET').toUpperCase() === 'GET'
    ? Promise.resolve(new Response(null, { status: 405, statusText: 'Method Not Allowed (stateless server: no standalone SSE stream)' }))
    : fetch(url, init);

export interface UiResource {
  uri: string;
  html: string;
  mimeType: string;
  meta?: Record<string, unknown>;
}

export class ScaffoldMcp {
  readonly role: Role;
  readonly client: Client;
  private readonly token: string;
  private readonly url: URL;
  tools = new Map<string, Tool>();
  protocolVersion: string | undefined;
  serverInfo: Implementation | undefined;
  instructions: string | undefined;
  private uiCache = new Map<string, Promise<UiResource>>();
  private originHints: { key: string; origin: Origin }[] = [];
  private connecting: Promise<void> | null = null;

  constructor(role: Role, token: string, path = '/mcp') {
    this.role = role;
    this.token = token;
    this.url = new URL(path, location.origin);
    this.client = new Client({ name: `scaffold-simulator-${role}`, version: '0.1.0' }, { capabilities: {} });
  }

  connect(): Promise<void> {
    this.connecting ??= (async () => {
      const token = this.token;
      const inner = new StreamableHTTPClientTransport(this.url, { authProvider: { token: async () => token }, fetch: statelessFetch });
      this.hint('initialize', undefined, undefined, 'system');
      await this.client.connect(new TracingTransport(inner, this));
      this.protocolVersion = this.client.getNegotiatedProtocolVersion();
      this.serverInfo = this.client.getServerVersion();
      this.instructions = this.client.getInstructions();
      const { tools } = await this.client.listTools();
      this.tools = new Map(tools.map((t) => [t.name, t]));
    })();
    return this.connecting;
  }

  /** The ui:// resource linked to a tool via `_meta.ui.resourceUri` (MCP Apps). */
  uiUriFor(toolName: string): string | undefined {
    const meta = this.tools.get(toolName)?._meta as Record<string, unknown> | undefined;
    const ui = meta?.ui as { resourceUri?: string } | undefined;
    const uri = ui?.resourceUri ?? (meta?.['ui/resourceUri'] as string | undefined);
    return uri?.startsWith('ui://') ? uri : undefined;
  }

  async callTool(name: string, args: Record<string, unknown>, origin: Origin): Promise<CallToolResult> {
    await this.connect();
    this.hint('tools/call', name, args, origin);
    return (await this.client.callTool({ name, arguments: args })) as CallToolResult;
  }

  /** resources/read for a ui:// view, cached per uri (views are static HTML). */
  readUi(uri: string, origin: Origin = 'system'): Promise<UiResource> {
    let p = this.uiCache.get(uri);
    if (!p) {
      p = (async () => {
        await this.connect();
        this.hint('resources/read', uri, undefined, origin);
        const res = await this.client.readResource({ uri });
        const c = res.contents.find((x) => x.uri === uri) ?? res.contents[0];
        if (!c || !('text' in c)) throw new Error(`No HTML content for ${uri}`);
        return { uri, html: c.text, mimeType: c.mimeType ?? 'text/html', meta: c._meta as Record<string, unknown> | undefined };
      })();
      p.catch(() => this.uiCache.delete(uri));
      this.uiCache.set(uri, p);
    }
    return p;
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => undefined);
  }

  // ------------------------------------------------------------------ tracing

  private hint(method: string, target: string | undefined, args: unknown, origin: Origin): void {
    this.originHints.push({ key: `${method}|${target ?? ''}|${args === undefined ? '' : stable(args)}`, origin });
    if (this.originHints.length > 50) this.originHints.shift();
  }

  private takeOrigin(m: Msg): Origin {
    const target = targetOf(m);
    const args = m.method === 'tools/call' ? m.params?.arguments : undefined;
    const key = `${m.method}|${target ?? ''}|${args === undefined ? '' : stable(args)}`;
    const i = this.originHints.findIndex((h) => h.key === key);
    if (i < 0) return 'system';
    const [h] = this.originHints.splice(i, 1);
    return h!.origin;
  }

  recordOut(m: Msg): TraceEntry {
    const entry: TraceEntry = {
      id: ++traceSeq,
      role: this.role,
      origin: m.method ? this.takeOrigin(m) : 'system',
      direction: 'out',
      rpcId: m.id ?? null,
      method: m.method ?? (m.result !== undefined ? 'response' : 'message'),
      target: targetOf(m),
      request: m,
      status: m.id === undefined ? 'sent' : 'pending',
      wallTime: Date.now(),
      startedAt: performance.now(),
    };
    trace.set((t) => {
      const next = [...t, entry];
      return next.length > MAX_TRACE ? next.slice(next.length - MAX_TRACE) : next;
    });
    return entry;
  }

  recordIn(m: Msg): void {
    const isResponse = m.id !== undefined && (m.result !== undefined || m.error !== undefined) && m.method === undefined;
    if (isResponse) {
      const now = performance.now();
      trace.set((t) => {
        const i = t.findIndex((e) => e.role === this.role && e.direction === 'out' && e.rpcId === m.id && e.status === 'pending');
        if (i < 0) return t;
        const e = t[i]!;
        const status: TraceEntry['status'] = m.error ? 'error' : (m.result as { isError?: boolean } | undefined)?.isError ? 'tool-error' : 'ok';
        const next = [...t];
        next[i] = { ...e, response: m, status, ms: Math.round((now - e.startedAt) * 10) / 10 };
        return next;
      });
      return;
    }
    // Server-initiated notification or request (rare for this stateless server).
    trace.set((t) => [
      ...t,
      {
        id: ++traceSeq,
        role: this.role,
        origin: 'system',
        direction: 'in',
        rpcId: m.id ?? null,
        method: m.method ?? 'message',
        request: m,
        status: 'ok',
        wallTime: Date.now(),
        startedAt: performance.now(),
      },
    ]);
  }

  recordFailure(entry: TraceEntry, err: unknown): void {
    trace.set((t) => t.map((e) => (e.id === entry.id ? { ...e, status: 'error', ms: Math.round(performance.now() - e.startedAt), response: { error: String((err as Error)?.message ?? err) } } : e)));
  }
}

/** Text of a tool result: structured `speech` when present, else the first text block. */
export function speechOf(r: CallToolResult | undefined): string {
  if (!r) return '';
  const sc = r.structuredContent as { speech?: unknown } | undefined;
  if (!r.isError && typeof sc?.speech === 'string') return sc.speech;
  const t = r.content?.find((c) => c.type === 'text') as { text?: string } | undefined;
  return t?.text ?? '';
}
