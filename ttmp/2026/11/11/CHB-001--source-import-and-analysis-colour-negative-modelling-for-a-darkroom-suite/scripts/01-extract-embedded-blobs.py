#!/usr/bin/env python3
"""Extract <script> blocks (inline JS and typed data blobs) from a single-file HTML source.

Usage: python3 -I 01-extract-embedded-blobs.py <input.html> <out-dir>

Writes one file per <script> element: NN-<id-or-type>.<ext>, plus an index on stdout.
Data blobs that look like JSON are pretty-printed; base64/compressed blobs are left raw.
"""
import json
import os
import re
import sys


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    html = open(src, encoding="utf-8").read()
    pat = re.compile(r"<script([^>]*)>(.*?)</script>", re.S | re.I)
    for i, m in enumerate(pat.finditer(html)):
        attrs, body = m.group(1), m.group(2)
        sid = re.search(r'id="([^"]+)"', attrs)
        typ = re.search(r'type="([^"]+)"', attrs)
        srcattr = re.search(r'src="([^"]+)"', attrs)
        name = sid.group(1) if sid else (typ.group(1).replace("/", "_") if typ else "inline")
        if srcattr:
            print(f"{i:02d} external {srcattr.group(1)}")
            continue
        ext = "js"
        if typ and "json" in typ.group(1):
            ext = "json"
            try:
                body = json.dumps(json.loads(body), indent=1, ensure_ascii=False)
            except Exception:
                pass
        elif typ and "octet" in typ.group(1):
            ext = "bin.txt"
        elif typ and "plain" in typ.group(1):
            ext = "txt.js"
        path = os.path.join(out, f"{i:02d}-{name}.{ext}")
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
        print(f"{i:02d} {name:30s} {ext:8s} {len(body):>9d} bytes -> {path}")
    # Strip scripts/styles to show the static HTML skeleton size.
    skeleton = pat.sub("", html)
    skeleton = re.sub(r"<style.*?</style>", "", skeleton, flags=re.S | re.I)
    with open(os.path.join(out, "skeleton.html"), "w", encoding="utf-8") as f:
        f.write(skeleton)
    print(f"skeleton {len(skeleton)} bytes")


if __name__ == "__main__":
    main()
