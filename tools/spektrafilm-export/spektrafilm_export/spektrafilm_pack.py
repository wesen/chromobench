"""Export the pinned spektrafilm checkout as the pack ``spektrafilm@<profile version>+<commit7>``.

Principle (guide §9.2): ask spektrafilm, do not re-derive. Every array is what upstream's own
function returns at the pinned commit (``load_profile``, ``standard_illuminant``,
``DichroicFilters``, ``read_neutral_print_filters``, ``compute_dir_couplers_matrix`` after
``digest_params``, the parameter dataclass defaults). The exporter only converts formats and hashes.
"""
from __future__ import annotations

import re
from dataclasses import asdict
from pathlib import Path
from typing import Any

import numpy as np

from . import upstream
from .packwriter import WAVELENGTHS_NM, PackWriter, runs_nm

ILLUMINANTS = ("D50", "D55", "D65", "T", "K75P", "TH-KG3", "TH-KG3-L")
DICHROIC_BRANDS = ("custom", "thorlabs", "edmund_optics", "durst_digital_light")
DIGEST_PAPER = "kodak_portra_endura"  # print profile used when digesting params for per-film presets
UPSAMPLING_FILE = "upsampling/hanatos2025-irradiance-xy-tc.safetensors"
ON_DEMAND_HINT = "not committed (5.97 MB); regenerate with: python -I tools/spektrafilm-export/sfx.py export --upstream <spektrafilm checkout>"

ATTRIBUTION = (
    "Derived from spektrafilm by Andrea Volpato, https://github.com/andreavolpato/spektrafilm, "
    "CC BY-SA 4.0. Converted by chromobench (tools/spektrafilm-export); see CHANGELOG.txt."
)

CHANGELOG = """chromobench changes to the spektrafilm data in this pack
==========================================================

Source: https://github.com/andreavolpato/spektrafilm at commit {commit}
(profile metadata version {version}). Licence: CC BY-SA 4.0, see SPEKTRAFILM_LICENSE.txt
(copied verbatim, unchanged). Exported by {exporter}.

What was changed
----------------
1. Format. Each profile's JSON was split into a JSON sidecar (info, metadata, fitted curve model,
   hanatos2025 adaptation parameters) and a safetensors file with the numeric arrays in IEEE
   float64, little-endian. Values are bit-identical to what spektrafilm's load_profile() returns.
2. Missing values. Upstream writes NaN as JSON null; this pack stores them as IEEE NaN. The
   meaning is documented per array in the sidecar ("missing": "opaque" for densities,
   "zero-sensitivity" for log sensitivities), following how spektrafilm uses them.
3. Names. Arrays were renamed to carry their unit (log_sensitivity -> log10_sensitivity,
   channel_density -> unit_dye_density_D, base_density -> base_density_D,
   midscale_neutral_density -> midscale_neutral_density_D, log_exposure -> log_exposure_logH,
   density_curves -> dye_amount_curves, density_curves_layers -> sublayer_dye_amount_curves).
   A wavelengths_nm array was added to each stock file.
4. Computed light and filter data. Illuminants (mean-1 normalised), dichroic filter sets, the
   Schott KG heat filters, the Canon lens transmission and the CIE 1931 2-degree CMFs are the
   arrays spektrafilm's own functions return on the 380-780 nm / 5 nm grid (filters resampled by
   upstream's Akima interpolation; colour-science provides the CIE tables).
5. Parameters. DIR-coupler, halation and grain parameters live in spektrafilm's code, not in its
   data; they were extracted by calling upstream's parameter builder and written as JSON presets.
6. Neutral print filter table: copied unchanged (re-serialised as canonical JSON).
7. Spectral upsampling table (hanatos2025 irradiance_xy_tc): stored as float16, as shipped.

No values were corrected, smoothed or resampled by chromobench.
"""


def _a(x: Any) -> np.ndarray:
    return np.asarray(x, dtype=np.float64)


def _same(a: np.ndarray, b: np.ndarray) -> bool:
    return a.shape == b.shape and bool(np.array_equal(a, b, equal_nan=True))


