import json
import struct

import numpy as np
from safetensors.numpy import load

from spektrafilm_export.packwriter import PackWriter, canonical_json, content_hash, runs_nm, WAVELENGTHS_NM


def test_runs_nm():
    m = np.zeros(81, dtype=bool)
    m[[0, 1, 2, 3]] = True
    m[65:] = True
    assert runs_nm(m) == [380, 395, 705, 780]
    assert runs_nm(np.zeros(81, dtype=bool)) == []
    m = np.zeros(81, dtype=bool)
    m[0] = True
    assert runs_nm(m) == [380, 380]


def test_canonical_json_sorted_nan_null():
    assert canonical_json({"b": 1, "a": [float("nan"), 0.1]}) == b'{"a":[null,0.1],"b":1}'


def test_content_hash_ignores_licence_but_not_data():
    t = {"x": np.array([1.0, np.nan])}
    h1 = content_hash({"kind": "stock", "id": "s", "attribution": "A", "metadata": {"license": "x"}}, t)
    h2 = content_hash({"kind": "stock", "id": "s", "attribution": "B", "metadata": {"license": "y"}}, t)
    h3 = content_hash({"kind": "stock", "id": "s"}, {"x": np.array([1.0, 0.0])})
    assert h1 == h2 != h3


def test_writer_is_deterministic_aligned_and_keeps_nan(tmp_path):
    def write(root):
        w = PackWriter(root=root, pack_id="t@1", source={"kind": "interim"}, license={"spdx": "CC0-1.0", "file": "L", "attribution": "a"})
        w.text("L", "licence")
        t = {"b_D": np.array([np.nan, 1.5, -0.0]), "a": np.arange(81, dtype=np.float64)}
        w.tensors("x/t.safetensors", t)
        w.item("thing", "t", ["x/t.safetensors"], {"k": 1}, t)
        return w.finish()

    m1 = write(tmp_path / "a")
    m2 = write(tmp_path / "b")
    assert m1["_packHash"] == m2["_packHash"]
    data = (tmp_path / "a" / "t@1" / "x" / "t.safetensors").read_bytes()
    n = struct.unpack("<Q", data[:8])[0]
    assert (8 + n) % 8 == 0
    header = json.loads(data[8:8 + n])
    assert header["__metadata__"]["packId"] == "t@1"
    back = load(data)
    assert np.isnan(back["b_D"][0]) and back["b_D"][1] == 1.5 and np.signbit(back["b_D"][2])
    assert np.array_equal(back["a"], np.arange(81))
    man = json.loads((tmp_path / "a" / "t@1" / "manifest.json").read_text())
    assert man["grid"] == {"start_nm": 380, "step_nm": 5, "count": 81}
    assert [f["path"] for f in man["files"]] == ["L", "x/t.safetensors"]
    assert len(WAVELENGTHS_NM) == 81
