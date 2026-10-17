// HTTP composition: MCP Streamable HTTP endpoint(s), demo sandbox API, debug/trace API and the
// static simulator. Everything that changes state goes through MCP tools; the REST routes here
// only create demo sandboxes and expose read-only traces for the "under the hood" panel.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport, toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import express, { type Request, type Response } from 'express';
import { project } from '../core/engine.ts';
import type { Actor, ScaffoldEvent } from '../core/model.ts';
import { startSpeech } from '../core/speech.ts';
import { stepView, wordCount } from '../core/views.ts';
import { buildSeedEvents, localYmd, zonedToUtc } from '../demo/seed.ts';
import { authenticate, SandboxRegistry, type AuthConfig } from './auth.ts';
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
  /** Anchor sandboxes' clocks at this local time today (e.g. "07:24"); null = real time. */
  demoStartTime: string | null;
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

export function createApp(cfg: AppConfig) {
  const service = new ScaffoldService({ store: cfg.store, clock: cfg.clock, timeZone: cfg.timeZone });
  const metrics = new Metrics();
  const sandboxes = new SandboxRegistry();
  const apps = fileApps(cfg.appsDir);
  const knownPictograms = new Set(PICTOGRAM_KEYS);

  const resolve = (authorization: string | null | undefined) => authenticate(cfg.auth, authorization, sandboxes, cfg.clock.now().getTime());
  const factory = (actor: Actor) => buildMcpServer({ service, actor, apps, metrics, knownPictograms });

  const handler = createMcpHandler(({ requestInfo }) => {
    const r = resolve(requestInfo?.headers.get('authorization'));
    if (!r.ok) throw new Error('unauthenticated'); // unreachable: rejected by middleware below
    return factory(r.actor);
  });
  const nodeHandler = toNodeHandler(handler);

  const app = createMcpExpressApp({
    host: cfg.host,
    ...(cfg.allowedHosts ? { allowedHosts: cfg.allowedHosts } : {}),
    ...(cfg.allowedOrigins ? { allowedOrigins: cfg.allowedOrigins } : {}),
  });
  app.disable('x-powered-by');

  const requireActor = (req: Request, res: Response): Actor | null => {
    const r = resolve(req.headers.authorization);
    if (!r.ok) {
      // Alexa+ add-on guidance: plain 401 without a WWW-Authenticate challenge.
      res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: r.message }, id: null });
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
  app.post(
    '/mcp-json',
    (req, res, next) => {
      if (!requireActor(req, res)) return;
      const accept = req.headers.accept ?? '';
      if (!accept.includes('text/event-stream')) {
        const fixed = accept ? `${accept}, text/event-stream` : 'application/json, text/event-stream';
        req.headers.accept = fixed;
        const i = req.rawHeaders.findIndex((h, idx) => idx % 2 === 0 && h.toLowerCase() === 'accept');
        if (i >= 0) req.rawHeaders[i + 1] = fixed;
        else req.rawHeaders.push('Accept', fixed);
      }
      next();
    },
    async (req, res) => {
      const actor = resolve(req.headers.authorization);
      if (!actor.ok) return;
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => void transport.close());
      await factory(actor.actor).connect(transport);
      await transport.handleRequest(req, res, req.body);
    },
  );

  // ---------------------------------------------------------------- debug / trace (read-only)
  app.get('/api/debug/events', async (req, res) => {
    const actor = requireActor(req, res);
    if (!actor) return;
    const after = Number(req.query.after ?? 0) || 0;
    const events = await cfg.store.load(actor.personId, after);
    res.json({ personId: actor.personId, events });
  });

  app.get('/api/debug/metrics', (_req, res) => {
    res.json(metrics.snapshot());
  });

  app.get('/api/info', (req, res) => {
    const r = resolve(req.headers.authorization);
    const pid = r.ok ? r.actor.personId : null;
    res.json({
      name: 'scaffold',
      protocol: PROTOCOL_VERSION,
      store: cfg.store.kind,
      timeZone: cfg.timeZone,
      demo: cfg.demo,
      now: (pid ? service.now(pid) : cfg.clock.now()).toISOString(),
      clock: pid ? service.clockMode(pid) : cfg.clock.mode,
    });
  });

  // ---------------------------------------------------------------- demo sandboxes
  if (cfg.demo) {
    app.post('/api/demo/sandbox', async (_req, res) => {
      const nowMs = cfg.clock.now().getTime();
      for (const dead of sandboxes.sweep(nowMs)) {
        await cfg.store.replace(dead, []);
        service.invalidate(dead);
      }
      const personId = `sam-${randomBytes(4).toString('hex')}`;
      const today = localYmd(nowMs, cfg.timeZone);
      const events = buildSeedEvents({ today, timeZone: cfg.timeZone, personId });
      await cfg.store.replace(personId, events);
      service.invalidate(personId);
      if (cfg.demoStartTime) {
        const [hh, mm] = cfg.demoStartTime.split(':').map(Number) as [number, number];
        service.anchorClock(personId, zonedToUtc(today, hh, mm, cfg.timeZone));
      }
      const tokens = sandboxes.create(personId, nowMs, () => randomBytes(18).toString('base64url'));
      res.json({ personId, ...tokens, seededEvents: events.length, today, timeZone: cfg.timeZone, clock: service.clockMode(personId) });
    });

    // Time machine: what would "start my morning" have sounded like on each seeded day?
    // Pure replay of the person's own event log prefix — no special-cased data.
    app.get('/api/demo/replay', async (req, res) => {
      const actor = requireActor(req, res);
      if (!actor) return;
      const all = await cfg.store.load(actor.personId);
      const starts = all.filter((e): e is Extract<ScaffoldEvent, { type: 'run.started' }> => e.type === 'run.started' && e.routineId === 'morning');
      const days = [...starts.map((s) => ({ seq: s.seq, at: s.at, runId: s.runId })), { seq: Number.MAX_SAFE_INTEGER, at: service.now(actor.personId).toISOString(), runId: null as string | null }];
      const out = days.map((d, i) => {
        const prefix = all.filter((e) => e.seq <= d.seq);
        const state = project(actor.personId, prefix, { timeZone: cfg.timeZone });
        const run = d.runId ? state.runs[d.runId] : undefined;
        const levels = Object.fromEntries((state.routines.morning?.current.steps ?? []).map((s) => [s.id, state.stats[`morning/${s.id}`]?.level ?? 'full']));
        const v = run ? stepView(state, run, 0) : null;
        const words = Object.entries(levels).reduce((acc, [id, level]) => {
          const sd = state.routines.morning?.current.steps.find((s) => s.id === id);
          return acc + (sd && level !== 'independent' ? wordCount(sd.prompts[level]) : 0);
        }, 0);
        return {
          day: i + 1,
          date: d.at,
          isToday: d.runId === null,
          levels,
          firstStep: v ? { title: v.title, level: v.level, prompt: v.prompt } : null,
          speech: v ? startSpeech(v, false) : null,
          plannedWords: words,
          seeded: !!run?.seeded,
        };
      });
      res.json({ personId: actor.personId, days: out });
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

  return { app, service, metrics, sandboxes, handler };
}
