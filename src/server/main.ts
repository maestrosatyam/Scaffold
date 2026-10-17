// Entry point: `node src/server/main.ts` (Node >= 22.18 runs TypeScript directly).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { packageRoot } from './root.ts';
import { buildSeedEvents, localYmd, DEMO_PERSON } from '../demo/seed.ts';
import { MemoryStore, type EventStore } from '../store/store.ts';
import { authFromEnv } from './auth.ts';
import { createApp } from './app.ts';
import { realClock } from './service.ts';

const root = packageRoot();
const env = process.env;

async function openStore(): Promise<EventStore> {
  const kind = (env.SCAFFOLD_STORE ?? 'sqlite').toLowerCase();
  if (kind === 'memory') return new MemoryStore();
  if (kind === 'dynamodb') {
    const { DynamoStore } = await import('../store/dynamo.ts');
    return DynamoStore.fromEnv(env);
  }
  const { SqliteStore } = await import('../store/sqlite.ts');
  return new SqliteStore(env.SCAFFOLD_DB ?? resolve(root, 'data/scaffold.db'));
}

const host = env.HOST ?? '127.0.0.1';
const port = Number(env.PORT ?? 8787);
const timeZone = env.SCAFFOLD_TZ ?? 'America/Los_Angeles';
/** Comma list -> array; empty or unset -> undefined (an empty allowlist would reject everything). */
const list = (v: string | undefined) => {
  const items = v?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  return items.length ? items : undefined;
};

/** Local token secret: env, else persisted under data/ so sandbox tokens survive restarts. */
function tokenSecret(): string {
  if (env.SCAFFOLD_TOKEN_SECRET) return env.SCAFFOLD_TOKEN_SECRET;
  const file = resolve(root, 'data/.token-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dirname(file), { recursive: true });
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const store = await openStore();
const { app } = createApp({
  host,
  store,
  clock: realClock,
  timeZone,
  auth: authFromEnv(env),
  demo: env.SCAFFOLD_DEMO !== '0',
  demoStartTime: env.SCAFFOLD_DEMO_START === 'real' ? null : (env.SCAFFOLD_DEMO_START ?? '07:24'),
  tokenSecret: tokenSecret(),
  allowedHosts: list(env.ALLOWED_HOSTS),
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  webDir: resolve(root, 'dist/web'),
  appsDir: resolve(root, 'dist/apps'),
});

// The shared demo person (used by generic MCP clients with no token) is seeded on first boot.
if ((await store.load(DEMO_PERSON.personId)).length === 0) {
  await store.replace(DEMO_PERSON.personId, buildSeedEvents({ today: localYmd(Date.now(), timeZone), timeZone }));
  console.log(`Seeded demo person "${DEMO_PERSON.personId}" with 21 days of synthetic history`);
}

const server = app.listen(port, host, () => {
  console.log(`Scaffold MCP server on http://${host}:${port}  (MCP: /mcp, store: ${store.kind}, tz: ${timeZone})`);
});
const shutdown = async () => {
  server.close();
  await store.close?.();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
