#!/usr/bin/env python3
"""Decode and describe the film-data blob embedded in Filmbench IDE.

The blob (<script id="film-data">) is base64 of a zlib/deflate stream whose
payload is JSON. Inside, each stock profile may carry a `lut` field that is
itself base64 of a deflate stream of little-endian int16 values (a 64x64x3
log2 table, scale 1/1024), decoded by FB.decodeLuts() in the JS.

Usage:
  python3 -I 06-decode-filmbench-film-data.py <00-film-data.bin.txt> [summary.json]

Prints the structure (keys, shapes, ranges), the stock list and per-stock
metadata. If a second path is given, writes a compact JSON summary there
(no big arrays, only shapes and small metadata).
"""
import base64
import json
import struct
import sys
import zlib


def shape(v):
    """Nested-list shape, e.g. [81, 3]."""
    s = []
    while isinstance(v, list):
        s.append(len(v))
        if not v:
            break
        v = v[0]
    return s


def flat_nums(v):
    if isinstance(v, list):
        for x in v:
            yield from flat_nums(x)
    elif isinstance(v, (int, float)) and v is not None:
        yield v


def rng(v):
    xs = [x for x in flat_nums(v)]
    if not xs:
        return None
    return [round(min(xs), 5), round(max(xs), 5)]


def describe(v, depth=0, maxdepth=2):
    if isinstance(v, dict):
        if depth >= maxdepth:
            return f"dict({len(v)} keys)"
        return {k: describe(x, depth + 1, maxdepth) for k, x in v.items()}
    if isinstance(v, list):
        sh = shape(v)
        r = rng(v)
        return f"list{sh}" + (f" range {r}" if r else "")
    if isinstance(v, str):
        return f"str({len(v)})" if len(v) > 60 else repr(v)
    return repr(v)


def main() -> None:
    raw = open(sys.argv[1], encoding="ascii").read().strip()
    comp = base64.b64decode(raw)
    js = zlib.decompress(comp)
    data = json.loads(js)
    print(f"base64 chars {len(raw)}  compressed {len(comp)} B  json {len(js)} B")
    print("top-level keys:")
    for k, v in data.items():
        if k == "profiles":
            print(f"  profiles: dict({len(v)})")
        else:
            d = describe(v, 0, 1)
            print(f"  {k}: {json.dumps(d, ensure_ascii=False)[:400]}")

    summary = {"top": {}, "profiles": {}, "illuminants": {}, "neutral_filters": {}}
    for k, v in data.items():
        if k != "profiles":
            summary["top"][k] = describe(v, 0, 1)

    # wavelength grid
    for key in ("wl", "wavelengths", "lambda", "lam"):
        if key in data:
            w = data[key]
            print(f"wavelength grid '{key}': n={len(w)} {w[0]}..{w[-1]} step {w[1]-w[0]}")

    if "illuminant" in data:
        print("illuminants:", ", ".join(f"{k}[{len(v)}]" for k, v in data["illuminant"].items()))
        summary["illuminants"] = {k: len(v) for k, v in data["illuminant"].items()}
    for k in ("illuminant_xyz", "xyz2rgb", "rgb2xyz_cat16"):
        if k in data:
            print(f"{k}: keys {list(data[k].keys())}")
    if "neutral_filters" in data:
        nf = data["neutral_filters"]
        for pk, films in nf.items():
            print(f"neutral_filters[{pk}]: {len(films)} films, e.g. "
                  + ", ".join(f"{f}={v}" for f, v in list(films.items())[:3]))
            summary["neutral_filters"][pk] = films

    print("\nprofiles:")
    for sid, p in data["profiles"].items():
        meta = {k: v for k, v in p.items() if not isinstance(v, (list, dict)) and not (isinstance(v, str) and len(v) > 80)}
        arrays = {k: shape(v) for k, v in p.items() if isinstance(v, list)}
        dicts = {k: describe(v, 0, 1) for k, v in p.items() if isinstance(v, dict)}
        lut_info = None
        if isinstance(p.get("lut"), str):
            b = zlib.decompress(base64.b64decode(p["lut"]))
            n = len(b) // 2
            vals = struct.unpack(f"<{n}h", b)
            lut_info = {"int16_count": n, "as_64x64x3": n == 64 * 64 * 3,
                        "log2_range": [round(min(vals) / 1024, 3), round(max(vals) / 1024, 3)]}
        crv = p.get("curves")
        crv_rng = None
        if isinstance(crv, list) and crv and isinstance(crv[0], list):
            cols = list(zip(*crv))
            crv_rng = [[round(min(c), 3), round(max(c), 3)] for c in cols]
        print(f"- {sid}: {json.dumps(meta, ensure_ascii=False)}")
        print(f"    arrays {arrays}" + (f"  curves dmin/dmax per channel {crv_rng}" if crv_rng else ""))
        if dicts:
            print(f"    dicts {json.dumps(dicts, ensure_ascii=False)[:300]}")
        if lut_info:
            print(f"    lut {lut_info}")
        summary["profiles"][sid] = {"meta": meta, "arrays": arrays, "dicts": dicts, "curves_range": crv_rng, "lut": lut_info}

    if len(sys.argv) > 2:
        with open(sys.argv[2], "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=1, ensure_ascii=False)
        print(f"\nwrote {sys.argv[2]}")


if __name__ == "__main__":
    main()
