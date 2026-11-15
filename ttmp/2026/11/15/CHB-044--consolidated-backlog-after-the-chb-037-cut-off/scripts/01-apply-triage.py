#!/usr/bin/env python3
"""Apply triage decisions to ticket tasks.md files via docmgr (edit text, then check)."""
import glob, os, re, subprocess, sys, collections

ROOT = sys.argv[1]
DEC = sys.argv[2]
MODE = sys.argv[3] if len(sys.argv) > 3 else 'dry'
ONLY = set(sys.argv[4].split(',')) if len(sys.argv) > 4 else None

line_re = re.compile(r'^\s*- \[( |x)\] (.*?) <!-- t:(\w+) -->\s*$')

def tasks_file(ticket):
    m = glob.glob(os.path.join(ROOT, 'ttmp', '*', '*', '*', f'{ticket}--*', 'tasks.md'))
    assert len(m) == 1, (ticket, m)
    return m[0]

decs = collections.OrderedDict()
for ln in open(DEC, encoding='utf8'):
    ln = ln.rstrip('\n')
    if not ln.strip():
        continue
    parts = ln.split('\t')
    while len(parts) < 4:
        parts.append('')
    t, i, s, suf = parts[:4]
    decs[(t, i)] = (s, suf.strip())

tickets = sorted({t for t, _ in decs})
counts = collections.Counter()
per = collections.defaultdict(collections.Counter)
for t in tickets:
    if ONLY and t not in ONLY:
        continue
    f = tasks_file(t)
    open_ids = {}
    for ln in open(f, encoding='utf8'):
        m = line_re.match(ln)
        if m and m.group(1) == ' ':
            open_ids[m.group(3)] = m.group(2)
    mine = {i for (tt, i) in decs if tt == t}
    missing = set(open_ids) - mine
    extra = mine - set(open_ids)
    if missing or extra:
        print(f'{t}: missing decisions {sorted(missing)}; not open {sorted(extra)}')
    for (tt, i), (s, suf) in decs.items():
        if tt != t or i not in open_ids:
            continue
        counts[s] += 1
        per[t][s] += 1
        if MODE != 'apply':
            continue
        if suf:
            new = f'{open_ids[i]} — {suf}'
            subprocess.run(['docmgr', 'task', 'edit', '--tasks-file', f, '--id', i, '--text', new], check=True, capture_output=True)
        if s != 'OPEN':
            subprocess.run(['docmgr', 'task', 'check', '--tasks-file', f, '--id', i], check=True, capture_output=True)
for t in tickets:
    print(t, dict(per[t]))
print('total', dict(counts), sum(counts.values()))