def stock_tensors(p: Any) -> dict[str, np.ndarray]:
    d = p.data
    if not _same(_a(d.wavelengths), WAVELENGTHS_NM):
        raise SystemExit(f"{p.info.stock}: not on the 380-780/5 nm grid")
    t = {
        "wavelengths_nm": _a(d.wavelengths),
        "log10_sensitivity": _a(d.log_sensitivity),
        "unit_dye_density_D": _a(d.channel_density),
        "base_density_D": _a(d.base_density),
        "midscale_neutral_density_D": _a(d.midscale_neutral_density),
        "log_exposure_logH": _a(d.log_exposure),
        "dye_amount_curves": _a(d.density_curves),
    }
    if np.size(d.density_curves_layers):
        t["sublayer_dye_amount_curves"] = _a(d.density_curves_layers)
    return t


TENSOR_MEANING = {
    "wavelengths_nm": {"unit": "nm", "missing": "none"},
    "log10_sensitivity": {"unit": "log10", "axes": ["wavelength", "layer R,G,B"], "missing": "zero-sensitivity"},
    "unit_dye_density_D": {"unit": "D", "axes": ["wavelength", "dye C,M,Y"], "missing": "opaque"},
    "base_density_D": {"unit": "D", "axes": ["wavelength"], "missing": "opaque"},
    "midscale_neutral_density_D": {"unit": "D", "axes": ["wavelength"], "missing": "opaque"},
    "log_exposure_logH": {"unit": "logH", "axes": ["logH"], "missing": "none"},
    "dye_amount_curves": {"unit": "dye", "axes": ["logH", "dye C,M,Y"], "missing": "none",
                          "note": "as stored upstream; curve minimum NOT subtracted (the film develop op owns that)"},
    "sublayer_dye_amount_curves": {"unit": "dye", "axes": ["logH", "sublayer", "dye C,M,Y"], "missing": "none"},
}


def stock_scalars(p: Any) -> dict[str, Any]:
    d = p.data
    m = d.density_curves_model
    model = None
    if np.size(m.centers):
        model = {"model_type": m.model_type, "axes": ["channel", "sublayer"],
                 "centers": _a(m.centers), "amplitudes": _a(m.amplitudes), "sigmas": _a(m.sigmas)}
    w = _a(d.hanatos2025_adaptation_window_params)
    window = None
    if w.size:
        if w.size != 4:
            raise SystemExit(f"{p.info.stock}: hanatos window has {w.size} parameters, expected 4 (erf4)")
        window = {"model": "erf4", "c_uv_nm": float(w[0]), "sigma_uv_nm": float(w[1]), "c_ir_nm": float(w[2]), "sigma_ir_nm": float(w[3])}
    s = _a(d.hanatos2025_adaptation_surface_params)
    surface = {"model": "poly4", "params": s} if s.size else None
    return {"curve_model": model, "hanatos_window": window, "hanatos_surface": surface}


def role_of(info: Any) -> str:
    return "print" if info.stage == "printing" else "film"


def shared_array_groups(profiles: dict[str, Any]) -> list[dict[str, Any]]:
    """Groups of profiles whose named array is identical (NaN-equal). Upstream facts, reported not fixed."""
    fields = ("log_sensitivity", "channel_density", "base_density", "midscale_neutral_density", "density_curves")
    out = []
    for f in fields:
        seen: list[tuple[np.ndarray, list[str]]] = []
        for sid in sorted(profiles):
            a = _a(getattr(profiles[sid].data, f))
            for arr, ids in seen:
                if _same(arr, a):
                    ids.append(sid)
                    break
            else:
                seen.append((a, [sid]))
        for _, ids in seen:
            if len(ids) > 1:
                out.append({"field": f, "items": ids})
    return out


def upstream_comments(stocks_py: Path) -> dict[str, str]:
    """Inline comments on stock enum members in model/stocks.py (e.g. '# problematic')."""
    out = {}
    for line in stocks_py.read_text().splitlines():
        m = re.match(r"\s*(\w+)\s*=\s*'(\w+)'\s*#\s*(.+)$", line)
        if m:
            out[m.group(2)] = m.group(3).strip()
    return out


