# AWS deployment evidence

Deployed **2026-10-23 at about 20:45 IST** with `scripts/deploy-aws.sh`, which uses only the AWS CLI, from `infra/template.yaml`.
- Account: a dedicated member account (`****1317`) used only for this project.
- Region: **ap-southeast-2** (Sydney).
- Stack: `scaffold-adh2026`. Every taggable resource carries `Project=scaffold-adh2026`.

**Live URL:** https://tjncr2jv6v7sqw6jw467fbdyha0pesly.lambda-url.ap-southeast-2.on.aws/ (MCP endpoint: `/mcp`)

## Stack resources (CloudFormation, all `CREATE_COMPLETE` / `UPDATE_COMPLETE`)
| Logical id | Type |
|---|---|
| `ScaffoldFunction`, `ScaffoldFunctionRole` | AWS::Lambda::Function (nodejs22.x, arm64, 512 MB), IAM role with `DynamoDBCrudPolicy` |
| `ScaffoldFunctionUrl`, `ScaffoldFunctionUrlPublicPermissions`, `ScaffoldFunctionURLInvokeAllowPublicAccess` | AWS::Lambda::Url (AuthType NONE) and its public-invoke permissions |
| `EventsTable` | AWS::DynamoDB::Table (on-demand, SSE, TTL on `ttl`) |
| `FunctionLogs`, `ErrorsAlarm` | Log group (14-day retention), CloudWatch alarm on Lambda `Errors` |
| `CostBudget` | AWS::Budgets::Budget, USD 20/month, **credits not deducted**; ACTUAL 100% → SNS + email, ACTUAL 80% → email, FORECASTED 100% → email |
| `BudgetTopic`, `BudgetTopicPolicy` | SNS topic that only `budgets.amazonaws.com` from this account may publish to |
| `BudgetGuardFunction`, its role, SNS subscription and permission | Guard Lambda allowed only `lambda:PutFunctionConcurrency` on `ScaffoldFunction` |

## Checks run against the live URL
| Check | Result |
|---|---|
| `GET /healthz` | `200 {"ok":true,"store":"dynamodb","protocol":"2025-11-25"}` |
| `GET /` (simulator) | `200 text/html` |
| `POST /mcp` `initialize` with no token | `401 {"error":{"code":-32001,"message":"Missing bearer token"}}`, as designed: the public URL never hands out a shared learner |
| `POST /api/demo/sandbox` | a private sandbox seeded with 194 events (21 days of synthetic history), demo clock |
| `initialize` with the sandbox learner token | `protocolVersion` `2025-11-25`, server `scaffold` |
| `tools/list` | 11 learner tools |
| `tools/call start_routine {routine:"morning"}` | `"Okay, morning routine. I'm here if you need me."`, step `teeth` |
| MCP Inspector CLI 2.11.0 `--header "Authorization: Bearer …" --method tools/list` | the tool list |
| **Playwright e2e suite (11 tests) with `E2E_BASE_URL=<live URL>`** | **11 passed (38.1 s)** |

## The cost cap, tested live
1. Invoked `BudgetGuardFunction` with a simulated SNS budget alert. It returned `{"throttled":"scaffold-adh2026-ScaffoldFunction-…"}`.
2. `get-function-concurrency` reported `ReservedConcurrentExecutions: 0`, and `GET /healthz` answered **429** (throttled).
3. Ran `delete-function-concurrency`. `GET /healthz` answered **200** again.

Budgets refresh a few times a day, so the cap stops spending shortly after the threshold rather than at the exact cent.

## A bug only the live deploy found (fixed before the final deploy)
**Symptom.** On the first deploy, 10 of the 11 e2e tests failed against the live URL. The simulator said *Could not reach the Scaffold MCP server*, and *Unexpected token 'e', "event: mes"… is not valid JSON*. `curl` showed `Content-Type: application/json` on an SSE body.

**Cause.**
- serverless-http returns only the headers Node recorded (`res.getHeaders()`).
- Node does not record headers passed directly to `writeHead()` unless `setHeader()` ran first.
- Express replaces serverless-http's `writeHead` override when it re-prototypes the response.
- The MCP SDK's Node adapter writes all its headers through `writeHead()`, and we disable `X-Powered-By`, the only header Express would otherwise set first. So every header was dropped, and the Function URL defaulted to `application/json`.

**Fix.** `src/server/lambda.ts` now routes `writeHead()` headers through `setHeader()` before serverless-http reads them.

**Regression test.** `tests/review/lambda.review.test.ts` › **R-21** failed before the fix and passes after. The full suite is 171 passed; the e2e suite against the live URL is 11 passed.
