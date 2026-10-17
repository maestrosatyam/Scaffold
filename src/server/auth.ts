// Who is calling. Each bearer token maps to an Actor: whose data (personId), who acts (actorId)
// and in which role. The MCP tool list is built per actor, so a learner token never even sees
// coach tools (least privilege by construction, not by convention).
//
// This is deliberately simple static-token auth for a self-hosted demo. A production Alexa+
// add-on would use account linking (OAuth 2.1 authorization_code + PKCE) and map the linked
// account to the same Actor shape; see architecture/DECISIONS.md.

import type { Actor } from '../core/model.ts';
import { DEMO_COACH, DEMO_PERSON } from '../demo/seed.ts';

export interface AuthConfig {
  tokens: Map<string, Actor>;
  /** Actor used when no Authorization header is sent (local demo / generic MCP clients). */
  anonymous: Actor | null;
}

const DEMO_LEARNER: Actor = {
  personId: DEMO_PERSON.personId,
  actorId: DEMO_PERSON.personId,
  role: 'learner',
  displayName: DEMO_PERSON.displayName,
};
const DEMO_COACH_ACTOR: Actor = {
  personId: DEMO_PERSON.personId,
  actorId: DEMO_COACH.coachId,
  role: 'coach',
  displayName: DEMO_COACH.displayName,
};

/**
 * SCAFFOLD_TOKENS format: comma-separated `token=personId:role:actorId`, e.g.
 *   "s3cr3t-learner=sam:learner:sam,s3cr3t-coach=sam:coach:priya"
 * SCAFFOLD_ANONYMOUS: "learner" (default for local demo) | "none"
 */
export function authFromEnv(env: NodeJS.ProcessEnv): AuthConfig {
  const tokens = new Map<string, Actor>();
  const spec = env.SCAFFOLD_TOKENS ?? 'demo-learner=sam:learner:sam,demo-coach=sam:coach:priya';
  for (const entry of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [token, rest] = entry.split('=');
    const [personId, role, actorId] = (rest ?? '').split(':');
    if (!token || !personId || (role !== 'learner' && role !== 'coach') || !actorId) {
      throw new Error(`Bad SCAFFOLD_TOKENS entry: ${entry.replace(/^[^=]*/, '<token>')}`);
    }
    const base = role === 'coach' ? DEMO_COACH_ACTOR : DEMO_LEARNER;
    tokens.set(token, { personId, role, actorId, displayName: actorId === base.actorId ? base.displayName : actorId });
  }
  const anon = (env.SCAFFOLD_ANONYMOUS ?? 'learner').toLowerCase();
  return { tokens, anonymous: anon === 'none' ? null : DEMO_LEARNER };
}

export type AuthResult = { ok: true; actor: Actor } | { ok: false; status: 401; message: string };

export function authenticate(
  cfg: AuthConfig,
  authorization: string | null | undefined,
  sandboxes?: SandboxRegistry,
  nowMs = Date.now(),
): AuthResult {
  if (!authorization) {
    return cfg.anonymous ? { ok: true, actor: cfg.anonymous } : { ok: false, status: 401, message: 'Missing bearer token' };
  }
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  const token = m?.[1]?.trim();
  const actor = token ? (cfg.tokens.get(token) ?? sandboxes?.lookup(token, nowMs)) : undefined;
  if (!actor) return { ok: false, status: 401, message: 'Invalid bearer token' };
  return { ok: true, actor };
}

/**
 * Short-lived demo sandboxes: each browser visitor gets their own seeded person and a pair of
 * random learner/coach tokens, so concurrent judges never see each other's state.
 */
export class SandboxRegistry {
  private sessions = new Map<string, { actor: Actor; expires: number }>();
  private readonly ttlMs: number;
  private readonly max: number;

  constructor(ttlMs = 6 * 60 * 60 * 1000, max = 500) {
    this.ttlMs = ttlMs;
    this.max = max;
  }

  create(personId: string, nowMs: number, token: () => string): { learnerToken: string; coachToken: string } {
    this.sweep(nowMs);
    if (this.sessions.size >= this.max * 2) throw new Error('Too many demo sandboxes; try again later');
    const learnerToken = token();
    const coachToken = token();
    const expires = nowMs + this.ttlMs;
    this.sessions.set(learnerToken, { actor: { ...DEMO_LEARNER, personId, actorId: personId }, expires });
    this.sessions.set(coachToken, { actor: { ...DEMO_COACH_ACTOR, personId }, expires });
    return { learnerToken, coachToken };
  }

  lookup(token: string, nowMs: number): Actor | undefined {
    const s = this.sessions.get(token);
    if (!s) return undefined;
    if (s.expires < nowMs) {
      this.sessions.delete(token);
      return undefined;
    }
    return s.actor;
  }

  /** Person ids whose sandboxes have expired (so callers can drop their streams). */
  sweep(nowMs: number): string[] {
    const dead: string[] = [];
    for (const [t, s] of this.sessions) {
      if (s.expires < nowMs) {
        this.sessions.delete(t);
        dead.push(s.actor.personId);
      }
    }
    return dead;
  }
}
