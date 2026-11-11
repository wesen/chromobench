import json, math, sys
d = json.load(open(sys.argv[1]))
NW = 81
P = d['profiles']['kodak_portra_400']; E = d['profiles']['kodak_portra_endura']
lamp = d['illuminant']['TH-KG3']
F = d['dichroic']
chan = P['chan']; base = P['base']
sens = [[10 ** E['logSens'][i][k] for k in range(3)] for i in range(NW)]
curves = P['curves']
def curve_at(x, c):
    u = (x + 3) / 7 * 255
    i = max(0, min(254, int(math.floor(u)))); t = u - i
    return curves[i][c] * (1 - t) + curves[i + 1][c] * t
def dens(cmy):
    return [sum(chan[i][k] * cmy[k] for k in range(3)) + base[i] for i in range(NW)]
def filt(cc):
    t = [10 ** (-v / 100) for v in cc]
    out = []
    for i in range(NW):
        tot = 1.0
        for k in range(3):
            tot *= 1 - (1 - F[i][k]) * (1 - t[k])
        out.append(tot)
    return out
def x_of(D, cc):
    f = filt(cc)
    return [math.log10(sum(lamp[i] * f[i] * 10 ** (-D[i]) * sens[i][k] for i in range(NW))) for k in range(3)]
grey = [curve_at(0.0, c) for c in range(3)]
print('grey dye (raw curve at logH 0):', [round(v, 4) for v in grey])
pack = [0, 51.568, 52.534]
Dg = dens(grey)
x0 = x_of(Dg, pack)
print('x at grey, neutral pack', [round(v, 4) for v in x0])
h = 0.5
J = [[0]*3 for _ in range(3)]
for j in range(3):
    pp = pack[:]; pp[j] += h; pm = pack[:]; pm[j] -= h
    xp = x_of(Dg, pp); xm = x_of(Dg, pm)
    for k in range(3): J[k][j] = (xp[k] - xm[k]) / (2 * h)
print('dx/dv (rows layers R,G,B; cols filters C,M,Y), per CC, no normalisation:')
for r in J: print('  ', [round(v, 4) for v in r])
Jn = [[J[k][j] - sum(J[q][j] for q in range(3)) / 3 for j in range(3)] for k in range(3)]
print('normalised (column mean removed):')
for r in Jn: print('  ', [round(v, 4) for v in r])
# filter factors
for name, dv in [('+10 Y', [0, 0, 10]), ('+10 M', [0, 10, 0]), ('+10 C', [10, 0, 0]), ('+20 Y', [0,0,20]), ('+10M+10Y', [0,10,10])]:
    pp = [pack[i] + dv[i] for i in range(3)]
    x1 = x_of(Dg, pp)
    dx = [x1[k] - x0[k] for k in range(3)]
    print(name, 'dx logH', [round(v, 4) for v in dx], 'points', [round(v / 0.025, 2) for v in dx], 'stops', [round(v / math.log10(2), 3) for v in dx], 'mean stops', round(sum(dx) / 3 / math.log10(2), 3))
# Jacobian preview error across densities: dyes along grey axis and some colours
import itertools
for dv in ([0, 0, 10], [0, 10, 0], [0, 5, 5], [0, 20, 20], [10, 0, 0]):
    worst = 0; worstAt = None
    for a in [-1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5, 2.0]:
        for off in [(0,0,0), (0.4,0,0), (0,0.4,0), (0,0,0.4), (-0.4,0,0), (0,-0.4,0), (0,0,-0.4)]:
            cmy = [max(0, curve_at(a + off[c], c)) for c in range(3)]
            D = dens(cmy)
            xa = x_of(D, pack); pp = [pack[i] + dv[i] for i in range(3)]
            xb = x_of(D, pp)
            pred = [xa[k] + sum(J[k][j] * dv[j] for j in range(3)) for k in range(3)]
            err = max(abs(xb[k] - pred[k]) for k in range(3))
            if err > worst: worst, worstAt = err, (a, off)
    print('Jacobian preview', dv, 'max err logH', round(worst, 5), 'points', round(worst/0.025, 2), 'at', worstAt)
