import json, math
exec(open('printchain.py').read().split("pack = [0, 51.568, 52.534]")[0].replace("d = json.load(open(sys.argv[1]))", "d = json.load(open('data.json'))"))
pack = [0, 51.568, 52.534]
grey = [curve_at(0.0, c) for c in range(3)]; Dg = neg_density(grey)
fM = 1 / math.exp(sum(math.log(v) for v in raw(Dg, pack)) / 3)
def xr(D, dl=0.0, g=1.0, gx=None):
    x = [math.log10(v * fM) + dl for v in raw(D, pack)]
    if gx is not None: x = [gx[k] + g*(x[k]-gx[k]) for k in range(3)]
    return x
def dvis(x):
    cp = [paper_dye(x[k], k) for k in range(3)]; return -math.log10(view(cp)[1])
W = neg_density([curve_at(0.689, c) for c in range(3)]); B = neg_density([curve_at(-0.788, c) for c in range(3)])
print('1/3-stop strip, base 10 s f/8: Dvis (white 90%, grey 18%, black 3%)')
for i in range(-3, 4):
    s = i/3; dl = s*math.log10(2)
    print(f'  {10*2**s:5.1f} s  {s:+.2f} st  ', [round(dvis(xr(D, dl)), 3) for D in (W, Dg, B)])
gx = xr(Dg)
print('grade (gamma about grey): Dvis white/grey/black')
for g in [0.7, 0.85, 1.0, 1.2, 1.45]:
    print('  g', g, [round(dvis(xr(D, 0, g, gx)), 3) for D in (W, Dg, B)])
# preflash: Chromogen formula phi = 0.35 p/100 10^(g-0.6) applied per layer
for p in [0, 20, 40]:
    out = []
    for D in (W, Dg, B):
        x = xr(D); x = [math.log10(10**x[k] + 0.35*p/100*10**(gx[k]-0.6)) for k in range(3)]
        out.append(round(dvis(x), 3))
    print('  preflash', p, out)
# burn +1 stop at mask 0.5: linear vs log-interp on grey
print('burn +1 stop, m=0.5: linear sum shift', round(math.log10(1+0.5*1), 4), 'log-interp', round(0.5*math.log10(2), 4))
print('Dvis grey linear', round(dvis(xr(Dg, math.log10(1.5))), 3), 'loginterp', round(dvis(xr(Dg, 0.5*math.log10(2))), 3))
# magnification
for m1, m2 in [(7.06, 14.1)]:
    f = ((m2+1)/(m1+1))**2; print('mag', m1, '->', m2, 'time factor', round(f, 2), 'stops', round(math.log2(f), 2))
print('f/8 -> f/11 nominal logH', round(-2*math.log10(11/8), 3), 'exact one stop', round(-math.log10(2), 3))
