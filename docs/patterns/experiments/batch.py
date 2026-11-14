#!/usr/bin/env python3
"""Run the pattern experiments in parallel: 4 tasks x (4 with the chapter + 2 controls).

usage: batch.py RUNS_ROOT [PARALLEL] [MODEL]
Skips runs that already have answer.json, so a re-run retries only failures. Logs start/end per run.
"""
import concurrent.futures as cf, os, subprocess, sys, time

root = sys.argv[1]
par = int(sys.argv[2]) if len(sys.argv) > 2 else 8
model = sys.argv[3] if len(sys.argv) > 3 else "lunaroute/deepseek-4.1-flash"
here = os.path.dirname(os.path.abspath(__file__))
runs = [(t, v, n) for n in (1, 2, 3, 4) for t in ("graph", "slots", "tiling", "document") for v in ("chapter", "control")
        if not (v == "control" and n > 2)]
os.makedirs(root, exist_ok=True)
log = open(os.path.join(root, "batch.log"), "a")

def one(r):
    t, v, n = r
    t0 = time.time()
    log.write(f"{time.strftime('%H:%M:%S')} start {t} {v}-{n}\n"); log.flush()
    p = subprocess.run([sys.executable, "-I", os.path.join(here, "run-impl.py"), t, v, str(n), root, model],
                       capture_output=True, text=True)
    log.write(f"{time.strftime('%H:%M:%S')} end   {t} {v}-{n} rc={p.returncode} {time.time() - t0:.0f}s {p.stdout.strip()} {p.stderr.strip()[-200:]}\n")
    log.flush()

with cf.ThreadPoolExecutor(par) as ex:
    list(ex.map(one, runs))
log.write("batch finished\n"); log.flush()
