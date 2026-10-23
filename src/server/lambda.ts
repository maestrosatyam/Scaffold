// AWS Lambda entry point (Function URL). The same Express app as local, wrapped by serverless-http;
// state lives in DynamoDB (SCAFFOLD_STORE=dynamodb). Tool responses are small and immediate, so a
// buffered (non-streaming) Lambda response carries the Streamable HTTP reply unchanged.
import { randomBytes } from 'node:crypto';
import type { OutgoingHttpHeaders } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import serverless from 'serverless-http';
import { resolve } from 'node:path';
import { packageRoot } from './root.ts';
import { buildSeedEvents, localYmd, DEMO_PERSON } from '../demo/seed.ts';
import { DynamoStore } from '../store/dynamo.ts';
import { authFromEnv } from './auth.ts';
import { createApp } from './app.ts';
import { realClock } from './service.ts';

const root = packageRoot();
const env = process.env;
const timeZone = env.SCAFFOLD_TZ ?? 'America/Los_Angeles';
const store = DynamoStore.fromEnv(env);
/** Comma list -> array; empty or unset -> undefined (an empty allowlist would reject everything). */
const list = (v: string | undefined) => {
  const items = v?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  return items.length ? items : undefined;
};

// A public Function URL must not hand out the shared demo learner to unauthenticated callers.
const auth = authFromEnv({ ...env, SCAFFOLD_ANONYMOUS: env.SCAFFOLD_ANONYMOUS ?? 'none' });
if (!env.SCAFFOLD_TOKEN_SECRET) {
  console.warn('[scaffold] SCAFFOLD_TOKEN_SECRET is not set: demo sandbox tokens will only work on this instance.');
}

const { app } = createApp({
  host: '0.0.0.0',
  store,
  clock: realClock,
  timeZone,
  auth,
  demo: env.SCAFFOLD_DEMO !== '0',
  demoStartTime: env.SCAFFOLD_DEMO_START === 'real' ? null : (env.SCAFFOLD_DEMO_START ?? '07:24'),
  tokenSecret: env.SCAFFOLD_TOKEN_SECRET || randomBytes(32).toString('hex'),
  // Function URL hostnames are only known after deploy; pin them via ALLOWED_HOSTS on update.
  allowedHosts: list(env.ALLOWED_HOSTS),
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  webDir: resolve(root, 'dist/web'),
  appsDir: resolve(root, 'dist/apps'),
});

// Seed the shared demo person once per instance; a failed attempt is retried on the next request.
let seeded: Promise<void> | null = null;
const ensureSeed = (): Promise<void> =>
  (seeded ??= (async () => {
    if ((await store.load(DEMO_PERSON.personId)).length === 0) {
      await store.replace(DEMO_PERSON.personId, buildSeedEvents({ today: localYmd(Date.now(), timeZone), timeZone }));
    }
  })().catch((err) => {
    seeded = null;
    throw err;
  }));

// serverless-http returns only the headers Node recorded (res.getHeaders()). Node does not record
// headers passed straight to writeHead() unless setHeader() ran first, and Express replaces
// serverless-http's writeHead override when it re-prototypes the response. The MCP SDK sets its
// headers that way, so /mcp would answer an SSE body as application/json. Record them first.
const outer = express();
outer.disable('x-powered-by');
outer.use((_req: Request, res: Response, next: NextFunction) => {
  const writeHead = res.writeHead;
  res.writeHead = function (this: Response, status: number, ...rest: unknown[]) {
    const reason = typeof rest[0] === 'string' ? rest[0] : undefined;
    const headers = (reason === undefined ? rest[0] : rest[1]) as OutgoingHttpHeaders | undefined;
    if (headers && !Array.isArray(headers)) {
      for (const [name, value] of Object.entries(headers)) if (value !== undefined) this.setHeader(name, value);
    }
    return (writeHead as (code: number, reason?: string) => Response).call(this, status, reason);
  } as typeof res.writeHead;
  next();
});
outer.use(app);

const wrapped = serverless(outer, {
  // serverless-http builds a synthetic request without rawHeaders; the MCP Node transport reads them.
  request(req: { headers: Record<string, string | string[] | undefined>; rawHeaders?: string[] }) {
    if (!req.rawHeaders || req.rawHeaders.length === 0) {
      req.rawHeaders = Object.entries(req.headers).flatMap(([k, v]) =>
        v === undefined ? [] : Array.isArray(v) ? v.flatMap((x) => [k, x]) : [k, String(v)],
      );
    }
  },
});

export const handler = async (event: { rawPath?: string }, context: unknown) => {
  if (event?.rawPath !== '/healthz') {
    try {
      await ensureSeed();
    } catch (err) {
      console.error('[scaffold] demo seed failed (will retry):', err);
    }
  }
  return wrapped(event as never, context as never);
};
