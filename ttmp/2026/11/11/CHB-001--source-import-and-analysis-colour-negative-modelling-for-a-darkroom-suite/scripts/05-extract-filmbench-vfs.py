#!/usr/bin/env python3
"""Extract the built-in virtual file system of Filmbench IDE.

The IDE's JS ends with one long line `IDE.vfs.define({...});` holding the
default scripts (main.js, controls.js, examples/*.js, docs/reference.md, ...).
This script reads that line as data (it never executes it), parses the object
literal as JSON and writes each file out so it can be read with line numbers.

Usage: python3 -I 05-extract-filmbench-vfs.py <01-inline.js> <out-dir>
"""
import json
import os
import sys


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    prefix = "IDE.vfs.define("
    with open(src, encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            if line.startswith(prefix):
                body = line[len(prefix):].rstrip().rstrip(";").rstrip(")")
                files = json.loads(body)
                break
        else:
            sys.exit("no IDE.vfs.define(...) line found")
    print(f"vfs line {lineno}: {len(files)} files")
    for name, text in files.items():
        # keep paths inside out-dir
        safe = os.path.normpath(name).lstrip("./")
        if safe.startswith(".."):
            sys.exit(f"refusing path {name!r}")
        path = os.path.join(out, safe)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as g:
            g.write(text)
        print(f"{text.count(chr(10)) + 1:5d} lines  {len(text):7d} bytes  {name}")


if __name__ == "__main__":
    main()
