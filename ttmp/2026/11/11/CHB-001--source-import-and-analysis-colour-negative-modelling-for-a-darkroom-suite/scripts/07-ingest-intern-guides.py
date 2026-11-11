#!/usr/bin/env python3
"""Ingest intern-guide blocks returned by guide-writing subagents into their docmgr tickets.

Usage: python3 -I 07-ingest-intern-guides.py <agent-output-file> <repo-root> [--replace] [--dry-run]

The agent output contains, per ticket:
  =====BEGIN GUIDE CHB-0NN===== ... =====END GUIDE CHB-0NN=====
  =====BEGIN TASKS CHB-0NN===== - [stage] text ... =====END TASKS CHB-0NN=====
  =====BEGIN RELATED CHB-0NN===== /abs/path:reason ... =====END RELATED CHB-0NN=====

For each ticket the script
  * writes the guide body after the YAML frontmatter of ttmp/*/<ID>--*/design-doc/01-intern-guide-*.md
    (refuses if the doc already has a body, unless --replace),
  * adds each task with `docmgr task add`,
  * relates each existing path to the guide with `docmgr doc relate --doc`.
It prints a summary line per ticket. Nothing in the agent text is executed.
"""
import glob
import os
import re
import subprocess
import sys

BLOCK = re.compile(r"^=====BEGIN (GUIDE|TASKS|RELATED) (CHB-\d{3})=====\n(.*?)^=====END \1 \2=====$", re.S | re.M)


def split_frontmatter(text: str):
    if not text.startswith("---\n"):
        return "", text
    end = text.index("\n---\n", 4) + len("\n---\n")
    return text[:end], text[end:]


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    replace = "--replace" in sys.argv
    dry = "--dry-run" in sys.argv
    out_file, repo = args[0], args[1]
    raw = open(out_file, encoding="utf-8").read()
    blocks = {}
    for kind, tid, body in BLOCK.findall(raw):
        blocks.setdefault(tid, {})[kind] = body
    if not blocks:
        print("no blocks found", file=sys.stderr)
        sys.exit(1)
    for tid, parts in sorted(blocks.items()):
        docs = glob.glob(os.path.join(repo, "ttmp", "*", "*", "*", f"{tid}--*", "design-doc", "01-intern-guide-*.md"))
        if len(docs) != 1:
            print(f"{tid}: expected one guide doc, found {docs}")
            continue
        doc = docs[0]
        summary = [tid]
        if "GUIDE" in parts:
            fm, body = split_frontmatter(open(doc, encoding="utf-8").read())
            # docmgr's design-doc template body is only headings and <!-- --> placeholders: treat as empty
            substantive = [l for l in body.splitlines()
                           if l.strip() and not l.lstrip().startswith("#") and not re.fullmatch(r"\s*<!--.*-->\s*", l)]
            if substantive and not replace:
                summary.append("guide SKIPPED (doc has a body; use --replace)")
            else:
                guide = parts["GUIDE"].rstrip() + "\n"
                if not dry:
                    with open(doc, "w", encoding="utf-8") as f:
                        f.write(fm + "\n" + guide)
                words = len(guide.split())
                escaped = guide.count("<\\")
                summary.append(f"guide {words} words" + (f", {escaped} escaped '<\\\\'" if escaped else ""))
        else:
            summary.append("NO GUIDE")
        n_tasks = 0
        for line in parts.get("TASKS", "").splitlines():
            line = line.strip()
            if not line.startswith("- "):
                continue
            n_tasks += 1
            if not dry:
                subprocess.run(["docmgr", "task", "add", "--ticket", tid, "--text", line[2:].strip()],
                               cwd=repo, check=True, capture_output=True)
        summary.append(f"{n_tasks} tasks")
        related, skipped = [], []
        for line in parts.get("RELATED", "").splitlines():
            line = line.strip()
            if not line or ":" not in line:
                continue
            path, _, reason = line.partition(":")
            path = os.path.expanduser(path.strip())
            (related if os.path.exists(path) else skipped).append((path, reason.strip()))
        if related and not dry:
            cmd = ["docmgr", "doc", "relate", "--doc", doc]
            for path, reason in related:
                cmd += ["--file-note", f"{path}:{reason}"]
            subprocess.run(cmd, cwd=repo, check=True, capture_output=True)
        summary.append(f"{len(related)} related" + (f", {len(skipped)} missing: {[p for p, _ in skipped]}" if skipped else ""))
        print(" | ".join(summary))


if __name__ == "__main__":
    main()
