import numpy as np

from spektrafilm_export import EXPORTER, synthetic


def test_flare_wedge_matches_textbook():
    got = -np.log10(synthetic.flare_read(synthetic.STEPS_D, 0.005))
    assert np.allclose(got, [0, 0.495, 0.981, 1.438, 1.826, 2.090, 2.224], atol=1e-3)


def test_neutral_wedge_reproduces_committed(repo, tmp_path):
    for d in synthetic.neutral_wedge(tmp_path, EXPORTER):
        rel = d.relative_to(tmp_path)
        for f in ("truth.json", "camera_linear.safetensors", "truth.safetensors"):
            assert (d / f).read_bytes() == (repo / "fixtures/synthetic" / rel / f).read_bytes(), f"{rel}/{f}"
