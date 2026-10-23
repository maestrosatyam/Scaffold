# Architecture Decision Records

Format: ADR-NNN — title — date — status. Context / Decision / Consequences.

## ADR-001 — Workspace layout — 2026-10-17 — Accepted
Context: Two independent deliverables (primary entry, OSS contribution) must stay legally and historically separate.
Decision: The hackathon coordination workspace (outside this repo). `primary-entry/` is its own git repository (the Devpost submission repo). Upstream OSS checkouts live under `oss-contribution/upstream/` (each with intact upstream history) and are never copied into the primary repo.
Consequences: The primary repo can be published publicly without leaking OSS work-in-progress or coordination notes; the coordination docs (research/, oss/) can optionally be published separately.

## ADR-002 — No dependency on a paid LLM for the headline demo — 2026-10-17 — Accepted
Context: No product LLM key or AWS credentials are available on this machine; developer credentials must never be embedded in the product. Judges may only watch the video and must be able to reproduce the core flow locally.
Decision: The headline workflow must run deterministically with zero external keys. Any LLM (e.g. Amazon Bedrock) is an optional adapter enabled by env vars.
Consequences: Reproducible, free demo; the design must make the deterministic path a strength, not a stub.

## ADR-003 — Alexa+ track; Scaffold concept — 2026-10-17 — Accepted
Context: Fire TV is blocked by disk (Vega SDK needs about 20 GB; we have about 5 GB). Ring needs a Playground account whose availability is uncertain. Bee needs a device. About 150 to 500 hackathon repos crowd the memory, elder-care, scam and approval-layer niches.
Decision: Build Scaffold as an Alexa+ MCP server. See research/05_FINAL_RECOMMENDATION.md.
Consequences: The demo is fully screen-based. The entry depends on the honest "simulated Alexa+ surface" path, plus a real MCP server.

## ADR-004 — Event sourcing with pure projection — 2026-10-17 — Accepted
Decision: An append-only per-person log; all state is projected from it; commands are pure functions that return events.
Consequences: Deterministic replay (the time machine, the seeded history produced by the real engine), explainable level changes, trivial optimistic concurrency. Cost: a projection is rebuilt per cold start. This is fine at our scale; the service caches it incrementally.

## ADR-005 — TypeScript SDK v2, stateless Streamable HTTP, role-scoped server per request — 2026-10-17 — Accepted
Decision: `@modelcontextprotocol/server` 2.3.1 `createMcpHandler(factory)`. The factory builds an McpServer for the authenticated actor.
Consequences: Fits Lambda. `tools/list` is least-privilege by construction. The 2026-07-28 era is also answered from the same definitions. 2025-11-25 is the version we claim and test.

## ADR-006 — Static bearer tokens and demo sandboxes instead of OAuth for the hackathon — 2026-10-17 — Accepted
Context: Alexa+ account linking (OAuth 2.1 with PKCE) can't be exercised without partner access. Judges need a zero-setup demo.
Decision: `SCAFFOLD_TOKENS` static tokens, an anonymous local learner, and per-visitor sandboxes with random tokens and a 6 h TTL.
Consequences: Production would replace token lookup with OAuth token verification; the Actor shape is unchanged. Documented as a limitation.

## ADR-007 — AWS deployment via Lambda Function URL + DynamoDB (serverless-http) — 2026-10-17 — Accepted (deployed 2026-10-23, ap-southeast-2)
Decision: One arm64 Lambda function wraps the same Express app. DynamoDB on-demand stores the events. A CloudWatch alarm and an optional $5 budget are included. The code is compiled to JS with `tsc` (`rewriteRelativeImportExtensions`), so the Lambda runtime doesn't need Node type stripping.
Consequences: Near-zero cost and the same code path as local. Blocked on credentials.
