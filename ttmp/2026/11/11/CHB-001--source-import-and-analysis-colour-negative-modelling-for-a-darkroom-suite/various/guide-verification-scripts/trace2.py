import json, sys
path = sys.argv[1]; wanted = sys.argv[2:]
res = {}; calls = []
with open(path) as f:
    for line in f:
        try: r = json.loads(line)
        except Exception: continue
        ts = r.get('timestamp','')
        c0 = (r.get('message') or {}).get('content')
        if not isinstance(c0, list): continue
        for c in c0:
            if c.get('type') == 'tool_use': calls.append((ts, c))
            elif c.get('type') == 'tool_result':
                cc = c.get('content')
                s = ' '.join(x.get('text','') for x in cc if isinstance(x, dict)) if isinstance(cc, list) else str(cc)
                res[c['tool_use_id']] = s
for ts, c in calls:
    if any(ts[11:19] == w for w in wanted) and c['name'] != 'Write':
        print('=====', ts[11:19], c['name'])
        inp = c['input']
        print(inp.get('command') or json.dumps(inp)[:3000])
        print('----- RESULT')
        print(res.get(c['id'], '')[:2500])
