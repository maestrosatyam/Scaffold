FRICTION LOG: Scaffold (Alexa+ track)

Times are IST (UTC+5:30). Severity: High = blocked a requirement; Medium = cost real time or forced a design change; Low = confusing but quick to work around.


F-01 · The Alexa+ client lifecycle example sends an older protocol version than the toolkit says it supports

When: 2026-10-17 21:35 IST
Task: Make sure our server handles the initialize request the Alexa+ MCP client really sends.
Steps:
1. Read the MCP Toolkit overview (https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview). It says Alexa+ for Builders supports MCP spec 2025-11-25.
2. Read the client lifecycle page (https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html).
Expected: The example initialize request carries "protocolVersion": "2025-11-25", the version the hackathon rules require.
Actual: The example carries "protocolVersion": "2025-03-26" and declares only the roots capability. We re-checked the page with curl at 21:35 IST.
Severity: Medium. Without the real client we can't tell whether Alexa+ negotiates 2025-11-25 or 2025-03-26, and that changes which headers and features a server can rely on.
Workaround: Our server answers both versions from one endpoint, and a test checks the 2025-11-25 handshake explicitly. We also added a JSON-only endpoint (/mcp-json) for clients that accept only application/json.
Suggested fix: Update the example to the version the client really sends, and add a short table of the protocol versions the Alexa+ client negotiates.


F-02 · Two different latency targets for add-on tools

