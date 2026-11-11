"""Stock bases read through Chromogen's scanner channels; ranking of stocks by rebate colour.

Usage: python3 -I base_rank.py /path/to/st-data/cg
Builds xt5-fitted (Gaussian LEDs 678/532/472, FWHM 20 x generic Bayer camera) and white-led channels
like channels.js scanner(): P_k = light_k * camera_k, normalised to sum 1; reads the base density.
"""
import sys, json, os
import numpy as np


def gaussian(c, fwhm, wl):
    s = fwhm / 2.354820045
    return np.exp(-0.5 * ((wl - c) / s) ** 2)


def main(cg):
    cam = json.load(open(os.path.join(cg, 'cameras/generic-bayer.json')))
    wl = np.array(cam['wl'])
    C = np.array([cam[k] for k in 'RGB'])
    wled = json.load(open(os.path.join(cg, 'lights/white-led.json')))
    W = np.array(wled.get('values') or wled.get('power') or wled.get('R'))

    def chans(lights):
        P = np.array([lights[k] * C[k] for k in range(3)])
        return P / P.sum(1, keepdims=True)

    xt5 = chans([gaussian(678, 20, wl), gaussian(532, 20, wl), gaussian(472, 20, wl)])
    book = chans([gaussian(660, 20, wl), gaussian(530, 25, wl), gaussian(450, 20, wl)])
    white = chans([W, W, W])
    stocks = sorted(f for f in os.listdir(os.path.join(cg, 'stocks')))
    rows = []
    for f in stocks:
        d = json.load(open(os.path.join(cg, 'stocks', f)))
        if d['info']['type'] != 'negative':
            continue
        b = np.array([0 if v is None else v for v in d['data']['base_density']])
        rd = lambda P: -np.log10(P @ (10 ** -b))
        rows.append((d['info']['stock'], rd(xt5), rd(book), rd(white)))
    for name, a, bb, c in rows:
        print(f'{name:22s} xt5 {np.round(a,3)}  book {np.round(bb,3)}  white {np.round(c,3)}')
    # sigma_min of the analytic K for xt5 vs white, Gold 200 dyes
    d = json.load(open(os.path.join(cg, 'stocks', 'kodak_gold_200.json')))
    E = np.array([[0 if v is None else v for v in row] for row in d['data']['channel_density']])  # 81 x 3
    for nm, P in (('xt5', xt5), ('book', book), ('white', white)):
        K = np.array([[-np.log10(P[k] @ (10 ** -E[:, j])) for j in range(3)] for k in range(3)])
        print(nm, 'secant K singular values', np.round(np.linalg.svd(K, compute_uv=False), 3))
    # Rank by difference between base readings of Gold 200 and others, through xt5
    ref = [r for r in rows if r[0] == 'kodak_gold_200'][0][1]
    print('xt5 distance of each base from Gold 200 base (max |dD|):')
    for name, a, _, _ in rows:
        print(f'  {name:22s} {np.abs(a - ref).max():.3f}  offsets-removed {np.abs((a-ref)-(a-ref).mean()).max():.3f}')


if __name__ == '__main__':
    main(sys.argv[1])
