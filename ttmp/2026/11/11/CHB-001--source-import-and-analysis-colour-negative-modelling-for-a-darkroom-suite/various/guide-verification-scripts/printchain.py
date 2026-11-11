import json, math, sys
d = json.load(open(sys.argv[1]))
NW = 81
P = d['profiles']['kodak_portra_400']; E = d['profiles']['kodak_portra_endura']
lamp = d['illuminant']['TH-KG3']; Fd = d['dichroic']; cmf = d['cmf']; D50 = d['illuminant']['D50']
sens = [[10 ** E['logSens'][i][k] for k in range(3)] for i in range(NW)]
def phi(z): return 0.5 * (1 + math.erf(z / math.sqrt(2)))
def curve_at(x, c, cur=P['curves']):
    u = (x + 3) / 7 * 255
    i = max(0, min(254, int(math.floor(u)))); t = u - i
    return cur[i][c] * (1 - t) + cur[i + 1][c] * t
m = E['model']
def paper_dye(x, c, g=1.0):
    return sum(m['amps'][c][i] * phi((x * g - m['centers'][c][i]) / m['sigmas'][c][i]) for i in range(3))
def neg_density(cmy): return [sum(P['chan'][i][k] * cmy[k] for k in range(3)) + P['base'][i] for i in range(NW)]
def filt(cc):
    t = [10 ** (-v / 100) for v in cc]; out = []
    for i in range(NW):
        tot = 1.0
        for k in range(3): tot *= 1 - (1 - Fd[i][k]) * (1 - t[k])
        out.append(tot)
    return out
def raw(D, cc):
    f = filt(cc)
    return [sum(lamp[i] * f[i] * 10 ** (-D[i]) * sens[i][k] for i in range(NW)) for k in range(3)]
norm = sum(D50[i] * cmf[i][1] for i in range(NW))
Xw = [sum(D50[i] * cmf[i][j] for i in range(NW)) / norm for j in range(3)]
def view(cp):
    Dp = [sum(E['chan'][i][k] * cp[k] for k in range(3)) + E['base'][i] for i in range(NW)]
    X = [sum(10 ** (-Dp[i]) * D50[i] * cmf[i][j] for i in range(NW)) / norm for j in range(3)]
    return X
def lab(X, W=Xw):
    f = lambda t: t ** (1/3) if t > 216/24389 else (24389/27 * t + 16) / 116
    fx, fy, fz = (f(X[j] / W[j]) for j in range(3))
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))
pack = [0, 51.568, 52.534]
grey = [curve_at(0.0, c) for c in range(3)]
Dg = neg_density(grey)
rg = raw(Dg, pack)
fM = 1 / math.exp(sum(math.log(v) for v in rg) / 3)     # spektrafilm mid-grey normalisation
def x_real(D, cc, dlogt=0.0):
    r = raw(D, cc); return [math.log10(v * fM) + dlogt for v in r]    # calibration fixed at the neutral pack
def x_norm(D, cc, dlogt=0.0):
    r = raw(D, cc); rgc = raw(Dg, cc)
    f = 1 / math.exp(sum(math.log(v) for v in rgc) / 3)
    return [math.log10(v * f) + dlogt for v in r]
def print_of(x):
    cp = [paper_dye(x[k], k) for k in range(3)]
    X = view(cp)
    return cp, X, -math.log10(X[1]), lab(X)
cp, X, Dv, L = print_of(x_real(Dg, pack))
print('grey paper dye', [round(v, 3) for v in cp], 'visual density', round(Dv, 3), 'Lab', [round(v, 2) for v in L])
pw = view([0, 0, 0]); print('paper white Y', round(pw[1], 3), 'Lab', [round(v, 2) for v in lab(pw)])
# test strip in time: 1/3 stop steps
print('\nTEST STRIP (grey card; highlight = film logH +1.5; shadow = film logH -1.5), real mode, neutral pack')
hl = neg_density([curve_at(1.5, c) for c in range(3)]); sh = neg_density([curve_at(-1.5, c) for c in range(3)])
base_t = 10.0
for s in [-1, -2/3, -1/3, 0, 1/3, 2/3, 1]:
    dl = s * math.log10(2)
    out = []
    for D in (hl, Dg, sh):
        _, _, dv, _ = print_of(x_real(D, pack, dl)); out.append(round(dv, 3))
    print(f'  {s:+.2f} stop  t={base_t * 2 ** s:5.1f} s  Dvis(highlight, grey, shadow) = {out}')
print('\nEQUAL-INCREMENT STRIP 4,8,12,16,20 s (base 12 s at aim):')
for t in [4, 8, 12, 16, 20]:
    dl = math.log10(t / 12)
    _, _, dv, _ = print_of(x_real(Dg, pack, dl)); print(f'  {t:2d} s  ({math.log2(t/12):+.2f} stop)  grey Dvis = {dv:.3f}')
print('\nFILTER CHANGES at grey, real mode vs normalised mode')
for name, dv in [('+10 Y', [0, 0, 10]), ('+10 M', [0, 10, 0]), ('+10 C', [10, 0, 0]), ('-10 Y', [0, 0, -10]), ('+5 M', [0,5,0])]:
    pp = [pack[i] + dv[i] for i in range(3)]
    for mode, fn in (('real', x_real), ('norm', x_norm)):
        _, _, dvv, LL = print_of(fn(Dg, pp))
        print(f'  {name} {mode}: Dvis {dvv:.3f} (d {dvv - Dv:+.3f})  L* {LL[0]:.2f} a* {LL[1]:+.2f} b* {LL[2]:+.2f}')
    # time compensation in real mode to restore grey visual density
    lo, hi = -0.5, 0.5
    for _ in range(60):
        mid = (lo + hi) / 2
        _, _, dvv, _ = print_of(x_real(Dg, pp, mid))
        if dvv < Dv: lo = mid
        else: hi = mid
    print(f'     time factor to restore grey Dvis: x{10 ** mid:.3f} ({mid / math.log10(2):+.3f} stop)')
print('\nPRINTER LIGHT +10 points red only (0.25 logH), real mode:')
_, _, dvv, LL = print_of([v + (0.25 if k == 0 else 0) for k, v in enumerate(x_real(Dg, pack))])
print(f'  Dvis {dvv:.3f}  Lab {[round(v, 2) for v in LL]}')
print('\nPAPER SLOPES at grey (dye per logH):', [round((paper_dye(x+0.01, k) - paper_dye(x-0.01, k)) / 0.02, 2) for k, x in enumerate(x_real(Dg, pack))])
