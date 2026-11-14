#!/usr/bin/env python3
"""One isolated pi implementation run for the pattern experiments (pi subagents handbook, go-go-parc).

usage: run-impl.py TASK VARIANT N RUNS_ROOT [MODEL] [THINKING]
  TASK     graph | slots | tiling | document
  VARIANT  chapter (the pattern chapter is given) | control (it is not)
Creates RUNS_ROOT/TASK/VARIANT-N/ with TASK.md, DIARY-SKILL.md, CHAPTER.md (chapter variant), an empty project/,
prompt.md, session/ (native pi JSONL), events.jsonl, stderr.log and answer.json (the agent's self-report).
"""
import json, os, re, shutil, subprocess, sys

task, variant, n, root = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
model = sys.argv[5] if len(sys.argv) > 5 else "lunaroute/deepseek-4.1-flash"
think = sys.argv[6] if len(sys.argv) > 6 else "high"
here = os.path.dirname(os.path.abspath(__file__))
CHAPTERS = {"graph": "01-interned-operation-graph.md", "slots": "04-latest-wins-render-slots.md",
            "tiling": "08-reach-declared-tiling.md", "document": "09-vector-edit-document.md"}
out = os.path.join(root, task, f"{variant}-{n}")
if os.path.exists(os.path.join(out, "answer.json")):
    print("done already", out); sys.exit(0)
os.makedirs(os.path.join(out, "project"), exist_ok=True)
shutil.copy(os.path.join(here, "tasks", task, "TASK.md"), os.path.join(out, "TASK.md"))
shutil.copy(os.path.expanduser("~/.codex/skills/diary/SKILL.md"), os.path.join(out, "DIARY-SKILL.md"))
with_chapter = variant == "chapter"
if with_chapter:
    shutil.copy(os.path.join(here, "..", CHAPTERS[task]), os.path.join(out, "CHAPTER.md"))

chapter_part = """
## The design-pattern chapter

`CHAPTER.md` in this directory is a chapter from a design-pattern book that applies to this task. Read it before you
design. Use it where it helps, deviate where it does not fit, and record in your diary which parts you used, what was
unclear, and where and why you deviated.
""" if with_chapter else ""
chapter_json = """,
  "chapter_used": ["which parts of CHAPTER.md shaped the design (sections, notes)"],
  "chapter_unclear": ["what in CHAPTER.md was unclear or wrong for this task"],
  "deviations": ["where you deviated from the chapter, and why"]""" if with_chapter else ""

prompt = f"""# Role

You are a senior TypeScript engineer. Implement the task in `TASK.md` in this directory, completely and carefully,
then verify it.
{chapter_part}
## Working rules

- Work only inside this directory. Do not read, list or search anything outside it. No network, no package installs.
- The project lives in `project/`: the API module at `project/src/index.ts` (ES module, TypeScript that Node 24 runs
  directly with type stripping: no enums, no namespaces, no parameter properties), tests in `project/test/`
  (`node --test project/test/`), no npm dependencies.
- Write your own tests for every requirement in `TASK.md` and run them until they pass. Unknown acceptance tests will
  also be run against your API, so follow the API exactly.
- Keep a diary in `project/DIARY.md`, following the format and writing rules in `DIARY-SKILL.md` (ignore its `docmgr`
  commands; there is no ticket). Write a step whenever you finish a design decision, an implementation piece or a
  debugging episode, not only at the end. For "User prompt (verbatim)" use: "Implement TASK.md (see TASK.md)".
- Write `project/NOTES.md`: the design in a few paragraphs, how each requirement is met, known limitations.

## Output contract

Your final message must be exactly one fenced ```json block:

```json
{{
  "requirements": {{"1": "met | partial | not met, with one sentence", "2": "..."}},
  "own_tests": {{"files": 0, "passed": 0, "failed": 0}},
  "design_summary": "three sentences"{chapter_json},
  "confidence": 0.0
}}
```
"""
open(os.path.join(out, "prompt.md"), "w").write(prompt)
cmd = ["pi", "-p", "--mode", "json", "--tools", "read,write,edit,bash,ls,find,grep", "--no-context-files",
       "--no-skills", "--no-prompt-templates", "--session-dir", os.path.join(out, "session"), "--model", model,
       "--thinking", think, prompt]
with open(os.path.join(out, "events.jsonl"), "w") as ev, open(os.path.join(out, "stderr.log"), "w") as er:
    try:
        subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=ev, stderr=er, cwd=out, timeout=3600)
    except subprocess.TimeoutExpired:
        er.write("TIMEOUT after 3600 s\n")

texts = []
for line in open(os.path.join(out, "events.jsonl")):
    try:
        e = json.loads(line)
    except json.JSONDecodeError:
        continue
    if e.get("type") != "message_end":
        continue
    msg = e.get("message") or {}
    if msg.get("role") == "assistant":
        for c in msg.get("content") or []:
            if isinstance(c, dict) and c.get("type") == "text":
                texts.append(c["text"])
for t in reversed(texts):
    m = re.findall(r"```json\s*(\{.*\})\s*```", t, re.S)
    if not m:
        continue
    txt = m[-1]
    for attempt in range(3):
        try:
            obj = json.loads(txt, strict=False)
            break
        except json.JSONDecodeError:
            txt = re.sub(r'(?<=[A-Za-z0-9.,;)] )"(?=[A-Za-z0-9])', r'\\"', txt)
            txt = re.sub(r'(?<=[A-Za-z0-9.?!)])"(?= [A-Za-z0-9(—-])', r'\\"', txt)
    else:
        open(os.path.join(out, "answer.raw.txt"), "w").write(t)
        print("unparseable answer", out, file=sys.stderr); sys.exit(1)
    json.dump(obj, open(os.path.join(out, "answer.json"), "w"), indent=1)
    print("answer written", out)
    break
else:
    print("no answer found", out, file=sys.stderr); sys.exit(1)
