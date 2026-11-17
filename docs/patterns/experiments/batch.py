#!/usr/bin/env python3
"""Run the pattern experiments in parallel: per task, 4 runs with the chapter and 2 controls.

usage: batch.py RUNS_ROOT [--par 4] [--tasks tiling,slots] [--budget-min tiling=120,default=60] [--watchdog-min 5]
                [--retries 2] [--model M]

Skips runs that already have answer.json, so a re-run retries only what is missing. Longest-budget tasks start first.
A provider failure (run-impl.py exit code 3) is retried up to --retries times after a pause: the failed attempt's
directory is moved to RUNS_ROOT/_failed/<task>-<variant>-<n>-<k>/ (kept as evidence), then the run starts afresh.
Logs start, end and retries to RUNS_ROOT/batch.log.
"""
import argparse
import concurrent.futures as cf
import os
import shutil
import subprocess
import sys
import threading
import time

ap = argparse.ArgumentParser()
ap.add_argument("root")
ap.add_argument("--par", type=int, default=4)
ap.add_argument("--tasks", default="graph,slots,tiling,document")
ap.add_argument("--budget-min", default="tiling=120,default=60")
ap.add_argument("--watchdog-min", type=float, default=5)
ap.add_argument("--retries", type=int, default=2)
ap.add_argument("--retry-pause-s", type=float, default=60)
ap.add_argument("--model", default="lunaroute/deepseek-4.1-flash")
a = ap.parse_args()

here = os.path.dirname(os.path.abspath(__file__))
budgets = dict(kv.split("=") for kv in a.budget_min.split(","))
budget = lambda t: float(budgets.get(t, budgets.get("default", 60)))  # noqa: E731
tasks = a.tasks.split(",")
runs = [(t, v, n) for n in (1, 2, 3, 4) for t in tasks for v in ("chapter", "control") if not (v == "control" and n > 2)]
runs.sort(key=lambda r: -budget(r[0]))  # stable: the longest tasks first, in the original interleaving
os.makedirs(a.root, exist_ok=True)
lock = threading.Lock()


def log(msg):
    with lock, open(os.path.join(a.root, "batch.log"), "a") as fh:
        fh.write(f"{time.strftime('%H:%M:%S')} {msg}\n")


def one(r):
    t, v, n = r
    for attempt in range(a.retries + 1):
        t0 = time.time()
        log(f"start {t} {v}-{n} (budget {budget(t):g} min, attempt {attempt + 1})")
        p = subprocess.run([sys.executable, "-I", os.path.join(here, "run-impl.py"), t, v, str(n), a.root,
                            "--model", a.model, "--budget-min", str(budget(t)), "--watchdog-min", str(a.watchdog_min)],
                           capture_output=True, text=True)
        log(f"end   {t} {v}-{n} rc={p.returncode} {time.time() - t0:.0f}s {p.stdout.strip()} {p.stderr.strip()[-200:]}")
        if p.returncode != 3 or attempt == a.retries:
            return
        failed = os.path.join(a.root, "_failed", f"{t}-{v}-{n}-{attempt + 1}")
        os.makedirs(os.path.dirname(failed), exist_ok=True)
        shutil.move(os.path.join(a.root, t, f"{v}-{n}"), failed)
        log(f"retry {t} {v}-{n}: provider failure, attempt moved to {os.path.relpath(failed, a.root)}")
        time.sleep(a.retry_pause_s)


log(f"batch: tasks {tasks}, par {a.par}, budgets {budgets}, watchdog {a.watchdog_min:g} min, retries {a.retries}")
with cf.ThreadPoolExecutor(a.par) as ex:
    list(ex.map(one, runs))
log("batch finished")
