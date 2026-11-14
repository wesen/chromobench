#!/usr/bin/env python3
"""Score finished runs with the hidden acceptance tests and the agent's own tests.

usage: score.py RUNS_ROOT HIDDEN_DIR EVAL_DIR OUT_JSON

Only runs that have answer.json (finished) are scored. Each run's project/ is copied to EVAL_DIR/<task>-<variant>-<n>/
and the hidden suite is copied beside it there, so nothing is ever written into a run directory (agents still
working never see the hidden tests). Writes per-test results and a summary to OUT_JSON and prints one line per run.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys

TAP_LINE = re.compile(r"^(not ok|ok) \d+ - (.+?)(?: # .*)?$", re.M)


def run_tap(args, cwd, timeout):
    """Runs node --test with the TAP reporter; returns {test name: passed} and the raw output."""
    try:
        p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        text = p.stdout + p.stderr
    except subprocess.TimeoutExpired as e:
        out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
        text = out + "\nTIMEOUT"
    return {m.group(2).strip(): m.group(1) == "ok" for m in TAP_LINE.finditer(text)}, text


def count_lines(paths):
    total = 0
    for f in paths:
        with open(f, encoding="utf-8", errors="replace") as fh:
            total += sum(1 for _ in fh)
    return total


def score_run(run, task, variant, n, hidden_dir, eval_dir):
    ev = os.path.join(eval_dir, f"{task}-{variant}-{n}")
    if os.path.exists(ev):
        shutil.rmtree(ev)
    shutil.copytree(os.path.join(run, "project"), os.path.join(ev, "project"),
                    ignore=shutil.ignore_patterns("node_modules"))
    shutil.copy(os.path.join(hidden_dir, f"{task}.test.ts"), os.path.join(ev, "hidden.test.ts"))
    has_src = os.path.exists(os.path.join(ev, "project", "src", "index.ts"))
    hidden, hidden_text = ({}, "no src")
    own = {}
    if has_src:
        hidden, hidden_text = run_tap(["node", "--test", "--test-reporter=tap", "hidden.test.ts"], ev, 900)
        if os.path.isdir(os.path.join(ev, "project", "test")):
            own, _ = run_tap(["node", "--test", "--test-reporter=tap", "project/test/"], ev, 900)
    with open(os.path.join(ev, "hidden.out.txt"), "w") as fh:
        fh.write(hidden_text)
    diary = os.path.join(run, "project", "DIARY.md")
    diary_steps = len(re.findall(r"^## Step", open(diary).read(), re.M)) if os.path.exists(diary) else 0
    src = glob.glob(os.path.join(run, "project", "src", "**", "*.ts"), recursive=True)
    with open(os.path.join(run, "answer.json")) as fh:
        answer = json.load(fh)
    return {
        "task": task, "variant": variant, "n": n, "has_src": has_src,
        "hidden": hidden, "hidden_passed": sum(hidden.values()), "hidden_total": len(hidden),
        "own_passed": sum(own.values()), "own_total": len(own),
        "diary_steps": diary_steps, "src_lines": count_lines(src), "self_report": answer,
    }


def main():
    root, hidden_dir, eval_dir, out = sys.argv[1:5]
    os.makedirs(eval_dir, exist_ok=True)
    expected = {}
    for f in glob.glob(os.path.join(hidden_dir, "*.test.ts")):
        expected[os.path.basename(f).split(".")[0]] = len(re.findall(r"^test\(", open(f).read(), re.M))
    rows = []
    for run in sorted(glob.glob(os.path.join(root, "*", "*-*"))):
        if not os.path.exists(os.path.join(run, "answer.json")):
            continue  # unfinished or failed: never touched
        task, name = run.split(os.sep)[-2:]
        variant, n = name.rsplit("-", 1)
        row = score_run(run, task, variant, int(n), hidden_dir, eval_dir)
        rows.append(row)
        failed = [k for k, ok in row["hidden"].items() if not ok]
        print(f"{task:9} {variant:8} {n}  hidden {row['hidden_passed']}/{expected.get(task, '?')}"
              f"  own {row['own_passed']}/{row['own_total']}  diary steps {row['diary_steps']}"
              f"  src {row['src_lines']} lines  failed: {failed}", flush=True)
    with open(out, "w") as fh:
        json.dump({"expected": expected, "runs": rows}, fh, indent=1)


if __name__ == "__main__":
    main()
