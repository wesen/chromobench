import base64, json, sys, zlib, os, glob
fb = json.loads(zlib.decompress(base64.b64decode(open(sys.argv[1], encoding="ascii").read().strip())))
up = sys.argv[2]
mx = 0
for sid, p in fb["profiles"].items():
    u = json.load(open(os.path.join(up, sid + ".json")))["data"]["density_curves_model"]
    for a, b in (("centers", "centers"), ("amps", "amplitudes"), ("sigmas", "sigmas")):
        for r1, r2 in zip(p["model"][a], u[b]):
            for x, y in zip(r1, r2): mx = max(mx, abs(x - y))
print("filmbench model vs upstream density_curves_model max |d|:", mx)
u = json.load(open(os.path.join(up, "kodak_portra_400.json")))["data"]
m = u["midscale_neutral_density"]; wl = u["wavelengths"]
print("portra400 midscale_neutral_density nulls:", sum(v is None for v in m), "sample 550:", m[wl.index(550.0)])
print("density_curves_layers[128]:", u["density_curves_layers"][128])
print("sum layers vs curve at 128:", [round(sum(u["density_curves_layers"][128][j][ch] for j in range(3)), 5) for ch in range(3)], u["density_curves"][128])
p = json.load(open(os.path.join(up, "kodak_portra_endura.json")))["data"]
print("endura log_exposure range", p["log_exposure"][0], p["log_exposure"][-1], len(p["log_exposure"]))
print("endura chan null rows nm:", [p["wavelengths"][i] for i, r in enumerate(p["channel_density"]) if any(v is None for v in r)])
