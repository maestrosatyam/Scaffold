// Shared helpers for the adversarial review tests (tests/review/*.test.ts).
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { apply, emptyState, type Ctx } from '../../src/core/engine.ts';
import type { NewEvent, ScaffoldEvent } from '../../src/core/model.ts';
import { MORNING } from '../../src/demo/seed.ts';
import { createApp, type AppConfig } from '../../src/server/app.ts';
import { authFromEnv } from '../../src/server/auth.ts';
import { realClock } from '../../src/server/service.ts';
import { MemoryStore, type EventStore } from '../../src/store/store.ts';

export const TZ = 'America/Los_Angeles';

export async function startApp(over: Partial<AppConfig> = {}) {
  const store: EventStore = over.store ?? new MemoryStore();
  const created = createApp({
    host: '127.0.0.1',
    store,
    clock: realClock,
    timeZone: TZ,
    auth: authFromEnv({ SCAFFOLD_TOKENS: 'L=sam:learner:sam,C=sam:coach:priya' } as NodeJS.ProcessEnv),
    demo: true,
    demoStartTime: '07:24',
    // Instances of one deployment share the token secret (SCAFFOLD_TOKEN_SECRET), as on Lambda.
    tokenSecret: 'review-shared-secret-0123456789abcdef',
    webDir: '/nonexistent',
    appsDir: '/nonexistent',
    ...over,
  });
  const server: Server = created.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = () => new Promise<void>((r) => server.close(() => r()));
  return { created, store, base, close };
}

export async function connect(base: string, token?: string) {
  const client = new Client({ name: 'scaffold-review', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}

export type SC = Record<string, any>;
export const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = await c.callTool({ name, arguments: args });
  return { raw: r as SC, sc: (r.structuredContent ?? {}) as SC, text: ((r.content as SC[])?.[0]?.text ?? '') as string };
};

export const sandbox = async (base: string) => (await fetch(`${base}/api/demo/sandbox`, { method: 'POST' })).json() as Promise<SC>;

/** Pure-engine harness: an in-memory log + projection for one person with the MORNING routine. */
export function harness(personId = 'sam') {
  const events: ScaffoldEvent[] = [];
  const state = emptyState(personId);
  let t = Date.parse('2026-10-18T14:00:00Z');
  let n = 0;
  const ctx = (): Ctx => ({ now: new Date((t += 30_000)).toISOString(), actorId: personId, newId: (p) => `${p}-${personId}-${++n}` });
  const push = (es: NewEvent[]) => {
    for (const e of es) {
      const full = { ...e, seq: events.length + 1 } as ScaffoldEvent;
      events.push(full);
      apply(state, full, { timeZone: TZ });
    }
  };
  push([
    { type: 'person.registered', personId, displayName: 'Sam', coachIds: ['priya'], at: ctx().now, actorId: personId },
    { type: 'routine.published', routine: MORNING, version: 1, at: ctx().now, actorId: personId },
  ]);
  return { events, state, ctx, push, advanceDays: (d: number) => (t += d * 86_400_000) };
}

/** A store that answers like a network store (DynamoDB): every call yields to the event loop. */
export class LatencyStore extends MemoryStore {
  private readonly ms: number;
  constructor(ms = 15) {
    super();
    this.ms = ms;
  }
  override async load(personId: string, afterSeq?: number) {
    const out = await super.load(personId, afterSeq);
    await new Promise((r) => setTimeout(r, this.ms));
    return out;
  }
  override async append(personId: string, events: readonly NewEvent[], expectedLastSeq: number) {
    const out = await super.append(personId, events, expectedLastSeq);
    await new Promise((r) => setTimeout(r, this.ms));
    return out;
  }
}
