# Scaffold driven by a real LLM (Amazon Nova + Strands Agents)

The simulated Alexa+ surface in `src/web` uses a deterministic utterance router, so the demo is repeatable. This folder answers the question the router cannot: **given only Scaffold's MCP `instructions` and tool list, does a language model turn messy speech into the right tool calls, chain the ids, and speak `speech` word for word?**

`nova_agent.py` does the following:
1. Creates a fresh demo sandbox.
2. Connects to `/mcp` as that learner through the [Strands Agents](https://github.com/strands-agents/harness-sdk) MCP client.
3. Hands the 11 learner tools to **Amazon Nova on Amazon Bedrock** at temperature 0.
4. Feeds it a scripted list of everyday utterances ("teeth are done", "ho gaya", "wait, what goes in my bag again?", "I'm running late, like ten minutes").
5. Writes `transcript.md` / `transcript.json`. These record every tool call, its arguments, the server's `speech`, what the model said, and whether the two match exactly.

The latest run is in [`docs/evidence/agent/`](../docs/evidence/agent/).

## Run it
Requires Python 3.10+, AWS credentials with `bedrock:InvokeModel` on Amazon Nova in the chosen region, and a running Scaffold, either local or the hosted URL.

```bash
python3 -m venv agent/.venv
agent/.venv/bin/pip install -r agent/requirements.txt
npm start &                                   # or use the hosted URL
agent/.venv/bin/python agent/nova_agent.py --url http://127.0.0.1:8787 --model us.amazon.nova-2-lite-v1:0
```

The server stays deterministic either way. The model only chooses tools and reads out the `speech` field, which is the job Alexa+ does in production.
