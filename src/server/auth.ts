// Who is calling. Each bearer token maps to an Actor: whose data (personId), who acts (actorId)
// and in which role. The MCP tool list is built per actor, so a learner token never even sees
// coach tools (least privilege by construction, not by convention).
//
// This is deliberately simple static-token auth for a self-hosted demo. A production Alexa+
// add-on would use account linking (OAuth 2.1 authorization_code + PKCE) and map the linked
// account to the same Actor shape; see architecture/DECISIONS.md.

import { createHmac, timingSafeEqual } from 'node:crypto';
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
  // Unset -> built-in local demo tokens. Empty string -> no static tokens (use demo sandboxes).
  const spec = env.SCAFFOLD_TOKENS ?? 'demo-learner=sam:learner:sam,demo-coach=sam:coach:priya';
  for (const entry of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = entry.indexOf('=');
    const token = eq > 0 ? entry.slice(0, eq) : '';
    const rest = eq > 0 ? entry.slice(eq + 1) : '';
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
  sandboxes?: SandboxTokens,
  nowMs = Date.now(),
  opts: { allowAnonymous?: boolean } = {},
): AuthResult {
  if (!authorization) {
    if (opts.allowAnonymous === false) return { ok: false, status: 401, message: 'Missing bearer token' };
    return cfg.anonymous ? { ok: true, actor: cfg.anonymous } : { ok: false, status: 401, message: 'Missing bearer token' };
  }
  const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization.trim());
  const token = m?.[1];
  const actor = token ? (cfg.tokens.get(token) ?? sandboxes?.verify(token, nowMs)) : undefined;
  if (!actor) return { ok: false, status: 401, message: 'Invalid bearer token' };
  return { ok: true, actor };
}

/**
 * Stateless demo-sandbox tokens: `sbx.<claims>.<hmac>` where claims = {p: personId, r: role, e: expiry}.
 * Any instance holding the same secret can verify them, so sandboxes survive Lambda scale-out and
 * recycling (nothing about a sandbox lives in process memory; its data lives in the store).
 */
export class SandboxTokens {
  private readonly secret: Buffer;
  readonly ttlMs: number;

  constructor(secret: string | Buffer, ttlMs = 6 * 60 * 60 * 1000) {
    this.secret = Buffer.isBuffer(secret) ? secret : Buffer.from(secret, 'utf8');
    if (this.secret.length < 16) throw new Error('Sandbox token secret must be at least 16 bytes');
    this.ttlMs = ttlMs;
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  issue(personId: string, role: 'learner' | 'coach', nowMs: number): string {
    const body = Buffer.from(JSON.stringify({ p: personId, r: role, e: nowMs + this.ttlMs })).toString('base64url');
    return `sbx.${body}.${this.sign(body)}`;
  }

  issuePair(personId: string, nowMs: number): { learnerToken: string; coachToken: string; expiresAt: number } {
    return { learnerToken: this.issue(personId, 'learner', nowMs), coachToken: this.issue(personId, 'coach', nowMs), expiresAt: nowMs + this.ttlMs };
  }

  verify(token: string, nowMs: number): Actor | undefined {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'sbx') return undefined;
    const [, body, mac] = parts as [string, string, string];
    const want = Buffer.from(this.sign(body));
    const got = Buffer.from(mac);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return undefined;
    let claims: { p?: unknown; r?: unknown; e?: unknown };
    try {
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return undefined;
    }
    if (typeof claims.p !== 'string' || !/^sam-[a-f0-9]{8,32}$/.test(claims.p)) return undefined;
    if (typeof claims.e !== 'number' || claims.e < nowMs) return undefined;
    if (claims.r === 'learner') return { ...DEMO_LEARNER, personId: claims.p, actorId: claims.p };
    if (claims.r === 'coach') return { ...DEMO_COACH_ACTOR, personId: claims.p };
    return undefined;
  }
}

/** Fixed-window limiter for unauthenticated sandbox creation (per client key and per instance). */
export class RateLimiter {
  private hits = new Map<string, { windowStart: number; n: number }>();
  private readonly perKey: number;
  private readonly total: number;
  private readonly windowMs: number;

  constructor(perKey = 20, total = 300, windowMs = 60 * 60 * 1000) {
    this.perKey = perKey;
    this.total = total;
    this.windowMs = windowMs;
  }

  /** Returns true and records a hit if allowed. Nothing is recorded when refused. */
  take(key: string, nowMs: number): boolean {
    const bump = (k: string, limit: number): (() => void) | null => {
      const h = this.hits.get(k);
      const fresh = !h || nowMs - h.windowStart >= this.windowMs;
      const n = fresh ? 0 : h!.n;
      if (n >= limit) return null;
      return () => this.hits.set(k, { windowStart: fresh ? nowMs : h!.windowStart, n: n + 1 });
    };
    const a = bump(`k:${key}`, this.perKey);
    const b = bump('*', this.total);
    if (!a || !b) return false;
    a();
    b();
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
}
