"""Illustrative 3-component variable-contrast paper (Ilford's 'three emulsions, same blue speed, same contrast').
All parameters are made up for illustration; nothing here is measured."""
import math
from statistics import NormalDist
N = NormalDist()
w, sig = 0.7, 0.119          # each component: Dmax 0.7, normal-CDF curve width in log H
delta = (0.0, 0.7, 1.4)      # green-light speed offsets (log H) of the three components
def paper_D(xk):             # xk: log10 exposure seen by each component (speed point at 0)
    return sum(w * N.cdf(x / sig) for x in xk)
def comp_x(x, p_blue):       # light = p_blue * blue + (1-p_blue) * green, relative log exposure x (blue-equivalent)
    return [x + math.log10(p_blue + (1 - p_blue) * 10 ** (-d)) for d in delta]
def isoR(p):
    # R = 100 * (x at D = 0.9*Dmax) - (x at D = 0.04)
    def solve(target):
        lo, hi = -6, 6
        for _ in range(100):
            mid = (lo + hi) / 2
            if paper_D(comp_x(mid, p)) < target: lo = mid
            else: hi = mid
        return lo
    return 100 * (solve(0.9 * 3 * w) - solve(0.04))
for p in (1.0, 0.5, 0.2, 0.1, 0.05, 0.0):
    print(f"blue share {p:4.2f}: ISO R = {isoR(p):5.1f}")
# negative patches (diffuse net density above base+fog)
neg = {"shadow": 0.12, "grey": 0.65, "highlight": 1.15}
def print_patches(p, Q):
    # exposure set so the grey patch prints at reflection density 0.74
    def Dgrey(e): return paper_D(comp_x(e - Q * neg["grey"], p))
    lo, hi = -6, 8
    for _ in range(100):
        mid = (lo + hi) / 2
        if Dgrey(mid) < 0.74: lo = mid
        else: hi = mid
    e = lo
    return e, {k: round(paper_D(comp_x(e - Q * d, p)), 3) for k, d in neg.items()}
for Q in (1.0, 1.25):
    for p in (0.5, 0.2):
        e, dd = print_patches(p, Q)
        print(f"Q={Q} blue share {p}: log exposure offset {e:.3f}, print densities {dd}")
# split grade: t_g of green-only, t_b of blue-only == single exposure with mixed light
tg, tb = 1.0, 0.25
p_equiv = tb / (tg + tb)
print("split 1.0 s green + 0.25 s blue == single exposure, blue share", round(p_equiv, 3), "ISO R", round(isoR(p_equiv), 1))
def p_for_R(R):
    lo, hi = 0.0, 1.0   # R decreases with p
    for _ in range(80):
        mid = (lo + hi) / 2
        if isoR(mid) > R: lo = mid
        else: hi = mid
    return lo
for R in (180, 130, 110, 90, 60, 40):
    try:
        print(f"R {R}: blue share {p_for_R(R):.4f}")
    except Exception as e:
        print(R, e)
neg2 = {"shadow": 0.15, "grey": 0.62, "highlight": 1.10}
neg.clear(); neg.update(neg2)
p2 = p_for_R(110)
for Q in (1.0, 1.25):
    e, dd = print_patches(p2, Q)
    print(f"R110 filter, Q={Q}: offset {e:.3f} densities {dd}")
p1 = p_for_R(130)
e, dd = print_patches(p1, 1.25)
print(f"R130 filter, Q=1.25: offset {e:.3f} densities {dd}")
