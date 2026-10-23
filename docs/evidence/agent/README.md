# A real LLM driving Scaffold: Amazon Nova 2 Lite on Amazon Bedrock, via Strands Agents

`transcript.md` and `transcript.json` are the run of `agent/nova_agent.py` against the **live** server (2026-10-23 17:22 UTC).
- The model was `us.amazon.nova-2-lite-v1:0`, at temperature 0.
- It got only the server's MCP `instructions` and its 11 learner tools.

**Result:**
- Nova chose the right tool for each of the 9 messy utterances, including "ho gaya", "wait, what goes in my bag again?" and "I'm running late, like ten minutes".
- It chained the real `run_id` and `step_id`.
- It spoke the server's `speech` **exactly in 9 of 9 turns**.

**The first run failed, and why.**
- Scaffold returned the ids only in `structuredContent`, and its text block held just the speech.
- Strands, like many MCP clients, gives the model only the text blocks. Nova never saw `run_id`, invented one, and every `step_done` failed with "Run … not found".
- The MCP spec says a tool with structured output *should* also return it as JSON in a text block. Scaffold now does: `src/server/mcp.ts` `ok()`, checked in `tests/mcp.http.test.ts`. The rerun above is after that fix.

**Account note.** Bedrock was called from a second account in the same AWS Organization. The demo account was new, and its Nova daily-token quota was still 0 on deadline day (friction entry F-10).
