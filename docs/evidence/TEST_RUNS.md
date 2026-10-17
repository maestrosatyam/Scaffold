# Test runs

Last updated 2026-10-17 (22:20–22:45 IST) by the QA / release pass.
Machine: Linux 7.0.0-38, Node **v22.22.1** (nvm), npm **10.9.4**. The system `/usr/bin/node` on this machine is v18.19.1 (see problem P2).

## 1. Clean-clone reproducibility (committed HEAD `f903f5a`)

`git clone <repo> /tmp/scaffold-clean`, then the README commands, in order. Wall time is end-to-end for the command (warm npm cache).

| # | Command (cwd `/tmp/scaffold-clean`) | Exit | Wall | Key output |
|---|---|---|---|---|
| 1 | `git clone …/primary-entry /tmp/scaffold-clean` | 0 | 0.1 s | HEAD `f903f5a README with judge quick start…`; no `.nvmrc` / `.node-version` |
| 2 | `npm ci` | 0 | 5.0 s | `added 258 packages`; **`3 high severity vulnerabilities`** (P5) |
| 3 | `npm run typecheck` (`tsc -p .`) | 0 | 11.1 s | no errors |
| 4 | `npx tsc -p src/web --noEmit` | 0 | 6.8 s | no errors |
| 5 | `npm test` (`vitest run`) | 0 | 3.4 s | **8 files, 168 tests passed**; prints `ExperimentalWarning: SQLite is an experimental feature` (P4) |
| 6 | `npm run build` | 0 | 4.9 s | 4 MCP App views (`dist/apps/*.html`, 296–310 KB each) + `dist/web` (JS 425 KB, gzip 121 KB, plus a 1.87 MB source map) |
| 7 | `PORT=8797 npm start` (defaults otherwise: SQLite `data/scaffold.db`) | running | ready in 1.1 s | `Seeded demo person "sam" with 21 days of synthetic history` · `Scaffold MCP server on http://127.0.0.1:8797 (MCP: /mcp, store: sqlite, tz: America/Los_Angeles)` · ExperimentalWarning on stderr. Port 8797 because another agent's demo server was already on 8787 (see P1) |
| 8 | `curl /healthz` | 0 | <0.1 s | HTTP 200 `{"ok":true,"store":"sqlite","protocol":"2025-11-25"}` |
| 9 | `curl -X POST /mcp` `initialize` (protocolVersion 2025-11-25, `Accept: application/json, text/event-stream`) | 0 | 0.2 s | HTTP 200, SSE `event: message` with `"protocolVersion":"2025-11-25"`, `serverInfo {name: scaffold, version: 0.1.0}`, capabilities tools+resources, instructions present |
| 10 | `curl -X POST /api/demo/sandbox` | 0 | 0.1 s | HTTP 200 `{"personId":"sam-e56ef163a869","learnerToken":"<redacted>","coachToken":"<redacted>","seededEvents":194,"today":"2026-10-17","clock":"demo",…}` |
| 11 | `curl /`, `/coach`, `/time-machine` | 0 | 0.1 s | HTTP 200 `text/html`, 1025 bytes, `<html lang="en">`, title "Scaffold — the routine coach designed to be needed less"; SPA routes 200 |
| 12 | `npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://127.0.0.1:8797/mcp --transport http --method tools/list` | 0 | 3.5 s | **11 tools** (anonymous = learner): start_routine, step_done, need_help, repeat_step, where_was_i, running_late, skip_step, review_suggestions, decide_suggestion, my_progress, list_routines; 9 carry a `ui://` view. Trailer: `Schema portability: 0 errors, 8 warnings across 8 tools` (P8) |
| 13 | same, `--method tools/call --tool-name start_routine --tool-arg routine=morning` (README example) | 0 | 2.6 s | `"speech": "Okay, morning routine. I'm here if you need me."`, no `isError` |
| 14 | stop (SIGTERM) and restart `node src/server/main.ts` on the same `data/scaffold.db` | 0 | 1.5 s | restarts without re-seeding (history persisted); `/healthz` 200 |
| 15 | `npm run test:e2e` **at HEAD** | **127** | 0.3 s | `sh: 1: playwright: not found` (P3; fixed by the uncommitted change in §2) |
| 16 | `npm run check` (typecheck + test + build) | 0 | 14.2 s | 168 passed, build OK |

### Unit / integration test counts (`npm test`, vitest 5.0.5)

