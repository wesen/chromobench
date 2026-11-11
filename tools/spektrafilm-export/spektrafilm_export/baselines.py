"""Convert upstream's regression baselines (tests/baselines/*.npz) to JSON golden fixtures.

The cases and their fast parameters are defined in upstream tests/regression_baselines.py and
tests/conftest.py::make_fast_test_params; we record them beside the arrays because the stored
outputs depend on those settings. We read the case table from the source text instead of
importing the upstream test module (which imports the whole simulator).
"""
from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np

FAST_PARAMS = {
    "function": "tests/conftest.py::make_fast_test_params",
    "debug.deactivate_spatial_effects": True,
    "debug.deactivate_stochastic_effects": True,
    "settings.use_enlarger_lut": False,
    "settings.use_scanner_lut": False,
    "io.upscale_factor": 1.0,
    "io.crop": False,
    "camera.auto_exposure": False,
    "camera.exposure_compensation_ev": 0.0,
    "then": "digest_params(params)",
}
IMAGE_RECIPES = {
    "gray_ramp_16": "np.ones((16,16,3)) * np.linspace(0.01, 1.0, 16)[None,:,None]",
    "green_patch_8": "np.tile([0.05, 0.40, 0.05], (8, 8, 1))",
}
TAPS = {"print_rgb": "rgb_out (default)", "negative_density": "cmy_film", "film_raw": "log_e_film"}


def regression_cases(src: Path) -> list[dict[str, str]]:
    tree = ast.parse(src.read_text())
    cases = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "RegressionCase":
            cases.append({kw.arg: ast.literal_eval(kw.value) for kw in node.keywords})
    return cases


def convert(checkout: Path, out_dir: Path, commit: str) -> list[Path]:
    cases = regression_cases(checkout / "tests" / "regression_baselines.py")
    if len(cases) != 5:
        raise SystemExit(f"expected 5 regression cases, found {len(cases)}")
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for c in cases:
        npz = checkout / "tests" / "baselines" / f"{c['case_id']}.npz"
        raw = npz.read_bytes()
        with np.load(npz, allow_pickle=False) as z:
            arr = np.asarray(z["output"], dtype=np.float64)
        doc: dict[str, Any] = {
            "case": c,
            "source": {"repo": "https://github.com/andreavolpato/spektrafilm", "commit": commit,
                       "file": f"tests/baselines/{c['case_id']}.npz", "sha256": hashlib.sha256(raw).hexdigest()},
            "params": FAST_PARAMS,
            "image": IMAGE_RECIPES[c["image_recipe"]],
            "tap": TAPS[c["output_mode"]],
            "seed": "np.random.seed(0) before simulate",
            "tolerance": {"rtol": 1.5e-3, "atol": 1e-6, "from": "tests/regression_baselines.py assert_matches_baseline"},
            "license": "Derived from spektrafilm by Andrea Volpato (outputs of the GPLv3 simulator on CC BY-SA 4.0 profiles); CC BY-SA 4.0",
            "shape": list(arr.shape),
            "output": arr.tolist(),
        }
        p = out_dir / f"{c['case_id']}.json"
        p.write_text(json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n")
        written.append(p)
    return written
