#!/usr/bin/env python3
"""Blind design review of one task's implementations (playbook §6: Alexander / Gabriel / Fowler rubric).

usage: review-design.py TASK RUNS_ROOT OUT_DIR SEED [MODEL] [--run-pi] [--allow-partial]

Builds OUT_DIR/<task>-r<SEED>/ holding CHAPTER.md (the yardstick), TASK.md, FACTS.md and impl-A … impl-F: copies of
each run's project/src and project/test only (no diary, notes or self-report), in an order shuffled by SEED, with the
word "chapter" (and CHAPTER.md) replaced by "[ref]" so the reviewer cannot tell which runs had the chapter. The key
(letter → run, redaction counts) goes to OUT_DIR/keys/<task>-r<SEED>.json, outside the reviewer's directory, and the
reviewer prompt to OUT_DIR/<task>-r<SEED>.prompt.md.

By default only the workspace and prompt are built: the review itself is run by an Opus subagent (Claude Code's Agent
tool, model opus) given the prompt, and its JSON is saved as OUT_DIR/<task>-r<SEED>.answer.json. With --run-pi, a pi
agent (MODEL, read-only tools read, ls, find, grep) runs the review in the workspace instead.
"""
import glob
import json
import os
import random
import re
import shutil
import subprocess
import sys

args = [a for a in sys.argv[1:] if not a.startswith("--")]
flags = {a for a in sys.argv[1:] if a.startswith("--")}
task, root, out_root, seed = args[0], args[1], args[2], int(args[3])
model = args[4] if len(args) > 4 else "lunaroute/deepseek-4.1-flash"
here = os.path.dirname(os.path.abspath(__file__))
CHAPTERS = {"graph": "01-interned-operation-graph.md", "slots": "04-latest-wins-render-slots.md",
            "tiling": "08-reach-declared-tiling.md", "document": "09-vector-edit-document.md"}

# A concrete next requirement per task, for the piecemeal-growth lens: where would each implementation change?
CHANGES = {
    "graph": [
        "Add an operation `crop` (1 input; arguments x, y, w, h in full-size pixels, scaled like blur's radius).",
        "Bound the reuse cache: keep at most N bytes of results, evicting the least recently used.",
    ],
    "slots": [
        "Add a pass `proof` that is never aborted by newer requests and is presented even when stale is otherwise "
        "dropped (soft-proof renders the user explicitly asked for).",
        "Allow at most 2 background renders to run at once across all slots.",
    ],
    "tiling": [
        "Add an operation `sharpen` { amount, sigmaUm }: v + amount × (v − blur(v, sigmaUm)) (it needs a "
        "neighbourhood and its own centre value).",
        "Add an operation `downsample2` that halves width and height (2 × 2 box average): the output grid differs "
        "from the input grid.",
    ],
    "document": [
        "Add a linear-gradient mask (two points dragged in the viewer, plus a feather width) that must land on the "
        "same part of the photograph at any resolution and survive save/load.",
        "Introduce document version 3, which renames `exposure` to `tone.exposure`; versions 1 and 2 must still load.",
    ],
}

REDACT = re.compile(r"CHAPTER\.md|\bchapters?\b|pattern book|pattern language|interned[ -]operation[ -]graph|"
                    r"latest[ -]wins[ -]render[ -]slots?|reach[ -]declared[ -]tiling|vector[ -]edit[ -]document", re.I)


def finished_runs():
    runs = sorted(glob.glob(os.path.join(root, task, "*-*")))
    done = [r for r in runs if os.path.exists(os.path.join(r, "answer.json"))]
    if len(done) < 6 and "--allow-partial" not in flags:
        sys.exit(f"{task}: only {len(done)} of 6 runs finished; pass --allow-partial to review them anyway")
    return done


def copy_impl(run, dest):
    """Copies src/ and test/ with the chapter vocabulary redacted; returns (redactions, files, lines)."""
    redactions, nfiles, nlines = 0, 0, 0
    for sub in ("src", "test"):
        for f in sorted(glob.glob(os.path.join(run, "project", sub, "**", "*"), recursive=True)):
            if not os.path.isfile(f) or not re.search(r"\.(ts|js|mjs|json)$", f):
                continue
            text = open(f, encoding="utf-8", errors="replace").read()
            text, n = REDACT.subn("[ref]", text)
            redactions += n
            target = os.path.join(dest, os.path.relpath(f, os.path.join(run, "project")))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            open(target, "w", encoding="utf-8").write(text)
            nfiles += 1
            nlines += text.count("\n")
    return redactions, nfiles, nlines