| File | Tests |
|---|---|
| tests/engine.test.ts | 17 |
| tests/mcp.http.test.ts | 13 |
| tests/store.test.ts | 13 |
| tests/review/engine.review.test.ts | 11 |
| tests/review/http.review.test.ts | 14 |
| tests/review/lambda.review.test.ts | 6 |
| tests/review/service.review.test.ts | 4 |
| src/web/lib/router.test.ts | 90 |
| **Total** | **168 passed, 0 failed** (2.55 s) |

## 2. Browser E2E (`npm run test:e2e`, Playwright)

Runner: **`@playwright/test` 1.64.1** (devDependency, pinned exact). Its `playwright-core` expects Chromium revision **1248**, which was already in `~/.cache/ms-playwright` (`chromium-1248`, `chromium_headless_shell-1248`), so nothing was downloaded. (The npx-cached `playwright@1.63.0` expects revision 1243, which is not installed.) The 1.64.1 packages have no install scripts; `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install` added 14 MB + 5 MB.

`playwright.config.ts` starts the server through `webServer`: `node src/server/main.ts` with `SCAFFOLD_STORE=memory`, `HOST=127.0.0.1`, a free port picked at config load, and an ephemeral `SCAFFOLD_TOKEN_SECRET`, so `data/` is never touched. It runs `npm run build` first if `dist/` is missing or older than `src/web`, `src/apps` (`E2E_BUILD=1` forces a build, `E2E_BUILD=0` skips it). `E2E_BASE_URL=…` tests an already-running server instead. Every test gets a fresh browser context, so a fresh demo sandbox. An auto fixture fails any test whose page or MCP App iframe logs a console error or throws.

### Run A: main repo (`<repo>`, HEAD f903f5a + uncommitted E2E files). Exit 1, 28.9 s wall (26.9 s tests, 3 workers). The result was the same on a second run (no flakes).

| Spec › test | Result | Time |
|---|---|---|
| headline › start → silent steps → cue → "ho gaya" → partial → help climbs to full → Kitchen "where was I?" → **real click on Done inside the sandboxed step-card iframe** (turn `source: card`, proxied `tools/call step_done` seen on `POST /mcp`) → "all done" → `Nice, you're done at 7:24 AM. 3 of 6 steps on your own.`; initialize offers 2025-11-25, `MCP-Protocol-Version: 2025-11-25` on later calls; iframe `sandbox="allow-scripts"` | PASS | 5.6 s |
| headline › typing in the text box goes through the same path (typed source, start_routine, trace row) | PASS | 2.7 s |
| coach › report shows `21 seeded (synthetic) runs · 0 live runs`, then after a finished morning `21 seeded (synthetic) runs · 1 live run`; live card "finished"; report iframe sandboxed | PASS | 5.4 s |
| coach › suggest Laundry (server-validated, "Waiting for Sam"); before approval "start laundry" → `I couldn't find that routine…`; "any suggestions?" → review; "yes" → `Laundry is ready`; "start laundry" → Laundry, step 1 of 4 at full prompt, card rendered; coach shows "Approved" | PASS | 6.1 s |
| time-machine › 4 columns Day 1 / Day 10 / Day 21 / Today; level chips **full / cue / independent / independent**; Day 1 speech has "Step 1 of 6."; Day 21 silent; 4 MCP App cards rendered | PASS | 3.5 s |
| surface › simulator (with a step card): label visible + in viewport, lang/title, no Alexa/Amazon artwork, named buttons/links, img alt, labelled fields (page + iframes), Playwright accessible names, focus visible on all **32** tab stops (2 in iframes) | PASS | 6.0 s |
| surface › director view (`/?layout=split`): same checks, 43 tab stops (8 in iframes) | PASS | 10.9 s |
| surface › device kiosk (`/device`): same checks, 16 tab stops | PASS | 2.9 s |
| surface › coach view: same checks, 18 tab stops (8 in iframes) | PASS | 5.3 s |
| surface › time machine: same checks, 19 tab stops (10 in iframes) | **FAIL** (real bug P6: the words chart `<svg class="spark" tabindex="0" role="img">` has no visible focus indicator) | 10.3 s |
| surface › self-test: the checks flag a nameless button, an img without alt, an unlabelled input and an `outline:none` link | PASS | 0.7 s |

**Total: 10 passed, 1 failed.** AC-16 is covered by the headline and coach specs, and passes. AC-17 (the label on every page and no Alexa logo) passes on all 5 pages; the one failure is the focus-visible accessibility check.

### Run B: clean clone + the E2E change applied (package.json, package-lock.json, playwright.config.ts, tests/e2e), `dist/` deleted first

