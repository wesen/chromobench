"""Recompute file hashes of a pack against its manifest (on-demand files may be absent)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


def verify_pack(pack_dir: Path) -> list[str]:
    m = json.loads((pack_dir / "manifest.json").read_text())
    problems = []
    for f in m["files"]:
        p = pack_dir / f["path"]
        if not p.is_file():
            if f.get("onDemand"):
                continue
            problems.append(f"missing {f['path']}")
            continue
        b = p.read_bytes()
        if len(b) != f["bytes"] or hashlib.sha256(b).hexdigest() != f["sha256"]:
            problems.append(f"hash mismatch {f['path']}")
    listed = {f["path"] for f in m["files"]} | {"manifest.json"}
    for p in pack_dir.rglob("*"):
        if p.is_file() and p.relative_to(pack_dir).as_posix() not in listed:
            problems.append(f"unlisted file {p.relative_to(pack_dir).as_posix()}")
    lic = m.get("license", {})
    for k in ("spdx", "file", "attribution"):
        if not lic.get(k):
            problems.append(f"license.{k} missing")
    if lic.get("file") and not (pack_dir / lic["file"]).is_file():
        problems.append(f"licence file {lic['file']} missing")
    return problems