def dir_presets(params_builder: Any, couplers: Any, schema: Any, films: list[str]) -> dict[str, Any]:
    def entry(dc: Any) -> dict[str, Any]:
        d = asdict(dc)
        d["matrix"] = couplers.compute_dir_couplers_matrix(dc)
        d["matrix_axes"] = ["donor layer R,G,B", "receiver layer R,G,B"]
        return d

    applied = {}
    for fid in films:
        params = params_builder.digest_params(params_builder.init_params(fid, DIGEST_PAPER))
        e = entry(params.film_render.dir_couplers)
        e["source"] = ("stock-override" if fid in ("fujifilm_velvia_100", "fujifilm_provia_100f")
                       else ("positive" if params.film.is_positive else "negative"))
        applied[fid] = e
    return {
        "schemaDefault": entry(schema.DirCouplersParams()),
        "applied": applied,
        "notes": ("'applied' is what spektrafilm's digest_params(init_params(film, "
                  f"'{DIGEST_PAPER}')) sets for the film (runtime/params_builder.py _apply_film_specifics); "
                  "'schemaDefault' is DirCouplersParams() (runtime/params_schema.py). matrix = "
                  "model/couplers.py compute_dir_couplers_matrix, donor rows, receiver columns; 'amount' is applied by the "
                  "filming stage, not folded into the matrix. Lengths in um."),
    }


def halation_presets(params_builder: Any, schema: Any, films: list[str]) -> dict[str, Any]:
    presets = [
        {"use": use, "antihalation": ah, "halation_first_sigma_um": list(v["sigma_h"]), "halation_strength": list(v["strength"])}
        for (use, ah), v in sorted(params_builder._HALATION_PRESETS.items())
    ]
    applied = {}
    for fid in films:
        params = params_builder.digest_params(params_builder.init_params(fid, DIGEST_PAPER))
        h = params.film_render.halation
        applied[fid] = {"use": params.film.info.use, "antihalation": params.film.info.antihalation,
                        "halation_first_sigma_um": list(h.halation_first_sigma_um), "halation_strength": list(h.halation_strength)}
    return {
        "presets": presets,
        "defaults": asdict(schema.HalationParams()),
        "applied": applied,
        "notes": "presets: runtime/params_builder.py _HALATION_PRESETS keyed by (use, antihalation); defaults: "
                 "HalationParams() in runtime/params_schema.py (scatter_* is in-emulsion scatter). Lengths in um.",
    }


