#!/usr/bin/env python3
"""Score every run with the hidden acceptance tests and the agent's own tests.

usage: score.py RUNS_ROOT HIDDEN_DIR OUT_JSON
For each RUNS_ROOT/<task>/<variant>-<n>/: copies HIDDEN_DIR/<task>.test.ts to hidden.test.ts, runs it with the TAP
reporter, and runs `node --test project/test/`. Writes per-test results and a summary to OUT_JSON.
"""
import glob, json, os, re, shutil, subprocess, sys

root, hidden, out = sys.argv[1], sys.argv[2], sys.argv[3]

def tap(cmd, cwd, timeout):
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        text = p.stdout + p.stderr
    except subprocess.TimeoutExpired as e:
        text = (e.stdout or b"").decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
        text += "\nTIMEOUT"
    tests = {}
    for m in re.finditer(r"^(not ok|ok) \d+ - (.+?)(?: # .*)?$", text, re.M):
        tests[m.group(2).strip()] = m.group(1) == "ok"
    return tests, text

rows = []
for run in sorted(glob.glob(os.path.join(root, "*", "*-*"))):
    task, name = run.split(os.sep)[-2:]
    variant, n = name.rsplit("-", 1)
    shutil.copy(os.path.join(hidden, f"{task}.test.ts"), os.path.join(run, "hidden.test.ts"))
    has_src = os.path.exists(os.path.join(run, "project", "src", "index.ts"))
    hid, hid_text = tap(["node", "--test", "--test-reporter=tap", "hidden.test.ts"], run, 900) if has_src else ({}, "no src")
    own, _ = tap(["node", "--test", "--test-reporter=tap", "project/test/"], run, 900) if has_src else ({}, "")
    ans = json.load(open(os.path.join(run, "answer.json"))) if os.path.exists(os.path.join(run, "answer.json")) else None
    open(os.path.join(run, "hidden.out.txt"), "w").write(hid_text)
    rows.append({"task": task, "variant": variant, "n": int(n), "has_src": has_src, "answered": ans is not None,
                 "hidden": hid, "hidden_passed": sum(hid.values()), "hidden_total": len(hid),
                 "own_passed": sum(own.values()), "own_total": len(own),
                 "self_report": ans, "diary": os.path.exists(os.path.join(run, "project", "DIARY.md")),
                 "diary_steps": len(re.findall(r"^## Step", open(os.path.join(run, "project", "DIARY.md")).read(), re.M)) if os.path.exists(os.path.join(run, "project", "DIARY.md")) else 0,
                 "src_lines": sum(1 for f in glob.glob(os.path.join(run, "project", "src", "**", "*.ts"), recursive=True) for _ in open(f))})
    print(f"{task:9} {variant:8} {n}  hidden {rows[-1]['hidden_passed']}/{rows[-1]['hidden_total']}  own {rows[-1]['own_passed']}/{rows[-1]['own_total']}  diary steps {rows[-1]['diary_steps']}  src {rows[-1]['src_lines']} lines", flush=True)
json.dump(rows, open(out, "w"), indent=1)
