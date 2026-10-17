// Adversarial review: HTTP composition (src/server/app.ts, auth.ts, mcp.ts) over real sockets.
import { describe, expect, it } from 'vitest';
import { apply, cmdSkip, cmdStartRun, project, type Ctx } from '../../src/core/engine.ts';
import type { NewEvent, ScaffoldEvent } from '../../src/core/model.ts';
import { buildSeedEvents, localYmd } from '../../src/demo/seed.ts';
import { authFromEnv, SandboxTokens } from '../../src/server/auth.ts';
import { fixedClock } from '../../src/server/service.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { TZ, call, connect, sandbox, startApp } from './helpers.ts';

const MCP = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' };

describe('authorization', () => {
  it('R-07: a sandbox token issued by one instance is accepted by another instance sharing the store (Lambda scale-out)', async () => {
    const store = new MemoryStore();
    const a = await startApp({ store });
    const b = await startApp({ store }); // second Lambda execution environment, same DynamoDB table
    try {
      const sb = await sandbox(a.base);
      const res = await fetch(`${b.base}/api/debug/events`, { headers: { authorization: `Bearer ${sb.learnerToken}` } });
      expect(res.status).toBe(200);
      // ...and the demo clock anchor must agree too (anchors live in instance memory as well).
      const ia = await (await fetch(`${a.base}/api/info`, { headers: { authorization: `Bearer ${sb.learnerToken}` } })).json();
      const ib = await (await fetch(`${b.base}/api/info`, { headers: { authorization: `Bearer ${sb.learnerToken}` } })).json();
      expect(ib.clock).toBe(ia.clock);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("R-08: a learner token cannot read the coach's private set_step_level reason via /api/debug/events", async () => {
    const app = await startApp();
    try {
      const sb = await sandbox(app.base);
      const coach = await connect(app.base, sb.coachToken);
      const secret = 'Family meeting: Sam had a seizure on Tuesday';
      const set = await call(coach, 'set_step_level', { routine: 'morning', step_id: 'door', level: 'full', reason: secret });
      expect(set.raw.isError).toBeFalsy();
      // The learner's MCP tool list has no explain_step / independence_report ("least privilege by construction")...
      const res = await fetch(`${app.base}/api/debug/events`, { headers: { authorization: `Bearer ${sb.learnerToken}` } });
      // ...but the raw coach audit is one GET away.
      expect(await res.text()).not.toContain(secret);
      await coach.close();
    } finally {
      await app.close();
    }
  });

  it('R-08: with no Authorization header at all, /api/debug/events does not return the shared person\'s full log', async () => {
    const store = new MemoryStore();
    await store.replace('sam', buildSeedEvents({ today: localYmd(Date.now(), TZ), timeZone: TZ }));
    const app = await startApp({ store, auth: authFromEnv({} as NodeJS.ProcessEnv) });
    try {
      const res = await fetch(`${app.base}/api/debug/events`);
      expect(res.status).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe('error handling / MCP transport compliance', () => {
  it('R-09: malformed JSON on /mcp gets a JSON-RPC Parse error (-32700), not an HTML page with a server stack trace', async () => {
    const app = await startApp();
    try {
      const res = await fetch(`${app.base}/mcp`, { method: 'POST', headers: MCP, body: '{"jsonrpc":' });
      const text = await res.text();
      expect(text).not.toMatch(/node_modules|at JSON\.parse/); // THREAT_MODEL T8: "Error messages carry no stack traces"
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      expect(JSON.parse(text).error.code).toBe(-32700);
    } finally {
      await app.close();
    }
  });

  it('R-09: a refused sandbox (cap reached) is a JSON 429/503, not an HTML 500 with a stack trace', async () => {
    // Fix design: sandboxes are stateless signed tokens; the cap is a rate limit checked before any write.
    const app = await startApp({ sandboxLimits: { perIp: 1, total: 1 } });
    try {
      await (await fetch(`${app.base}/api/demo/sandbox`, { method: 'POST' })).arrayBuffer();
      const res = await fetch(`${app.base}/api/demo/sandbox`, { method: 'POST' });
      const text = await res.text();
      expect(text).not.toMatch(/node_modules|src\/server/);
      expect([429, 503]).toContain(res.status);
    } finally {
      await app.close();
    }
  });

  it('R-12: tool calls with run_id "__proto__"/"constructor" fail with a domain message, not a leaked TypeError', async () => {
    const app = await startApp();
    try {
      const sb = await sandbox(app.base);
      const l = await connect(app.base, sb.learnerToken);
      const r1 = await call(l, 'step_done', { run_id: '__proto__', step_id: 'teeth' });
      const r2 = await call(l, 'repeat_step', { run_id: 'constructor' });
      const r3 = await call(l, 'decide_suggestion', { proposal_id: 'toString', decision: 'approved' });
      for (const r of [r1, r2, r3]) {
        expect(r.raw.isError).toBe(true);
        expect(r.text).not.toMatch(/Cannot read properties|undefined/);
      }
      await l.close();
    } finally {
      await app.close();
    }
  });
});

describe('demo endpoints on a public deployment', () => {
  it('R-10: when the sandbox cap is reached, nothing is written to the store and no clock anchor is leaked', async () => {
    let writes = 0;
    class CountingStore extends MemoryStore {
      override async replace(personId: string, events: readonly ScaffoldEvent[]) {
        if (events.length) writes++;
        return super.replace(personId, events);
      }
    }
    const app = await startApp({ store: new CountingStore(), sandboxLimits: { perIp: 1, total: 1 } });
    try {
      for (let i = 0; i < 6; i++) await (await fetch(`${app.base}/api/demo/sandbox`, { method: 'POST' })).arrayBuffer();
      expect(writes).toBe(1); // only the one allowed sandbox is written; refused requests write nothing
      // Demo clocks now live in each sandbox's own event stream, not in instance memory.
      expect((app.created.service as unknown as { anchors?: Map<string, unknown> }).anchors).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('R-10: expired sandboxes stop authenticating and their streams are deleted by the store (TTL / sweep)', async () => {
    // Fix design: no in-memory registry to leak. Tokens carry their expiry; streams carry expiresAtMs.
    const tokens = new SandboxTokens('review-shared-secret-0123456789abcdef', 1000);
    const { learnerToken } = tokens.issuePair('sam-deadbeef00', 0);
    expect(tokens.verify(learnerToken, 500)?.personId).toBe('sam-deadbeef00');
    expect(tokens.verify(learnerToken, 5000)).toBeUndefined();
    const forged = learnerToken.replace(/\.[^.]+$/, '.AAAA');
    expect(tokens.verify(forged, 500)).toBeUndefined();
    const store = new MemoryStore();
    await store.replace('sam-deadbeef00', [{ type: 'run.finished', runId: 'r', at: 'x', actorId: 'a', seq: 1 } as ScaffoldEvent], { expiresAtMs: Date.now() - 1 });
    await store.replace('sam-other', []);
    expect(await store.load('sam-deadbeef00')).toEqual([]);
  });

  it('R-11: /api/demo/replay stays inside the 500 ms budget for a person with ~300 runs (it re-projects the log once per run)', async () => {
    const store = new MemoryStore();
    const events: ScaffoldEvent[] = buildSeedEvents({ today: localYmd(Date.now(), TZ), timeZone: TZ });
    const st = project('sam', events, { timeZone: TZ });
    let t = Date.now() - 40 * 86_400_000;
    let k = 0;
    const ctx = (): Ctx => ({ now: new Date((t += 1000)).toISOString(), actorId: 'sam', newId: (p) => `${p}-x${++k}` });
    const push = (es: NewEvent[]) => {
      for (const e of es) {
        const full = { ...e, seq: events.length + 1 } as ScaffoldEvent;
        events.push(full);
        apply(st, full, { timeZone: TZ });
      }
    };
    // ~300 runs: what an anonymous caller can build with ~2,400 cheap tool calls (start + 6 x skip).
    for (let i = 0; i < 300; i++) {
      const s = cmdStartRun(st, ctx(), { routineRef: 'morning', device: 'x' });
      push(s.events);
      for (let j = 0; j < 6; j++) push(cmdSkip(st, ctx(), { runId: s.runId, reason: 'asked' }));
    }
    await store.replace('sam', events);
    const app = await startApp({ store, demoStartTime: null });
    try {
      const t0 = performance.now();
      const res = await fetch(`${app.base}/api/demo/replay`, { headers: { authorization: 'Bearer L' } });
      await res.json();
      expect(performance.now() - t0).toBeLessThan(500);
    } finally {
      await app.close();
    }
  });
});

describe('speech honesty over MCP', () => {
  it('R-17: a retried step_done on a run that was abandoned does not tell the person they are "on" a step of the dead run', async () => {
    const clock = fixedClock(new Date());
    const app = await startApp({ clock, demoStartTime: null });
    try {
      const sb = await sandbox(app.base);
      const l = await connect(app.base, sb.learnerToken);
      const old = (await call(l, 'start_routine', { routine: 'morning' })).sc.run.run_id;
      await call(l, 'step_done', { run_id: old, step_id: 'teeth' });
      clock.advance(4 * 60 * 60 * 1000); // > STALE_RUN_MS
      const fresh = await call(l, 'start_routine', { routine: 'morning' }); // abandons `old`
      expect(fresh.sc.run.run_id).not.toBe(old);
      const retry = await call(l, 'step_done', { run_id: old, step_id: 'teeth' });
      expect(retry.sc.run?.status).toBe('abandoned');
      expect(retry.sc.speech).not.toMatch(/You're on wash face/);
      await l.close();
    } finally {
      await app.close();
    }
  });

  it('R-18: declining a suggestion does not promise a notification that no code sends', async () => {
    const app = await startApp();
    try {
      const sb = await sandbox(app.base);
      const coach = await connect(app.base, sb.coachToken);
      const learner = await connect(app.base, sb.learnerToken);
      const { LAUNDRY_TEMPLATE } = await import('../../src/demo/seed.ts');
      const sent = await call(coach, 'suggest_routine', { routine: LAUNDRY_TEMPLATE, note: '' });
      const no = await call(learner, 'decide_suggestion', { proposal_id: sent.sc.proposal_id, decision: 'declined' });
      expect(no.sc.speech).not.toMatch(/I'll let .* know/);
      await Promise.all([coach.close(), learner.close()]);
    } finally {
      await app.close();
    }
  });

  it('R-21: need_help with a step_id that is still ahead does not claim "That step is already finished."', async () => {
    const app = await startApp();
    try {
      const sb = await sandbox(app.base);
      const l = await connect(app.base, sb.learnerToken);
      const run = (await call(l, 'start_routine', { routine: 'morning' })).sc.run.run_id;
      const r = await call(l, 'need_help', { run_id: run, step_id: 'door' }); // current step is teeth
      expect(r.text).not.toBe('That step is already finished.');
      await l.close();
    } finally {
      await app.close();
    }
  });
});

describe('small speech / config defects', () => {
  it('R-25: skipping a step before an independent step does not say "Okay" twice', async () => {
    const app = await startApp();
    try {
      const sb = await sandbox(app.base);
      const l = await connect(app.base, sb.learnerToken);
      const run = (await call(l, 'start_routine', { routine: 'morning' })).sc.run.run_id; // teeth, face are independent
      const r = await call(l, 'skip_step', { run_id: run, step_id: 'teeth' });
      expect(r.sc.speech).not.toMatch(/Okay.*Okay\./);
      await l.close();
    } finally {
      await app.close();
    }
  });

  it('R-26: a malformed SCAFFOLD_DEMO_START ("7") is rejected at startup instead of breaking every sandbox tool call', async () => {
    let app: Awaited<ReturnType<typeof startApp>> | undefined;
    try {
      app = await startApp({ demoStartTime: '7' });
    } catch {
      return; // fixed: refused at startup
    }
    try {
      const res = await fetch(`${app.base}/api/demo/sandbox`, { method: 'POST' });
      expect(res.status).toBe(200); // today: 500 (NaN anchor)
      const sb = await res.json();
      const l = await connect(app.base, sb.learnerToken);
      const r = await call(l, 'start_routine', { routine: 'morning' });
      expect(r.text).not.toMatch(/Invalid time value/);
      expect(r.raw.isError).toBeFalsy();
      await l.close();
    } finally {
      await app.close();
    }
  });
});
