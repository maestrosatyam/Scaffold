AWS SERVICES USED, AND HOW (AWS Builder mini-challenge)

Scaffold runs live on AWS at https://tjncr2jv6v7sqw6jw467fbdyha0pesly.lambda-url.ap-southeast-2.on.aws/, deployed from one SAM template through CloudFormation.

- AWS Lambda (Node.js 22, arm64) with a Function URL serves the MCP endpoint (/mcp), the demo sandbox API and the simulated Echo Show web app.
- Amazon DynamoDB (on-demand, encrypted at rest, with TTL) holds each person's append-only event log. Appends use TransactWriteItems with a condition check on the last item and an idempotency token, so two devices can't overwrite each other. Replays use consistent, paginated queries. TTL clears out the demo sandboxes judges create.
- Amazon CloudWatch keeps logs for 14 days and raises an alarm on errors, so we know if the demo goes down during judging.
- AWS Budgets, Amazon SNS and a small guard Lambda enforce a $20/month cap. When actual spend reaches 100%, the guard sets the app's reserved concurrency to 0. We tested it on the live stack: 429 while capped, 200 after reset.
- AWS CloudFormation and SAM: one template, with every resource tagged Project=scaffold-adh2026.
- Amazon Bedrock (Amazon Nova 2 Lite) through the Strands Agents SDK: a script gives Nova only Scaffold's MCP instructions and tools and drives the live server from everyday speech, the job Alexa+ does in production. Nova chose the right tool and spoke the server's words exactly in 9 of 9 turns (section 8).

All 11 browser end-to-end tests pass against the live URL. The deployment record is in the repo at docs/evidence/aws/DEPLOYMENT.md.


1. ALEXA+ FOR BUILDERS: MCP TOOLKIT DOCUMENTATION

The toolkit itself is limited to partners, so we worked from the documentation alone.

What we used it for: we designed our server to the documented contract. That meant MCP spec 2025-11-25 over Streamable HTTP, round trips under 500 ms, and functional requirement #13 (stable ids, one intent per tool, only declare parameters you honour). It also meant MCP Apps cards on the 768×480 Echo Show screen, the voice guidance (at most 5 options, never speak ids, an explicit yes before transactions) and the authentication tiers. We read the overview, quickstart, client lifecycle, functional requirements, design guide, authentication and Local Inspector pages.

What worked well: the functional requirements are unusually concrete. The advice to return stable ids so tools can be chained, and to declare only the parameters you actually honour, shaped our step_done(run_id, step_id) design, which makes repeated calls safe. The split of responsibilities is also clear: Alexa+ handles understanding and rendering, and the server owns the tools and data. That made it an easy decision to keep LLMs out of our server.

What needs work:
- The client lifecycle example sends protocolVersion "2025-03-26", while the overview says the toolkit supports 2025-11-25 (friction log F-01).
- The quickstart says responses must take under 500 ms, and the functional requirements say "within 3 seconds" (F-02).
- The quickstart says the 2025-11-25 spec deprecated HTTP+SSE. That happened in 2025-03-26 (F-04).
- All the validation tools are private preview: the CLI, the Local Inspector and the simulator. Builders outside the partner program can't check tool selection, speech or card rendering (F-03).

Getting started (zero to hello world): for a partner the path looks simple: npm i -g @alexa-ai/cli, then configure, new mcp, deploy. For us it stopped at the private CodeArtifact registry, and our "hello world" ran only against our own simulated client.

Would we build with it again? Yes, once access opens. Because the add-on is a standard MCP server, it already works with any MCP client and could be onboarded to Alexa+ without a rewrite.


2. AWS SDK FOR JAVASCRIPT V3 (@aws-sdk/client-dynamodb)

What we used it for: our production event store. That covers consistent, paginated Query calls, appends guarded by TransactWriteItems (a ConditionCheck on the last item plus conditional Puts, with a fixed ClientRequestToken), BatchWriteItem with retries for unprocessed items, and TTL attributes for demo sandboxes.

What worked well: the modular packages keep the bundle small. Typed command inputs caught mistakes at compile time. TransactionCanceledException is an exported class, so mapping errors is clean. aws-sdk-client-mock made it easy to write deterministic tests for pagination, cancelled transactions and unprocessed-item retries.

