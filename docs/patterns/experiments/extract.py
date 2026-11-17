#!/usr/bin/env python3
"""Extract the last fenced json block from an agent transcript (JSONL) and save it.

usage: extract.py TRANSCRIPT OUT_JSON"""
import json, re, sys
src, out = sys.argv[1:3]
texts = []
for line in open(src, encoding="utf-8"):
    try:
        e = json.loads(line)
    except json.JSONDecodeError:
        continue
    msg = e.get("message") or {}
    if msg.get("role") != "assistant":
        continue
    c = msg.get("content")
    if isinstance(c, str):
        texts.append(c)
    elif isinstance(c, list):
        for x in c:
            if not isinstance(x, dict):
                continue
            if x.get("type") == "text":
                texts.append(x.get("text", ""))
            elif x.get("type") == "tool_use":   # the hand-back tool carries the report in its input
                texts += [v for v in (x.get("input") or {}).values() if isinstance(v, str)]
for t in reversed(texts):
    m = re.findall(r"```json\s*(\{.*\})\s*```", t, re.S)
    if m:
        obj = json.loads(m[-1], strict=False)
        json.dump(obj, open(out, "w"), indent=1)
        print("saved", out, "keys", list(obj))
        break
else:
    sys.exit("no json block found")
