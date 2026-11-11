"""Interim packs from the CHB-001 prototype extracts (guide §5.5).

* ``interim-chromogen@1``: Chromogen Studio's 11 stocks (upstream values rounded to 5 decimals,
  JSON null kept as NaN). Supports every missing-data policy; no fitted paper model, no sublayers.
* ``interim-filmbench@1``: Filmbench IDE's embedded bundle, 28 stocks. Filmbench overwrote missing
  rows (``nanRows``) with base 99 D and dye 0, destroying the real values, so those rows are restored
  as NaN in base *and* dyes and the pack supports only the ``opaque`` policy. Also carries the fitted
  curve models, the neutral filter table (under lamp TH-KG3), the ``custom`` dichroics, the
  illuminants, the CIE CMFs and Filmbench's 64 x 64 film exposure tables.

Both are spektrafilm data (CC BY-SA 4.0, Andrea Volpato) and carry the same licence notice.
"""
from __future__ import annotations

import base64
import hashlib
import json
import zlib
from pathlib import Path
from typing import Any

import numpy as np

from .packwriter import WAVELENGTHS_NM, PackWriter, runs_nm

EXTRACTED = "various/extracted"
CG_STOCKS = f"{EXTRACTED}/chromogen-studio/st-data/cg/stocks"
FB_BLOB = f"{EXTRACTED}/filmbench-ide/00-film-data.bin.txt"
ATTRIBUTION = (
    "Derived from spektrafilm by Andrea Volpato, https://github.com/andreavolpato/spektrafilm, CC BY-SA 4.0, "
    "via the {via} prototype bundle (an older, rounded snapshot). Converted by chromobench (tools/spektrafilm-export); see CHANGELOG.txt."
)
TENSOR_MEANING = {
    "wavelengths_nm": {"unit": "nm", "missing": "none"},
    "log10_sensitivity": {"unit": "log10", "axes": ["wavelength", "layer R,G,B"], "missing": "zero-sensitivity"},
    "unit_dye_density_D": {"unit": "D", "axes": ["wavelength", "dye C,M,Y"], "missing": "opaque"},
    "base_density_D": {"unit": "D", "axes": ["wavelength"], "missing": "opaque"},
    "log_exposure_logH": {"unit": "logH", "axes": ["logH"], "missing": "none"},
    "dye_amount_curves": {"unit": "dye", "axes": ["logH", "dye C,M,Y"], "missing": "none"},
    "film_exposure_lut64_log2": {"unit": "log2", "axes": ["filmbench lut u", "filmbench lut v", "layer R,G,B"], "missing": "none",
                                 "note": "Filmbench FB.decodeLuts (01-inline.js 96-106): int16 / 1024; substitute for the hanatos table"},
}
CHANGELOG = """chromobench changes to the data in this interim pack
=====================================================

Source: {source} (decoded by the CHB-001 scripts; file sha256 {sha}).
The data is spektrafilm's (Andrea Volpato, CC BY-SA 4.0; SPEKTRAFILM_LICENSE.txt copied verbatim),
as embedded in an older prototype at reduced precision.

What was changed
----------------
1. Format: JSON arrays -> safetensors float64 + JSON sidecars; arrays renamed with units as in the
   spektrafilm pack (log10_sensitivity, unit_dye_density_D, base_density_D, log_exposure_logH,
   dye_amount_curves).
2. Missing values: {missing}
3. Field mapping: {mapping}

No values were corrected or resampled.
"""


def _f64(rows: Any) -> np.ndarray:
    return np.array([[np.nan if v is None else v for v in r] if isinstance(r, list) else (np.nan if r is None else r) for r in rows], dtype=np.float64)


def _licence(packs_root: Path) -> Path:
    for p in sorted(packs_root.glob("spektrafilm@*/SPEKTRAFILM_LICENSE.txt")):
        return p
    raise SystemExit("export the spektrafilm pack first: the interim packs copy its SPEKTRAFILM_LICENSE.txt")


