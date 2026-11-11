import base64, json, sys, zlib, math
fb = json.loads(zlib.decompress(base64.b64decode(open(sys.argv[1], encoding="ascii").read().strip())))
rows = sorted({float(a): float(b) for a, b in (l.split(",") for l in open(sys.argv[2]) if l.strip())}.items())
def lin(x):
    for (x0, y0), (x1, y1) in zip(rows, rows[1:]):
        if x0 <= x <= x1: return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return float("nan")
h, c, k = 6.62607015e-34, 2.99792458e8, 1.380649e-23
bb = lambda l, T: 2 * h * c**2 / l**5 / (math.exp(h * c / (l * k * T)) - 1)
wl = fb["wl"]
v = [bb(l * 1e-9, 3400) * lin(l) for l in wl]
m = sum(v) / len(v); v = [x / m for x in v]
d = [abs(a - b) / b for a, b in zip(v, fb["illuminant"]["TH-KG3"])]
print("max rel diff TH-KG3 (linear interp of KG3) vs filmbench:", round(max(d), 4), "at", wl[d.index(max(d))])
print("median rel diff", round(sorted(d)[len(d)//2], 5))
