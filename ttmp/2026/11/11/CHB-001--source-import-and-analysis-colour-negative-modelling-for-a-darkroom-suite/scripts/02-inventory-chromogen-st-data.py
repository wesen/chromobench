#!/usr/bin/env python3
"""Inventory the window.ST_DATA blob of Chromogen Studio (03-inline.js) without executing it.

Usage: python3 -I 02-inventory-chromogen-st-data.py <03-inline.js> [<out-dir>]

Prints: the embedded data files (stocks, camera, light) with their grids, curve ranges and licence strings;
the sample metadata; the bundled book chapters (id, title, size, st: links).
With <out-dir>, also writes each bundled book chapter to <out-dir>/book/NN-<id>.md and each embedded data file
to <out-dir>/cg/<path> (pretty-printed JSON), so they can be grepped.
"""
import json
import os
import re
import sys


def load(path):
    s = open(path, encoding="utf-8").read().strip()
    m = re.match(r"^window\.ST_DATA\s*=\s*", s)
    if not m:
        raise SystemExit("not a window.ST_DATA blob")
    s = s[m.end():].rstrip(";").strip()
    return json.loads(s)


def rng(vals):
    v = [x for x in vals if isinstance(x, (int, float))]
    return (min(v), max(v)) if v else (None, None)


def main():
    data = load(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else None
    print("top-level keys:", list(data.keys()))
    cg = data.get("cg", {})
    print(f"\n== cg: {len(cg)} embedded files")
    for name, body in sorted(cg.items()):
        size = len(body)
        try:
            j = json.loads(body)
        except Exception:
            print(f"- {name}: {size} bytes (not JSON)")
            continue
        if name.startswith("stocks/"):
            info, d, meta = j.get("info", {}), j.get("data", {}), j.get("metadata", {})
            wl = d.get("wavelengths", [])
            le = d.get("log_exposure", [])
            dc = d.get("density_curves", [])
            print(f"- {name}: {size} bytes")
            print(f"    info: {info}")
            print(f"    metadata keys: {list(meta.keys())}; licence: {meta.get('license')!r}")
            print(f"    data keys: {list(d.keys())}")
            print(f"    wavelengths: n={len(wl)} {wl[:1]}..{wl[-1:]}")
            print(f"    log_exposure: n={len(le)} range={rng(le)}")
            if dc:
                cols = list(zip(*dc))
                print("    density_curves per layer (min,max): " + ", ".join(str(tuple(round(x, 3) for x in rng(c))) for c in cols))
            for key in ("log_sensitivity", "channel_density"):
                if key in d:
                    rows = d[key]
                    nulls = sum(1 for r in rows for x in r if x is None)
                    print(f"    {key}: {len(rows)} rows x {len(rows[0]) if rows else 0}, nulls={nulls}")
            if "base_density" in d:
                bd = d["base_density"]
                print(f"    base_density: n={len(bd)} range={rng(bd)}")
            extra = {k: v for k, v in d.items() if k not in ("wavelengths", "log_exposure", "density_curves", "log_sensitivity", "channel_density", "base_density")}
            for k, v in extra.items():
                print(f"    extra data.{k}: {str(v)[:160]}")
        else:
            keys = list(j.keys()) if isinstance(j, dict) else type(j).__name__
            print(f"- {name}: {size} bytes, keys={keys}")
            if isinstance(j, dict):
                for k, v in j.items():
                    if isinstance(v, list):
                        print(f"    {k}: list n={len(v)} range={rng(v)}")
                    else:
                        print(f"    {k}: {str(v)[:200]}")
        if out:
            p = os.path.join(out, "cg", name)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(j, f, indent=1)

    print("\n== samples")
    for k, v in data.get("samples", {}).items():
        print(f"- {k}: {json.dumps(v)[:600]}")

    for k in data:
        if k not in ("cg", "samples", "book"):
            print(f"\n== {k}: {json.dumps(data[k])[:800]}")

    book = data.get("book", [])
    print(f"\n== book: {len(book)} chapters")
    for i, ch in enumerate(book):
        body = ch.get("body", "")
        links = sorted(set(re.findall(r"\((st:[^)\s]*)\)", body)))
        heads = re.findall(r"^#{1,2}\s+(.*)$", body, re.M)
        print(f"- {i:02d} id={ch.get('id')!r} title={ch.get('title')!r} keys={list(ch.keys())} chars={len(body)}")
        print(f"    headings: {heads[:12]}")
        print(f"    st: links ({len(links)}): {links[:40]}")
        if out:
            p = os.path.join(out, "book", f"{i:02d}-{ch.get('id')}.md")
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                f.write(body)


if __name__ == "__main__":
    main()