What needs work:
- The API reference doesn't make clear whether the SDK generates a ClientRequestToken and reuses it across its own retries. We set one ourselves to be sure.
- How attribute_not_exists(pk) interacts with the full primary key is easy to misread. We had to check that the condition is evaluated against the item with the full primary key. One sentence in the docs saying exactly that would help.

Getting started: writing the code was quick. DynamoDB Local (Docker) needed more disk space than our machine had left, so we relied on mocked contract tests until we had an account. Once deployed, the same store passed the full browser suite against the live table on the first run.

Would we build with it again? Yes. Typed commands and the mock library let us get a transactional store right before we ever had a table.


3. AWS SAM / CLOUDFORMATION, LAMBDA FUNCTION URLS, AWS BUDGETS AND AMAZON SNS

What we used it for: one template (infra/template.yaml) defines the Lambda with its Function URL, the DynamoDB table, a CloudWatch error alarm, a log group with 14-day retention, and a $20/month budget wired through SNS to a guard Lambda that throttles the app to zero at the cap.

What worked well: AWS::Serverless::Function with FunctionUrlConfig and policy templates such as DynamoDBCrudPolicy keeps the template short. AWS::Budgets::Budget let a hackathon project ship its own cost guard.

What needs work:
- The Function URL hostname isn't known until after the first deploy. Our server needs it for a Host allowlist (protection against DNS rebinding), so we had to deploy twice. A hostname known before deploy, or a documented pattern, would help (F-07).
- We couldn't validate the template offline without installing the SAM CLI, which needed more disk space than we had. We deployed with the plain AWS CLI instead: cloudformation package, then deploy, which applies the SAM transform on the server. That worked well and deserves a mention in the SAM docs.
- Budgets only alert; there's no hard cap. For a demo on a public URL, a built-in "stop at $X" switch would beat wiring Budgets → SNS → Lambda → PutFunctionConcurrency(0) by hand. On a new account the Lambda concurrency quota is 10, so you can't even reserve a small fixed concurrency for cost control.

Getting started: the first deploy was quick. Account setup took far longer than the template: Organizations policies, the CLI signing in to the wrong account, and Bedrock verification (F-10, F-11). One bug appeared only on the live URL (F-09).

Would we build with it again? Yes. One template gave us the whole stack, including a cost cap we could test, and every deploy is repeatable.


4. MCP TYPESCRIPT SDK V2 (@modelcontextprotocol/server 2.3.1, /client 2.3.1, /node 2.1.1, /express 2.0.2)

What we used it for: the server itself (createMcpHandler, registerTool with zod v4 input and output schemas, structuredContent, server instructions), createMcpExpressApp for Host and Origin checks, and the browser and Node clients behind our tests, the simulator and a script that traces a learner and a coach side by side.

What worked well: one stateless handler serves both protocol versions. Building the server per request let us give each role its own tool list. Output schemas are validated on the server. Host and Origin protection is on by default for localhost.

What needs work:
- On Lambda behind serverless-http, express.json() leaves req.body as a Buffer, and the transport rejects every message as "not a valid JSON-RPC message". We had to parse the Buffer ourselves and synthesize rawHeaders. A note in the docs, or accepting Buffer bodies, would save others hours (F-06).
- An empty allowedHosts: [] silently rejects everything, health checks included. We'd expect it to be treated as unset, or at least to log a warning.
- Upgrades can break code without any warning. While working on our open-source contribution we found that the official v1→v2 codemod turns tool(name, annotations, cb) into a broken schema. Our fix is on a public branch; the upstream PR isn't open yet.

Getting started: very fast. The migration guide and the split packages are clear, and we had a working Streamable HTTP server in minutes.

Would we build with it again? Yes. It's the reference implementation, and building a server per request made role-scoped tools simple.


5. MCP APPS (@modelcontextprotocol/ext-apps 2.0.3)

What we used it for: registerAppTool and registerAppResource on the server, the App runtime inside four single-file card views, and AppBridge with PostMessageTransport in our simulated host, so the buttons on a card send real tools/call requests.

What worked well: the bridge forwards tool and resource calls with no extra code, and size-change notifications and host context work as documented.

What needs work:
- Bundling the view runtime adds about 225 KB to each card. A smaller view-only entry point would help on constrained devices.
- Playwright can't target elements inside a sandboxed srcdoc iframe with locators, so our tests fall back to clicking coordinates. A testing guide for hosts would help.

