"""Grey card of Portra 400 through TH-KG3 + neutral pack onto Portra Endura: NaN-as-opaque vs NaN-as-zero. Read-only."""
import base64, json, sys, zlib, math, glob, os
fb = json.loads(zlib.decompress(base64.b64decode(open(sys.argv[1], encoding="ascii").read().strip())))
cg = lambda s: json.load(open(os.path.join(sys.argv[2], "stocks", s + ".json")))["data"]
wl = fb["wl"]; n = len(wl)
# dichroic check vs spektrafilm custom erf filters
def erf(x): return math.erf(x)
edges, trans = [516, 500, 610, 607], [12, 8, 8, 8]
mx = 0
for i, l in enumerate(wl):
    y = erf((l - edges[0]) / trans[0]) / 2 + .5
    m = (-erf((l - edges[1]) / trans[1]) if l <= 550 else erf((l - edges[2]) / trans[2])) / 2 + .5
    c = -erf((l - edges[3]) / trans[3]) / 2 + .5
    for k, v in enumerate((c, m, y)):
        mx = max(mx, abs(v - fb["dichroic"][i][k]))
print("max |filmbench dichroic - spektrafilm custom erf| =", mx)
# blackbody 3400 K normalised check is skipped (needs KG3 table); use filmbench TH-KG3
L = fb["illuminant"]["TH-KG3"]
cc = fb["neutral_filters"]["kodak_portra_endura"]["kodak_portra_400"]
t = [10 ** (-v / 100) for v in cc]
F = [math.prod(1 - (1 - fb["dichroic"][i][k]) * (1 - t[k]) for k in range(3)) for i in range(n)]
film, paper = cg("kodak_portra_400"), cg("kodak_portra_endura")
c = (0.687, 0.704, 0.864)
S = [[(10 ** r[k]) if r[k] is not None else 0.0 for k in range(3)] for r in paper["log_sensitivity"]]
def D(i, mode):
    b = film["base_density"][i]; row = film["channel_density"][i]
    if b is None or any(v is None for v in row):
        return math.inf if mode == "opaque" else (b or 0) + sum((v or 0) * ck for v, ck in zip(row, c))
    return b + sum(v * ck for v, ck in zip(row, c))
for mode in ("opaque", "zero"):
    raw = [sum(L[i] * F[i] * (10 ** -D(i, mode) if D(i, mode) != math.inf else 0) * S[i][k] for i in range(n)) for k in range(3)]
    print(mode, "log10 raw per paper layer (R,G,B):", [round(math.log10(r), 4) for r in raw])
    if mode == "opaque": ro = raw
    else: rz = raw
print("x(opaque) - x(zero):", [round(math.log10(a / b), 4) for a, b in zip(ro, rz)])
# share of lamp-filtered red sensitivity at >=705 nm
w = [L[i] * F[i] * S[i][0] for i in range(n)]
print("share of filtered-lamp x red sensitivity at >=705 nm:", round(sum(w[i] for i in range(n) if wl[i] >= 705) / sum(w), 3))
w2 = [L[i] * S[i][0] for i in range(n)]
print("share of lamp x red sensitivity at >=705 nm (no filters):", round(sum(w2[i] for i in range(n) if wl[i] >= 705) / sum(w2), 3))
