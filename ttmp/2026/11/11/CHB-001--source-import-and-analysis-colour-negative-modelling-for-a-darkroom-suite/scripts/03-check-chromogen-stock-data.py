#!/usr/bin/env python3
"""Sanity checks on the stock / camera / light data unpacked by 02-inventory-chromogen-st-data.py.

Usage: python3 -I 03-check-chromogen-stock-data.py <st-data/cg dir>

Prints, per stock: wavelength ranges where channel_density is null (the Studio sets those to 0), dye peaks and
log-sensitivity peaks; pairs of stocks with identical data arrays; each stock's neutral slope over -0.5..+0.5 log H
and density at log H 0; the peaks of the illustrative camera and white LED; and the linear value paper white
(Y = 1) reaches after the output shader's tanh shoulder at 0.82 (render.js outUniforms, FS_OUT).
Reads JSON only; executes nothing from the data.
"""
import glob
import itertools
import json
import math
import os
import sys


def ranges(ws, step=5.0):
    out = []
    for w in ws:
        if out and w - out[-1][1] <= step:
            out[-1][1] = w
        else:
            out.append([w, w])
    return [tuple(r) for r in out]


def interp_at(xs, ys, x):
    for i in range(len(xs) - 1):
        if xs[i] <= x <= xs[i + 1]:
            t = (x - xs[i]) / (xs[i + 1] - xs[i])
            return ys[i] + t * (ys[i + 1] - ys[i])
    return None


def main():
    base = sys.argv[1]
    stocks = {os.path.basename(f)[:-5]: json.load(open(f, encoding="utf-8"))["data"]
              for f in sorted(glob.glob(os.path.join(base, "stocks", "*.json")))}
    print("== null dye ranges, dye peaks, sensitivity peaks")
    for name, d in stocks.items():
        wl = d["wavelengths"]
        for k in range(3):
            nul = [wl[i] for i, r in enumerate(d["channel_density"]) if r[k] is None]
            peak = max((r[k], wl[i]) for i, r in enumerate(d["channel_density"]) if r[k] is not None)
            spk = max((r[k], wl[i]) for i, r in enumerate(d["log_sensitivity"]) if r[k] is not None)
            print(f"{name:34s} layer {k}: null {ranges(nul)}  dye peak {peak}  logS peak {spk}")
    print("\n== identical arrays between stocks")
    keys = ["log_sensitivity", "channel_density", "base_density", "density_curves"]
    for a, b in itertools.combinations(sorted(stocks), 2):
        same = [k for k in keys if stocks[a][k] == stocks[b][k]]
        if same:
            print(f"{a} == {b}: {same}")
    print("\n== neutral slope over -0.5..+0.5 log H, density at log H 0")
    for name, d in stocks.items():
        le, dc = d["log_exposure"], d["density_curves"]
        col = lambda k: [r[k] for r in dc]
        slope = [round(interp_at(le, col(k), 0.5) - interp_at(le, col(k), -0.5), 3) for k in range(3)]
        d0 = [round(interp_at(le, col(k), 0.0), 3) for k in range(3)]
        print(f"{name:34s} slope={slope} D(0)={d0}")
    cam = json.load(open(os.path.join(base, "cameras", "generic-bayer.json"), encoding="utf-8"))
    for k in "RGB":
        v = cam[k]
        print(f"camera {k} peak {cam['wl'][max(range(len(v)), key=lambda i: v[i])]} nm")
    led = json.load(open(os.path.join(base, "lights", "white-led.json"), encoding="utf-8"))
    print(f"white LED peak {led['wl'][max(range(len(led['values'])), key=lambda i: led['values'][i])]} nm")
    s = 0.82
    w = s + (1 - s) * math.tanh((1.0 - s) / (1 - s))
    enc = 1.055 * w ** (1 / 2.4) - 0.055
    print(f"paper white after shoulder: {w:.4f} linear, sRGB {enc:.4f} = {round(enc * 255)}/255")


if __name__ == "__main__":
    main()
