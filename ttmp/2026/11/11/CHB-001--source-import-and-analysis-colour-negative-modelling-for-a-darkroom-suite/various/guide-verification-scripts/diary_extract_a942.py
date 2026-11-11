import json, sys

path = sys.argv[1]
maxin = int(sys.argv[2]) if len(sys.argv) > 2 else 400
maxout = int(sys.argv[3]) if len(sys.argv) > 3 else 400
start = int(sys.argv[4]) if len(sys.argv) > 4 else 0
stop = int(sys.argv[5]) if len(sys.argv) > 5 else 10**9

with open(path) as f:
    lines = f.readlines()

n = 0
for i, line in enumerate(lines):
    try:
        rec = json.loads(line)
    except Exception:
        continue
    ts = rec.get('timestamp', '')[11:19]
    msg = rec.get('message') or {}
    content = msg.get('content')
    role = msg.get('role') or rec.get('type')
    if isinstance(content, str):
        if start <= n < stop:
            print(f"[{n}] {ts} {role} TEXT: {content[:maxout]!r}")
        n += 1
        continue
    if not isinstance(content, list):
        continue
    for c in content:
        t = c.get('type')
        if start <= n < stop:
            if t == 'tool_use':
                inp = json.dumps(c.get('input'), ensure_ascii=False)
                print(f"[{n}] {ts} USE {c.get('name')}: {inp[:maxin]}")
            elif t == 'tool_result':
                cc = c.get('content')
                if isinstance(cc, list):
                    cc = ' '.join(x.get('text', '') for x in cc if isinstance(x, dict))
                err = ' ERROR' if c.get('is_error') else ''
                print(f"[{n}] {ts} RESULT{err}: {str(cc)[:maxout]!r}")
            elif t == 'text':
                print(f"[{n}] {ts} {role} TEXT: {c.get('text', '')[:maxout]!r}")
        n += 1
