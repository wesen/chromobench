import json, math, sys
exec(open('printchain.py').read().split("pack = [0, 51.568, 52.534]")[0].replace("d = json.load(open(sys.argv[1]))", "d = json.load(open('data.json'))"))
pack = [0, 51.568, 52.534]
grey = [curve_at(0.0, c) for c in range(3)]
Dg = neg_density(grey)
rg = raw(Dg, pack)
fM = 1 / math.exp(sum(math.log(v) for v in rg) / 3)
def xr(D, cc): return [math.log10(v * fM) for v in raw(D, cc)]
# Jacobian at grey
h = 0.5; J = [[0]*3 for _ in range(3)]
for j in range(3):
    pp = pack[:]; pp[j] += h; pm = pack[:]; pm[j] -= h
    a = xr(Dg, pp); b = xr(Dg, pm)
    for k in range(3): J[k][j] = (a[k] - b[k]) / (2*h)
Jn = [[J[k][j] - sum(J[q][j] for q in range(3))/3 for j in range(3)] for k in range(3)]
Jd = [[-0.01 if k == j else 0 for j in range(3)] for k in range(3)]
samples = []
for a in [-1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5, 2.0]:
    for off in [(0,0,0),(0.4,0,0),(0,0.4,0),(0,0,0.4),(-0.4,0,0),(0,-0.4,0),(0,0,-0.4)]:
        samples.append(neg_density([max(0, curve_at(a + off[c], c)) for c in range(3)]))
for dv in ([0,10,0],[0,0,10],[0,20,20]):
    pp = [pack[i]+dv[i] for i in range(3)]
    for name, JJ in (('J(grey)', J), ('diag 0.4pt/CC', Jd), ('J_norm in real mode', Jn)):
        worst = 0
        for D in samples:
            a = xr(D, pack); b = xr(D, pp)
            err = max(abs(b[k] - a[k] - sum(JJ[k][j]*dv[j] for j in range(3))) for k in range(3))
            worst = max(worst, err)
        print(f'preview {dv} with {name}: max err {worst/0.025:.2f} points')
# split filtration: 5 s at pack + 5 s at pack+30M vs single equivalent exposure (lights fitted at grey)
p2 = [pack[0], pack[1]+30, pack[2]]
def xsplit(D):
    r1 = raw(D, pack); r2 = raw(D, p2)
    return [math.log10(0.5*(r1[k]+r2[k]) * fM) for k in range(3)]
xs_g = xsplit(Dg); x0_g = xr(Dg, pack)
L = [xs_g[k] - x0_g[k] for k in range(3)]
print('split 50/50 with +30M: equivalent lights at grey (points)', [round(v/0.025, 2) for v in L])
worst = 0
for D in samples:
    xs = xsplit(D); x0 = xr(D, pack)
    worst = max(worst, max(abs(xs[k] - x0[k] - L[k]) for k in range(3)))
print('  max deviation from single equivalent exposure over samples (points):', round(worst/0.025, 3))
# flash colour: open gate vs through base, with neutral pack
Dbase = neg_density([0, 0, 0])
ro = [math.log10(v) for v in raw([0.0]*NW, pack)]; rb = [math.log10(v) for v in raw(Dbase, pack)]
d = [ro[k] - rb[k] for k in range(3)]; m = sum(d)/3
print('open gate minus through-base paper logH per layer', [round(v, 3) for v in d], 'colour part (points)', [round((v-m)/0.025, 1) for v in d])
# warmth vector: film exposed to blackbody 5500 K +/- 20 mired
h_ = 6.62607015e-34; c_ = 2.99792458e8; kB = 1.380649e-23
def bb(T): return [ (2*h_*c_**2/((380e-9+5e-9*i)**5)) / (math.exp(h_*c_/((380e-9+5e-9*i)*kB*T)) - 1) for i in range(NW)]
fs = [[10 ** P['logSens'][i][k] if P['logSens'][i][k] is not None else 0 for k in range(3)] for i in range(NW)]
def pd_at(T):
    S = bb(T); S0 = bb(5500)
    u = [math.log10(sum(S[i]*fs[i][k] for i in range(NW)) / sum(S0[i]*fs[i][k] for i in range(NW))) for k in range(3)]
    cm = [curve_at(u[k], k) for k in range(3)]
    D = neg_density(cm)
    return [-v for v in xr(D, pack)]      # printing density up to a constant
m1 = 1e6/5500 + 20; m0 = 1e6/5500 - 20
p1 = pd_at(1e6/m1); p0 = pd_at(1e6/m0)
dw = [-(p1[k]-p0[k])/40 for k in range(3)]; mw = sum(dw)/3; dw = [v - mw for v in dw]
print('warmPerMired (logH per mired, mean removed):', [round(v, 5) for v in dw], ' x130 mired in points:', [round(v*130/0.025, 2) for v in dw])
