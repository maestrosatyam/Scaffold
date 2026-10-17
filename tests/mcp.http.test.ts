// End-to-end over real HTTP: the official MCP TypeScript client talks Streamable HTTP to the
// Scaffold server (same code path an Alexa+-style client or MCP Inspector would use).
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.ts';
import { authFromEnv } from '../src/server/auth.ts';
import { realClock } from '../src/server/service.ts';
import { MemoryStore } from '../src/store/store.ts';
import { buildSeedEvents, localYmd } from '../src/demo/seed.ts';

const TZ = 'America/Los_Angeles';
let server: Server;
let base: string;
let created: ReturnType<typeof createApp>;
const store = new MemoryStore();

beforeAll(async () => {
  await store.replace('sam', buildSeedEvents({ today: localYmd(Date.now(), TZ), timeZone: TZ }));
  created = createApp({
    host: '127.0.0.1',
    store,
    clock: realClock,
    timeZone: TZ,
    auth: authFromEnv({ SCAFFOLD_TOKENS: 'L=sam:learner:sam,C=sam:coach:priya' } as NodeJS.ProcessEnv),
    demo: true,
    demoStartTime: '07:24',
    webDir: '/nonexistent',
    appsDir: '/nonexistent',
  });
  server = created.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function connect(token?: string) {
  const client = new Client({ name: 'scaffold-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}

type SC = Record<string, any>;
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = await c.callTool({ name, arguments: args });
  return { raw: r, sc: (r.structuredContent ?? {}) as SC };
};

describe('protocol & transport', () => {
  it('negotiates MCP 2025-11-25 over Streamable HTTP (raw initialize)', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const json = JSON.parse(text.includes('data:') ? text.split('data: ')[1]!.split('\n')[0]! : text);
    expect(json.result.protocolVersion).toBe('2025-11-25');
    expect(json.result.serverInfo.name).toBe('scaffold');
    expect(json.result.instructions).toMatch(/exactly as written/);
  });

  it('rejects a foreign Origin (DNS-rebinding protection) with 403', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: 'https://evil.example' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects an invalid bearer token with 401 and no WWW-Authenticate challenge', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer nope' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
  });

  it('rejects an unsupported MCP-Protocol-Version header with 400', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '1999-01-01' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(res.status).toBe(400);
  });

  it('serves JSON-only clients on /mcp-json', async () => {
    const res = await fetch(`${base}/mcp-json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } }),
    });
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect((await res.json()).result.protocolVersion).toBe('2025-11-25');
  });
});

describe('role-scoped tools', () => {
  it('learner sees learner tools only; coach sees coach tools only', async () => {
    const learner = await connect('L');
    const coach = await connect('C');
    const lt = (await learner.listTools()).tools.map((t) => t.name).sort();
    const ct = (await coach.listTools()).tools.map((t) => t.name).sort();
    expect(lt).toEqual(['decide_suggestion', 'list_routines', 'my_progress', 'need_help', 'repeat_step', 'review_suggestions', 'running_late', 'skip_step', 'start_routine', 'step_done', 'where_was_i']);
    expect(ct).toEqual(['explain_step', 'independence_report', 'list_routines', 'list_suggestions', 'set_step_level', 'suggest_routine']);
    const start = (await learner.listTools()).tools.find((t) => t.name === 'start_routine')!;
    expect(start.outputSchema).toBeTruthy();
    expect((start._meta as SC).ui.resourceUri).toBe('ui://scaffold/step-card.html');
    await learner.close();
    await coach.close();
  });

  it('a learner cannot call a coach tool', async () => {
    const learner = await connect('L');
    const r = await learner.callTool({ name: 'set_step_level', arguments: { step_id: 'teeth', level: 'full', reason: 'test' } }).catch((e) => e);
    const failed = r instanceof Error || (r as SC).isError === true;
    expect(failed).toBe(true);
    await learner.close();
  });

  it('exposes MCP Apps ui:// resources with the MCP Apps MIME type', async () => {
    const learner = await connect('L');
    const res = await learner.readResource({ uri: 'ui://scaffold/step-card.html' });
    expect(res.contents[0]!.mimeType).toBe('text/html;profile=mcp-app');
    await learner.close();
  });
});

describe('the headline workflow over MCP', () => {
  it('start → fading levels → retry-safe done → help → resume in another room → finish → coach report', async () => {
    const sb = await (await fetch(`${base}/api/demo/sandbox`, { method: 'POST' })).json();
    const learner = await connect(sb.learnerToken);
    const coach = await connect(sb.coachToken);

    // Seeded history says: teeth/face/breakfast independent, dress cue, bag partial, door cue.
    const s1 = await call(learner, 'start_routine', { routine: 'morning', device: 'bedroom' });
    expect(s1.sc.step.step_id).toBe('teeth');
    expect(s1.sc.step.level).toBe('independent');
    expect(s1.sc.speech).toBe("Okay, morning routine. I'm here if you need me.");
    const runId = s1.sc.run.run_id;

    const d1 = await call(learner, 'step_done', { run_id: runId, step_id: 'teeth' });
    expect(d1.sc.step.step_id).toBe('face');
    // Retry of the same completion (e.g. assistant timeout) must not skip "face".
    const retry = await call(learner, 'step_done', { run_id: runId, step_id: 'teeth' });
    expect(retry.sc.duplicate).toBe(true);
    expect(retry.sc.step.step_id).toBe('face');

    await call(learner, 'step_done', { run_id: runId, step_id: 'face' });
    const dress = (await call(learner, 'repeat_step', { run_id: runId })).sc;
    expect(dress.step.level).toBe('cue');
    expect(dress.speech).toBe('Clothes on the chair.');
    await call(learner, 'step_done', { run_id: runId, step_id: 'dress' });
    const bag = await call(learner, 'step_done', { run_id: runId, step_id: 'breakfast' });
    expect(bag.sc.step.step_id).toBe('bag');
    expect(bag.sc.step.level).toBe('partial');
    expect(bag.sc.speech).toBe('Pack your lunch box, bus pass and phone in your bag.');

    const help = await call(learner, 'need_help', { run_id: runId, step_id: 'bag' });
    expect(help.sc.step.level).toBe('full');
    expect(help.sc.step.base_level).toBe('partial');
    expect(help.sc.speech).toMatch(/^Step 5 of 6\. Open your bag\./);

    // Walk to the kitchen: resume on a different device.
    const where = await call(learner, 'where_was_i', { device: 'kitchen' });
    expect(where.sc.run.run_id).toBe(runId);
    expect(where.sc.run.devices).toEqual(['bedroom', 'kitchen']);
    expect(where.sc.speech).toMatch(/^You've done 4 of 6\. Next is pack your bag\./);

    await call(learner, 'step_done', { run_id: runId, step_id: 'bag' });
    const fin = await call(learner, 'step_done', { run_id: runId, step_id: 'door' });
    expect(fin.sc.run.status).toBe('finished');
    expect(fin.sc.step).toBeNull();
    expect(fin.sc.speech).toMatch(/^Nice, you're done at 7:\d\d AM\./); // demo clock anchored at 07:24

    const rep = await call(coach, 'independence_report', { routine: 'morning' });
    expect(rep.sc.live_runs).toBe(1);
    expect(rep.sc.seeded_runs).toBe(21);
    expect(rep.sc.attention.map((a: SC) => a.step_id)).toContain('bag');
    expect(rep.sc.headline).toMatch(/Spoken prompting fell from \d+ words to \d+ words per run/);

    const why = await call(coach, 'explain_step', { routine: 'morning', step_id: 'teeth' });
    expect(why.sc.level).toBe('independent');
    expect(why.sc.changes.map((c: SC) => c.to)).toEqual(['partial', 'cue', 'independent']);

    // Replay endpoint reproduces Day 1 / Day 10 / Day 21 from the same log.
    const replay = await (await fetch(`${base}/api/demo/replay`, { headers: { authorization: `Bearer ${sb.coachToken}` } })).json();
    expect(replay.days[0].firstStep.level).toBe('full');
    expect(replay.days[9].firstStep.level).toBe('cue');
    expect(replay.days[20].firstStep.level).toBe('independent');
    await learner.close();
    await coach.close();
  });

  it('coach suggests a routine; it only exists after the learner approves by voice', async () => {
    const sb = await (await fetch(`${base}/api/demo/sandbox`, { method: 'POST' })).json();
    const learner = await connect(sb.learnerToken);
    const coach = await connect(sb.coachToken);
    const { LAUNDRY_TEMPLATE } = await import('../src/demo/seed.ts');
    const bad = await call(coach, 'suggest_routine', { routine: { ...LAUNDRY_TEMPLATE, steps: [LAUNDRY_TEMPLATE.steps[0], LAUNDRY_TEMPLATE.steps[0]] }, note: '' });
    expect(bad.sc.accepted).toBe(false);
    expect(bad.sc.issues.some((i: SC) => i.severity === 'error')).toBe(true);

    const sent = await call(coach, 'suggest_routine', { routine: LAUNDRY_TEMPLATE, note: 'Let us try it on Saturday.' });
    expect(sent.sc.accepted).toBe(true);
    const before = await call(learner, 'start_routine', { routine: 'laundry' });
    expect(before.raw.isError).toBe(true);

    const review = await call(learner, 'review_suggestions');
    expect(review.sc.speech).toMatch(/^Priya suggested a new routine: Laundry, with 4 steps\./);
    const decided = await call(learner, 'decide_suggestion', { proposal_id: sent.sc.proposal_id, decision: 'approved' });
    expect(decided.sc.published_version).toBe(1);
    const start = await call(learner, 'start_routine', { routine: 'laundry' });
    expect(start.sc.step.step_id).toBe('sort');
    expect(start.sc.step.level).toBe('full');
    await learner.close();
    await coach.close();
  });

  it('concurrent duplicate step_done calls advance exactly one step', async () => {
    const sb = await (await fetch(`${base}/api/demo/sandbox`, { method: 'POST' })).json();
    const a = await connect(sb.learnerToken);
    const b = await connect(sb.learnerToken);
    const s = await call(a, 'start_routine', {});
    const runId = s.sc.run.run_id;
    const results = await Promise.all([
      call(a, 'step_done', { run_id: runId, step_id: 'teeth' }),
      call(b, 'step_done', { run_id: runId, step_id: 'teeth' }),
      call(a, 'step_done', { run_id: runId, step_id: 'teeth' }),
    ]);
    expect(results.filter((r) => !r.sc.duplicate)).toHaveLength(1);
    const now = await call(a, 'repeat_step', { run_id: runId });
    expect(now.sc.step.step_id).toBe('face');
    await a.close();
    await b.close();
  });

  it('server-side tool latency stays far under the 500 ms Alexa+ budget', () => {
    const snap = created.metrics.snapshot();
    expect(snap.total.count).toBeGreaterThan(10);
    expect(snap.total.p95).toBeLessThan(500);
  });

  it('sandboxes are isolated from each other and from the shared demo person', async () => {
    const one = await (await fetch(`${base}/api/demo/sandbox`, { method: 'POST' })).json();
    const two = await (await fetch(`${base}/api/demo/sandbox`, { method: 'POST' })).json();
    expect(one.personId).not.toBe(two.personId);
    const c1 = await connect(one.learnerToken);
    await call(c1, 'start_routine', {});
    const ev2 = await (await fetch(`${base}/api/debug/events`, { headers: { authorization: `Bearer ${two.learnerToken}` } })).json();
    expect(ev2.events.some((e: SC) => e.type === 'run.started' && !e.seeded)).toBe(false);
    await c1.close();
  });
});
