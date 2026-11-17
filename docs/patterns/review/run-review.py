#!/usr/bin/env python3
"""Run one isolated pi review of a pattern chapter (pi subagents handbook, go-go-parc Research/playbooks).

usage: run-review.py SPEC.json OUTDIR [MODEL] [THINKING]
SPEC.json: { "chapter": "path.md", "contexts": [...], "questions": {"q1": "...", ...} }
Writes OUTDIR/prompt.md, events.jsonl, stderr.log, answer.json. No tools are given to the agent.
"""
import json, os, re, subprocess, sys

spec_path, out = sys.argv[1], sys.argv[2]
model = sys.argv[3] if len(sys.argv) > 3 else "lunaroute/deepseek-4.1-flash"
think = sys.argv[4] if len(sys.argv) > 4 else "high"
spec = json.load(open(spec_path))
here = os.path.dirname(os.path.abspath(spec_path))
chapter = open(os.path.join(here, spec["chapter"])).read()
os.makedirs(out, exist_ok=True)

qs = "\n".join(f"- {k}: {v}" for k, v in spec["questions"].items())
ctx = "\n".join(f"- {c}" for c in spec["contexts"])
example = {
    "answers": {k: "..." for k in spec["questions"]},
    "review": {"solution_stands_alone": True, "unclear": ["..."], "errors": ["..."], "missing": ["..."],
               "too_long": "...", "suggested_edits": ["..."]},
    "applications": [{"context": "...", "participants": {"<chapter participant>": "<its counterpart>"},
                      "sketch": "pseudocode", "key_note": "which implementation note matters most here, and why",
                      "failure_or_adaptation": "..."}],
    "ratings": {"understanding_confidence": 0.0, "usefulness_1to5": 0, "portability_1to5": 0},
}
prompt = f"""# Role and task

You are a senior engineer reviewing one chapter of a design-pattern book about interactive image engines and their
editors. You have no tools. Work from the chapter text below and your own engineering knowledge.

Do four things:

1. **Comprehension.** Answer each question from the chapter only, in one or two sentences. If the chapter does not
   state the answer, answer exactly "not stated in the chapter". Do not guess.
2. **Review notes.** As a careful reader new to the originating project: does the Solution paragraph stand on its
   own? What is unclear, wrong, or missing? Is anything longer than a reader needs? Is any known use or claim
   doubtful? Give concrete suggested edits.
3. **Apply it elsewhere.** For each context listed below, design how the pattern would be used there: map the
   chapter's participants to that context's parts, give a short pseudocode sketch, name the one implementation note
   from the chapter that matters most there and why, and say where the pattern would fail or need adapting.
4. **Rate** your understanding confidence (0 to 1), the pattern's usefulness for these contexts (1 to 5), and its
   portability beyond image software (1 to 5).

# Questions

{qs}

# Contexts to apply the pattern to

{ctx}

# Output contract

Your final message must be exactly one fenced ```json block with this shape (fill every field; lists may be empty):

```json
{json.dumps(example, indent=2)}
```

# The chapter

{chapter}
"""
open(f"{out}/prompt.md", "w").write(prompt)
cmd = ["pi", "-p", "--mode", "json", "--no-builtin-tools", "--no-context-files", "--no-skills",
       "--no-prompt-templates", "--session-dir", f"{out}/session", "--model", model, "--thinking", think, prompt]
with open(f"{out}/events.jsonl", "w") as ev, open(f"{out}/stderr.log", "w") as er:
    subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=ev, stderr=er, cwd=out, timeout=1800)

texts = []
for line in open(f"{out}/events.jsonl"):
    try:
        e = json.loads(line)
    except json.JSONDecodeError:
        continue
    msg = e.get("message") or {}
    if msg.get("role") == "assistant":
        for c in msg.get("content") or []:
            if isinstance(c, dict) and c.get("type") == "text":
                texts.append(c["text"])
for t in reversed(texts):
    m = re.findall(r"```json\s*(\{.*\})\s*```", t, re.S)
    if m:
        txt = m[-1]
        try:
            json.loads(txt)
        except json.JSONDecodeError:
            try:
                txt = json.dumps(json.loads(txt, strict=False))          # raw newline inside a string
            except json.JSONDecodeError:
                # unescaped quotes inside prose: a quote between a word and a space, or a space and a word
                fixed = re.sub(r'(?<=[A-Za-z0-9.,;)] )"(?=[A-Za-z0-9])', r'\\"', txt)
                fixed = re.sub(r'(?<=[A-Za-z0-9.?!)])"(?= [A-Za-z0-9(—-])', r'\\"', fixed)
                open(f"{out}/raw.txt", "w").write(t)
                txt = json.dumps(json.loads(fixed, strict=False))
        open(f"{out}/answer.json", "w").write(txt)
        print("answer written", out)
        break
else:
    print("no answer found", out, file=sys.stderr)
    sys.exit(1)
