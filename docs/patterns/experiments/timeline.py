#!/usr/bin/env python3
"""Timeline of a pi session: per message, the local time, the gap since the previous message, thinking size,
tool calls (command or path) and the start of each tool result.

usage: timeline.py SESSION.jsonl [RESULT_CHARS]"""
import json, sys
from datetime import datetime, timedelta
path = sys.argv[1]
rc = int(sys.argv[2]) if len(sys.argv) > 2 else 200
prev = None
for line in open(path):
    e = json.loads(line)
    if e.get("type") != "message":
        continue
    t = datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00")) - timedelta(hours=5)
    gap = (t - prev).total_seconds() if prev else 0
    prev = t
    m = e["message"]
    role = m.get("role")
    head = f"{t:%H:%M:%S} +{gap:5.0f}s {role:10}"
    for c in m.get("content") or []:
        ty = c.get("type")
        if ty == "thinking":
            th = c.get("thinking", "")
            print(f"{head} THINK {len(th):6} chars | {th[:160]!r} … {th[-160:]!r}")
        elif ty == "text" and role == "assistant":
            print(f"{head} TEXT  {c['text'][:200]!r}")
        elif ty == "toolCall":
            a = c.get("arguments") or {}
            what = a.get("command") or a.get("path") or json.dumps(a)[:200]
            what = what.split("&& ", 1)[-1] if what.startswith("cd ") else what
            print(f"{head} CALL  {c.get('name')}: {what[:300]!r}")
        elif ty == "text" and role == "toolResult":
            print(f"{head} RESULT {len(c['text']):6} chars | {c['text'][:rc]!r}")
        head = " " * len(head)
