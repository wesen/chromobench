"""spektrafilm-export command line.

    sfx.py export       --upstream PATH   write packages/data/packs/spektrafilm@<ver>+<commit7>/
    sfx.py baselines    --upstream PATH   write fixtures/golden/spektrafilm/*.json
    sfx.py interim                        write interim-chromogen@1 and interim-filmbench@1 from CHB-001
    sfx.py illustrative                   write illustrative@1 (camera, LEDs) from stated parameters
    sfx.py synthetic                      write fixtures/synthetic/neutral-wedge (other sets: TODO, stage 5)
    sfx.py crosscheck   --pack ID         compare a pack against the CHB-001 prototype data (guide §5.3)
    sfx.py verify       [--pack ID ...]   recompute every file hash against the manifests
    sfx.py all          --upstream PATH   everything above, then crosscheck and verify
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import EXPORTER

TOOL_DIR = Path(__file__).resolve().parents[1]
REPO = TOOL_DIR.parents[1]
PACKS = REPO / "packages" / "data" / "packs"
C1 = REPO / "ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite"
GOLDEN = REPO / "fixtures" / "golden" / "spektrafilm"
SYNTHETIC = REPO / "fixtures" / "synthetic"


def _summary(m: dict) -> str:
    return f"{m['packId']}: {len(m['items'])} items, {len(m['files'])} files, packHash {m['_packHash']}"


def cmd_export(a: argparse.Namespace) -> int:
    from . import spektrafilm_pack
    m = spektrafilm_pack.export(Path(a.upstream), Path(a.packs), exporter=EXPORTER, with_upsampling=not a.no_upsampling)
    print(_summary(m))
    return 0


def cmd_baselines(a: argparse.Namespace) -> int:
    from . import baselines, upstream
    checkout = Path(a.upstream).resolve()
    upstream.load(checkout)
    for p in baselines.convert(checkout, Path(a.out), upstream.git_head(checkout)):
        print("wrote", p.relative_to(REPO) if p.is_relative_to(REPO) else p)
    return 0


def cmd_interim(a: argparse.Namespace) -> int:
    from . import interim
    for m in interim.export_all(Path(a.c1), Path(a.packs), exporter=EXPORTER):
        print(_summary(m))
    return 0


def cmd_illustrative(a: argparse.Namespace) -> int:
    from . import illustrative
    print(_summary(illustrative.export(Path(a.packs), exporter=EXPORTER)))
    return 0


def cmd_synthetic(a: argparse.Namespace) -> int:
    from . import synthetic
    for d in synthetic.neutral_wedge(Path(a.synthetic), EXPORTER):
        print("wrote", d.relative_to(REPO) if d.is_relative_to(REPO) else d)
    return 0


def cmd_crosscheck(a: argparse.Namespace) -> int:
    from . import crosscheck
    report = crosscheck.run(Path(a.packs) / a.pack, Path(a.c1))
    print(json.dumps(report["summary"], indent=1, sort_keys=True))
    if a.report:
        Path(a.report).write_text(json.dumps(report, indent=1, sort_keys=True) + "\n")
    return 0 if report["summary"]["ok"] else 1


def cmd_verify(a: argparse.Namespace) -> int:
    from .verify import verify_pack
    root = Path(a.packs)
    ids = a.pack or sorted(p.name for p in root.iterdir() if (p / "manifest.json").is_file())
    bad = 0
    for pid in ids:
        problems = verify_pack(root / pid)
        print(f"{pid}: {'ok' if not problems else '; '.join(problems)}")
        bad += bool(problems)
    return 1 if bad else 0


def cmd_all(a: argparse.Namespace) -> int:
    rc = cmd_export(a) or cmd_baselines(a) or cmd_interim(a) or cmd_illustrative(a) or cmd_synthetic(a)
    if rc:
        return rc
    from . import spektrafilm_pack  # noqa: F401  (pack id is derived inside export)
    pack = next(p.name for p in sorted(Path(a.packs).iterdir()) if p.name.startswith("spektrafilm@"))
    a.pack = pack
    rc = cmd_crosscheck(a)
    a.pack = None
    return rc or cmd_verify(a)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="spektrafilm-export", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--packs", default=str(PACKS), help="packs root (default packages/data/packs)")
    ap.add_argument("--c1", default=str(C1), help="CHB-001 ticket directory (prototype extracts)")
    ap.add_argument("--synthetic", default=str(SYNTHETIC), help="synthetic frames root (default fixtures/synthetic)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export")
    e.add_argument("--upstream", required=True)
    e.add_argument("--no-upsampling", action="store_true", help="skip the 6 MB hanatos table")
    e.set_defaults(fn=cmd_export)
    b = sub.add_parser("baselines")
    b.add_argument("--upstream", required=True)
    b.add_argument("--out", default=str(GOLDEN))
    b.set_defaults(fn=cmd_baselines)
    sub.add_parser("interim").set_defaults(fn=cmd_interim)
    sub.add_parser("illustrative").set_defaults(fn=cmd_illustrative)
    sub.add_parser("synthetic").set_defaults(fn=cmd_synthetic)
    c = sub.add_parser("crosscheck")
    c.add_argument("--pack", required=True)
    c.add_argument("--report", help="write the full report as JSON")
    c.set_defaults(fn=cmd_crosscheck)
    v = sub.add_parser("verify")
    v.add_argument("--pack", action="append")
    v.set_defaults(fn=cmd_verify)
    al = sub.add_parser("all")
    al.add_argument("--upstream", required=True)
    al.add_argument("--out", default=str(GOLDEN))
    al.add_argument("--no-upsampling", action="store_true")
    al.add_argument("--report")
    al.set_defaults(fn=cmd_all)
    a = ap.parse_args(argv)
    return a.fn(a)
