# CHB-033 step 5: sample dng_validate's stage-3 image (linear camera RGB, Adobe's demosaic) and its final render
# (ProPhoto RGB, 16-bit, gamma 1.8) on the same pixel grid, for scripts/04-validate-port.ts. No colour math here.
# The final render is the stage-3 image cropped by DefaultCropOrigin (8, 8 for the D750). Every STEP-th pixel.
# Usage: python3 04a-sample-dng-validate.py <dir with NAME-stage3.tif and NAME-adobe-prophoto16.tif> NAME [STEP]
# Output: <dir>/NAME-samples.f32: float32 records (s3 R, G, B in 0..1, final R, G, B in 0..1), header-less.
import sys, numpy as np, tifffile
d, name = sys.argv[1], sys.argv[2]
step = int(sys.argv[3]) if len(sys.argv) > 3 else 8
s3 = tifffile.imread(f'{d}/{name}-stage3.tif')
fin = tifffile.imread(f'{d}/{name}-adobe-prophoto16.tif')
oy, ox = 8, 8  # DefaultCropOrigin (exiftool -DefaultCropOrigin: "8 8")
a = s3[oy:oy + fin.shape[0]:step, ox:ox + fin.shape[1]:step].reshape(-1, 3).astype(np.float32) / 65535
b = fin[::step, ::step].reshape(-1, 3).astype(np.float32) / 65535
out = np.concatenate([a, b], axis=1).astype('<f4')
out.tofile(f'{d}/{name}-samples.f32')
print(name, 'stage3', s3.shape, 'final', fin.shape, 'samples', out.shape[0], 'stage3 max', float(a.max()), 'final max', float(b.max()))
