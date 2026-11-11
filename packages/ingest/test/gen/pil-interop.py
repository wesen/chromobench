"""Interop fixtures written by Pillow/libtiff (an encoder that is not ours).

Run from the repo root:  python3 -I packages/ingest/test/gen/pil-interop.py packages/ingest/test/fixtures
Each image is a deterministic pattern the test recomputes: v(x, y, k) as below.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
W, H = 37, 23
y, x = np.mgrid[0:H, 0:W]


def rgb8():
    return np.stack([(x * 7 + y * 3) % 256, (x * 5 + y * 11 + 40) % 256, (x * y + 9) % 256], -1).astype(np.uint8)


def grey16():
    return ((x * 1543 + y * 977 + 12345) % 65536).astype(np.uint16)


for comp in ["raw", "tiff_lzw", "tiff_adobe_deflate", "packbits"]:
    Image.fromarray(rgb8(), "RGB").save(out / f"pil-rgb8-{comp}.tif", compression=None if comp == "raw" else comp)
    Image.fromarray(grey16(), "I;16").save(out / f"pil-grey16-{comp}.tif", compression=None if comp == "raw" else comp)
# Predictor 2 through libtiff
Image.fromarray(rgb8(), "RGB").save(out / "pil-rgb8-lzw-pred2.tif", compression="tiff_lzw", tiffinfo={317: 2})
# A larger LZW image so the code width reaches 12 bits and the table resets
rng = np.random.default_rng(7)
big = rng.integers(0, 256, size=(96, 128, 3), dtype=np.uint8)
big[:, :64] //= 16
Image.fromarray(big, "RGB").save(out / "pil-rgb8-lzw-big.tif", compression="tiff_lzw")
(out / "pil-rgb8-lzw-big.rgb").write_bytes(big.tobytes())
print("ok")
