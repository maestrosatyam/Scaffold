# Scaffold — Threat Model & Privacy

**Scope:** the MCP server (`/mcp`, `/mcp-json`), the demo and debug HTTP API, the stores (SQLite, DynamoDB), and the simulated web surface. **Method:** STRIDE-style, per asset. Implementation references point to `primary-entry/src`. This document claims only what the code and tests show.

## Assets
1. **Learner's routine and performance history.** This is sensitive: it implies disability status.
2. **Learner's decisions.** These are approvals and declines of coach suggestions.
3. **Integrity of support levels.** A wrong level means wrong support for a vulnerable user.
4. **Availability through the judging period.**

## Trust boundaries
- **Client to server:** `Authorization: Bearer <token>` maps to an Actor `{personId, actorId, role}` (`server/auth.ts`).
- **Server to store:** append-only events with optimistic concurrency (`store/*.ts`).
- **MCP Apps:** each `ui://` view runs in a sandboxed iframe (`sandbox="allow-scripts"`, no network). It can only call tools through the host bridge.

## Threats and mitigations
| # | Threat | Mitigation (implemented) | Evidence / residual risk |
|---|---|---|---|
| T0 | **Unauthenticated access on a public deployment** | The anonymous demo learner exists only locally. Lambda defaults to `SCAFFOLD_ANONYMOUS=none`, so `/mcp` without a token gets a 401. | Review R-04 |
| T1 | **Spoofing:** a learner token used to call coach tools | `tools/list` and tool registration are built per actor. Coach tools do not exist on a learner's server instance (`server/mcp.ts`). | Test "learner sees learner tools only", "a learner cannot call a coach tool" (`tests/mcp.http.test.ts`) |
| T2 | **Cross-person access** | Every handler uses `actor.personId` from the token; no tool takes a person id argument. Debug and replay endpoints are scoped to the token's person, need an explicit token (never the anonymous fallback), and redact coach free text for learner tokens. Records use null-prototype maps, so ids like `constructor` can't cross people. | Tests "sandboxes are isolated", review R-08, R-13 |
| T3 | **Tampering:** a coach changes a learner's routine without consent | Coaches can only `suggest_routine`. Publishing requires the learner's `decide_suggestion`. A stale suggestion (the routine changed since) is rejected. | Engine tests "nothing changes until the learner approves", "rejects a stale suggestion" |
| T4 | **Tampering:** a coach sets a level silently | `set_step_level` requires a reason and writes an audit entry and a `coach-set` LevelChange that the report shows. | Audit is in the projection (`state.audit`) |
| T5 | **Repudiation** | Append-only, sequence-numbered event log. Each event carries `actorId` and time. Any state can be rebuilt by replay. | Determinism test "replay is deterministic" |
| T6 | **Duplicate or concurrent writes** (two Echo devices, retries, multiple Lambda instances) | `step_done` is idempotent by `step_id`. A per-person in-process lock, plus optimistic concurrency in the store: SQLite uses a transaction and a primary key; DynamoDB uses a conditional TransactWriteItems. Writers retry on conflict. | Tests "concurrent duplicate step_done calls advance exactly one step", store contract "two racing writers: exactly one wins" |
| T7 | **DNS rebinding and cross-site browser calls** | Host and Origin validation (403) from the MCP SDK's `createMcpExpressApp`: localhost by default, allowlists via `ALLOWED_HOSTS` / `ALLOWED_ORIGINS` on public deployments. An empty allowlist counts as unset. | Test "rejects a foreign Origin". **Residual:** on Lambda you must set `ALLOWED_HOSTS` after the first deploy, because the Function URL host is unknown before it (friction F-07). |
| T8 | **Information disclosure** in logs or speech | No PII in the seed data (synthetic "Sam"). Speech never includes IDs. Reports carry task metrics only. All HTTP errors are JSON with no stack traces, and internal tool errors are mapped to a fixed message. | Review R-09, R-12. **Residual:** no log redaction layer, because no PII is logged |
| T9 | **Malicious MCP App content** | Views are first-party, single-file and inlined, with no network. The host renders them in a sandboxed iframe, and tool calls from a view go through the same authenticated client. | |
| T10 | **Denial of service and cost** on a public demo | Small JSON body limit (express default 100 kb). Sandbox creation is rate-limited per IP and per instance *before* anything is written. Sandbox tokens are stateless HMAC tokens with a 6 h expiry, and their streams carry a TTL (DynamoDB TTL, or a local sweep). Replay is a single pass. The SAM template sets a cost budget and an error alarm, and DynamoDB is on-demand. | Review R-10, R-11. **Residual:** rate limits are per instance, not global |
| T11 | **Prompt injection** via routine text | No LLM runs on the server, so there is nothing to inject into. Routine text is validated (zod) and spoken verbatim. | An orchestrating assistant such as Alexa+ treats the content as tool output. |
| T12 | **Unsafe guidance** to a vulnerable user | Content is authored by the coach and approved by the learner. The system never invents instructions. Support can only change one level at a time. | No clinical validation yet (see PRD §7) |

## Privacy posture
- **Data minimisation.** The store holds routine definitions and step outcomes only: helped, done, skipped, and timestamps. There are no names beyond a display name, no health data, no audio and no location.
- **Ownership.** The learner is the account owner. Coach access is granted by token. In production, an Alexa account-linking grant would replace the token and be revocable.
- **Synthetic data only in the demo.** Every seeded event is flagged `seeded: true`, and reports print the seeded and live run counts.
- **Retention.** Demo sandboxes expire after 6 hours. For production we would add a DynamoDB TTL attribute; it is not implemented yet.