def _stock(w: PackWriter, sid: str, info: dict, metadata: dict, t: dict[str, np.ndarray], role: str, attribution: str,
           extra_meaning: dict | None = None) -> None:
    if not np.array_equal(t["wavelengths_nm"], WAVELENGTHS_NM):
        raise SystemExit(f"{sid}: not on the 380-780/5 nm grid")
    missing = {"base": runs_nm(np.isnan(t["base_density_D"])), "dyes": runs_nm(np.isnan(t["unit_dye_density_D"]).any(axis=1)),
               "sensitivity": runs_nm(np.isnan(t["log10_sensitivity"]).any(axis=1))}
    meaning = {"info": info, "role": role, "curve_model": None, "hanatos_window": None, "hanatos_surface": None,
               **(extra_meaning or {}),
               "tensors": {k: {**TENSOR_MEANING[k], "shape": list(v.shape)} for k, v in t.items()}}
    jf, tf = f"stocks/{sid}.json", f"stocks/{sid}.safetensors"
    w.json(jf, {"kind": "stock", "id": sid, **meaning, "metadata": metadata, "attribution": attribution, "missingRows_nm": missing})
    w.tensors(tf, t, metadata={"stock": sid, "license": "CC-BY-SA-4.0"})
    w.item("stock", sid, [jf, tf], meaning, t, role=role, type=info.get("type"), missingRows_nm=missing)


def export_chromogen(c1: Path, packs_root: Path, exporter: str) -> dict:
    files = sorted((c1 / CG_STOCKS).glob("*.json"))
    h = hashlib.sha256()
    for f in files:
        h.update(f.name.encode() + b"\0" + f.read_bytes())
    sha = h.hexdigest()
    attribution = ATTRIBUTION.format(via="Chromogen Studio")
    w = PackWriter(root=packs_root, pack_id="interim-chromogen@1",
                   title=f"Interim: Chromogen Studio stocks ({len(files)})",
                   source={"kind": "interim", "from": CG_STOCKS, "sha256": sha, "exporter": exporter,
                           "note": "sha256 over (file name, NUL, bytes) of every stock file in name order"},
                   license={"spdx": "CC-BY-SA-4.0", "file": "SPEKTRAFILM_LICENSE.txt", "changelog": "CHANGELOG.txt", "attribution": attribution})
    w.copy_verbatim("SPEKTRAFILM_LICENSE.txt", _licence(packs_root))
    w.text("CHANGELOG.txt", CHANGELOG.format(
        source=f"Chromogen Studio window.ST_DATA stocks ({CG_STOCKS})", sha=sha,
        missing="JSON null kept as IEEE NaN (Chromogen's own loader read null densities as 0; this pack does not).",
        mapping="info.stock/name/type/densitometer/target_print kept; role = 'print' for status_A negatives (the 3 papers), else 'film'."))
    for f in files:
        j = json.loads(f.read_text())
        d, info = j["data"], dict(j["info"])
        sid = info["stock"]
        t = {"wavelengths_nm": _f64(d["wavelengths"]), "log10_sensitivity": _f64(d["log_sensitivity"]),
             "unit_dye_density_D": _f64(d["channel_density"]), "base_density_D": _f64(d["base_density"]),
             "log_exposure_logH": _f64(d["log_exposure"]), "dye_amount_curves": _f64(d["density_curves"])}
        role = "print" if info.get("densitometer") == "status_A" and info.get("type") == "negative" else "film"
        _stock(w, sid, info, dict(j.get("metadata", {})), t, role, attribution)
    w.extra["counts"] = {"stocks": len(files)}
    return w.finish()


def decode_filmbench(c1: Path) -> tuple[dict, str]:
    raw = (c1 / FB_BLOB).read_bytes()
    return json.loads(zlib.decompress(base64.b64decode(raw.strip()))), hashlib.sha256(raw).hexdigest()


def _lut64(b64: str) -> np.ndarray:
    raw = base64.b64decode(b64)
    try:
        data = zlib.decompress(raw)
    except zlib.error:
        data = zlib.decompress(raw, -15)
    q = np.frombuffer(data, dtype="<i2")
    if q.size != 64 * 64 * 3:
        raise SystemExit(f"filmbench lut has {q.size} values, expected 12288")
    return (q.astype(np.float64) / 1024.0).reshape(64, 64, 3)


