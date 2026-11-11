"""Compare Chromogen st-data stocks with Filmbench's decoded profiles. Read-only."""
import base64, json, sys, zlib, glob, os, math
fb = json.loads(zlib.decompress(base64.b64decode(open(sys.argv[1], encoding="ascii").read().strip())))
cgdir = sys.argv[2]
wl = fb["wl"]
def maxdiff(a, b, skip_rows=()):
    m = 0.0; where = None; n = 0
    for i, (x, y) in enumerate(zip(a, b)):
        if i in skip_rows: continue
        xs = x if isinstance(x, list) else [x]
        ys = y if isinstance(y, list) else [y]
        for k, (u, v) in enumerate(zip(xs, ys)):
            if u is None or v is None: continue
            n += 1
            d = abs(u - v)
            if d > m: m, where = d, (i, k)
    return m, where, n
for f in sorted(glob.glob(os.path.join(cgdir, "stocks", "*.json"))):
    sid = os.path.basename(f)[:-5]
    cg = json.load(open(f))["data"]
    p = fb["profiles"].get(sid)
    if not p:
        print(sid, "not in filmbench"); continue
    nan = set(p["nanRows"])
    out = {}
    out["logSens"] = maxdiff(cg["log_sensitivity"], p["logSens"])
    out["chan(excl nanRows)"] = maxdiff(cg["channel_density"], p["chan"], nan)
    out["base(excl nanRows)"] = maxdiff(cg["base_density"], p["base"], nan)
    out["curves"] = maxdiff(cg["density_curves"], p["curves"])
    # chan in nanRows where chromogen has values
    lost = [(wl[i], cg["channel_density"][i]) for i in sorted(nan) if any(v not in (None, 0) for v in cg["channel_density"][i])]
    cgnullbase = [i for i, v in enumerate(cg["base_density"]) if v is None]
    print(f"{sid}: " + "; ".join(f"{k} max|d|={v[0]:.2e} at {v[1]} n={v[2]}" for k, v in out.items()))
    print(f"   nanRows==cg base-null rows: {sorted(nan)==cgnullbase}; FB base at nanRows: {set(p['base'][i] for i in nan)}; FB chan at nanRows all 0: {all(p['chan'][i]==[0,0,0] or p['chan'][i]==[0.0,0.0,0.0] for i in nan)}; cg chan values lost in FB at {len(lost)} rows, e.g. {lost[:2]}")
    if cg["log_exposure"][0] != -3 or len(cg["log_exposure"]) != 256: print("   log_exposure grid differs", cg["log_exposure"][:2])
