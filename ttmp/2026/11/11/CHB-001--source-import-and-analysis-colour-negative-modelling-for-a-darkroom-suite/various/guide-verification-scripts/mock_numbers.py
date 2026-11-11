# Mock-engine numbers used in the CHB-002 and CHB-007 traces.
import math
T = (0.20, 0.10, 0.05)          # camera-linear pixel (grey patch)
Treb = (0.80, 0.50, 0.35)       # rebate
d = [-math.log10(t/r) for t, r in zip(T, Treb)]
print('scanner density', [round(x, 4) for x in d])
c = d                            # mock invert.dyes: identity
def expose(c, time_s=10.0, fstop=8.0):
    return [-ck + math.log10(time_s/10.0) - 2*math.log10(fstop/8.0) for ck in c]
def develop(x):
    return [min(2.5, max(0.0, 0.8 + 1.5*(xk + 0.7))) for xk in x]
def enc(v):
    return 12.92*v if v <= 0.0031308 else 1.055*v**(1/2.4) - 0.055
for lights in ([0,0,0], [0.1,0,0], [-0.1125,-0.0125,0.125]):
    x = [a+b for a, b in zip(expose(c), lights)]
    a = develop(x)
    R = [10**-ak for ak in a]
    print('lights', lights, 'x', [round(v,4) for v in x], 'paper dyes', [round(v,4) for v in a], 'R', [round(v,4) for v in R], 'display', [round(enc(v),4) for v in R])
a = develop(expose(c)); m = sum(a)/3
dx = [(m-ak)/1.5 for ak in a]
print('mean', round(m,4), 'dx logH', [round(v,4) for v in dx], 'points', [round(v/0.025,2) for v in dx])
print('12.6 s vs 10 s stops', math.log2(12.6/10), 'logH', math.log10(12.6/10), 'pt', math.log10(12.6/10)/0.025)
print('1 stop in points', 0.30103/0.025)
# Beer-Lambert golden: product of transmittances
print(1.0626*0.1294*0.9950*0.2498, 10**-1.4662)
# visual density of print for R with sRGB-ish Y weights (mock)
