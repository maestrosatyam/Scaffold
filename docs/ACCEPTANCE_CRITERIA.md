# Scaffold — Acceptance Criteria

Each criterion names the test that proves it. Status reflects the last executed run (see `evidence/TEST_RUNS.md`).

| ID | Criterion | Verified by |
|---|---|---|
| AC-01 | The server completes an MCP `initialize` over Streamable HTTP and returns `protocolVersion: "2025-11-25"`, server info and instructions | `tests/mcp.http.test.ts` › negotiates MCP 2025-11-25; `evidence/mcp/` (Inspector CLI) |
| AC-02 | A foreign `Origin` gets 403. An invalid token gets 401 with no `WWW-Authenticate`. An unsupported `MCP-Protocol-Version` gets 400 | `tests/mcp.http.test.ts` › protocol & transport |
| AC-03 | `tools/list` is role-scoped: 11 learner tools and 6 coach tools, with no overlap except `list_routines` | `tests/mcp.http.test.ts` › role-scoped tools |
| AC-04 | Every step tool links `ui://scaffold/step-card.html`. Its resource is served as `text/html;profile=mcp-app` | `tests/mcp.http.test.ts` › MCP Apps resources |
| AC-05 | A step fades exactly one level after 3 consecutive unaided runs and never skips a level | `tests/engine.test.ts` › fading policy |
| AC-06 | Support is added back one level after 2 consecutive aided runs, and the step is flagged for the coach | `tests/engine.test.ts` › adds support back |
| AC-07 | Randomized policies and outcomes never break the level invariants | `tests/engine.test.ts` › property |
| AC-08 | `step_done` is idempotent per step; concurrent duplicates advance exactly once | `tests/engine.test.ts` › idempotent; `tests/mcp.http.test.ts` › concurrent duplicate |
| AC-09 | Starting a routine that is already running resumes it, and `where_was_i` works from another device | engine › resumes it; http › headline workflow |
| AC-10 | Speech is byte-identical for identical state, and silent for independent steps | `tests/engine.test.ts` › speech |
| AC-11 | Coach suggestions take effect only after learner approval; stale suggestions are rejected | engine › suggestions; http › coach suggests |
| AC-12 | The seeded history is produced by the real engine, fully labelled `seeded`, deterministic, and ends in the documented state | `tests/engine.test.ts` › seeded demo history |
| AC-13 | Server-side tool p95 is under 500 ms | `tests/mcp.http.test.ts` › latency |
| AC-14 | Demo sandboxes are isolated from each other | `tests/mcp.http.test.ts` › sandboxes are isolated |
| AC-15 | Stores satisfy one contract: sequential seq numbers, optimistic concurrency, replace. The DynamoDB store paginates, uses conditional transactions and retries unprocessed items | `tests/store.test.ts` |
| AC-16 | The simulated surface is a real MCP client: utterance → `tools/call` → MCP App render, with taps on the card going through the MCP client | `tests/e2e/*` (Playwright) |
| AC-17 | The simulated surface is labelled "Simulated Alexa+ surface — not Amazon software" and uses no Alexa logo | `tests/e2e/*` + manual check of screenshots |
