"""Compare upstream spektrafilm profiles with Chromogen st-data stocks and Filmbench; report duplicates. Read-only."""
import json, sys, glob, os, itertools, base64, zlib
up_dir, cg_dir, fb_path = sys.argv[1:4]
up = {os.path.basename(f)[:-5]: json.load(open(f)) for f in glob.glob(os.path.join(up_dir, "*.json"))}
fb = json.loads(zlib.decompress(base64.b64decode(open(fb_path, encoding="ascii").read().strip())))
def md(a, b):
    m = 0.0; n = 0; nullmismatch = 0
    for x, y in zip(a, b):
        xs = x if isinstance(x, list) else [x]; ys = y if isinstance(y, list) else [y]
        for u, v in zip(xs, ys):
            if (u is None) != (v is None): nullmismatch += 1; continue
            if u is None: continue
            n += 1; m = max(m, abs(u - v))
    return round(m, 6), nullmismatch
print("upstream versions:", {k: v["metadata"].get("version") for k, v in list(up.items())[:3]}, "created", {v["metadata"].get("created") for v in up.values()})
for f in sorted(glob.glob(os.path.join(cg_dir, "stocks", "*.json"))):
    sid = os.path.basename(f)[:-5]
    cg = json.load(open(f))["data"]; u = up[sid]["data"]
    print(sid, {k: md(cg[k], u[k]) for k in ("log_sensitivity", "channel_density", "base_density", "density_curves")})
print("\nupstream identical arrays between stocks:")
keys = ["log_sensitivity", "channel_density", "base_density", "density_curves", "midscale_neutral_density"]
for a, b in itertools.combinations(sorted(up), 2):
    same = [k for k in keys if up[a]["data"][k] == up[b]["data"][k]]
    if same: print(f"  {a} == {b}: {same}")
print("\nper-stock info and extra fields:")
for sid in sorted(up):
    i = up[sid]["info"]; d = up[sid]["data"]
    nb = [d["wavelengths"][k] for k, v in enumerate(d["base_density"]) if v is None]
    ls_null = sum(1 for r in d["log_sensitivity"] for v in r if v is None)
    win = d.get("hanatos2025_adaptation_window_params"); surf = d.get("hanatos2025_adaptation_surface_params")
    dcl = d.get("density_curves_layers"); mod = d.get("density_curves_model", {})
    shp = lambda v: (len(v), len(v[0]) if v and isinstance(v[0], list) else None) if isinstance(v, list) else None
    print(f"  {sid}: {i['type']}/{i['support']}/{i['stage']}/{i['use']} AH={i['antihalation']} dens={i['densitometer']} ref={i['reference_illuminant']} view={i['viewing_illuminant']} target={i['target_print']} chm={i['channel_model']} | base null nm {nb[:1]}..{nb[-1:]} n={len(nb)} | logS nulls {ls_null} | window {win} | surface {shp(surf)} | layers {shp(dcl)} | model {mod.get('model_type')} {shp(mod.get('centers'))}")
