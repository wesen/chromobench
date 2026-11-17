#!/usr/bin/env python3
"""One isolated pi implementation run for the pattern experiments (pi subagents handbook, go-go-parc).

usage: run-impl.py TASK VARIANT N RUNS_ROOT [--model M] [--thinking T] [--budget-min 60] [--watchdog-min 5]
  TASK     graph | slots | tiling | document
  VARIANT  chapter (the pattern chapter is given) | control (it is not)
Creates RUNS_ROOT/TASK/VARIANT-N/ with TASK.md, DIARY-SKILL.md, CHAPTER.md (chapter variant), an empty project/,
prompt.md, session/ (native pi JSONL), events.jsonl, stderr.log, watchdog.log, run.json (harness settings and how the
run ended) and answer.json (the agent's self-report).

Harness v2 (CHB-036 Steps 9-10): the agent runs under supervise.py (a watchdog kills any command that runs longer
than --watchdog-min, the budget kills the whole process tree); the prompt states the budget, the start time, the
watchdog, a test command that works on Node 24, and asks for the diary and notes as the work goes.

Exit codes: 0 answer written; 1 no answer (timeout or the agent stopped without one); 2 unparseable answer;
3 provider failure (the last model call ended in an error, e.g. upstream_stream_failed): safe to retry.
"""
import argparse
import json
import os
import re
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supervise  # noqa: E402

HARNESS = "v2"
ap = argparse.ArgumentParser()
ap.add_argument("task")
ap.add_argument("variant")
ap.add_argument("n")
ap.add_argument("root")
ap.add_argument("--model", default="lunaroute/deepseek-4.1-flash")
ap.add_argument("--thinking", default="high")
ap.add_argument("--budget-min", type=float, default=60)
ap.add_argument("--watchdog-min", type=float, default=5)
a = ap.parse_args()

here = os.path.dirname(os.path.abspath(__file__))
CHAPTERS = {"graph": "01-interned-operation-graph.md", "slots": "04-latest-wins-render-slots.md",
            "tiling": "08-reach-declared-tiling.md", "document": "09-vector-edit-document.md"}
out = os.path.join(a.root, a.task, f"{a.variant}-{a.n}")
if os.path.exists(os.path.join(out, "answer.json")):
    print("done already", out)
    sys.exit(0)
os.makedirs(os.path.join(out, "project"), exist_ok=True)
shutil.copy(os.path.join(here, "tasks", a.task, "TASK.md"), os.path.join(out, "TASK.md"))
shutil.copy(os.path.expanduser("~/.codex/skills/diary/SKILL.md"), os.path.join(out, "DIARY-SKILL.md"))
with_chapter = a.variant == "chapter"
if with_chapter:
    shutil.copy(os.path.join(here, "..", CHAPTERS[a.task]), os.path.join(out, "CHAPTER.md"))

start = time.time()
start_hm = time.strftime("%H:%M", time.localtime(start))
end_hm = time.strftime("%H:%M", time.localtime(start + a.budget_min * 60))
wd = f"{a.watchdog_min:g}"

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

- Work only inside this directory. Do not read, list or search anything outside it (not `/tmp` either: put scratch
  files in `project/scratch/`). No network, no package installs.
- The project lives in `project/`: the API module at `project/src/index.ts` (ES module, TypeScript that Node 24 runs
  directly with type stripping: no enums, no namespaces, no parameter properties), tests in `project/test/*.test.ts`,
  no npm dependencies.
- Run the tests with `node --test --test-timeout=60000 project/test/*.test.ts` (list the files: on Node 24,
  `node --test project/test/` treats the directory as a module and fails). Keep the whole suite well under a minute.
- Write your own tests for every requirement in `TASK.md` and run them until they pass. Unknown acceptance tests will
  also be run against your API, so follow the API exactly.

## Time

- You have {a.budget_min:g} minutes: you started at {start_hm} and the run is stopped at {end_hm} (check with `date`).
  Work stopped by the deadline is lost, including the final answer.
- Any shell command that runs longer than {wd} minutes is killed, and you get its output so far. A test that hangs
  (an endless loop, a promise that never settles) is killed the same way; find the cause rather than rerunning it.
  Give the bash tool a `timeout` (in seconds) for commands that might hang.
- When about 15 minutes remain, stop adding features: finish the diary, `NOTES.md` and the final answer.

## Diary and notes

- Keep a diary in `project/DIARY.md`, following the format and writing rules in `DIARY-SKILL.md` (ignore its `docmgr`
  commands; there is no ticket). Write the first step before you write `project/src/index.ts`, and add a step each
  time you finish a design decision, an implementation piece or a debugging episode: an evaluator compares the diary
  with the transcript, so a diary written at the end counts as missing. For "User prompt (verbatim)" use: "Implement
  TASK.md (see TASK.md)".
- Write `project/NOTES.md`: the design in a few paragraphs, how each requirement is met, known limitations. Start it
  once the design stands and keep it current.

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
       "--no-skills", "--no-prompt-templates", "--session-dir", os.path.join(out, "session"), "--model", a.model,
       "--thinking", a.thinking, prompt]
with open(os.path.join(out, "events.jsonl"), "w") as ev, open(os.path.join(out, "stderr.log"), "w") as er:
    res = supervise.supervise(cmd, out, ev, er, a.budget_min * 60, a.watchdog_min * 60,
                              log=os.path.join(out, "watchdog.log"))
    if res["timed_out"]:
        er.write(f"TIMEOUT after {a.budget_min * 60:.0f} s\n")

run = {"harness": HARNESS, "task": a.task, "variant": a.variant, "n": int(a.n), "model": a.model,
       "thinking": a.thinking, "budget_min": a.budget_min, "watchdog_min": a.watchdog_min,
       "started": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(start)), **res}


def finish(code, outcome):
    run["outcome"] = outcome
    json.dump(run, open(os.path.join(out, "run.json"), "w"), indent=1)
    sys.exit(code)


texts, last_assistant = [], None
for line in open(os.path.join(out, "events.jsonl")):
    try:
        e = json.loads(line)
    except json.JSONDecodeError:
        continue
    if e.get("type") != "message_end":
        continue
    msg = e.get("message") or {}
    if msg.get("role") == "assistant":
        last_assistant = msg
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
        print("unparseable answer", out, file=sys.stderr)
        finish(2, "unparseable answer")
    json.dump(obj, open(os.path.join(out, "answer.json"), "w"), indent=1)
    print("answer written", out)
    finish(0, "answer")

if not res["timed_out"] and last_assistant and last_assistant.get("stopReason") == "error":
    err = str(last_assistant.get("errorMessage", ""))[:500]
    open(os.path.join(out, "provider-error.txt"), "w").write(err + "\n")
    print("provider failure", out, err[:120], file=sys.stderr)
    finish(3, f"provider failure: {err[:200]}")
print("no answer found", out, file=sys.stderr)
finish(1, "timeout" if res["timed_out"] else "no answer")
