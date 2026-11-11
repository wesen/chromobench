"""Stage 1 acceptance (guide §14): every upstream array round-trips bit-exactly (NaN positions
included), re-running the export yields identical hashes, and the committed pack is what the
pinned commit exports."""
import json

import numpy as np
import pytest
from safetensors.numpy import load_file

from spektrafilm_export import EXPORTER, baselines, crosscheck, spektrafilm_pack, upstream

PACK_ID = "spektrafilm@0.3.2+3bb2c2d"
FIELDS = {
    "log10_sensitivity": "log_sensitivity", "unit_dye_density_D": "channel_density", "base_density_D": "base_density",
    "midscale_neutral_density_D": "midscale_neutral_density", "log_exposure_logH": "log_exposure",
    "dye_amount_curves": "density_curves", "sublayer_dye_amount_curves": "density_curves_layers", "wavelengths_nm": "wavelengths",
}


def bit_equal(a, b) -> bool:
    a = np.ascontiguousarray(a, dtype=np.float64)
    b = np.ascontiguousarray(b, dtype=np.float64)
    return a.shape == b.shape and a.tobytes() == b.tobytes()


@pytest.fixture(scope="module")
def exported(checkout, tmp_path_factory):
    root = tmp_path_factory.mktemp("packs")
    m1 = spektrafilm_pack.export(checkout, root / "a", exporter=EXPORTER)
    m2 = spektrafilm_pack.export(checkout, root / "b", exporter=EXPORTER)
    return root, m1, m2


def test_determinism(exported, repo):
    root, m1, m2 = exported
    assert m1["packId"] == PACK_ID
    assert m1["_packHash"] == m2["_packHash"]
    a = (root / "a" / PACK_ID / "manifest.json").read_bytes()
    committed = (repo / "packages/data/packs" / PACK_ID / "manifest.json").read_bytes()
    assert a == committed, "committed pack differs from a fresh export of the pinned commit"


def test_round_trip_bit_exact(exported, checkout):
    root, m1, _ = exported
    io = upstream.module("spektrafilm.profiles.io")
    ids = io.list_profiles()
    assert len(ids) == 28
    for sid in ids:
        p = io.load_profile(sid)
        t = load_file(str(root / "a" / PACK_ID / "stocks" / f"{sid}.safetensors"))
        for ours, theirs in FIELDS.items():
            assert bit_equal(t[ours], getattr(p.data, theirs)), f"{sid}:{ours}"
        side = json.loads((root / "a" / PACK_ID / "stocks" / f"{sid}.json").read_text())
        m = p.data.density_curves_model
        if np.size(m.centers):
            assert bit_equal(side["curve_model"]["centers"], m.centers)
            assert bit_equal(side["curve_model"]["amplitudes"], m.amplitudes)
            assert bit_equal(side["curve_model"]["sigmas"], m.sigmas)


def test_round_trip_catches_a_zeroed_nan(exported, checkout):
    root, _, _ = exported
    io = upstream.module("spektrafilm.profiles.io")
    p = io.load_profile("kodak_portra_400")
    t = load_file(str(root / "a" / PACK_ID / "stocks" / "kodak_portra_400.safetensors"))
    broken = t["base_density_D"].copy()
    broken[np.flatnonzero(np.isnan(broken))[0]] = 0.0
    assert not bit_equal(broken, p.data.base_density)


def test_guide_numbers(exported):
    root, _, _ = exported
    d = root / "a" / PACK_ID
    side = json.loads((d / "stocks/kodak_portra_400.json").read_text())
    w = side["hanatos_window"]
    assert [round(w[k], 2) for k in ("c_uv_nm", "sigma_uv_nm", "c_ir_nm", "sigma_ir_nm")] == [433.49, 31.56, 593.13, 68.76]
    nf = json.loads((d / "enlarger/neutral-print-filters.json").read_text())["table"]
    assert [round(v, 3) for v in nf["kodak_portra_endura"]["TH-KG3"]["kodak_portra_400"]] == [0.0, 51.568, 52.534]
    cmf = load_file(str(d / "cie/cmf-1931-2deg.safetensors"))["cmf_xyz_2deg"]
    assert np.allclose(cmf[35], [0.51205, 1.0, 0.00575], atol=5e-6)
    t = load_file(str(d / "stocks/kodak_portra_400.safetensors"))
    c = [np.interp(0.0, t["log_exposure_logH"], t["dye_amount_curves"][:, k]) for k in range(3)]
    assert np.allclose(c, [0.687, 0.704, 0.864], atol=5e-4)
    dirp = json.loads((d / "presets/dir-couplers.json").read_text())
    assert dirp["applied"]["kodak_portra_400"]["matrix"] == [[0.336, 0.353, 0.302], [0.154, 0.319, 0.353], [0.168, 0.226, 0.273]]
    lut = load_file(str(d / "upsampling/hanatos2025-irradiance-xy-tc.safetensors"))["irradiance_xy_tc_f16"]
    assert lut.dtype == np.float16 and lut.shape == (192, 192, 81)


def test_crosscheck_passes(exported, repo):
    root, _, _ = exported
    for sub in ("interim-filmbench@1",):  # optional comparison pack for the zero-density note
        src = repo / "packages/data/packs" / sub
        if src.is_dir():
            import shutil
            shutil.copytree(src, root / "a" / sub, dirs_exist_ok=True)
    r = crosscheck.run(root / "a" / PACK_ID, repo / "ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite")
    s = r["summary"]
    assert s["chromogen"]["ok"] and s["filmbench"]["ok"] and s["illustrative"]["ok"], s
    assert s["greyCard"]["ok"], s["greyCard"]
    assert s["balanceLaw"]["ok"], s["balanceLaw"]


def test_baselines_match_committed(checkout, repo, tmp_path):
    upstream.load(checkout)
    out = baselines.convert(checkout, tmp_path, upstream.git_head(checkout))
    assert len(out) == 5
    for p in out:
        assert p.read_bytes() == (repo / "fixtures/golden/spektrafilm" / p.name).read_bytes()
