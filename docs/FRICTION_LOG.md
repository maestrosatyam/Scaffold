# Friction Log — Scaffold (Amazon Developer Hackathon 2026, Alexa+ track)

Only issues we actually hit while building are logged here, with the time we hit them (IST, UTC+5:30). Each entry gives the task, steps, expected vs. actual, severity, workaround and a concrete fix. Severity scale: **High** = blocked a requirement; **Medium** = cost real time or forced a design hedge; **Low** = confusing but cheap to work around.

---

### F-01 · Alexa+ MCP client lifecycle example sends an older protocol version than the toolkit claims to support
- **When:** 2026-10-17 21:35 IST
- **Task:** Make sure our MCP server's `initialize` handling matches what the Alexa+ MCP client actually sends.
- **Steps:**
  1. Read the MCP Toolkit overview (https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview). It says Alexa+ for Builders supports MCP spec 2025-11-25.
  2. Read the client lifecycle page (https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html).
- **Expected:** The example `initialize` request carries `"protocolVersion": "2025-11-25"`, the version the hackathon rules require.
- **Actual:** The example request payload carries `"protocolVersion": "2025-03-26"` and declares only the `roots` capability. Re-checked with curl at 21:35 IST.
- **Severity:** Medium. Without access to the real client, we can't tell whether Alexa+ negotiates 2025-11-25 or 2025-03-26. That changes which headers and features a server can rely on.
- **Workaround:** Our server answers both eras from one endpoint and tests the 2025-11-25 handshake explicitly (`tests/mcp.http.test.ts`, "negotiates MCP 2025-11-25"). We also added a JSON-only `/mcp-json` endpoint for clients that send `Accept: application/json` only.
- **Suggested fix:** Update the lifecycle example to the version the client really sends. Add a short "protocol versions the Alexa+ client negotiates" table.

### F-02 · Two different latency targets for add-on tools
- **When:** 2026-10-17 21:35 IST
- **Task:** Set a latency budget for our tools, which the UI shows as a p95 badge.
- **Steps:** Compare the MCP Toolkit quickstart with the Functional Requirements page.
- **Expected:** One latency requirement.
- **Actual:** The quickstart says the server "must meet a round-trip query response latency of less than 500 ms". The Functional Requirements page gives "return results within 3 seconds" as a best practice, with an interim message when slower.
- **Severity:** Low–Medium. The choice between 500 ms and 3 s decides whether an LLM call inside a tool is viable at all. It shaped our "no LLM at runtime" architecture.
- **Workaround:** We designed to the stricter 500 ms target. The tests assert that server-side p95 stays under 500 ms (`tests/mcp.http.test.ts`), and the simulator shows live p50/p95.
- **Suggested fix:** State one hard limit and one recommended target, say where each is measured (Alexa edge vs. server), and say what happens when it is exceeded.