runs = finished_runs()
rng = random.Random(seed)
order = runs[:]
rng.shuffle(order)
letters = "ABCDEFGH"[: len(order)]
ws = os.path.join(out_root, f"{task}-r{seed}")
if os.path.exists(ws):
    shutil.rmtree(ws)
os.makedirs(ws)
shutil.copy(os.path.join(here, "..", CHAPTERS[task]), os.path.join(ws, "CHAPTER.md"))
shutil.copy(os.path.join(here, "tasks", task, "TASK.md"), os.path.join(ws, "TASK.md"))
key, facts = {}, ["# Facts about the implementations", "", "| impl | files | lines (src) | lines (test) |", "|---|---|---|---|"]
for letter, run in zip(letters, order):
    dest = os.path.join(ws, f"impl-{letter}")
    red, nfiles, _ = copy_impl(run, dest)
    src_lines = sum(open(f).read().count("\n") for f in glob.glob(os.path.join(dest, "src", "**", "*.ts"), recursive=True))
    test_lines = sum(open(f).read().count("\n") for f in glob.glob(os.path.join(dest, "test", "**", "*"), recursive=True)
                     if os.path.isfile(f))
    facts.append(f"| impl-{letter} | {nfiles} | {src_lines} | {test_lines} |")
    key[letter] = {"run": os.path.relpath(run, root), "redactions": red}
open(os.path.join(ws, "FACTS.md"), "w").write("\n".join(facts) + "\n")
os.makedirs(os.path.join(out_root, "keys"), exist_ok=True)
json.dump(key, open(os.path.join(out_root, "keys", f"{task}-r{seed}.json"), "w"), indent=1)

