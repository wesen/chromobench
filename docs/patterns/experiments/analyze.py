#!/usr/bin/env python3
"""Convert the finished runs' pi sessions to minitrace and run the analysis queries.

usage: analyze.py RUNS_ROOT TRACE_DIR OUT_DIR
Each finished run (it has answer.json) is converted once into TRACE_DIR/<task>-<variant>-<n>/ (skipped when that
directory already holds a .minitrace.json). Then every analysis/*.sql runs over all archives; results go to
OUT_DIR/<name>.json (rows) and OUT_DIR/<name>.txt (table).
"""
import glob
import os
import subprocess
import sys

here = os.path.dirname(os.path.abspath(__file__))
root, trace_dir, out_dir = sys.argv[1:4]
os.makedirs(trace_dir, exist_ok=True)
os.makedirs(out_dir, exist_ok=True)

for run in sorted(glob.glob(os.path.join(root, "*", "*-*"))):
    if not os.path.exists(os.path.join(run, "answer.json")):
        continue
    task, name = run.split(os.sep)[-2:]
    dest = os.path.join(trace_dir, f"{task}-{name}")
    if glob.glob(os.path.join(dest, "**", "*.minitrace.json"), recursive=True):
        continue
    p = subprocess.run(["go-minitrace", "convert", "pi", "--source-dir", os.path.join(run, "session"),
                        "--output-dir", dest], capture_output=True, text=True)
    print(f"convert {task}-{name}: rc={p.returncode} {p.stderr.strip()[-200:]}")

archives = sorted(glob.glob(os.path.join(trace_dir, "**", "*.minitrace.json"), recursive=True))
print(len(archives), "archives")
# go-minitrace globs have no "**": pass every archive as its own --archive-glob
glob_args = [a for f in archives for a in ("--archive-glob", f)]
for sql in sorted(glob.glob(os.path.join(here, "analysis", "*.sql"))):
    name = os.path.splitext(os.path.basename(sql))[0]
    for fmt, ext in (("json", "json"), ("table", "txt")):
        p = subprocess.run(["go-minitrace", "query", "run", *glob_args, "--sql-file", sql,
                            "--max-rows", "5000", "--output", fmt], capture_output=True, text=True)
        with open(os.path.join(out_dir, f"{name}.{ext}"), "w") as fh:
            fh.write(p.stdout if p.returncode == 0 else p.stdout + p.stderr)
        if p.returncode != 0:
            print(f"query {name} ({fmt}) failed: {p.stderr.strip()[-400:]}")
    print("wrote", name)
