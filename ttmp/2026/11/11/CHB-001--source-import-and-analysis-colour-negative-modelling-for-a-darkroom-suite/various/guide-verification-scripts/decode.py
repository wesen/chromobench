import base64, json, sys, zlib
src, out = sys.argv[1], sys.argv[2]
raw = open(src).read().strip()
b = base64.b64decode(raw)
try:
    js = zlib.decompress(b)
except zlib.error:
    js = zlib.decompress(b, -15)
d = json.loads(js)
keep = {k: d[k] for k in d if k != 'profiles'}
keep['profiles'] = {k: {kk: vv for kk, vv in v.items() if kk != 'lut'} for k, v in d['profiles'].items() if k in ('kodak_portra_400', 'kodak_portra_endura', 'kodak_gold_200', 'kodak_supra_endura')}
json.dump(keep, open(out, 'w'))
print(list(d.keys()))
p = d['profiles']['kodak_portra_400']
print(list(p.keys()), p.get('nanRows'), p.get('meta'))
