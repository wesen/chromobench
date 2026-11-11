import base64, json, sys, zlib
src, out = sys.argv[1], sys.argv[2]
txt = open(src).read().strip()
raw = base64.b64decode(txt)
try:
    js = zlib.decompress(raw)
except Exception:
    js = zlib.decompress(raw, -15)
d = json.loads(js)
json.dump({k: d[k] for k in ['wl','cmf','illuminant','rgb2xyz_cat16','xyz2rgb','illuminant_xyz','dichroic']}, open(out + '/top.json','w'))
prof = {}
for k in ['kodak_portra_400','kodak_portra_endura','kodak_portra_800','kodak_portra_800_push1','kodak_portra_800_push2']:
    p = dict(d['profiles'][k]); p.pop('lut', None); prof[k] = p
json.dump(prof, open(out + '/profiles.json','w'))
print('ok', list(d.keys()))
