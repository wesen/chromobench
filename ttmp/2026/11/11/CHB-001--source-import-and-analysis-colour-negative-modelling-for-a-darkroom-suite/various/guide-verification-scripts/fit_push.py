import json, sys, math
P = json.load(open(sys.argv[1]))
le = [-3 + 7*k/255 for k in range(256)]
def curves(name):
    c = P[name]['curves']; mn = [min(r[j] for r in c) for j in range(3)]
    return [[r[j]-mn[j] for r in c] for j in range(3)]
def interp(x, xp, fp):
    if x <= xp[0]: return fp[0]
    if x >= xp[-1]: return fp[-1]
    lo, hi = 0, len(xp)-1
    while hi-lo > 1:
        m = (lo+hi)//2
        if xp[m] <= x: lo = m
        else: hi = m
    t = (x-xp[lo])/(xp[hi]-xp[lo]); return fp[lo]+t*(fp[hi]-fp[lo])
base = curves('kodak_portra_800')
def slope(f, x, h=0.1): return (interp(x+h, le, f)-interp(x-h, le, f))/(2*h)
for name in ['kodak_portra_800_push1','kodak_portra_800_push2']:
    tgt = curves(name)
    print(name)
    for j in range(3):
        best = None
        # model: f_push(x) ~ f(g*x + s)  over x in [-2, 2]
        for gi in range(80, 161):
            g = gi/100
            for si in range(-60, 61):
                s = si/100
                err = 0; n = 0
                for x in [i/20 for i in range(-40, 41)]:
                    e = interp(g*x+s, le, base[j]) - interp(x, le, tgt[j]); err += e*e; n += 1
                rms = math.sqrt(err/n)
                if best is None or rms < best[0]: best = (rms, g, s)
        rms, g, s = best
        print('  layer', 'RGB'[j], 'gamma x%.2f' % g, 'shift %+.2f logH (= %+.2f stops)' % (s, s/0.30103), 'rms %.3f' % rms,
              'dmax %.3f -> %.3f' % (max(base[j]), max(tgt[j])), 'slope@0 %.3f -> %.3f' % (slope(base[j],0), slope(tgt[j],0)),
              'f(0) %.3f -> %.3f' % (interp(0,le,base[j]), interp(0,le,tgt[j])))
for name in ['kodak_portra_800','kodak_portra_800_push1','kodak_portra_800_push2']:
    ls = P[name]['logSens']; print(name, 'logSens peak', [round(max(r[j] for r in ls if r[j] is not None),3) for j in range(3)], 'curve min', [round(min(r[j] for r in P[name]['curves']),4) for j in range(3)])