| Command | Exit | Wall | Output |
|---|---|---|---|
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci` | 0 | 5.5 s | lockfile consistent; same 3 audit findings |
| `npm run typecheck` (now also checks tests/e2e) | 0 | 10.8 s | no errors |
| `npm run test:e2e` | 1 | 29.8 s | webServer ran `npm run build` (dist was missing), then **10 passed, 1 failed** (same time-machine focus failure) |

## 3. Problems a judge could hit, with proposed fixes

| # | Severity | Problem | Proposed fix |
|---|---|---|---|
| P1 | High | **A busy port looks like a successful start.** Express 5 passes `EADDRINUSE` to the `app.listen` callback. `src/server/main.ts` ignores it, prints `Scaffold MCP server on http://127.0.0.1:8787`, and the process exits with code 0. A judge with an old instance still running would then be testing the old server. Reproduced against a busy 8787: the banner prints and the exit code is 0. | `app.listen(port, host, (err) => { if (err) { console.error(\`Cannot listen on ${host}:${port}: ${err.message}. Set PORT=…\`); process.exit(1); } console.log(…) })` |
| P2 | High | Node < 22.18 fails at `npm start` with `ERR_UNKNOWN_FILE_EXTENSION ".ts"`. This machine's apt Node 18.19.1 shows it. `engines` only warns, and the repo has no `.nvmrc`. | Add `.nvmrc` (`22.18` or `24`) and `.npmrc` with `engine-strict=true`, and add a README line: `node --version  # must be >= 22.18`. |
| P3 | High (fixed, not committed) | At HEAD, `npm run test:e2e` exits 127 (`playwright: not found`): the script exists but the dependency does not. | Commit `@playwright/test@1.64.1` plus `playwright.config.ts` and `tests/e2e/`. Add a README line: on a fresh machine run `npx playwright install chromium` once (about 170 MB). |
| P4 | Low | `ExperimentalWarning: SQLite is an experimental feature` prints on every `npm start` and `npm test`. A judge may read it as an error. | `"start": "node --disable-warning=ExperimentalWarning src/server/main.ts"` (same for `dev`). Optionally add a README note. |
| P5 | Low | `npm ci` reports 3 high-severity vulnerabilities: `braces` via `micromatch` via `vite-plugin-singlefile`. This is build-time only. | Add an `overrides` entry for a patched `braces`, or add a README note that it is a dev/build-only dependency. Don't run `npm audit fix --force`: it downgrades the plugin to 0.9. |
| P6 | Medium (a11y) | `src/web/components/WordsChart.tsx`: the chart SVG has `tabIndex={0}` plus arrow-key handling, but its inline style is `outline: 'none'` and it has no other focus style. That fails WCAG 2.4.7 and fails the E2E time-machine surface test. | Remove `outline: 'none'` from the inline style so the global `:focus-visible` outline applies, or add a visible focus ring or highlighted point on focus. |
| P7 | Medium (security/hygiene) | `data/.token-secret` (the HMAC secret for sandbox tokens) is committed, file mode 0664. It is not in `.gitignore`, so every clone shares it. | `git rm --cached data/.token-secret`, add `data/.token-secret` to `.gitignore`, and keep `data/.gitkeep` if the directory must exist. `main.ts` already regenerates the secret with mode 0600. |
| P8 | Low | Inspector warns `Schema portability: 0 errors, 8 warnings across 8 tools`: nullable output fields use `type: ["string","null"]`. | Emit `anyOf: [{type:"string"},{type:"null"}]`, or add a README note that the warnings are expected. |
| P9 | Low | README links `docs/THREAT_MODEL.md` and `evidence/TEST_RUNS.md`, but neither is in the repo (they live in `../product/` and `../evidence/`). | Copy them into the repo (`docs/`) or link the published location. |
| P10 | Low | `.env.example` suggests a `.env`, but nothing loads it (`node src/server/main.ts` has no `--env-file`). | Use `"start": "node --env-file-if-exists=.env src/server/main.ts"` (Node ≥ 22.9), or say "export these variables" in the README. |
| P11 | Low | `npm run typecheck` does not cover `src/web`, which root `tsconfig` excludes. The README tells judges to run only `npm run typecheck`. | `"typecheck": "tsc -p . && tsc -p src/web"`. |
| P12 | Low | The README's Inspector commands are unpinned and have no `-y`, so npx asks "Ok to proceed?" and may resolve a different version. | `npx -y @modelcontextprotocol/inspector@2.11.0 --cli …` |
| P13 | Info | `dist/web` ships a 1.87 MB source map, and the server serves it. | `build.sourcemap: false` (or `'hidden'`) in `vite.web.config.ts` if that is not wanted. |

Cleanup: `/tmp/scaffold-clean` and the QA scratch directory `/tmp/scaffold-qa` were deleted after the run, and so were `test-results/` and `dist/` in the clone.
