# MCP protocol evidence (Scaffold)

Captured 2026-10-17 against a local Scaffold server (`SCAFFOLD_STORE=memory PORT=8797 node src/server/main.ts`). No auth header was sent, so the anonymous local-demo learner was used.

| File | Command | Result |
|---|---|---|
| `inspector_tools_list.json` | `npx @modelcontextprotocol/inspector@2.11.0 --cli http://127.0.0.1:8797/mcp --transport http --method tools/list` | exit 0. Lists 11 learner tools with input/output schemas, annotations and `_meta.ui.resourceUri`. |
| `inspector_call_start_routine.json` | `… --method tools/call --tool-name start_routine --tool-arg routine=morning --tool-arg device=kitchen` | exit 0. `structuredContent.speech` = "Okay, morning routine. I'm here if you need me." |
| `inspector_resources_list.json` | `… --method resources/list` | exit 0. Lists 4 `ui://scaffold/*.html` resources with MIME type `text/html;profile=mcp-app`. |
| `conformance_0.1.16.txt` | `npx @modelcontextprotocol/conformance@0.1.16 server --url http://127.0.0.1:8797/mcp` | exit 1. 6 passed, 24 failed. |

## Conformance suite results
**Passed:**
- `server-initialize`
- `ping`
- `tools-list`
- `resources-list`
- `dns-rebinding-protection` (2/2)
- `server-sse-multiple-streams` reported 0 passed and 0 failed, so nothing was actually checked.

**Failed for an expected reason (no change needed):** most failing scenarios call fixtures from the suite's reference test server. Examples are tools such as `test_simple_text`, prompts, and resources such as `test://static-text`. Scaffold does not implement those fixtures.

**Failed because Scaffold lacks the feature:** a few failures are real gaps rather than fixture problems.
- Scaffold does not declare the `logging` capability (`logging-set-level`).
- It does not declare `completions` (`completion-complete`).
- It has no prompts (`prompts-*`).

Neither the hackathon nor the Alexa+ MCP Toolkit requires any of these three.
