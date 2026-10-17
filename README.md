# Scaffold — the routine coach designed to be needed less

**Alexa+ track · Amazon Developer Hackathon 2026**

Scaffold coaches adults with cognitive disabilities through daily routines such as getting ready, laundry or making tea. As each step is learned, it **fades its own prompts**:

> full prompt → short prompt → cue word → silence

Support comes back on its own when a step gets harder again. Every change has a written, auditable reason.

Scaffold is a **self-hosted MCP server**. It uses **Streamable HTTP** and **MCP spec 2025-11-25**, which is what Alexa+ for Builders consumes. Alexa+ does the talking; Scaffold keeps the books, meaning state, rules and the exact words, and runs no LLM. Rich cards for the Echo Show canvas are implemented as **MCP Apps** (`ui://` resources).

> **Honest boundary.** The Alexa+ developer toolkit is partner-only, so this repo includes a **simulated Alexa+ surface**: a web page that is a *real* MCP client and a *real* MCP Apps host. It is labelled "Simulated Alexa+ surface — not Amazon software" on every screen. It does not run on an Echo, and it is not affiliated with or certified by Amazon. All people and history in the demo are **synthetic**.

## 60-second tour
- **The routine gets quieter as the person learns.** On Day 1 the step is *"Step 1 of 6. Pick up the blue toothbrush. Squeeze a pea-sized bit of toothpaste…"*. On Day 10 it is *"Toothbrush and paste."* On Day 21 there is silence. Open **Time machine** to see this replayed from the event log.
- **"Help" climbs one level, for that step only.** If help is needed two runs in a row, support is **added back** and the coach is told why. The reason reads like this: *"Added support back (cue to partial) because help was needed in 2 runs in a row (Oct 16, Oct 17)."*
- **"Where was I?"** resumes the same routine run on another device, so the person can move from the bedroom to the kitchen.
- **The learner owns their routines.** A coach can only *suggest* a routine. It takes effect only when the learner says "yes".
- **Speech is deterministic.** The same state always produces byte-identical words. Many learners need this, and it keeps Scaffold within the Alexa+ 500 ms tool budget. Server p95 is single-digit milliseconds.

## Quick start (no keys, no cloud)
Requires **Node.js ≥ 22.18** (see `.nvmrc`), which runs the TypeScript directly with no build step for the server. With an older Node, `npm ci` stops with an engines error.

```bash
npm ci
npm run build      # MCP App cards + the simulator web app
npm start          # http://127.0.0.1:8787  (MCP endpoint: /mcp)
```

Open http://127.0.0.1:8787 and say or type **"start my morning"**, then "done", "help", "where was I?" (try the Kitchen device), "I'm running late, 10 minutes" and "all done". Each browser session gets its own seeded sandbox. Other pages:
- `/coach`: the coach's phone view, with the independence report, step explanations, level overrides and "suggest a routine".
- `/time-machine`: Day 1, Day 10, Day 21 and Today, replayed from the same log.
- `/?layout=split`: the device and the coach side by side, as used in the demo video.

## Use it from any MCP client
| | |
|---|---|
| Endpoint | `http://127.0.0.1:8787/mcp` (Streamable HTTP, stateless). `/mcp-json` is also available for clients that only accept `application/json` |
| Protocol | `2025-11-25` (initialize handshake). The same tools also answer 2026-07-28 clients |
| Auth | `Authorization: Bearer demo-learner` or `Bearer demo-coach` locally. No header means the local demo learner |

```bash
# MCP Inspector (CLI)
npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://127.0.0.1:8787/mcp --transport http --method tools/list
npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://127.0.0.1:8787/mcp --transport http \
  --method tools/call --tool-name start_routine --tool-arg routine=morning

# Any other MCP client that supports Streamable HTTP: point it at http://127.0.0.1:8787/mcp
```

