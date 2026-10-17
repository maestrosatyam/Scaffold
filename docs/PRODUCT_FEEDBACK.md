# Product Feedback

Every tool, API and SDK we actually used gets the five rules questions below. We separate what we used hands-on from what we only read or evaluated, and we don't claim usage that didn't happen.

---

## 1. Alexa+ for Builders: MCP Toolkit documentation (read and designed against; toolkit itself not accessible)
**What we used it for.** We designed our MCP server to the documented contract:
- MCP spec 2025-11-25 over Streamable HTTP;
- round trips under 500 ms;
- functional requirement #13: stable ids, one intent per tool, honoured parameters;
- MCP Apps (`ui://`) on a 768×480 Echo Show canvas;
- voice guidance: at most 5 options, no IDs spoken, an explicit yes before transactions;
- the auth tiers.

Pages: overview, quickstart, client lifecycle, functional requirements, design guide, authentication, local inspector.

**What worked well.**
- The functional requirements are unusually concrete and actionable. "Return stable IDs so tools can be chained" and "declare only parameters you honor" directly shaped our `step_done(run_id, step_id)` idempotency design.
- The split of responsibilities is clear: Alexa+ handles understanding and rendering, the server owns tools and data. That made "no LLM inside the server" an obvious, defensible architecture.

**What needs work.**
- **(a)** The client lifecycle example sends `protocolVersion: "2025-03-26"`, while the overview says the toolkit supports 2025-11-25 (friction F-01).
- **(b)** The quickstart says "<500 ms" and the functional requirements say "within 3 seconds" (F-02).
- **(c)** The quickstart says 2025-11-25 deprecated HTTP+SSE. That actually happened in 2025-03-26 (F-04).
- **(d)** All validation tooling is private preview: the CLI, the Local Inspector and the simulator. Builders outside the partner program can't check tool selection, speech or card rendering (F-03).

**Onboarding (zero to hello world).** For a partner, the path looks reasonable on paper: `npm i -g @alexa-ai/cli`, then `configure`, `new mcp`, `deploy`. For us it stopped at the private CodeArtifact registry. We reached "hello world" only against our own simulated client.

**Would we build with it again?** **Yes**, once access opens. The MCP-native approach meant our server works with any MCP client today, and could be onboarded to Alexa+ without rewriting it.

## 2. AWS SDK for JavaScript v3: `@aws-sdk/client-dynamodb` (used in code; tested with mocks, not against a live table)
**What we used it for.** The production event store (`src/store/dynamo.ts`):
- consistent paginated `Query` (`LastEvaluatedKey`);
- an optimistic-concurrency append with `TransactWriteItems`: a `ConditionCheck` on the tail item plus conditional `Put`s, with a deterministic `ClientRequestToken`;
- `BatchWriteItem` with `UnprocessedItems` retry;
- TTL attributes for demo sandboxes.

**What worked well.**
- The modular package keeps the bundle small.
- Typed command inputs caught mistakes at compile time.
- `TransactionCanceledException` is a real exported class, so error mapping is clean.
- `aws-sdk-client-mock` made deterministic tests of pagination, cancellation and unprocessed-item retries easy.

**What needs work.**
- **Auto-generated `ClientRequestToken`.** Whether the SDK auto-generates the token and reuses it across its own retries isn't obvious from the API reference. We set one explicitly to be sure.
- **Silent no-ops in conditions.** The interaction between `attribute_not_exists(pk)` and the full primary key confuses people. Our own reviewer had to confirm that it is evaluated against the item with the full key. A short doc note, "conditions are evaluated against the item with the full primary key", would help.

**Onboarding.** Writing the code was quick. Testing it against real DynamoDB needs an AWS account, which we didn't have during the build. DynamoDB Local (Docker) was too large for our disk budget.

**Would we build with it again?** **Yes.**

## 3. AWS SAM / CloudFormation (template authored; NOT deployed)
**What we used it for.** `infra/template.yaml` defines:
- a Lambda (arm64) with a Function URL;
- a DynamoDB table (on-demand, SSE, TTL);
- a CloudWatch error alarm;
- an optional AWS Budget;
- a log group with 14-day retention.

