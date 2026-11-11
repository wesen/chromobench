"""Cross-check a spektrafilm pack against the CHB-001 prototype data (guide §5.3, §9.4).

Tolerances are written down before the run, from the precision each prototype stored:
Chromogen 5 decimals (5e-6), Filmbench 4 decimals for sensitivities and curves (5e-5) and 5 for
spectra; the fitted curve models and the dichroic formula agree to float32-ish precision (1e-6); the
neutral filter table must be identical. The check also recomputes the grey-card numbers of guide
§6.1 under the opaque and zero-density readings and the 128-pair neutral balance law.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
from safetensors.numpy import load_file

from . import illustrative
from .interim import CG_STOCKS, decode_filmbench

TOL = {
    "chromogen": 5e-6 + 1e-12,
    "filmbench_rounded4": 5e-5 + 1e-12,
    "filmbench_spectra": 5e-6 + 1e-12,
    "filmbench_model": 1e-6,
    "filmbench_dichroic": 1e-6,
    "filmbench_illuminant": 1e-5,
    "filmbench_cmf": 5e-6 + 1e-12,
    "illustrative": 6e-6,
}
GREY_OPAQUE = (0.004, 0.005, -0.009)
GREY_ZERO = (0.111, -0.072, -0.038)


class Pack:
    def __init__(self, d: Path):
        self.dir = d
        self.manifest = json.loads((d / "manifest.json").read_text())
        self._t: dict[str, dict[str, np.ndarray]] = {}

    def tensors(self, rel: str) -> dict[str, np.ndarray]:
        if rel not in self._t:
            self._t[rel] = load_file(str(self.dir / rel))
        return self._t[rel]

    def stock(self, sid: str) -> dict[str, np.ndarray]:
        return self.tensors(f"stocks/{sid}.safetensors")

    def sidecar(self, sid: str) -> dict[str, Any]:
        return json.loads((self.dir / f"stocks/{sid}.json").read_text())

    def stock_ids(self) -> list[str]:
        return [i["id"] for i in self.manifest["items"] if i["kind"] == "stock"]

    def json(self, rel: str) -> Any:
        return json.loads((self.dir / rel).read_text())


def _maxdiff(a: Any, b: Any) -> float:
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    if a.shape != b.shape:
        return float("inf")
    m = ~(np.isnan(a) | np.isnan(b))
    return float(np.max(np.abs(a[m] - b[m]))) if m.any() else 0.0


def _nan_equal(a: Any, b: Any) -> bool:
    return bool(np.array_equal(np.isnan(np.asarray(a, dtype=np.float64)), np.isnan(np.asarray(b, dtype=np.float64))))


def _null(x: Any) -> np.ndarray:
    return np.array([[np.nan if v is None else v for v in r] if isinstance(r, list) else (np.nan if r is None else r) for r in x], dtype=np.float64)


# -- grey card and the neutral balance law (guide §6.1, §15) ------------------------------------

def enlarger_filter(dichroic_cmy: np.ndarray, cc: tuple[float, float, float]) -> np.ndarray:
    v = 10 ** (-np.asarray(cc, dtype=np.float64) / 100.0)
    return np.prod(1 - (1 - dichroic_cmy) * (1 - v[None, :]), axis=1)


def normalised_paper_logH(film: dict[str, np.ndarray], paper: dict[str, np.ndarray], lamp: np.ndarray, filt: np.ndarray,
                          policy: str) -> np.ndarray:
    le = film["log_exposure_logH"]
    curves = film["dye_amount_curves"]
    c = np.array([np.interp(0.0, le, curves[:, k]) for k in range(3)])
    eps = film["unit_dye_density_D"]
    base = film["base_density_D"]
    D = eps @ c + base
    if policy == "opaque":
        T = np.where(np.isnan(D), 0.0, 10 ** (-np.nan_to_num(D)))
    elif policy == "zero-density":
        D = np.nan_to_num(eps) @ c + np.nan_to_num(base)
        T = 10 ** (-D)
    else:
        raise ValueError(policy)
    s = np.nan_to_num(10 ** paper["log10_sensitivity"])
    x = np.log10((lamp * filt * T) @ s)
    return x - x.mean()


def grey_card(p: Pack, policy: str) -> np.ndarray:
    lamp = p.tensors("light/illuminants.safetensors")["TH-KG3_spd_rel_mean1"]
    dich = p.tensors("enlarger/dichroics.safetensors")["custom_cmy_transmittance_fraction"]
    cc = p.json("enlarger/neutral-print-filters.json")["table"]["kodak_portra_endura"]["TH-KG3"]["kodak_portra_400"]
    return normalised_paper_logH(p.stock("kodak_portra_400"), p.stock("kodak_portra_endura"), lamp, enlarger_filter(dich, cc), policy)


def balance_law(p: Pack, policy: str) -> dict[str, Any]:
    lamp = p.tensors("light/illuminants.safetensors")["TH-KG3_spd_rel_mean1"]
    dich = p.tensors("enlarger/dichroics.safetensors")["custom_cmy_transmittance_fraction"]
    table = p.json("enlarger/neutral-print-filters.json")["table"]
    roles = {i["id"]: (i["role"], i.get("type")) for i in p.manifest["items"] if i["kind"] == "stock"}
    spreads = {}
    for paper, lamps in table.items():
        for film, cc in lamps.get("TH-KG3", {}).items():
            if roles.get(film) != ("film", "negative") or paper not in roles:
                continue
            x = normalised_paper_logH(p.stock(film), p.stock(paper), lamp, enlarger_filter(dich, cc), policy)
            spreads[f"{paper}/{film}"] = float(x.max() - x.min())
    v = np.array(list(spreads.values()))
    worst = max(spreads, key=spreads.get)
    return {"pairs": len(v), "median": float(np.median(v)), "max": float(v.max()), "worst": worst}


# -- comparisons --------------------------------------------------------------------------------

def against_chromogen(p: Pack, c1: Path) -> dict[str, Any]:
    out: dict[str, Any] = {}
    ok = True
    pairs = {"log_sensitivity": "log10_sensitivity", "channel_density": "unit_dye_density_D", "base_density": "base_density_D",
             "density_curves": "dye_amount_curves", "log_exposure": "log_exposure_logH"}
    for f in sorted((c1 / CG_STOCKS).glob("*.json")):
        j = json.loads(f.read_text())
        sid = j["info"]["stock"]
        t = p.stock(sid)
        r = {}
        for cg, pk in pairs.items():
            a = _null(j["data"][cg])
            r[pk] = {"maxdiff": _maxdiff(a, t[pk]), "nanPatternEqual": _nan_equal(a, t[pk])}
            ok &= r[pk]["maxdiff"] <= TOL["chromogen"] and r[pk]["nanPatternEqual"]
        out[sid] = r
    return {"ok": ok, "tolerance": TOL["chromogen"], "stocks": out}


def against_filmbench(p: Pack, c1: Path) -> dict[str, Any]:
    fb, _ = decode_filmbench(c1)
    ok = True
    stocks = {}
    for sid, q in sorted(fb["profiles"].items()):
        t = p.stock(sid)
        nan = np.zeros(81, dtype=bool)
        nan[np.asarray(q["nanRows"], dtype=int)] = True
        union = np.isnan(t["base_density_D"]) | np.isnan(t["unit_dye_density_D"]).any(axis=1)
        chan = np.asarray(q["chan"], dtype=np.float64)
        base = np.asarray(q["base"], dtype=np.float64)
        r = {
            "logSens": _maxdiff(q["logSens"], t["log10_sensitivity"]),
            "curves": _maxdiff(q["curves"], t["dye_amount_curves"]),
            "chan_outside_nanRows": _maxdiff(chan[~nan], t["unit_dye_density_D"][~nan]),
            "base_outside_nanRows": _maxdiff(base[~nan], t["base_density_D"][~nan]),
            "nanRows_equal_union": bool(np.array_equal(nan, union)),
            "base_on_nanRows": sorted(set(base[nan].tolist())),
        }
        sc = p.sidecar(sid)
        if q.get("model") and sc.get("curve_model"):
            m = sc["curve_model"]
            r["model"] = max(_maxdiff(q["model"]["centers"], m["centers"]), _maxdiff(q["model"]["amps"], m["amplitudes"]),
                             _maxdiff(q["model"]["sigmas"], m["sigmas"]))
        else:
            r["model"] = None if not q.get("model") and not sc.get("curve_model") else float("inf")
        good = (r["logSens"] <= TOL["filmbench_rounded4"] and r["curves"] <= TOL["filmbench_rounded4"]
                and r["chan_outside_nanRows"] <= TOL["filmbench_spectra"] and r["base_outside_nanRows"] <= TOL["filmbench_spectra"]
                and r["nanRows_equal_union"] and (r["model"] is None or r["model"] <= TOL["filmbench_model"]))
        r["ok"] = bool(good)
        ok &= good
        stocks[sid] = r
    table = p.json("enlarger/neutral-print-filters.json")["table"]
    flat = {paper: films.get("TH-KG3", {}) for paper, films in table.items()}
    neutral_equal = flat == fb["neutral_filters"]
    dich = _maxdiff(fb["dichroic"], p.tensors("enlarger/dichroics.safetensors")["custom_cmy_transmittance_fraction"])
    lights = p.tensors("light/illuminants.safetensors")
    ill = {k: _maxdiff(v, lights[f"{k}_spd_rel_mean1"]) for k, v in fb["illuminant"].items()}
    cmf = _maxdiff(fb["cmf"], p.tensors("cie/cmf-1931-2deg.safetensors")["cmf_xyz_2deg"])
    ok &= neutral_equal and dich <= TOL["filmbench_dichroic"] and cmf <= TOL["filmbench_cmf"] and all(v <= TOL["filmbench_illuminant"] for v in ill.values())
    return {"ok": bool(ok), "tolerances": {k: v for k, v in TOL.items() if k.startswith("filmbench")}, "stocks": stocks,
            "neutralTableIdentical": neutral_equal, "dichroicCustom": dich, "illuminants": ill, "cmf": cmf}


def against_illustrative(c1: Path) -> dict[str, Any]:
    cg = c1 / "various/extracted/chromogen-studio/st-data/cg"
    cam = json.loads((cg / "cameras/generic-bayer.json").read_text())
    led = json.loads((cg / "lights/white-led.json").read_text())
    ours = illustrative.camera_generic_bayer()
    d_cam = max(_maxdiff(cam[k], ours[:, i]) for i, k in enumerate("RGB"))
    d_led = _maxdiff(led["values"], illustrative.white_led())
    return {"ok": d_cam <= TOL["illustrative"] and d_led <= TOL["illustrative"], "camera": d_cam, "whiteLed": d_led, "tolerance": TOL["illustrative"]}


def run(pack_dir: Path, c1: Path) -> dict[str, Any]:
    p = Pack(pack_dir)
    cg = against_chromogen(p, c1)
    fb = against_filmbench(p, c1)
    il = against_illustrative(c1)
    g_op = grey_card(p, "opaque")
    g_zero = grey_card(p, "zero-density")
    grey_ok = bool(np.all(np.abs(g_op - GREY_OPAQUE) <= 1e-3) and np.all(np.abs(g_zero - GREY_ZERO) <= 2e-3))
    bal_op = balance_law(p, "opaque")
    bal_zero = balance_law(p, "zero-density")
    fb_pack = pack_dir.parent / "interim-filmbench@1"
    bal_fb_zero = balance_law(Pack(fb_pack), "zero-density") if (fb_pack / "manifest.json").is_file() else None
    law_ok = bal_op["pairs"] == 128 and bal_op["median"] <= 0.06 and bal_zero["median"] > 0.06
    shared = [k for k in p.manifest["knownIssues"]]
    summary = {
        "pack": p.manifest["packId"],
        "chromogen": {"ok": cg["ok"], "stocks": len(cg["stocks"]),
                      "maxdiff": max(v["maxdiff"] for s in cg["stocks"].values() for v in s.values())},
        "filmbench": {"ok": fb["ok"], "stocks": len(fb["stocks"]),
                      "maxdiff": {k: max((s[k] for s in fb["stocks"].values() if s[k] is not None), default=0.0)
                                  for k in ("logSens", "curves", "chan_outside_nanRows", "base_outside_nanRows", "model")},
                      "nanRowsEqualUnion": all(s["nanRows_equal_union"] for s in fb["stocks"].values()),
                      "neutralTableIdentical": fb["neutralTableIdentical"], "dichroicCustom": fb["dichroicCustom"],
                      "illuminants": fb["illuminants"], "cmf": fb["cmf"]},
        "illustrative": il,
        "greyCard": {"ok": grey_ok, "opaque": g_op.round(4).tolist(), "zeroDensity": g_zero.round(4).tolist()},
        "balanceLaw": {"ok": law_ok, "opaque": bal_op, "zeroDensity": bal_zero,
                       "zeroDensityOnFilmbenchData": bal_fb_zero,
                       "note": "Filmbench zeroed the dye rows it marked missing, so its zero-density reading differs from upstream's"},
        "knownIssues": [k["id"] for k in shared],
    }
    summary["ok"] = bool(cg["ok"] and fb["ok"] and il["ok"] and grey_ok and law_ok)
    return {"summary": summary, "chromogen": cg, "filmbench": fb}