def export(checkout: Path, packs_root: Path, *, exporter: str, with_upsampling: bool = True) -> dict[str, Any]:
    src = upstream.load(checkout)
    commit = upstream.git_head(checkout)
    io = upstream.module("spektrafilm.profiles.io")
    ill = upstream.module("spektrafilm.model.illuminants")
    cf = upstream.module("spektrafilm.model.color_filters")
    uio = upstream.module("spektrafilm.utils.io")
    cfg = upstream.module("spektrafilm.config")
    pb = upstream.module("spektrafilm.runtime.params_builder")
    schema = upstream.module("spektrafilm.runtime.params_schema")
    couplers = upstream.module("spektrafilm.model.couplers")

    ids = io.list_profiles()
    profiles = {sid: io.load_profile(sid) for sid in ids}
    versions = {p.metadata.version for p in profiles.values()}
    if len(versions) != 1:
        raise SystemExit(f"profiles disagree on metadata.version: {sorted(versions)}")
    version = versions.pop()
    pack_id = f"spektrafilm@{version}+{commit[:7]}"
    licence_file = src / "spektrafilm" / "data" / "license" / "SPEKTRAFILM_LICENSE.txt"

    w = PackWriter(
        root=packs_root, pack_id=pack_id,
        title=f"spektrafilm profiles, enlarger, light and parameter data ({len(ids)} stocks)",
        source={"kind": "upstream", "repo": upstream.UPSTREAM_REPO, "commit": commit, "profileVersion": version, "exporter": exporter},
        license={"spdx": "CC-BY-SA-4.0", "file": "SPEKTRAFILM_LICENSE.txt", "changelog": "CHANGELOG.txt", "attribution": ATTRIBUTION},
    )
    w.copy_verbatim("SPEKTRAFILM_LICENSE.txt", licence_file)
    w.text("CHANGELOG.txt", CHANGELOG.format(commit=commit, version=version, exporter=exporter))

    # -- stocks ------------------------------------------------------------------------------
    films = [sid for sid in ids if profiles[sid].info.stage == "filming"]
    for sid in ids:
        p = profiles[sid]
        if p.info.stock != sid:
            raise SystemExit(f"profile file {sid} says stock={p.info.stock}")
        t = stock_tensors(p)
        base_nan = np.isnan(t["base_density_D"])
        dye_nan = np.isnan(t["unit_dye_density_D"]).any(axis=1)
        sens_nan = np.isnan(t["log10_sensitivity"]).any(axis=1)
        missing = {"base": runs_nm(base_nan), "dyes": runs_nm(dye_nan), "sensitivity": runs_nm(sens_nan)}
        meaning = {
            "info": asdict(p.info), "role": role_of(p.info), **stock_scalars(p),
            "tensors": {k: {**TENSOR_MEANING[k], "shape": list(v.shape)} for k, v in t.items()},
        }
        sidecar = {"kind": "stock", "id": sid, **meaning, "metadata": asdict(p.metadata), "attribution": ATTRIBUTION,
                   "missingRows_nm": missing}
        jf, tf = f"stocks/{sid}.json", f"stocks/{sid}.safetensors"
        w.json(jf, sidecar)
        w.tensors(tf, t, metadata={"stock": sid, "license": "CC-BY-SA-4.0", "attribution": ATTRIBUTION})
        w.item("stock", sid, [jf, tf], meaning, t, role=role_of(p.info), type=p.info.type, missingRows_nm=missing)

    # -- enlarger ----------------------------------------------------------------------------
    neutral = uio.read_neutral_print_filters()
    w.json("enlarger/neutral-print-filters.json", {
        "axes": ["paper", "lamp", "film"], "values": "[C, M, Y] in Kodak CC units",
        "source": "spektrafilm data/filters/neutral_print_filters.json (unchanged)", "table": neutral})
    w.item("neutral-print-filters", "neutral-print-filters", ["enlarger/neutral-print-filters.json"], {"table": neutral},
           lamps=sorted({lamp for paper in neutral.values() for lamp in paper}))
    dich = {f"{b}_cmy_transmittance_fraction": _a(cf.DichroicFilters(brand=b).filters) for b in DICHROIC_BRANDS}
    w.tensors("enlarger/dichroics.safetensors", dich, metadata={"license": "see manifest"})
    for b in DICHROIC_BRANDS:
        k = f"{b}_cmy_transmittance_fraction"
        w.item("dichroics", b, ["enlarger/dichroics.safetensors"], {"tensor": k, "unit": "fraction", "axes": ["wavelength", "filter C,M,Y"]},
               {k: dich[k]}, tensor=k, missingRows_nm=runs_nm(np.isnan(dich[k]).any(axis=1)),
               default=(b == "custom"))

    # -- light -------------------------------------------------------------------------------
    lights = {f"{i}_spd_rel_mean1": _a(ill.standard_illuminant(i)) for i in ILLUMINANTS}
    w.tensors("light/illuminants.safetensors", lights)
    for i in ILLUMINANTS:
        k = f"{i}_spd_rel_mean1"
        w.item("illuminant", i, ["light/illuminants.safetensors"], {"tensor": k, "unit": "relMean1"}, {k: lights[k]}, tensor=k)
    filt = {
        "schott_kg1_transmittance_fraction": _a(cf.schott_kg1_heat_filter.transmittance),
        "schott_kg3_transmittance_fraction": _a(cf.schott_kg3_heat_filter.transmittance),
        "schott_kg5_transmittance_fraction": _a(cf.schott_kg5_heat_filter.transmittance),
        "canon_24_f28_is_transmittance_fraction": _a(cf.generic_lens_transmission.transmittance),
    }
    w.tensors("light/filters.safetensors", filt)
    for k, v in filt.items():
        w.item("filter", k.removesuffix("_transmittance_fraction"), ["light/filters.safetensors"], {"tensor": k, "unit": "fraction"}, {k: v}, tensor=k)

    # -- observer ----------------------------------------------------------------------------
    cie = {"cmf_xyz_2deg": _a(cfg.STANDARD_OBSERVER_CMFS[:]), "lms_stockman_sharpe_2deg": _a(cfg.STANDARD_OBSERVER_LMS[:])}
    w.tensors("cie/cmf-1931-2deg.safetensors", cie, metadata={"source": "CIE 1931 2 degree observer and Stockman & Sharpe 2 degree cone fundamentals via colour-science"})
    w.item("cmf", "cie1931-2deg", ["cie/cmf-1931-2deg.safetensors"], {"tensor": "cmf_xyz_2deg"}, {"cmf_xyz_2deg": cie["cmf_xyz_2deg"]}, tensor="cmf_xyz_2deg")
    w.item("cmf", "stockman-sharpe-2deg-lms", ["cie/cmf-1931-2deg.safetensors"], {"tensor": "lms_stockman_sharpe_2deg"},
           {"lms_stockman_sharpe_2deg": cie["lms_stockman_sharpe_2deg"]}, tensor="lms_stockman_sharpe_2deg")

    # -- parameter presets (code, not data) -------------------------------------------------
    dirp = dir_presets(pb, couplers, schema, films)
    w.json("presets/dir-couplers.json", dirp)
    w.item("preset", "dir-couplers", ["presets/dir-couplers.json"], dirp)
    hal = halation_presets(pb, schema, films)
    w.json("presets/halation.json", hal)
    w.item("preset", "halation", ["presets/halation.json"], hal)
    grain = {"defaults": asdict(schema.GrainParams()), "notes": "GrainParams() in runtime/params_schema.py; used by CHB-012"}
    w.json("presets/grain.json", grain)
    w.item("preset", "grain", ["presets/grain.json"], grain)

    # -- spectral upsampling table (on demand) ----------------------------------------------
    lut_path = src / "spektrafilm" / "data" / "luts" / "spectral_upsampling" / "irradiance_xy_tc.npy"
    with lut_path.open("rb") as fh:
        lut = np.load(fh, allow_pickle=False)
    if lut.dtype != np.float16 or lut.ndim != 3 or lut.shape[2] != 81:
        raise SystemExit(f"unexpected hanatos table {lut.dtype} {lut.shape}")
    up = {"irradiance_xy_tc_f16": lut}
    if with_upsampling:
        w.tensors(UPSAMPLING_FILE, up, metadata={"source": "spektrafilm data/luts/spectral_upsampling/irradiance_xy_tc.npy",
                                                 "axes": "tc_x, tc_y (triangular xy coordinates), wavelength"},
                  on_demand=ON_DEMAND_HINT)
        w.item("upsampling", "hanatos2025-irradiance-xy-tc", [UPSAMPLING_FILE], {"tensor": "irradiance_xy_tc_f16", "shape": list(lut.shape)}, up,
               tensor="irradiance_xy_tc_f16", shape=list(lut.shape), licence_note="provided to spektrafilm by Johannes Hanika (hanatos); licence unclear (guide §12.1)")

    # -- known issues ------------------------------------------------------------------------
    for g in shared_array_groups(profiles):
        w.known_issue(f"shared-{g['field']}-{'-'.join(g['items'])}", g["items"],
                      f"{g['field']} is identical across {', '.join(g['items'])} (upstream data, reproduced not repaired)")
    for sid, comment in sorted(upstream_comments(src / "spektrafilm" / "model" / "stocks.py").items()):
        w.known_issue(f"upstream-comment-{sid}", [sid], f"upstream model/stocks.py comment: '{comment}'")
    for sid, p in profiles.items():
        if not np.size(p.data.density_curves_model.centers) and role_of(p.info) == "print":
            w.known_issue(f"no-curve-model-{sid}", [sid], "print material without a fitted curve model")

    w.extra["counts"] = {"stocks": len(ids), "films": len(films), "prints": len(ids) - len(films)}
    return w.finish()
