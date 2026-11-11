#!/usr/bin/env python3
"""Check intern guides for Markdown that breaks the pandoc/LaTeX render used by remarquee.

Usage: python3 -I 08-check-guide-markdown.py <guide.md>...

Reports per file: words, code blocks, opening fences without a language tag, unbalanced fences,
raw HTML-looking lines outside code, and '<\\' sequences left by the harness's tag neutraliser.
"""
import re
import sys

HTML = re.compile(r"^\s*</?(div|span|br|p|table|tr|td|img|details|summary|sup|sub)\b", re.I)


def check(path: str) -> str:
    text = open(path, encoding="utf-8").read()
    body = text.split("\n---\n", 1)[1] if text.startswith("---\n") else text
    in_code, blocks, untagged, html, problems = False, 0, [], [], []
    for n, line in enumerate(body.splitlines(), 1):
        s = line.strip()
        if s.startswith("```"):
            if not in_code:
                blocks += 1
                if s == "```":
                    untagged.append(n)
            in_code = not in_code
            continue
        if not in_code and HTML.match(line):
            html.append(n)
    if in_code:
        problems.append("unbalanced fence")
    escaped = body.count("<\\")
    parts = [f"{len(body.split())} words", f"{blocks} code blocks"]
    if untagged:
        parts.append(f"untagged fences at body lines {untagged[:10]}{'…' if len(untagged) > 10 else ''}")
    if html:
        parts.append(f"raw HTML at {html[:10]}")
    if escaped:
        parts.append(f"{escaped} '<\\\\' sequences")
    parts += problems
    return f"{path.split('/')[-3][:7]}: " + ", ".join(parts)


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(check(p))
