import base64, json, sys, zlib, math
raw = open(sys.argv[1], encoding="ascii").read().strip()
data = json.loads(zlib.decompress(base64.b64decode(raw)))
p = data["profiles"]["kodak_portra_400"]
wl = data["wl"]
print("keys", list(p.keys()))
print("nanRows", p.get("nanRows"))
# base null/None ranges
b = p["base"]
print("base", [(wl[i], b[i]) for i in range(0, 81, 4)])
print("base None at", [wl[i] for i,v in enumerate(b) if v is None])
ch = p["chan"]
print("chan None rows", [wl[i] for i,r in enumerate(ch) if any(x is None for x in r)])
print("chan at 700..780", [(wl[i], ch[i]) for i in range(64,81)])
ls = p["logSens"]
print("logSens None rows", [wl[i] for i,r in enumerate(ls) if any(x is None for x in r)])
print("logSens 380..420", [(wl[i], ls[i]) for i in range(0,9)])
print("model", json.dumps(p["model"]))
pe = data["profiles"]["kodak_portra_endura"]
print("endura nanRows", pe.get("nanRows"))
print("endura base", [(wl[i], pe["base"][i]) for i in range(0,81,4)])
print("endura chan", [(wl[i], pe["chan"][i]) for i in range(0,81,8)])
print("endura logSens", [(wl[i], pe["logSens"][i]) for i in range(0,81,8)])
print("dichroic", [(wl[i], data["dichroic"][i]) for i in range(0,81,8)])
print("TH-KG3", [(wl[i], round(data["illuminant"]["TH-KG3"][i],4)) for i in range(0,81,8)])
print("cmf 555", data["cmf"][35])
print("other top keys", [k for k in data if k not in ("profiles",)])
