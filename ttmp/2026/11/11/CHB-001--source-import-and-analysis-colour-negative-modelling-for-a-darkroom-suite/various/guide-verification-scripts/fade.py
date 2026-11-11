import json, math
exec(open('printchain.py').read().split("pack = [0, 51.568, 52.534]")[0].replace("d = json.load(open(sys.argv[1]))", "d = json.load(open('data.json'))"))
pack = [0, 51.568, 52.534]
grey = [curve_at(0.0, c) for c in range(3)]; Dg = neg_density(grey)
fM = 1 / math.exp(sum(math.log(v) for v in raw(Dg, pack)) / 3)
def xr(cmy, l=(0,0,0)): return [math.log10(v * fM) + l[k] for k, v in enumerate(raw(neg_density(cmy), pack))]
def labof(x):
    cp = [paper_dye(x[k], k) for k in range(3)]; X = view(cp); return lab(X), -math.log10(X[1])
k = [0.70, 0.90, 0.85]
pts = {'black 3%': -0.788, 'shadow': -0.4, 'grey': 0.0, 'light': 0.4, 'white 90%': 0.689}
co = {n: [curve_at(t, c) for c in range(3)] for n, t in pts.items()}
cf = {n: [co[n][c] * k[c] for c in range(3)] for n in pts}
L = [a - b for a, b in zip(xr(co['grey']), xr(cf['grey']))]
print('faded grey dyes', [round(v, 3) for v in cf['grey']], 'orig', [round(v, 3) for v in co['grey']])
print('lights to rebalance grey (points)', [round(v / 0.025, 1) for v in L])
for n in pts:
    (L0, D0) = labof(xr(co[n])); (L1, D1) = labof(xr(cf[n], L)); (L2, D2) = labof(xr(cf[n]))
    de = math.sqrt(sum((a - b) ** 2 for a, b in zip(L0, L1)))
    print(f'{n:10s} orig Lab {[round(v,1) for v in L0]} D {D0:.3f} | faded+lights Lab {[round(v,1) for v in L1]} D {D1:.3f} dE76 {de:.1f} | faded no lights Lab {[round(v,1) for v in L2]}')