When: 2026-10-17 21:35 IST
Task: Set a latency budget for our tools, which the simulator shows as a p95 badge.
Steps: Compare the MCP Toolkit quickstart with the Functional Requirements page.
Expected: One latency requirement.
Actual: The quickstart says the server "must meet a round-trip query response latency of less than 500 ms". The Functional Requirements page gives "return results within 3 seconds" as a best practice, with an interim message when a call is slower.
Severity: Low to Medium. The choice between 500 ms and 3 s decides whether an LLM call inside a tool is viable at all, and it shaped our decision to run no LLM in the server.
Workaround: We designed to the stricter 500 ms target. Our tests assert that server-side p95 stays under 500 ms, and the simulator shows live p50 and p95.
Suggested fix: State one hard limit and one recommended target, say where each is measured (Alexa's edge or the server), and say what happens when it's exceeded.


F-03 · Developers outside the partner program can't validate an MCP server against Alexa+

When: 2026-10-17, about 21:00 IST
Task: Test our MCP server and MCP Apps cards against the real Alexa+ client or the Local Inspector.
Steps:
1. Followed "Set up your development environment" (https://developer.amazon.com/docs/alexaplus/add-ons/set-up-your-development-environment.html).
2. Found that @alexa-ai/cli and @alexa-ai/addon-local-inspector install from a private CodeArtifact registry that needs a partner IAM role.
3. Confirmed in the hackathon FAQ and forum that participants won't be given access.
Expected: At least the Local Inspector, a static checker, would be publicly installable, so hackathon builders could check functional requirement #13, latency and MCP Apps rendering.
Actual: All the validation tools are private preview. Builders can't see how Alexa+ would choose tools, phrase the speech a tool returns, or render a card at 768×480.
Severity: High for confidence that we fit the track, although the hackathon allows a simulated surface.
Workaround: We built a simulated Echo Show that is a real MCP client and a real MCP Apps host (using the @modelcontextprotocol/ext-apps AppBridge). We checked the server with the open MCP Inspector CLI and conformance suite, and followed the published design guide (768×480 screen, at most 5 options, no ids spoken).
Suggested fix: Publish the Local Inspector, or a read-only add-on linter, on public npm with no partner gating, along with an MCP Apps rendering harness that matches the Echo Show host.


F-04 · The quickstart credits the HTTP+SSE deprecation to the wrong MCP revision

When: 2026-10-17 21:35 IST
Task: Confirm which transport requirements apply.
Steps: Read the Technical requirements section of the MCP Toolkit quickstart.
Expected: An accurate history of the transport change.
Actual: The page says "The MCP specification (2025-11-25) deprecated the standalone HTTP+SSE transport in favor of Streamable HTTP". The deprecation happened in the 2025-03-26 revision.
Severity: Low.
Workaround: Checked the MCP spec changelog directly.
Suggested fix: Say "since 2025-03-26 (and in 2025-11-25)".


F-05 · The Fire TV (Vega) SDK's disk requirement ruled out that track on a small machine

When: 2026-10-17, about 20:50 IST
Task: Assess the Fire TV track using the Vega Virtual Device.
Steps: Read the Vega SDK install requirements, then measured free disk on our Ubuntu machine: about 5 GB.
Expected: A lightweight emulator we could build on and record a demo with.
Actual: The docs ask for about 20 GB free. The Vega Virtual Device on Ubuntu also has no WebView, so a web-based app would need a React Native port.
Severity: Medium. It took a track off the table.
Workaround: We chose the Alexa+ track.
Suggested fix: Offer a slim "virtual device only" download, or a cloud-hosted virtual device for hackathons.


F-06 · An MCP server on Lambda behind an Express adapter receives a raw Buffer body

When: 2026-10-17 22:05 IST, found while reviewing our Lambda handler before the first deploy
Task: Run the same Express and MCP TypeScript SDK server on a Lambda Function URL, using serverless-http.
Steps: Send a Function URL (v2 payload) POST /mcp with a JSON-RPC initialize request.
Expected: The same 200 response as when running locally.
Actual: HTTP 400, "not a valid JSON-RPC message". express.json() didn't parse the adapter's synthetic request, so the SDK received a Node Buffer. The JSON-only endpoint returned 415, because the adapter supplies no rawHeaders.
Severity: High. Every MCP call would have failed on Lambda while every local test passed.
Workaround: A small middleware parses Buffer bodies as JSON (and returns JSON-RPC error -32700 on bad input), and our Lambda wrapper fills in rawHeaders.
Suggested fix: Add a "running an MCP Streamable HTTP server on Lambda" recipe to the Lambda docs (or Powertools) that covers body parsing and the response-streaming choice.


F-07 · The Function URL hostname isn't known until after the first deploy, which blocks a Host allowlist

When: 2026-10-17 22:10 IST
Task: Turn on DNS-rebinding protection (a Host allowlist) for the public MCP endpoint, since the MCP spec requires servers to validate Host and Origin.
Steps: Tried to pass the Function URL's hostname into the same function's environment in the SAM template.
Expected: A way to reference the Function URL host within the same template.
Actual: The URL only exists after deploy, and referencing it from the function's own environment creates a circular dependency.
Severity: Medium.
Workaround: Deploy twice: first with AllowedHosts empty (our app treats that as unset), then again with the hostname from the stack outputs.
Suggested fix: Expose a predictable URL id before creation, or document a supported pattern, such as a post-deploy custom resource.


F-08 · Testing DynamoDB code locally was too heavy for a small machine

When: 2026-10-17 21:55 IST
Task: Run our DynamoDB event store against a real DynamoDB API before we had an AWS account.
Steps: Looked at running DynamoDB Local from its Docker image.
Expected: A small local emulator.
Actual: The DynamoDB Local Docker image (JVM-based) would have taken much of our remaining 2 GB of disk.
Severity: Low.
Workaround: Contract tests with aws-sdk-client-mock, covering pagination, cancelled transactions and unprocessed items.
Suggested fix: A slim native build of DynamoDB Local, or a documented in-process test double.


F-09 · On Lambda, every MCP response header was dropped, so the event stream was served as application/json

When: 2026-10-23 20:50 IST, on our first live deploy
Task: Serve the MCP TypeScript SDK's Streamable HTTP endpoint from a Lambda Function URL, through Express and serverless-http.
Steps: Deploy, then open the simulator, or run curl -D - against POST /mcp with an initialize request.
Expected: Content-Type: text/event-stream with an "event: message" body, the same as locally.
Actual: Content-Type: application/json with an event-stream body. Every browser MCP client failed with "Unexpected token 'e', "event: mes"… is not valid JSON", and 10 of our 11 end-to-end tests failed. No unit test caught it. The cause is a chain: serverless-http reads res.getHeaders(); Node doesn't record headers passed straight to writeHead() unless setHeader() ran first; Express replaces serverless-http's writeHead override; and the Function URL then quietly defaults to application/json.
Severity: High. The hosted demo was unusable while the health check still looked fine.
Workaround: A wrapper copies the headers passed to writeHead() into setHeader(). A regression test now covers it.
Suggested fix: Function URLs could reject, or warn about, a response with no Content-Type instead of defaulting to JSON. A Lambda recipe for MCP Streamable HTTP servers would cover this too.


F-10 · A brand-new account couldn't call Amazon Bedrock on deadline day

When: 2026-10-23, 18:30 to 21:00 IST
Task: Drive our MCP server with Amazon Nova, through Strands Agents, to show an LLM choosing the tools.
Steps:
1. Call bedrock-runtime converse with us.amazon.nova-2-lite-v1:0.
2. List the quotas in Service Quotas.
Expected: A small default on-demand quota on a paid account with credits.
Actual: First, "Your account is currently being verified … normally takes less than 2 hours". Then, "Too many tokens per day". In one region every Nova tokens-per-day quota read 0 and was marked not adjustable. In another region the listed quota was large, but calls were still refused.
Severity: High for hackathon builders. We had to drop the feature.
Workaround: At 22:45 IST we called Bedrock from an older account in the same AWS Organization. Nova 2 Lite answered at once there; Nova Pro was still "being verified".
Suggested fix: Show the verification status and an expected time in the Bedrock console, make the effective quota after verification visible, and give new accounts a small, adjustable starter quota.


F-11 · aws login signed the CLI in to the wrong account

When: 2026-10-23 20:35 IST
Task: Point the CLI at a newly created member account.
Steps: Ran aws logout, then aws login --region … while a console session for a different account was open in the browser.
Expected: A choice of account, or at least a confirmation that names the account.
Actual: It reused the existing browser session ("Opening in existing browser session") and wrote that account's role into the default profile. We only noticed on the next denied API call.
Severity: Medium.
Workaround: Switch the console to the right account first, run aws login --profile <name>, then confirm with aws sts get-caller-identity.
Suggested fix: Show the account ID and alias on the confirmation page, and accept --account-id so the CLI can refuse a session for the wrong account.


F-12 · boto3 needs botocore[crt] for aws login credentials, and only says so on the first API call

When: 2026-10-23 18:40 IST
Task: Run a Strands Agents script with credentials from aws login.
Steps: Signed in with aws login, then ran a script that creates a Bedrock model client.
Expected: Either it works, or the missing dependency is reported at install time.
Actual: MissingDependencyException: "Using the login credential provider requires an additional dependency … pip install "botocore[crt]"", raised when the model client was created.
Severity: Low. The error message is clear.
Workaround: pip install "botocore[crt]".
Suggested fix: Mention it in the aws login docs and the Strands quickstart, or declare the extra in SDKs that build Bedrock clients.
