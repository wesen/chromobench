"""The interim and illustrative packs are reproducible from the CHB-001 extracts (no upstream needed)."""
import json
import shutil

import numpy as np
from safetensors.numpy import load_file

from spektrafilm_export import EXPORTER, illustrative, interim

C1 = "ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite"
SF = "spektrafilm@0.3.2+3bb2c2d"


def test_interim_and_illustrative_reproduce_committed(repo, tmp_path):
    (tmp_path / SF).mkdir()
    shutil.copy(repo / "packages/data/packs" / SF / "SPEKTRAFILM_LICENSE.txt", tmp_path / SF / "SPEKTRAFILM_LICENSE.txt")
    ms = interim.export_all(repo / C1, tmp_path, EXPORTER) + [illustrative.export(tmp_path, EXPORTER)]
    for m in ms:
        ours = (tmp_path / m["packId"] / "manifest.json").read_bytes()
        assert ours == (repo / "packages/data/packs" / m["packId"] / "manifest.json").read_bytes(), m["packId"]


def test_filmbench_nan_rows_restored(repo):
    d = repo / "packages/data/packs/interim-filmbench@1"
    t = load_file(str(d / "stocks/kodak_portra_400.safetensors"))
    nan_base = np.flatnonzero(np.isnan(t["base_density_D"]))
    assert nan_base.tolist() == [0, 1, 2, 3] + list(range(65, 81))
    assert np.isnan(t["unit_dye_density_D"][nan_base]).all()
    m = json.loads((d / "manifest.json").read_text())
    assert m["missing"]["supported"] == ["opaque"]
    assert t["film_exposure_lut64_log2"].shape == (64, 64, 3)


def test_chromogen_keeps_real_nulls(repo):
    t = load_file(str(repo / "packages/data/packs/interim-chromogen@1/stocks/kodak_portra_400.safetensors"))
    # Chromogen still has the 385-395 nm dye values Filmbench threw away (guide §5.1).
    assert not np.isnan(t["unit_dye_density_D"][1:4]).any()
    assert np.isnan(t["base_density_D"][1:4]).all()