### F-03 · No way for non-partner developers to validate an MCP server against Alexa+
- **When:** 2026-10-17 (research phase, ~21:00 IST)
- **Task:** Test our MCP server and MCP Apps cards against the real Alexa+ client or the Local Inspector.
- **Steps:**
  1. Followed "Set up your development environment" (https://developer.amazon.com/docs/alexaplus/add-ons/set-up-your-development-environment.html).
  2. Found that `@alexa-ai/cli` and `@alexa-ai/addon-local-inspector` install from a private CodeArtifact registry, which needs a partner IAM role.
  3. Confirmed in the hackathon FAQ and forum that participants won't be granted access.
- **Expected:** At least the Local Inspector (a static conformance checker) would be publicly installable, so hackathon builders could check functional requirement #13, latency and MCP Apps rendering.
- **Actual:** All validation tooling is private preview. Builders can't see how Alexa+ would choose tools, phrase `speech`, or render a `ui://` card at 768×480.
- **Severity:** High for confidence in track fit, though the hackathon allows a simulated surface.
- **Workaround:**
  - We built a simulated Echo Show surface that is a real MCP client and a real MCP Apps host (`@modelcontextprotocol/ext-apps` AppBridge).
  - We used the open MCP Inspector CLI and the open conformance suite.
  - We follow the published design guide (768×480 canvas, at most 5 options, no IDs spoken).
- **Suggested fix:** Publish the Local Inspector, or a read-only "add-on linter", to npm without partner gating. Publish an MCP Apps rendering harness that mirrors the Echo Show host.

### F-04 · Quickstart attributes the HTTP+SSE deprecation to the wrong MCP revision
- **When:** 2026-10-17 21:35 IST
- **Task:** Confirm which transport requirements apply.
- **Steps:** Read the Technical requirements section of the MCP Toolkit quickstart.
- **Expected:** An accurate history of the transport change.
- **Actual:** The page says "The MCP specification (2025-11-25) deprecated the standalone HTTP+SSE transport in favor of Streamable HTTP". The deprecation actually happened in the 2025-03-26 revision.
- **Severity:** Low.
- **Workaround:** Checked the MCP spec changelog directly.
- **Suggested fix:** Say "since 2025-03-26 (and in 2025-11-25)".

### F-05 · Fire TV (Vega) SDK disk requirement ruled the track out for a small machine
- **When:** 2026-10-17 ~20:50 IST
- **Task:** Assess the Fire TV track using the Vega Virtual Device.
- **Steps:** Read the Vega SDK install requirements. Measured free disk on our Ubuntu machine: about 5 GB.
- **Expected:** A lightweight emulator path for building and recording a demo.
- **Actual:** The docs ask for about 20 GB free. The Vega Virtual Device on Ubuntu has no WebView, so a web-based app would need a React Native port.
- **Severity:** Medium. It removed a track option.
- **Workaround:** Chose the Alexa+ track.
- **Suggested fix:** Offer a slim "virtual device only" download, or a cloud-hosted virtual device for hackathons.

### F-06 · An MCP server on AWS Lambda behind an Express adapter got a raw Buffer body
- **When:** 2026-10-17 22:05 IST (found by our adversarial review, reproduced in `tests/review/lambda.review.test.ts`)
- **Task:** Run the same Express + MCP TypeScript SDK server on a Lambda Function URL, using `serverless-http`.
- **Steps:** Send a Function URL v2 `POST /mcp` with a JSON-RPC `initialize`.
- **Expected:** The same 200 response as running locally.
- **Actual:** HTTP 400 "not a valid JSON-RPC message". `express.json()` did not parse the synthetic request, so the SDK received a Node `Buffer`. The JSON-only path returned 415, because the adapter supplies no `rawHeaders`.
- **Severity:** High. Every MCP call failed on Lambda, while every local test passed.
- **Workaround:** A middleware parses Buffer bodies into JSON (and returns JSON-RPC -32700 on bad input). The Lambda wrapper synthesizes `rawHeaders`.
- **Suggested fix:** The AWS Lambda docs (and Powertools) could document a "running an MCP Streamable HTTP server on Lambda" recipe that covers body parsing and the response-streaming choice.

### F-07 · The Function URL hostname is unknown until after the first deploy, which blocks a Host allowlist
- **When:** 2026-10-17 22:10 IST
- **Task:** Turn on DNS-rebinding protection (a Host allowlist) for the public MCP endpoint, as the MCP spec requires servers to validate Host/Origin.
- **Expected:** A way to reference the Function URL host in the same SAM template.
- **Actual:** The URL is only generated by the deploy. Referencing it in the function's own environment creates a circular dependency.
- **Severity:** Medium.
- **Workaround:** Deploy twice: first with `AllowedHosts` empty (treated as "unset"), then with the output host.
- **Suggested fix:** Expose a deterministic URL id before creation, or document a supported pattern (for example a post-deploy custom resource).

### F-08 · Testing DynamoDB code locally was too heavy for a small machine
- **When:** 2026-10-17 21:55 IST
- **Task:** Run the DynamoDB event store against a real DynamoDB API without an AWS account.
- **Expected:** A small local emulator.
- **Actual:** The DynamoDB Local Docker image (JVM-based) would have used much of our remaining ~2 GB of disk.
- **Severity:** Low.
- **Workaround:** Contract tests with `aws-sdk-client-mock`, covering pagination, cancelled transactions and unprocessed items.
- **Suggested fix:** A slim native DynamoDB Local build, or a documented in-process test double.

### F-09 · On Lambda, every MCP response header was dropped, so SSE was served as `application/json`
- **When:** 2026-10-23 20:50 IST, on the first live deploy
- **Task:** Serve the MCP TypeScript SDK's Streamable HTTP endpoint from a Lambda Function URL, through Express and `serverless-http`.
- **Steps:** Deploy, then open the simulator, or `curl -D -` a `POST /mcp` `initialize`.
- **Expected:** `Content-Type: text/event-stream` with an `event: message` body, as locally.
- **Actual:** `Content-Type: application/json` with an SSE body. Every browser MCP client failed ("Unexpected token 'e', \"event: mes\"… is not valid JSON"), and 10 of 11 e2e tests failed. No unit test noticed.
  - serverless-http reads `res.getHeaders()`.
  - Node doesn't record headers passed directly to `writeHead()` unless `setHeader()` ran first.
  - Express replaces serverless-http's `writeHead` override.
  - The Function URL then silently defaults to `application/json`.
- **Severity:** High. The hosted demo was unusable while `/healthz` looked healthy.
- **Workaround:** A wrapper records `writeHead()` headers with `setHeader()`. Regression test R-21.
- **Suggested fix:** Function URLs could refuse or warn on a response with no `Content-Type` instead of defaulting to JSON. A Lambda recipe for MCP Streamable HTTP servers would cover this.

### F-10 · A brand-new account could not call Amazon Bedrock on deadline day
- **When:** 2026-10-23 18:30–21:00 IST
- **Task:** Drive our MCP server with Amazon Nova (via Strands Agents) to show an LLM choosing the tools.
- **Steps:**
  1. Call `bedrock-runtime converse` with `us.amazon.nova-2-lite-v1:0`.
  2. Then list the quotas in Service Quotas.
- **Expected:** A small default on-demand quota on a paid account with credits.
- **Actual:**
  - First, *"Your account is currently being verified … normally takes less than 2 hours"*.
  - Then *"Too many tokens per day"*.
  - In one region every Nova tokens-per-day quota read 0 and was marked **not adjustable**. In another region the listed quota was large, but calls were still refused.
- **Severity:** High for hackathon builders. The feature was dropped from the submission.
- **Workaround:** None in time. The Nova client was kept out of the submission.
- **Suggested fix:**
  - Show the verification status and an ETA in the Bedrock console.
  - Make the effective quota (after verification) visible.
  - Give new accounts a small, adjustable starter quota.

### F-11 · `aws login` signed the CLI in to the wrong account
- **When:** 2026-10-23 20:35 IST
- **Task:** Point the CLI at a newly created member account.
- **Steps:** `aws logout`, then `aws login --region …` while a console session for another account was open.
- **Expected:** A choice of account, or at least a confirmation naming the account.
- **Actual:** It reused the existing browser console session ("Opening in existing browser session") and wrote that account's role into the default profile. The mismatch only showed up on the next denied API call.
- **Severity:** Medium.
- **Workaround:** `aws login --profile <name>` after switching the console to the right account, then check with `sts get-caller-identity`.
- **Suggested fix:** Show the account ID and alias on the confirmation page, and accept `--account-id` to refuse a mismatched session.

### F-12 · Boto3 needs `botocore[crt]` for `aws login` credentials, and says so only on the first API call
- **When:** 2026-10-23 18:40 IST
- **Task:** Run a Strands Agents script with credentials from `aws login`.
- **Actual:** `MissingDependencyException: Using the login credential provider requires an additional dependency … pip install "botocore[crt]"`. This was raised when the model client was created, not at install time.
- **Severity:** Low. The message is clear.
- **Suggested fix:** Mention it in the `aws login` docs and the Strands quickstart, or declare the extra in SDKs that build Bedrock clients.

---
*Entries continue below as we hit new issues during deployment and recording.*
