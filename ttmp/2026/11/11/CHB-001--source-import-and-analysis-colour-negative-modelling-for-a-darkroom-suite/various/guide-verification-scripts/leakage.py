"""Leakage ratios of Gaussian LEDs through Chromogen's illustrative camera, and an LED-peak fit from them.
Usage: python3 -I leakage.py /path/to/st-data/cg"""
import sys, json, os
import numpy as np
cg = sys.argv[1]
cam = json.load(open(os.path.join(cg, 'cameras/generic-bayer.json')))
wl = np.array(cam['wl']); Q = np.array([cam[k] for k in 'RGB'])
def g(c, fwhm): s = fwhm / 2.3548; return np.exp(-0.5 * ((wl - c) / s) ** 2)
def ratios(mu, w=20):
    out = []
    for k, m in enumerate(mu):
        s = Q @ g(m, w)
        out.append(s / s[k])
    return np.array(out)  # row k = LED k, columns = camera channel c
for mu in ([678, 532, 472], [660, 530, 450]):
    print('LEDs', mu, 'leakage rho[k][c]:'); print(ratios(mu).round(4))
# sensitivity: d rho / d mu (per nm)
base = ratios([678, 532, 472])
for k in range(3):
    mu = [678, 532, 472]; mu2 = list(mu); mu2[k] += 1
    d = ratios(mu2)[k] - base[k]
    print('LED', k, 'd rho per +1 nm', d.round(5))
# fit: recover peaks from ratios with noise 1% relative
rng = np.random.default_rng(1)
true = np.array([678., 532., 472.])
meas = ratios(true) * (1 + 0.01 * rng.standard_normal((3, 3)))
fit = []
for k in range(3):
    grid = np.arange(true[k] - 40, true[k] + 40, 0.1)
    err = [np.sum(((ratios([m if j == k else true[j] for j in range(3)])[k] - meas[k]) / np.maximum(meas[k], 1e-3)) ** 2 * (np.arange(3) != k)) for m in grid]
    fit.append(grid[int(np.argmin(err))])
print('fit peaks with 1% ratio noise:', np.round(fit, 1))
# camera peaks and FWHM-ish
for k in range(3):
    print('camera', 'RGB'[k], 'peak', wl[np.argmax(Q[k])])
