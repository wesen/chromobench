"""Write a chromobench data pack: safetensors for numbers, JSON for meaning, a hashed manifest.

Layout and rules: CHB-004 intern guide §7. Everything written here is deterministic: JSON is
canonical (sorted keys), safetensors orders tensors itself, no timestamps are added, so exporting the
same inputs twice yields byte-identical files and the same pack hash (sha256 of manifest.json).
"""
from __future__ import annotations

import hashlib
import json
import math
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import numpy as np

SCHEMA_VERSION = 1
GRID = {"start_nm": 380, "step_nm": 5, "count": 81}
WAVELENGTHS_NM = np.arange(380, 781, 5, dtype=np.float64)
LOG_EXPOSURE_GRID = {"start_logH": -3, "stop_logH": 4, "count": 256}
# Keys never fed into an item's contentHash: licence text changes must not invalidate GPU tables.
LICENCE_KEYS = frozenset({"metadata", "attribution", "license", "licence"})


_DTYPES = {np.dtype("<f8"): "F64", np.dtype("<f4"): "F32", np.dtype("<f2"): "F16"}


def st_save(tensors: dict[str, np.ndarray], metadata: dict[str, str]) -> bytes:
    """Serialise to the safetensors format (github.com/huggingface/safetensors) deterministically.

    The ``safetensors`` package keeps ``__metadata__`` in a hash map, so its key order (and the file
    bytes) change between processes. Here: tensors in name order, metadata keys sorted, header padded
    with spaces so the data starts 8-byte aligned. ``safetensors.numpy.load`` reads the result (tested).
    """
    header: dict[str, object] = {"__metadata__": {k: str(metadata[k]) for k in sorted(metadata)}}
    blobs = []
    off = 0
    for name in sorted(tensors):
        a = np.ascontiguousarray(tensors[name])
        a = a.astype(a.dtype.newbyteorder("<"), copy=False)
        if a.dtype not in _DTYPES:
            raise TypeError(f"{name}: unsupported dtype {a.dtype}")
        b = a.tobytes()
        header[name] = {"dtype": _DTYPES[a.dtype], "shape": list(a.shape), "data_offsets": [off, off + len(b)]}
        blobs.append(b)
        off += len(b)
    h = json.dumps(header, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    h += b" " * (-(8 + len(h)) % 8)
    return len(h).to_bytes(8, "little") + h + b"".join(blobs)


def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _finite_or_none(v: Any) -> Any:
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if isinstance(v, dict):
        return {k: _finite_or_none(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_finite_or_none(x) for x in v]
    if isinstance(v, np.ndarray):
        return _finite_or_none(v.tolist())
    if isinstance(v, (np.floating,)):
        return _finite_or_none(float(v))
    if isinstance(v, (np.integer,)):
        return int(v)
    return v


def canonical_json(obj: Any, *, indent: int | None = None) -> bytes:
    """Sorted keys, NaN as null, exact float repr; with indent=None also no whitespace."""
    sep = (",", ":") if indent is None else (",", ": ")
    return json.dumps(_finite_or_none(obj), sort_keys=True, separators=sep, indent=indent,
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def tensor_bytes(tensors: dict[str, np.ndarray]) -> bytes:
    return b"".join(np.ascontiguousarray(tensors[k]).astype(tensors[k].dtype.newbyteorder("<"), copy=False).tobytes()
                    for k in sorted(tensors))


def content_hash(meaning: dict[str, Any], tensors: dict[str, np.ndarray] | None = None) -> str:
    """sha256 over canonical JSON of the item's meaning (licence keys dropped) + tensor bytes by name."""
    m = {k: v for k, v in meaning.items() if k not in LICENCE_KEYS}
    h = hashlib.sha256(canonical_json(m))
    if tensors:
        h.update(tensor_bytes(tensors))
    return "sha256:" + h.hexdigest()


def runs_nm(mask: np.ndarray) -> list[int]:
    """Run-length summary of True rows as [first, last, first, last, …] wavelengths in nm."""
    out: list[int] = []
    i = 0
    n = len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j + 1 < n and mask[j + 1]:
                j += 1
            out += [int(WAVELENGTHS_NM[i]), int(WAVELENGTHS_NM[j])]
            i = j + 1
        else:
            i += 1
    return out


@dataclass
class PackWriter:
    root: Path  # packages/data/packs
    pack_id: str
    source: dict[str, Any]
    license: dict[str, Any]
    missing: dict[str, Any] = field(default_factory=lambda: {"default": "opaque", "supported": ["opaque", "zero-density", "extend-flat"]})
    title: str = ""
    items: list[dict[str, Any]] = field(default_factory=list)
    files: dict[str, dict[str, Any]] = field(default_factory=dict)
    known_issues: list[dict[str, Any]] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.dir = self.root / self.pack_id
        if self.dir.exists():
            shutil.rmtree(self.dir)
        self.dir.mkdir(parents=True)

    # -- files -------------------------------------------------------------------------------
    def _record(self, rel: str, data: bytes, *, on_demand: str | None = None) -> None:
        if rel in self.files:
            raise ValueError(f"file written twice: {rel}")
        p = self.dir / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        entry: dict[str, Any] = {"path": rel, "bytes": len(data), "sha256": sha256_hex(data)}
        if on_demand:
            entry["onDemand"] = on_demand
        self.files[rel] = entry

    def tensors(self, rel: str, tensors: dict[str, np.ndarray], *, metadata: dict[str, str] | None = None,
                on_demand: str | None = None) -> None:
        for k, v in tensors.items():
            if not isinstance(v, np.ndarray) or v.dtype.kind != "f":
                raise TypeError(f"{rel}:{k} must be a float ndarray, got {type(v)} {getattr(v, 'dtype', '')}")
        md = {"format": "chromobench-pack", "schemaVersion": str(SCHEMA_VERSION), "packId": self.pack_id}
        md.update(metadata or {})
        data = st_save(tensors, md)
        self._record(rel, data, on_demand=on_demand)

    def json(self, rel: str, obj: Any) -> None:
        self._record(rel, canonical_json(obj, indent=1) + b"\n")

    def text(self, rel: str, s: str) -> None:
        self._record(rel, s.encode("utf-8"))

    def copy_verbatim(self, rel: str, src: Path) -> None:
        self._record(rel, src.read_bytes())

    # -- items -------------------------------------------------------------------------------
    def item(self, kind: str, id: str, files: Iterable[str], meaning: dict[str, Any],
             tensors: dict[str, np.ndarray] | None = None, **extra: Any) -> dict[str, Any]:
        it = {"kind": kind, "id": id, "files": list(files), "contentHash": content_hash({"kind": kind, "id": id, **meaning}, tensors)}
        it.update({k: _finite_or_none(v) for k, v in extra.items()})
        self.items.append(it)
        return it

    def known_issue(self, id: str, items: list[str], text: str) -> None:
        self.known_issues.append({"id": id, "items": sorted(items), "text": text})

    # -- manifest ----------------------------------------------------------------------------
    def finish(self) -> dict[str, Any]:
        for it in self.items:
            for f in it["files"]:
                if f not in self.files:
                    raise ValueError(f"item {it['kind']}:{it['id']} names unwritten file {f}")
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "packId": self.pack_id,
            "title": self.title,
            "source": self.source,
            "grid": GRID,
            "logExposureGrid": LOG_EXPOSURE_GRID,
            "missing": self.missing,
            "license": self.license,
            "items": sorted(self.items, key=lambda i: (i["kind"], i["id"])),
            "files": [self.files[k] for k in sorted(self.files)],
            "knownIssues": sorted(self.known_issues, key=lambda k: k["id"]),
            **self.extra,
        }
        data = canonical_json(manifest, indent=1) + b"\n"
        (self.dir / "manifest.json").write_bytes(data)
        manifest["_packHash"] = "sha256:" + sha256_hex(data)
        return manifest