impls = ", ".join(f"impl-{x}" for x in letters)
changes = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(CHANGES[task]))
example = {
    "implementations": {
        "A": {
            "summary": "two sentences: the design",
            "seams": ["the main internal interfaces, file:line"],
            "participants": {"<participant named in CHAPTER.md>": "file:line of its counterpart, or 'absent'"},
            "forces": {"resolved": ["force: how, file:line"], "in_tension": ["..."], "unnoticed": ["..."]},
            "adapted_not_copied": "is it shaped by this task, or a transcription of a generic sketch? evidence",
            "wholeness": ["dead, unused or ornamental structure, file:line"],
            "habitability": "could a newcomer change it comfortably? evidence",
            "change_requests": [{"change": 1, "touches": ["file:line"], "local": True, "notes": "..."}],
            "smells": [{"where": "file:line", "smell": "duplicated knowledge | long function | primitive obsession | "
                        "shotgun surgery | speculative generality | other", "note": "..."}],
            "tests_as_laws": "do the tests state properties and negative controls, or only examples? evidence",
            "scores_1to5": {"forces": 0, "adapted": 0, "wholeness": 0, "habitability": 0, "piecemeal_growth": 0,
                            "smell_free": 0, "tests_as_laws": 0},
        }
    },
    "cross": {
        "generativity": "did similar seams and participants emerge across implementations, each different in detail?",
        "clusters": [["A", "C"], ["B"]],
        "worse_is_better": "did a smaller implementation reach the same quality with less? which, and why",
        "ranking": ["best first"],
        "ideas_the_yardstick_lacks": ["good ideas in the code that CHAPTER.md does not describe"],
        "yardstick_problems": ["where following CHAPTER.md would have hurt this task"],
    },
    "guess_yardstick_used": {"A": 0.0},
    "confidence": 0.0,
}
prompt = f"""# Role and task

You are a senior software designer doing a design review in the spirit of Christopher Alexander (forces, wholeness,
generativity), Richard Gabriel (habitability, piecemeal growth, worse is better) and Martin Fowler (code smells).

The review directory `{ws}` holds {len(letters)} independent implementations of one task: {impls}. Each has `src/` and `test/`. `TASK.md` is
the task they were given. `CHAPTER.md` is a design-pattern chapter for this kind of problem: use it as the yardstick
for what forces exist and what a good structure resolves, not as a checklist to tick. `FACTS.md` gives sizes. Some
words were replaced by "[ref]" in the code; ignore that.

Work only inside the review directory, read-only: do not read, list or search anything outside it, and do not change
any file. Read `TASK.md` and `CHAPTER.md` first, then read every implementation's `src/`
completely, and enough of each `test/` to judge it. Cite evidence as `impl-X/path:line`. Judge only what the code shows.

# Rubric (for each implementation)

- **Forces resolved** (Alexander): which of the chapter's forces does the code resolve, which does it leave in
  tension, which does it never notice? The trade-off must be visible in code, not only in comments.
- **Adapted, not copied** (Alexander): is it shaped by this task's context (names and structure from the task's
  domain), or a transcription of a generic sketch, including parts this task does not need?
- **Wholeness** (Alexander): does every part serve the whole? Name dead, unused or ornamental structure.
- **Habitability** (Gabriel): could a newcomer live in this code and change it comfortably? Over-compressed or
  over-abstracted? Look at locality of change, names, size of units, density.
- **Piecemeal growth** (Gabriel): for each change request below, list the places it would touch and say whether the
  change is local.
- **Smells** (Fowler): duplicated knowledge, long functions, primitive obsession (for example ids built by string
  concatenation), shotgun surgery, speculative generality; concrete `file:line` findings.
- **Tests as laws:** do the tests state the forces as properties and negative controls, or only examples?

Score each lens 1 (poor) to 5 (excellent); `smell_free` 5 means no smells.

# Change requests (piecemeal growth)

{changes}

# Across the implementations

- **Generativity:** did similar structure emerge (same seams, same participants), each different in detail? Group
  the implementations into clusters of similar design.
- **Worse is better** (Gabriel): did a simpler, smaller implementation reach the same quality? Then the yardstick may
  ask for too much.
- Rank the implementations, best first. List good ideas in the code that the chapter lacks, and places where
  following the chapter would have hurt this task.
- **Last, after all scores are written:** for each implementation, estimate the probability (0 to 1) that its author
  had read `CHAPTER.md` while working. Some did and some did not.

# Output contract

Your final message must be exactly one fenced ```json block with this shape, one entry per implementation
({", ".join(letters)}), every field filled:

```json
{json.dumps(example, indent=2)}
```
"""
open(os.path.join(out_root, f"{task}-r{seed}.prompt.md"), "w").write(prompt)
print("workspace", ws, "redactions", {k: v["redactions"] for k, v in key.items()})
if "--run-pi" not in flags:
    sys.exit(0)

base = os.path.join(out_root, f"{task}-r{seed}")
cmd = ["pi", "-p", "--mode", "json", "--tools", "read,ls,find,grep", "--no-context-files", "--no-skills",
       "--no-prompt-templates", "--session-dir", base + ".session", "--model", model, "--thinking", "high", prompt]
with open(base + ".events.jsonl", "w") as ev, open(base + ".stderr.log", "w") as er:
    try:
        subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=ev, stderr=er, cwd=ws, timeout=3600)
    except subprocess.TimeoutExpired:
        er.write("TIMEOUT after 3600 s\n")

texts = []
for line in open(base + ".events.jsonl"):
    try:
        e = json.loads(line)
    except json.JSONDecodeError:
        continue
    msg = e.get("message") or {}
    if e.get("type") == "message_end" and msg.get("role") == "assistant":
        texts += [c["text"] for c in msg.get("content") or [] if isinstance(c, dict) and c.get("type") == "text"]
for t in reversed(texts):
    m = re.findall(r"```json\s*(\{.*\})\s*```", t, re.S)
    if not m:
        continue
    txt = m[-1]
    for _ in range(3):
        try:
            obj = json.loads(txt, strict=False)
            break
        except json.JSONDecodeError:
            txt = re.sub(r'(?<=[A-Za-z0-9.,;)] )"(?=[A-Za-z0-9])', r'\\"', txt)
            txt = re.sub(r'(?<=[A-Za-z0-9.?!)])"(?= [A-Za-z0-9(—-])', r'\\"', txt)
    else:
        open(base + ".answer.raw.txt", "w").write(t)
        sys.exit(f"unparseable answer {base}")
    json.dump(obj, open(base + ".answer.json", "w"), indent=1)
    print("answer written", base + ".answer.json")
    break
else:
    sys.exit(f"no answer found {base}")