**What worked well.** `AWS::Serverless::Function` with `FunctionUrlConfig` and policy templates (`DynamoDBCrudPolicy`) keeps the template short. `AWS::Budgets::Budget` lets a hackathon project ship its own cost guard.

**What needs work.**
- **The Function URL hostname is unknown until after deploy.** Our server needs it for a Host allowlist (DNS-rebinding protection), so a two-step deploy is required. Exposing the URL domain as a pre-deploy, predictable value, or documenting a recommended pattern, would help.
- **No offline validation.** We couldn't run `sam validate` without installing the SAM CLI, which was too large for our disk budget.

**Onboarding.** Not executed. We had no AWS credentials.

**Would we build with it again?** **Yes.**

## 4. MCP TypeScript SDK v2: `@modelcontextprotocol/server` 2.3.1, `/client` 2.3.1, `/node` 2.1.1, `/express` 2.0.2 (used heavily)
**What we used it for.**
- The server (`createMcpHandler`, `registerTool` with zod v4 input and output schemas, `structuredContent`, `instructions`).
- `createMcpExpressApp` for Host and Origin validation.
- The browser and Node clients: tests, the simulator, and a two-role trace.

**What worked well.**
- One stateless factory serves both protocol eras.
- Building the server *per request* lets `tools/list` be role-scoped.
- Server-side `outputSchema` validation.
- Host and Origin protection by default on localhost.

**What needs work.**
- **Behind `serverless-http` on Lambda, `express.json()` leaves `req.body` as a Buffer.** The transport then rejects every message as "not a valid JSON-RPC message". We had to parse the Buffer and synthesize `rawHeaders`. A note in the Lambda docs, or tolerance for Buffer bodies, would save others hours.
- **An empty `allowedHosts: []` silently rejects everything**, including health checks. We would expect it to be treated as "unset" or to warn.
- **Version upgrades can break code silently.** While working on our OSS contribution, we found that the official v1→v2 codemod turns `tool(name, annotations, cb)` into a broken schema (our fix is ready; PR not yet opened).

**Onboarding.** Very fast. The migration guide and the split packages are clear. A working Streamable HTTP server took minutes.

**Would we build with it again?** **Yes.**

## 5. MCP Apps (`@modelcontextprotocol/ext-apps` 2.0.3) (used: server helpers, View `App`, host `AppBridge`)
**What we used it for.**
- `registerAppTool` and `registerAppResource` on the server.
- `App` inside four single-file views.
- `AppBridge` with `PostMessageTransport` in our simulated host, so card buttons are real `tools/call` requests.

**What worked well.** The bridge proxies tools and resources automatically. Size-change notifications and host context work.

**What needs work.**
- Bundling the View runtime adds about 225 KB per card. A smaller "view-only" entry would help constrained devices.
- Playwright can't target elements inside a sandboxed srcdoc iframe by locator, so we fell back to coordinate clicks. A testing guide for hosts would help.

**Would we build with it again?** **Yes.**

## 6. MCP Inspector CLI 2.11.0 and the MCP conformance suite 0.1.16 (used for evidence)
**What worked well.** `--cli … --method tools/list|tools/call|resources/list` made scripted protocol evidence trivial.

**What needs work.** The conformance `server` suite assumes the reference fixture tools (`test_simple_text`, …). Against a real product server, 24 of 30 scenarios fail by construction. A "product server" profile that only checks the transport, lifecycle, security and declared capabilities would make the results meaningful.

**Would we use them again?** **Yes.**

## 7. Strands Agents Python SDK (`strands-agents/harness-sdk`) (used for our second open-source contribution)
**What we used it for.** We reproduced and fixed issue #4896: concurrent `MCPClient.load_tools()` calls failing.

**What worked well.**
- A large, fast unit-test suite.
- Clear contribution guidelines.
- An MCP client design that mirrors the TypeScript SDK, which made the fix's semantics easy to align.

**What needs work.** Optional extras make the full local test run noisy: failures from extras that aren't installed, plus mypy errors. A documented "core-only" test command would help outside contributors.

**Would we build with it again?** **Yes.**

## 8. Evaluated but not used
- **Fire TV Vega SDK.** It needs about 20 GB of disk, more than we had (F-05).
- **Ring Developer Playground.** It needs an account and offers no event simulation. We didn't proceed.
- **Bee.** It needs a device, which we don't have.
