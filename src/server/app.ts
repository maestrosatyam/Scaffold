// HTTP composition: MCP Streamable HTTP endpoint(s), demo sandbox API, debug/trace API and the
// static simulator. Everything that changes state goes through MCP tools; the REST routes here
// only create demo sandboxes and expose read-only traces for the "under the hood" panel.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport, toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import express, { type NextFunction, type Request, type Response } from 'express';
import { apply, emptyState } from '../core/engine.ts';
import type { Actor, ScaffoldEvent } from '../core/model.ts';
import { startSpeech } from '../core/speech.ts';
import { stepView, wordCount } from '../core/views.ts';
import { buildSeedEvents, localYmd, zonedToUtc } from '../demo/seed.ts';
import { authenticate, RateLimiter, SandboxTokens, type AuthConfig } from './auth.ts';
import { buildMcpServer, UI, type AppHtml } from './mcp.ts';
import { Metrics } from './metrics.ts';
import { ScaffoldService, type Clock } from './service.ts';
import type { EventStore } from '../store/store.ts';
import { PICTOGRAM_KEYS } from '../apps/pictogram-keys.ts';

export const PROTOCOL_VERSION = '2025-11-25';

export interface AppConfig {
  host: string;
  store: EventStore;
  clock: Clock;
  timeZone: string;
  auth: AuthConfig;
  /** Enables /api/demo/* (sandboxes, replay) and the demo clock. */
  demo: boolean;
  /** Anchor sandboxes' clocks at this local time today ("HH:MM", e.g. "07:24"); null = real time. */
  demoStartTime: string | null;
  /** HMAC secret for stateless sandbox tokens (>= 16 bytes). Random per process if omitted. */
  tokenSecret?: string;
  /** Sandbox creation limits per client IP / per instance per hour. */
  sandboxLimits?: { perIp: number; total: number };
  allowedHosts?: string[];
  allowedOrigins?: string[];
  webDir: string;
  appsDir: string;
}

function fileApps(dir: string): AppHtml {
  const cache = new Map<string, string>();
  return {
    get(name) {
      const hit = cache.get(name);
      if (hit) return hit;
      const file = join(dir, UI[name].replace('ui://scaffold/', ''));
      const html = existsSync(file)
        ? readFileSync(file, 'utf8')
        : `<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:16px">MCP App "${name}" is not built. Run <code>npm run build</code>.</body>`;
      if (existsSync(file)) cache.set(name, html);
      return html;
    },
  };
}

const rpcError = (res: Response, status: number, code: number, message: string) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

/** Coach-only free text that a learner token does not get from the raw debug log. */
function redactForLearner(e: ScaffoldEvent): ScaffoldEvent {
  if (e.type === 'level.set') return { ...e, reason: '[coach note]' };
  return e;
}

