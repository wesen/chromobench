import json, sys
path = sys.argv[1]
n = 0
results = {}
calls = []
with open(path) as f:
    for line in f:
        try: r = json.loads(line)
        except Exception: continue
        ts = r.get('timestamp','')
        msg = r.get('message') or {}
        content = msg.get('content')
        if isinstance(content, str):
            if r.get('type') == 'user':
                calls.append(('USERTEXT', ts, content[:600]))
            continue
        if not isinstance(content, list): continue
        for c in content:
            t = c.get('type')
            if t == 'tool_use':
                calls.append(('CALL', ts, c['id'], c['name'], json.dumps(c.get('input'))[:700]))
            elif t == 'tool_result':
                cc = c.get('content')
                if isinstance(cc, list):
                    s = ' '.join(x.get('text','') for x in cc if isinstance(x, dict) and x.get('type')=='text')
                else:
                    s = str(cc)
                results[c['tool_use_id']] = (bool(c.get('is_error')), s)
            elif t == 'text' and r.get('type') == 'user':
                calls.append(('USERTEXT', ts, c.get('text','')[:600]))
for x in calls:
    if x[0] == 'USERTEXT':
        print(f"\n### USER {x[1]}: {x[2]!r}")
    else:
        _, ts, i, name, inp = x
        err, s = results.get(i, (None, ''))
        print(f"\n[{ts[11:19]}] {name} {inp}")
        print(f"   -> {'ERROR ' if err else ''}{s[:500]!r}")
