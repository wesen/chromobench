"""Post-hoc check of hand-computed numbers quoted in the CHB-006/013 guides (no inputs)."""
import math
dec = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
a, b = dec(0.2), dec(0.8)
avg_first, lin_first = dec(0.5), (a + b) / 2
print('sRGB edge: avg-first', round(avg_first, 4), 'lin-first', round(lin_first, 4),
      'D', round(-math.log10(avg_first), 3), round(-math.log10(lin_first), 3),
      'diff', round(-math.log10(avg_first) + math.log10(lin_first), 3))
T = (0.128625, 0.734625, 0.239500)   # (u-32)/64000 for u = (8264, 47049, 15362)
print('T from u', [round((u - 32) / 64000, 5) for u in (8264, 47049, 15362)])
auto = (0.13446469, 0.77217251, 0.24652444); box = (0.12053495, 0.67926413, 0.21386581)
sig = (0.00899, 0.00686, 0.01220)
for name, R in (('box', box), ('auto', auto)):
    D = [-math.log10(t / r) for t, r in zip(T, R)]
    print(name, 'D', [round(d, 4) for d in D], 'z', [round(d / s, 2) for d, s in zip(D, sig)])
print('footprint rule red', round(0.0090 / (1090 / 640), 4))
print('leak rel change per nm, red LED green leak', round(-0.00044 / 0.0152, 3))