export function createApp(cfg: AppConfig) {
  if (cfg.demoStartTime !== null && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(cfg.demoStartTime)) {
    throw new Error(`Invalid demo start time "${cfg.demoStartTime}" (expected HH:MM, or "real")`);
  }
  const service = new ScaffoldService({ store: cfg.store, clock: cfg.clock, timeZone: cfg.timeZone });
  const metrics = new Metrics();
  const sandboxes = new SandboxTokens(cfg.tokenSecret ?? randomBytes(32));
  const limiter = new RateLimiter(cfg.sandboxLimits?.perIp ?? 20, cfg.sandboxLimits?.total ?? 300);
  const apps = fileApps(cfg.appsDir);
  const knownPictograms = new Set<string>(PICTOGRAM_KEYS);

  const resolve = (authorization: string | null | undefined, allowAnonymous = true) =>
    authenticate(cfg.auth, authorization, sandboxes, cfg.clock.now().getTime(), { allowAnonymous });
  const factory = (actor: Actor) => buildMcpServer({ service, actor, apps, metrics, knownPictograms });

  const handler = createMcpHandler(({ requestInfo }) => {
    const r = resolve(requestInfo?.headers.get('authorization'));
    if (!r.ok) throw new Error('unauthenticated'); // unreachable: rejected by middleware below
    return factory(r.actor);
  });
  const nodeHandler = toNodeHandler(handler);

  const app = createMcpExpressApp({
    host: cfg.host,
    ...(cfg.allowedHosts?.length ? { allowedHosts: cfg.allowedHosts } : {}),
    ...(cfg.allowedOrigins?.length ? { allowedOrigins: cfg.allowedOrigins } : {}),
  });
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // Some hosts (e.g. serverless-http on Lambda) hand Express a raw Buffer body that express.json()
  // did not parse. Parse it here so every route sees the same JSON body.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (Buffer.isBuffer(req.body)) {
      const type = String(req.headers['content-type'] ?? '');
      if (req.body.length === 0) req.body = undefined;
      else if (type.includes('json')) {
        try {
          req.body = JSON.parse(req.body.toString('utf8'));
        } catch {
          rpcError(res, 400, -32700, 'Parse error');
          return;
        }
      }
    }
    next();
  });

  const requireActor = (req: Request, res: Response, allowAnonymous = true): Actor | null => {
    const r = resolve(req.headers.authorization, allowAnonymous);
    if (!r.ok) {
      // Alexa+ add-on guidance: plain 401 without a WWW-Authenticate challenge.
      rpcError(res, 401, -32001, r.message);
      return null;
    }
    return r.actor;
  };

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, store: cfg.store.kind, protocol: PROTOCOL_VERSION });
  });

  // Primary MCP endpoint: Streamable HTTP, stateless. Serves 2025-11-25 (initialize handshake)
  // and also answers 2026-07-28 clients from the same tool definitions.
  app.all('/mcp', (req, res) => {
    if (!requireActor(req, res)) return;
    void nodeHandler(req, res, req.body);
  });

  // Hedge for 2025-era clients that send `Accept: application/json` only and cannot parse SSE.
  app.post('/mcp-json', async (req, res) => {
    const actor = requireActor(req, res);
    if (!actor) return;
    const accept = req.headers.accept ?? '';
    if (!accept.includes('text/event-stream')) {
      const fixed = accept ? `${accept}, text/event-stream` : 'application/json, text/event-stream';
      req.headers.accept = fixed;
      const i = req.rawHeaders.findIndex((h, idx) => idx % 2 === 0 && h.toLowerCase() === 'accept');
      if (i >= 0) req.rawHeaders[i + 1] = fixed;
      else req.rawHeaders.push('Accept', fixed);
    }
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => void transport.close());
    await factory(actor).connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // ---------------------------------------------------------------- debug / trace (read-only)
  // Requires an explicit token (never the anonymous fallback). Learner tokens get coach free text redacted.
  app.get('/api/debug/events', async (req, res) => {
    const actor = requireActor(req, res, false);
    if (!actor) return;
    const after = Math.max(0, Number(req.query.after ?? 0) || 0);
    const events = await cfg.store.load(actor.personId, after);
    res.json({ personId: actor.personId, events: actor.role === 'coach' ? events : events.map(redactForLearner) });
  });

  app.get('/api/debug/metrics', (_req, res) => {
    res.json(metrics.snapshot());
  });

  app.get('/api/info', async (req, res) => {
    const r = resolve(req.headers.authorization, false);
    const state = r.ok ? await service.state(r.actor.personId) : null;
    res.json({
      name: 'scaffold',
      protocol: PROTOCOL_VERSION,
      store: cfg.store.kind,
      timeZone: cfg.timeZone,
      demo: cfg.demo,
      now: (state ? service.nowFor(state) : cfg.clock.now()).toISOString(),
      clock: state ? service.clockMode(state) : cfg.clock.mode,
    });
  });

  // ---------------------------------------------------------------- demo sandboxes
  if (cfg.demo) {
    app.post('/api/demo/sandbox', async (req, res) => {
      const nowMs = cfg.clock.now().getTime();
      // Rate-limit BEFORE writing anything, so refused requests leave no orphan streams.
      if (!limiter.take(req.ip ?? 'unknown', nowMs)) {
        rpcError(res, 429, -32002, 'Too many demo sandboxes from here; please try again later.');
        return;
      }
      const personId = `sam-${randomBytes(6).toString('hex')}`;
      const today = localYmd(nowMs, cfg.timeZone);
      let demoClock: { anchorMs: number; startedMs: number } | undefined;
      if (cfg.demoStartTime) {
        const [hh, mm] = cfg.demoStartTime.split(':').map(Number) as [number, number];
        demoClock = { anchorMs: zonedToUtc(today, hh, mm, cfg.timeZone), startedMs: nowMs };
      }
      const events = buildSeedEvents({ today, timeZone: cfg.timeZone, personId, demoClock });
      await cfg.store.replace(personId, events, { expiresAtMs: nowMs + sandboxes.ttlMs });
      const tokens = sandboxes.issuePair(personId, nowMs);
      res.json({ personId, ...tokens, seededEvents: events.length, today, timeZone: cfg.timeZone, clock: demoClock ? 'demo' : cfg.clock.mode });
    });

    // Time machine: what would "start my morning" have sounded like before each run?
    // One incremental pass over the person's own log — no special-cased data.
    app.get('/api/demo/replay', async (req, res) => {
      const actor = requireActor(req, res, false);
      if (!actor) return;
      const all = await cfg.store.load(actor.personId);
      const state = emptyState(actor.personId);
      const snap = (runId: string | null, at: string, seeded: boolean, index: number) => {
        const routine = state.routines.morning?.current;
        const levels = Object.fromEntries((routine?.steps ?? []).map((s) => [s.id, state.stats[`morning/${s.id}`]?.level ?? 'full']));
        const run = runId ? state.runs[runId] : undefined;
        // "Today" has no run yet: show what start_routine would present right now.
        const first = routine?.steps[0];
        const v = run
          ? stepView(state, run, 0)
          : first && routine
            ? {
                runId: '',
                routineId: routine.routineId,
                routineName: routine.name,
                stepId: first.id,
                index: 1,
                total: routine.steps.length,
                doneCount: 0,
                title: first.title,
                pictogram: first.pictogram,
                level: levels[first.id]!,
                baseLevel: levels[first.id]!,
                prompt: levels[first.id] === 'independent' ? '' : first.prompts[levels[first.id] as 'full' | 'partial' | 'cue'],
                must: first.must,
                estSec: first.estSec,
                isLast: routine.steps.length === 1,
              }
            : null;
        const plannedWords = (routine?.steps ?? []).reduce((acc, s) => {
          const level = levels[s.id]!;
          return acc + (level !== 'independent' ? wordCount(s.prompts[level]) : 0);
        }, 0);
        return {
          day: index,
          date: at,
          isToday: runId === null,
          levels,
          firstStep: v ? { step_id: v.stepId, title: v.title, pictogram: v.pictogram, level: v.level, prompt: v.prompt, index: v.index, total: v.total } : null,
          speech: v ? startSpeech(v, false) : null,
          plannedWords,
          seeded,
        };
      };
      const days: ReturnType<typeof snap>[] = [];
      for (const e of all) {
        apply(state, e, { timeZone: cfg.timeZone });
        if (e.type === 'run.started' && e.routineId === 'morning') days.push(snap(e.runId, e.at, !!e.seeded, days.length + 1));
      }
      days.push(snap(null, service.nowFor(state).toISOString(), false, days.length + 1));
      res.json({ personId: actor.personId, days });
    });
  }

  // ---------------------------------------------------------------- static simulator
  if (existsSync(cfg.webDir)) {
    app.use('/', express.static(cfg.webDir, { index: 'index.html', maxAge: '5m' }));
    app.get(/^\/(coach|time-machine|device)(\/.*)?$/, (_req, res) => res.sendFile(join(cfg.webDir, 'index.html')));
  } else {
    app.get('/', (_req, res) => {
      res.type('text/plain').send('Scaffold MCP server. Build the simulator with `npm run build` to serve it here. MCP endpoint: /mcp');
    });
  }

  // JSON errors only: never an HTML page or a stack trace (malformed JSON -> JSON-RPC Parse error).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { type?: string; status?: number; statusCode?: number };
    if (res.headersSent) return;
    if (e?.type === 'entity.parse.failed') return void rpcError(res, 400, -32700, 'Parse error');
    if (e?.type === 'entity.too.large') return void rpcError(res, 413, -32600, 'Request too large');
    const status = e?.status ?? e?.statusCode ?? 500;
    if (status >= 500) console.error('[scaffold] unhandled error:', err);
    rpcError(res, status >= 400 && status < 600 ? status : 500, -32603, status >= 500 ? 'Internal error' : 'Bad request');
  });

  return { app, service, metrics, sandboxes, limiter, handler };
}