### Tools (the list depends on the role in the token)
| Learner (11) | What it does |
|---|---|
| `start_routine` | Starts or resumes a routine. Each step is presented at the support level it has earned |
| `step_done` | Moves to the next step. Idempotent by `step_id`, so retries never skip a step. `all_remaining` finishes on-your-own steps in bulk |
| `need_help` | Gives one level more support for this step in this run, and records it |
| `repeat_step` | Says the same words again |
| `where_was_i` | Resumes from any device |
| `running_late` | Keeps the must-do steps, drops optional steps that don't fit, and stays neutral for progress |
| `skip_step` | Skips the current step today |
| `my_progress` | The learner's own view of which steps they now do alone |
| `review_suggestions`, `decide_suggestion` | The learner approves or declines a coach's suggestion |
| `list_routines` | Lists routines and any run in progress |

| Coach (6) | What it does |
|---|---|
| `independence_report` | Words of prompting per run, per-step levels, steps needing attention, and every change with its reason |
| `explain_step` | One step's level history and the runs that caused each change |
| `suggest_routine` | Validates a routine (errors block it, warnings advise) and queues it for the learner's approval |
| `set_step_level` | Overrides a step's level. A reason is required and audited |
| `list_suggestions`, `list_routines` | Suggestion status and the routine list |

Every result carries a verbatim `speech` field and stable ids for chaining. Step tools link `ui://scaffold/step-card.html`. The other MCP Apps are `independence-report`, `suggestions` and `progress`.

## How it works
- **Event-sourced.** An append-only, per-person event log is the only truth. Levels, runs, reports and explanations are pure projections of it (`src/core/engine.ts`).
- **Fading policy.** After 3 consecutive unaided runs, a step fades one level. After 2 consecutive aided runs, one level of support is added back and the step is flagged. Levels never skip a rung. This is property-tested.
- **Concurrency.** Commands for each person are serialised. Stores use optimistic concurrency: SQLite through a transaction and primary key, DynamoDB through a conditional `TransactWriteItems` with a tail check. Command ids make a retry safe after an ambiguous commit.
- **Stores.** SQLite (`node:sqlite`) by default, in-memory for tests, DynamoDB for AWS.
- **Security.** Role-scoped tool lists, Host and Origin validation, JSON-only errors, and stateless HMAC sandbox tokens. Full details are in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

The code lives in `src/core` (pure domain), `src/store`, `src/server` (MCP + HTTP), `src/apps` (MCP Apps views + original pictograms) and `src/web` (simulated surface, coach, time machine).

## Tests
```bash
npm test              # unit + property + store contract + MCP-over-HTTP + adversarial-review + web router tests
npm run typecheck
npm run test:e2e      # browser end-to-end (Playwright with the cached Chromium; results in docs/evidence/TEST_RUNS.md)
```

## Deploy to AWS (optional, near-zero cost)
`infra/template.yaml` (AWS SAM) creates:
- **Lambda (arm64) with a Function URL**, serving `/mcp`, the demo API and the simulator;
- **DynamoDB, on-demand**, with TTL for demo sandboxes;
- a **CloudWatch error alarm**;
- an **optional $5/month AWS Budget**.

```bash
scripts/package-lambda.sh
sam deploy --guided --template-file infra/template.yaml   # set TokenSecret; then redeploy with AllowedHosts=<function-url-host>
sam delete --stack-name <stack>                          # teardown
```

## Configuration
See `.env.example`. A local demo needs none of it.

## Limitations
- No real Alexa+ or Echo integration, because the partner toolkit is not available to us. The surface is simulated and labelled.
- No proactive push. Add-ons can't push yet, so a real deployment would pair this with a native Alexa routine such as "start my morning" at 7:00.
- The demo uses static and sandbox bearer tokens. Production would use Alexa account linking (OAuth 2.1 with PKCE).
- Prompts are in English. The simulated router also accepts a few Hinglish commands ("ho gaya", "madad").
- The prompt ladders follow published task-analysis practice, but no practitioner has reviewed them for this product yet.

## Provenance and licences
- All code in this repository was written during the hackathon submission period, starting 2026-10-17. No pre-existing project was extended.
- Licence: Apache-2.0 (`LICENSE`).
- Typeface: Atkinson Hyperlegible (Braille Institute), SIL Open Font License 1.1.
- The pictograms were drawn for this project.
- Major dependencies:
  - `@modelcontextprotocol/*` (MIT)
  - Express (MIT)
  - zod (MIT)
  - Preact (MIT)
  - AWS SDK for JavaScript v3 (Apache-2.0)
  - serverless-http (MIT)