def export_filmbench(c1: Path, packs_root: Path, exporter: str) -> dict:
    fb, sha = decode_filmbench(c1)
    attribution = ATTRIBUTION.format(via="Filmbench IDE")
    if not np.array_equal(np.asarray(fb["wl"], dtype=np.float64), WAVELENGTHS_NM):
        raise SystemExit("filmbench wl is not the 380-780/5 grid")
    w = PackWriter(root=packs_root, pack_id="interim-filmbench@1",
                   title=f"Interim: Filmbench IDE bundle ({len(fb['profiles'])} stocks)",
                   source={"kind": "interim", "from": FB_BLOB, "sha256": sha, "exporter": exporter},
                   license={"spdx": "CC-BY-SA-4.0", "file": "SPEKTRAFILM_LICENSE.txt", "changelog": "CHANGELOG.txt", "attribution": attribution},
                   missing={"default": "opaque", "supported": ["opaque"],
                            "note": "Filmbench replaced missing rows by base 99 D and dye 0; only the opaque reading is recoverable"})
    w.copy_verbatim("SPEKTRAFILM_LICENSE.txt", _licence(packs_root))
    w.text("CHANGELOG.txt", CHANGELOG.format(
        source=f"Filmbench IDE embedded film-data blob ({FB_BLOB})", sha=sha,
        missing="rows listed in nanRows (base 99 D, dyes 0 in Filmbench) restored as NaN in base and all three dyes.",
        mapping="logSens->log10_sensitivity, chan->unit_dye_density_D, base->base_density_D, curves->dye_amount_curves, "
                "model{centers,amps,sigmas}->curve_model{centers,amplitudes,sigmas}, lut->film_exposure_lut64_log2 (int16/1024), "
                "neutral_filters[paper][film]->[paper]['TH-KG3'][film], dichroic->custom set, role 'print'/'film' kept."))
    log_exposure = np.linspace(-3, 4, 256)
    for sid in sorted(fb["profiles"]):
        p = fb["profiles"][sid]
        nan = np.zeros(81, dtype=bool)
        nan[np.asarray(p["nanRows"], dtype=int)] = True
        chan = _f64(p["chan"])
        base = _f64(p["base"])
        chan[nan, :] = np.nan
        base[nan] = np.nan
        t = {"wavelengths_nm": WAVELENGTHS_NM.copy(), "log10_sensitivity": _f64(p["logSens"]), "unit_dye_density_D": chan,
             "base_density_D": base, "log_exposure_logH": log_exposure.copy(), "dye_amount_curves": _f64(p["curves"])}
        if p.get("lut"):
            t["film_exposure_lut64_log2"] = _lut64(p["lut"])
        info = {"stock": p["stock"], "name": p["name"], "type": p["type"], "support": p["support"], "use": p["use"],
                "antihalation": p["antihalation"], "reference_illuminant": p["ref"], "viewing_illuminant": p["view"],
                "target_print": p.get("target_print"), "stage": "printing" if p["role"] == "print" else "filming"}
        model = None
        if p.get("model"):
            m = p["model"]
            model = {"model_type": "cdfs", "axes": ["channel", "sublayer"], "centers": m["centers"], "amplitudes": m["amps"], "sigmas": m["sigmas"]}
        _stock(w, sid, info, {"license": "spektrafilm profile by Andrea Volpato, CC BY-SA 4.0 (via Filmbench IDE)"}, t,
               "print" if p["role"] == "print" else "film", attribution, {"curve_model": model})
    neutral = {paper: {"TH-KG3": films} for paper, films in fb["neutral_filters"].items()}
    w.json("enlarger/neutral-print-filters.json", {"axes": ["paper", "lamp", "film"], "values": "[C, M, Y] in Kodak CC units",
                                                    "source": "Filmbench neutral_filters (lamp level restored as TH-KG3)", "table": neutral})
    w.item("neutral-print-filters", "neutral-print-filters", ["enlarger/neutral-print-filters.json"], {"table": neutral}, lamps=["TH-KG3"])
    dich = {"custom_cmy_transmittance_fraction": _f64(fb["dichroic"])}
    w.tensors("enlarger/dichroics.safetensors", dich)
    w.item("dichroics", "custom", ["enlarger/dichroics.safetensors"], {"tensor": "custom_cmy_transmittance_fraction"}, dich,
           tensor="custom_cmy_transmittance_fraction", missingRows_nm=[], default=True)
    lights = {f"{k}_spd_rel_mean1": _f64(v) for k, v in sorted(fb["illuminant"].items())}
    w.tensors("light/illuminants.safetensors", lights)
    for k in sorted(fb["illuminant"]):
        n = f"{k}_spd_rel_mean1"
        w.item("illuminant", k, ["light/illuminants.safetensors"], {"tensor": n, "unit": "relMean1"}, {n: lights[n]}, tensor=n)
    cie = {"cmf_xyz_2deg": _f64(fb["cmf"])}
    w.tensors("cie/cmf-1931-2deg.safetensors", cie)
    w.item("cmf", "cie1931-2deg", ["cie/cmf-1931-2deg.safetensors"], {"tensor": "cmf_xyz_2deg"}, cie, tensor="cmf_xyz_2deg")
    w.extra["counts"] = {"stocks": len(fb["profiles"])}
    return w.finish()


def export_all(c1: Path, packs_root: Path, exporter: str) -> list[dict]:
    return [export_chromogen(c1, packs_root, exporter), export_filmbench(c1, packs_root, exporter)]
