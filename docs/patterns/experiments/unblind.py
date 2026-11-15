#!/usr/bin/env python3
"""Unblind one review: scores, the reviewer's guess and the ranking per run.

usage: unblind.py REVIEW_DIR TASK"""
import json, sys
R, task = sys.argv[1:3]
a = json.load(open(f"{R}/{task}-r1.answer.json")); k = json.load(open(f"{R}/keys/{task}-r1.json"))
print(f"{task}: letter run  guess  [forces adapted whole habit growth smellfree tests] sum")
for L in sorted(k):
    s = a["implementations"][L]["scores_1to5"]
    print(f"  {L} {k[L]['run']:18} {a['guess_yardstick_used'][L]:.2f} {list(s.values())} {sum(s.values())}")
print("  ranking:", " > ".join(f"{L}({k[L]['run'].split('/')[1]})" for L in a["cross"]["ranking"]))
