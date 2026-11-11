"""Across all film x paper pairs (Filmbench data): normalised mid-grey paper log exposures through the neutral pack,
with NaN-as-opaque (Filmbench's 99 D) and NaN-as-zero (base->0, chan->0 at nanRows). Read-only."""
import base64, json, sys, zlib, math
fb = json.loads(zlib.decompress(base64.b64decode(open(sys.argv[1], encoding="ascii").read().strip())))
wl = fb["wl"]; n = 81; L = fb["illuminant"]["TH-KG3"]; DI = fb["dichroic"]
def curve_at0(p):
    # log exposure grid -3..4, 256 samples; curves minus per-channel min (spektrafilm develop subtracts min)
    le = [-3 + 7 * i / 255 for i in range(256)]
    out = []
    for ch in range(3):
        col = [r[ch] for r in p["curves"]]; mn = min(col)
        for i in range(255):
            if le[i] <= 0 <= le[i + 1]:
                t = (0 - le[i]) / (le[i + 1] - le[i]); out.append(col[i] + t * (col[i + 1] - col[i]) - mn); break
    return out
res = {"opaque": [], "zero": []}
worst = {"opaque": (0, None), "zero": (0, None)}
for paper, films in fb["neutral_filters"].items():
    pp = fb["profiles"][paper]
    S = [[10 ** v for v in r] for r in pp["logSens"]]
    for film, cc in films.items():
        fp = fb["profiles"][film]
        if fp["type"] != "negative": continue
        c = curve_at0(fp)
        t = [10 ** (-v / 100) for v in cc]
        F = [math.prod(1 - (1 - DI[i][k]) * (1 - t[k]) for k in range(3)) for i in range(n)]
        nan = set(fp["nanRows"])
        for mode in ("opaque", "zero"):
            raw = []
            for k in range(3):
                s = 0
                for i in range(n):
                    if i in nan:
                        if mode == "opaque": continue
                        D = 0.0  # Filmbench zeroed chan at nanRows; zero base
                    else:
                        D = fp["base"][i] + sum(fp["chan"][i][j] * c[j] for j in range(3))
                    s += L[i] * F[i] * 10 ** (-D) * S[i][k]
                raw.append(math.log10(s))
            m = sum(raw) / 3; x = [r - m for r in raw]
            spread = max(x) - min(x)
            res[mode].append(spread)
            if spread > worst[mode][0]: worst[mode] = (spread, (film, paper, [round(v, 3) for v in x]))
for mode in res:
    v = sorted(res[mode])
    print(mode, "pairs", len(v), "median spread", round(v[len(v)//2], 4), "max", round(v[-1], 4), "worst", worst[mode][1])
