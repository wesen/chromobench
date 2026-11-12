# CHB-012: reference values computed by spektrafilm itself (commit 3bb2c2d) for the forward path.
# Run from spektrafilm/src with PYTHONPATH=.:<stubs>. Prints JSON to stdout.
import json
import numpy as np
import colour
from spektrafilm.profiles.io import load_profile
from spektrafilm.utils.spectral_upsampling import (
    compute_hanatos2025_tc_lut, rgb_to_raw_hanatos2025, _illuminant_to_xy, _rgb_to_tc_b, eval_erf4_spectral_bandpass,
    HANATOS2025_SPECTRA_LUT,
)
from spektrafilm.utils.gamut_compression import InputGamutCompressSpec, compress_xy
from spektrafilm.utils.autoexposure import measure_autoexposure_ev
from spektrafilm.model.couplers import compute_density_curves_before_dir_couplers, compute_dir_couplers_matrix
from spektrafilm.model.density_curves import interpolate_exposure_to_density
from spektrafilm.runtime.params_schema import DirCouplersParams

out = {}
p = load_profile('kodak_portra_400')
S = np.nan_to_num(10 ** p.data.log_sensitivity)
ad = p.hanatos2025_adaptation()
ad.apply_window = True
ad.apply_surface = False
lut_w = compute_hanatos2025_tc_lut(S, ad, gamut_compress=InputGamutCompressSpec())
ad2 = p.hanatos2025_adaptation()
ad2.apply_window = False
ad2.apply_surface = False
lut_bare = compute_hanatos2025_tc_lut(S, ad2, gamut_compress=None)
lut_w_nocomp = compute_hanatos2025_tc_lut(S, ad, gamut_compress=None)

# table nodes
nodes = [(0, 0), (49, 120), (100, 100), (150, 40), (191, 191), (20, 170), (120, 150)]
out['tcLut'] = {
    'window+compress': [[i, j, lut_w[i, j].tolist()] for i, j in nodes],
    'window': [[i, j, lut_w_nocomp[i, j].tolist()] for i, j in nodes],
    'bare': [[i, j, lut_bare[i, j].tolist()] for i, j in nodes],
}
out['refXY'] = _illuminant_to_xy('D55').tolist()
# M_D55 for sRGB
M = colour.RGB_to_XYZ(np.eye(3), colourspace='sRGB', apply_cctf_decoding=False, illuminant=_illuminant_to_xy('D55'), chromatic_adaptation_transform='CAT16')
out['M_sRGB_D55'] = M.T.tolist()  # rows = XYZ, columns = R,G,B
# raw for colours (linear sRGB)
cols = {
    'moderate_red': [0.5606, 0.0807, 0.1143],
    'grey184': [0.184, 0.184, 0.184],
    'white90': [0.9, 0.9, 0.9],
    'blue': [0.05, 0.1, 0.6],
    'green': [0.1, 0.5, 0.08],
    'yellow': [0.8, 0.7, 0.05],
    'cyan': [0.02, 0.4, 0.5],
    'saturated_red': [1.0, 0.0, 0.0],
    'saturated_blue': [0.0, 0.0, 1.0],
}
rgb = np.array([[v for v in cols.values()]])
raw = rgb_to_raw_hanatos2025(rgb, S, color_space='sRGB', apply_cctf_decoding=False, reference_illuminant='D55', tc_lut=lut_w)
tc, b = _rgb_to_tc_b(rgb, color_space='sRGB', apply_cctf_decoding=False, reference_illuminant='D55')
out['raw'] = {k: {'rgb': cols[k], 'raw': raw[0, i].tolist(), 'tc': tc[0, i].tolist(), 'b': float(b[0, i])} for i, k in enumerate(cols)}
# compress_xy samples
xy = np.array([[0.7, 0.3], [0.1, 0.1], [0.2, 0.7], [0.4, 0.4], [0.15, 0.05]])
out['compressXY'] = {'in': xy.tolist(), 'out': compress_xy(xy, _illuminant_to_xy('D55'), InputGamutCompressSpec()).tolist()}
# window
w = eval_erf4_spectral_bandpass(p.data.hanatos2025_adaptation_window_params)[:, 0]
out['window'] = {'params': list(map(float, p.data.hanatos2025_adaptation_window_params)), 'at': {str(int(l)): float(w[int((l - 380) / 5)]) for l in [400, 445, 500, 550, 645, 700]}}
# autoexposure on a deterministic synthetic image (linear sRGB, 30 x 40)
h, wd = 30, 40
yy, xx = np.mgrid[0:h, 0:wd]
img = np.stack([0.05 + 0.5 * xx / wd, 0.1 + 0.3 * yy / h, 0.2 + 0.2 * ((xx + yy) % 7) / 7], -1)
out['autoexposure'] = {'image': 'R=0.05+0.5x/40, G=0.1+0.3y/30, B=0.2+0.2((x+y) mod 7)/7, 30x40, linear sRGB',
                       'ev': {m: float(measure_autoexposure_ev(img, 'sRGB', False, method=m)) for m in ['average', 'median', 'center_weighted', 'partial', 'matrix', 'multi_zone', 'highlight_weighted']}}
# DIR
dc = p.data.density_curves - np.nanmin(p.data.density_curves, axis=0)
le = p.data.log_exposure
dirp = DirCouplersParams(gamma_samelayer_rgb=(0.336, 0.319, 0.273), gamma_interlayer_r_to_gb=(0.353, 0.302), gamma_interlayer_g_to_rb=(0.154, 0.353), gamma_interlayer_b_to_rg=(0.168, 0.226))
Mdir = compute_dir_couplers_matrix(dirp)
dc0 = compute_density_curves_before_dir_couplers(dc, le, Mdir)
U = np.array([[[0, 0, 0], [0.399, -0.2774, -0.1612], [1.0, -1.5, -1.5], [-1, -1, -1], [2, 2, 2], [0.5, 0.2, -0.3]]], dtype=float)
d0 = interpolate_exposure_to_density(U, dc, le, 1.0)
a = np.einsum('ijk,km->ijm', d0, Mdir)
d = interpolate_exposure_to_density(U - a, dc0, le, 1.0)
out['dir'] = {'M': Mdir.tolist(), 'u': U[0].tolist(), 'd0': d0[0].tolist(), 'a': a[0].tolist(), 'd': d[0].tolist()}
# midgray raw via the filming path (rgb 0.184 in sRGB default of _rgb_to_film_raw)
out['midgrayRaw'] = raw[0, 1].tolist()
print(json.dumps(out, indent=1))
