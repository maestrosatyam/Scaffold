// AWS Lambda entry point (Function URL). The same Express app as local, wrapped by serverless-http;
// state lives in DynamoDB (SCAFFOLD_STORE=dynamodb). Tool responses are small and immediate, so a
// buffered (non-streaming) Lambda response carries the Streamable HTTP reply unchanged.
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
const list = (v: string | undefined) => v?.split(',').map((s) => s.trim()).filter(Boolean);

const { app } = createApp({
  host: '0.0.0.0',
  store,
  clock: realClock,
  timeZone,
  auth: authFromEnv(env),
  demo: env.SCAFFOLD_DEMO !== '0',
  demoStartTime: env.SCAFFOLD_DEMO_START === 'real' ? null : (env.SCAFFOLD_DEMO_START ?? '07:24'),
  // Function URL hostnames are only known after deploy; pin them via ALLOWED_HOSTS on update.
  allowedHosts: list(env.ALLOWED_HOSTS),
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  webDir: resolve(root, 'dist/web'),
  appsDir: resolve(root, 'dist/apps'),
});

let seeded: Promise<void> | null = null;
const ensureSeed = () =>
  (seeded ??= (async () => {
    if ((await store.load(DEMO_PERSON.personId)).length === 0) {
      await store.replace(DEMO_PERSON.personId, buildSeedEvents({ today: localYmd(Date.now(), timeZone), timeZone }));
    }
  })());

const wrapped = serverless(app);
export const handler = async (event: unknown, context: unknown) => {
  await ensureSeed();
  return wrapped(event as never, context as never);
};