Getting started: we had a first card rendering inside our own host in under an hour, using the typings in the app-bridge examples. A plain-HTML minimal host example would have made it faster.

Would we build with it again? Yes. It gave us tappable Echo Show cards from a standard MCP server with very little glue code.


6. MCP INSPECTOR CLI 2.11.0 AND THE MCP CONFORMANCE SUITE 0.1.16

What we used them for: scripted protocol checks against our server (tools/list, tools/call, resources/list) and the conformance suite's server scenarios. The transcripts are in the repo under docs/evidence/.

What worked well: --cli with --method tools/list, tools/call or resources/list made scripted checks trivial.

What needs work: the conformance suite's server scenarios assume the reference fixture tools (test_simple_text and others). Against a real product server, 24 of 30 scenarios fail for that reason alone. A "product server" profile that checks only transport, lifecycle, security and declared capabilities would make the results meaningful.

Getting started: one npx command each, with nothing to install or configure. The Inspector worked the first time.

Would we use them again? Yes. They're the quickest independent check that a server speaks MCP correctly.


7. STRANDS AGENTS PYTHON SDK (strands-agents/harness-sdk)

What we used it for: two things. Its MCP client connects Amazon Nova to our live server in agent/nova_agent.py (section 8). It's also where we made our second open-source contribution: we reproduced and fixed issue #4896, where concurrent MCPClient.load_tools() calls fail.

What worked well: a large, fast unit-test suite, clear contribution guidelines, and an MCP client design that mirrors the TypeScript SDK, which made it easy to match the fix to how the TypeScript client behaves.

What needs work: optional extras make a full local test run noisy, with failures from extras that aren't installed and mypy errors. A documented core-only test command would help outside contributors.

Getting started: uv plus an editable install got the MCP tests running quickly. Working out which extras the full suite needs took longer.

Would we build with it again? Yes. The codebase was easy to work in, and the MCP client is cleanly structured.


8. AMAZON BEDROCK (AMAZON NOVA 2 LITE)

What we used it for: checking that a real language model can drive Scaffold, which is Alexa+'s job in production. agent/nova_agent.py gives Amazon Nova 2 Lite (us.amazon.nova-2-lite-v1:0, temperature 0) only Scaffold's MCP instructions and its 11 learner tools, through the Strands Agents MCP client, and feeds it everyday speech against the live server. The server itself still runs no LLM.

What worked well: Nova 2 Lite followed the server's instructions closely. Across 9 messy utterances, including "ho gaya" and "wait, what goes in my bag again?", it chose the right tool every time, chained the real run and step ids, and spoke the server's words exactly in 9 of 9 turns. The run also exposed a bug in our server that our own tests had missed: ids were only in structuredContent, which Strands doesn't pass to the model. We fixed it by also returning the structured result as JSON text, as the MCP spec recommends.

What needs work:
- New accounts. On deadline day our new account was first held for verification ("normally takes less than 2 hours"), then refused with "Too many tokens per day". In one region every Nova tokens-per-day quota read 0 and was marked not adjustable; in another the listed quota was large, but calls were still refused (F-10).
- There's no way to see the verification status or the quota that actually applies. A status and expected time in the console, and a small adjustable starter quota for new accounts, would have saved us hours.
- Even on our older account, Nova Pro was still "being verified" while Nova 2 Lite worked.

Getting started: about four hours, almost all of it account access rather than code. The new account was blocked from 18:30 IST. At 22:45 IST we switched to an older account in the same AWS Organization, and Nova 2 Lite answered at once. Using aws login credentials from Python also needed the botocore[crt] extra, which boto3 only reports on the first API call (F-12). The agent script itself was quick to write; its first run found the bug in our server described above.

Would we build with it again? Yes. Once we had access, Nova and Strands gave us a cheap, realistic stand-in for Alexa+ choosing our tools, and it caught a bug our tests had missed. We'd want the new-account quota problem fixed first.


9. TRIED OR EVALUATED, BUT NOT USED

- Fire TV Vega SDK: it needs about 20 GB of disk space, more than we had (F-05).
- Ring Developer Playground: it needs an account and offers no event simulation, so we didn't go further.
- Bee: it needs a device, which we don't have.
