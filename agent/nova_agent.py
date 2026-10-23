"""Drive the Scaffold MCP server with a real LLM (Amazon Nova on Amazon Bedrock, via Strands Agents).

The simulated Alexa+ surface uses a deterministic utterance router. This script answers the other
question: does a language model, given only the server's instructions and tool list, turn messy
speech into the right tool calls, chain the ids, and speak the "speech" field word for word?

It creates a fresh demo sandbox, connects to /mcp as that learner, feeds a scripted list of
utterances, and writes a transcript that records every tool call and whether the spoken reply
matched the server's speech exactly.

    python agent/nova_agent.py --url http://127.0.0.1:8787 --out docs/evidence/agent
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient

UTTERANCES = [
    "hey, ok... let's do my morning stuff",
    "teeth are done",
    "yep, finished that one",
    "ho gaya",
    "ok did it",
    "wait, what goes in my bag again?",
    "can you say that again",
    "I'm running late, like ten minutes",
    "all done, I'm good",
]

PERSONA = """You are the voice assistant on the learner's Echo device, standing in for Alexa+.
Reply with exactly the words to speak aloud and nothing else: no explanations, no markdown, no quotes.
If the last tool result has an empty "speech" field, reply with nothing at all."""

NO_SPEECH = "(no speech: the person is doing this step on their own)"


def new_sandbox(base_url: str) -> dict:
    req = urllib.request.Request(f"{base_url}/api/demo/sandbox", method="POST", data=b"{}", headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def server_instructions(base_url: str, token: str) -> str:
    """The `instructions` the server returns from initialize (read over the JSON-only endpoint)."""
    body = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "nova-agent", "version": "0.1.0"}}}
    headers = {"content-type": "application/json", "accept": "application/json", "authorization": f"Bearer {token}"}
    req = urllib.request.Request(f"{base_url}/mcp-json", method="POST", data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)["result"].get("instructions", "")


def tool_calls_since(messages: list, start: int) -> list[dict]:
    """Pairs each toolUse in messages[start:] with its toolResult."""
    uses, results = {}, {}
    for msg in messages[start:]:
        for block in msg.get("content", []):
            if "toolUse" in block:
                uses[block["toolUse"]["toolUseId"]] = block["toolUse"]
            if "toolResult" in block:
                results[block["toolResult"]["toolUseId"]] = block["toolResult"]
    calls = []
    for use_id, use in uses.items():
        result = results.get(use_id, {})
        calls.append({"name": use["name"], "input": use.get("input", {}), "status": result.get("status"), "speech": speech_of(result)})
    return calls


def speech_of(result: dict) -> str | None:
    """The server's speech for a tool result: structured content when present, else the text block."""
    structured = result.get("structuredContent")
    if isinstance(structured, dict) and isinstance(structured.get("speech"), str):
        return structured["speech"]
    for block in result.get("content", []):
        data = block.get("json")
        if data is None and isinstance(block.get("text"), str) and block["text"].startswith("{"):
            try:
                data = json.loads(block["text"])
            except ValueError:
                data = None
        if isinstance(data, dict) and isinstance(data.get("speech"), str):
            return data["speech"]
    for block in result.get("content", []):
        text = block.get("text")
        if isinstance(text, str):
            return "" if text == NO_SPEECH else text
    return None


def normalise(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--url", default="http://127.0.0.1:8787", help="Scaffold base URL (no trailing slash)")
    ap.add_argument("--model", default="us.amazon.nova-2-lite-v1:0", help="Bedrock model or inference profile id")
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument("--out", default="docs/evidence/agent", help="directory for transcript.md and transcript.json")
    args = ap.parse_args()
    base = args.url.rstrip("/")

    sandbox = new_sandbox(base)
    client = MCPClient(url=f"{base}/mcp", headers={"Authorization": f"Bearer {sandbox['learnerToken']}"})
    model = BedrockModel(model_id=args.model, region_name=args.region, temperature=0.0, max_tokens=400)

    turns = []
    with client:
        tools = client.list_tools_sync()
        system = f"{server_instructions(base, sandbox['learnerToken'])}\n\n{PERSONA}"
        agent = Agent(model=model, tools=tools, system_prompt=system, callback_handler=None)
        for utterance in UTTERANCES:
            start = len(agent.messages)
            t0 = time.perf_counter()
            reply = str(agent(utterance)).strip()
            elapsed = time.perf_counter() - t0
            calls = tool_calls_since(agent.messages, start)
            expected = next((c["speech"] for c in reversed(calls) if c["speech"] is not None), None)
            verbatim = expected is not None and normalise(reply) == normalise(expected)
            turns.append({"utterance": utterance, "tool_calls": calls, "server_speech": expected, "spoken": reply, "verbatim": verbatim, "seconds": round(elapsed, 2)})
            print(f"> {utterance}", flush=True)
            for c in calls:
                print(f"  {c['name']} {json.dumps(c['input'])} -> {c['status']}: {(c['speech'] or '')[:90]}", flush=True)
            print(f"  said: {reply or '(silence)'}  | verbatim: {verbatim}\n", flush=True)

    write_transcript(Path(args.out), base, args.model, sandbox["personId"], [t.tool_name for t in tools], turns)
    return 0


def write_transcript(out: Path, base: str, model: str, person: str, tool_names: list[str], turns: list[dict]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    when = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    with_speech = [t for t in turns if t["server_speech"] is not None]
    matched = sum(t["verbatim"] for t in with_speech)
    (out / "transcript.json").write_text(json.dumps({"when": when, "server": base, "model": model, "person": person, "tools": tool_names, "turns": turns}, indent=2) + "\n")
    lines = [
        "# Scaffold driven by Amazon Nova (Strands Agents)",
        "",
        f"Run {when} against `{base}/mcp` with `{model}` on Amazon Bedrock, temperature 0. Fresh demo sandbox `{person}`, learner token.",
        f"The model saw only the server's `instructions` and its {len(tool_names)} learner tools. Spoken reply matched the server's `speech` exactly in **{matched} of {len(with_speech)}** turns.",
        "",
        "| # | Learner said | Tool calls (arguments) | Server `speech` | Model said | Verbatim |",
        "|---|---|---|---|---|---|",
    ]
    for i, t in enumerate(turns, 1):
        calls = "<br>".join(f"`{c['name']}` {json.dumps(c['input'], separators=(',', ':'))}" for c in t["tool_calls"]) or "none"
        speech = "(empty)" if t["server_speech"] == "" else (t["server_speech"] or "n/a")
        lines.append(f"| {i} | {t['utterance']} | {calls} | {speech} | {t['spoken'] or '(silence)'} | {'yes' if t['verbatim'] else 'no'} |")
    (out / "transcript.md").write_text("\n".join(lines) + "\n")
    print(f"Wrote {out / 'transcript.md'}")


if __name__ == "__main__":
    sys.exit(main())
