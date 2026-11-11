import sys, json
p, rp = sys.argv[1], sys.argv[2]
s = open(p).read()
for a, b in json.load(open(rp)):
    if a not in s:
        print('MISSING:', a[:80]); sys.exit(1)
    if s.count(a) > 1:
        print('AMBIGUOUS:', a[:80]); sys.exit(1)
    s = s.replace(a, b)
open(p, 'w').write(s)
print('ok')
