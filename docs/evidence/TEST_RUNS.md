# Test runs: final evidence

| Check | Result |
|---|---|
| Typecheck (server + web) | ✅ exit 0 |
| Vitest: unit, property, store contracts (memory/SQLite/mocked DynamoDB), MCP over real HTTP, adversarial-review regressions, web router and presentation | ✅ **212 / 212** passed (10 files; 2026-10-23 23:14 IST, final) |
| Build (MCP Apps single-file cards + web) | ✅ exit 0 |
| Playwright e2e (cached Chromium): headline flow incl. tap inside the sandboxed MCP App, coach report, consent flow, time machine, "simulated" label + a11y on every page | ✅ **11 / 11** passed locally |
| **The same e2e suite against the live AWS deployment** (`E2E_BASE_URL=https://tjncr2jv6v7sqw6jw467fbdyha0pesly.lambda-url.ap-southeast-2.on.aws`) | ✅ **11 / 11** passed (41.8 s, 2026-10-23 21:50 IST, final deploy); see `aws/DEPLOYMENT.md` |
| Clean clone of the final commit: `npm ci`, `npm test`, `npm run build`, `npm start` | ✅ all exit 0 |
| Smoke against the clean clone: `/healthz`, MCP `initialize`, Inspector `tools/list`, demo sandbox | ✅ 200 · `protocolVersion: 2025-11-25` · 11 learner tools · 194 seeded events |

Known and accepted:
- `npm audit` (with dev dependencies) reports 1 high advisory in `braces`. It comes in at build time only, through `vite-plugin-singlefile` → `micromatch`, and no patched version exists. `npm audit --omit=dev` reports 0.
- `node:sqlite` is marked experimental in Node 22. Its warning is silenced in `npm start`.

Raw command log:

# Test runs — final commit 58f9ca9 (2026-10-18T00:44:22+05:30)

Machine: Linux x86_64, Node v22.22.1, npm 10.9.4. All commands run from the repo root.

### `npm run typecheck`
exit **0**, 12 s
```

> primary-entry@0.1.0 typecheck
> tsc -p . && tsc -p src/web --noEmit
```

### `npx vitest run`
exit **0**, 3 s
```
 RUN  v5.0.5 <repo>

(Use `node --trace-warnings ...` to show where the warning was created)

 Test Files  9 passed (9)
      Tests  170 passed (170)
   Start at  00:44:35
   Duration  2.34s (tests 53%, import 39%, transform 8%, worker 1%)
```

### `npm run build`
exit **0**, 4 s
```
dist/web/assets/index-C9C4y9UV.css                                          34.26 kB │ gzip:   8.20 kB
dist/web/assets/index-MeKdJ7MI.js                                          425.41 kB │ gzip: 121.04 kB

✓ built in 497ms
```

### `npx playwright test`
exit **0**, 23 s
```

Running 11 tests using 3 workers

  ✓   2 [chromium] › tests/e2e/coach.spec.ts:7:1 › coach report shows 1 live run next to the 21 seeded runs after a finished morning (4.7s)
  ✓   3 [chromium] › tests/e2e/headline.spec.ts:6:1 › headline flow: start, fade to silence, cue, help climbs, kitchen resume, tap Done on the card, finish (4.7s)
  ✓   1 [chromium] › tests/e2e/coach.spec.ts:34:1 › coach suggests Laundry, the learner approves by voice, then starts laundry (5.4s)
  ✓   5 [chromium] › tests/e2e/headline.spec.ts:98:1 › typing in the text box goes through the same path as the automation hook (2.5s)
  ✓   7 [chromium] › tests/e2e/surface.spec.ts:163:3 › device kiosk: "Simulated Alexa+ surface — not Amazon software" label, no Alexa logo, basic accessibility (2.9s)
  ✓   4 [chromium] › tests/e2e/surface.spec.ts:163:3 › simulator (with a step card on screen): "Simulated Alexa+ surface — not Amazon software" label, no Alexa logo, basic accessibility (5.6s)
  ✓   8 [chromium] › tests/e2e/surface.spec.ts:163:3 › coach view: "Simulated Alexa+ surface — not Amazon software" label, no Alexa logo, basic accessibility (4.8s)
  ✓   6 [chromium] › tests/e2e/surface.spec.ts:163:3 › director view: "Simulated Alexa+ surface — not Amazon software" label, no Alexa logo, basic accessibility (10.1s)
  ✓  10 [chromium] › tests/e2e/surface.spec.ts:207:1 › the accessibility checks themselves catch a nameless button, an image without alt and an unlabelled field (580ms)
  ✓   9 [chromium] › tests/e2e/surface.spec.ts:163:3 › time machine: "Simulated Alexa+ surface — not Amazon software" label, no Alexa logo, basic accessibility (7.1s)
  ✓  11 [chromium] › tests/e2e/time-machine.spec.ts:5:1 › time machine shows the first step fading full -> cue -> independent (2.7s)

  11 passed (20.9s)
```

## Clean clone of the final commit (`git clone <repo> && cd <repo>`)

### `npm ci --no-audit --no-fund`
exit **0**, 4 s
```

added 261 packages in 4s
```

### `npm test`
exit **0**, 3 s
```

 Test Files  9 passed (9)
      Tests  170 passed (170)
   Start at  00:45:23
   Duration  2.42s (tests 44%, import 29%, transform 26%, worker 1%)
```

### `npm run build`
exit **0**, 3 s
```

✓ built in 546ms
```

### `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8796/healthz`
exit **0**, 0 s
```
200
```

### `curl -s -X POST http://127.0.0.1:8796/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"judge","version":"0"}}}' | grep -o '"protocolVersion":"[^"]*"'`
exit **0**, 0 s
```
"protocolVersion":"2025-11-25"
```

### `npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://127.0.0.1:8796/mcp --transport http --method tools/list | grep -c '"name": "'`
exit **0**, 3 s
```
11
```

### `curl -s -X POST http://127.0.0.1:8796/api/demo/sandbox | grep -o '"seededEvents":[0-9]*'`
exit **0**, 0 s
```
"seededEvents":194
```

