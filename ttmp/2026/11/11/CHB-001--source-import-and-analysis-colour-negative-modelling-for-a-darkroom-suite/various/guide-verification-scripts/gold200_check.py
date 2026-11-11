"""Check Gold 200 sample numbers: rebate T, sigma (leave-one-out MAD), auto rebate bias.

Usage: python3 -I gold200_check.py /path/to/gold200.png
Reimplements Chromogen's loadSample, Source.region (area average), rebate() and sigmaD()
for verification only.
"""
import sys, zlib, struct
import numpy as np


def read_png16(path):
    b = open(path, 'rb').read()
    assert b[:8] == b'\x89PNG\r\n\x1a\n'
    p = 8
    idat = []
    while p < len(b):
        ln = struct.unpack('>I', b[p:p + 4])[0]
        t = b[p + 4:p + 8]
        d = b[p + 8:p + 8 + ln]
        if t == b'IHDR':
            w, h, depth, ctype, comp, filt, inter = struct.unpack('>IIBBBBB', d)
        elif t == b'IDAT':
            idat.append(d)
        elif t == b'IEND':
            break
        p += 12 + ln
    assert depth == 16 and ctype == 2 and inter == 0
    raw = zlib.decompress(b''.join(idat))
    bpp = 6
    stride = w * bpp
    out = np.zeros((h, stride), np.uint8)
    prev = np.zeros(stride, np.int32)
    ip = 0
    for y in range(h):
        f = raw[ip]; ip += 1
        cur = np.frombuffer(raw[ip:ip + stride], np.uint8).astype(np.int32).copy(); ip += stride
        if f == 0:
            pass
        elif f == 1:
            for i in range(bpp, stride):
                cur[i] = (cur[i] + cur[i - bpp]) & 255
        elif f == 2:
            cur = (cur + prev) & 255
        elif f == 3:
            for i in range(stride):
                a = cur[i - bpp] if i >= bpp else 0
                cur[i] = (cur[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = cur[i - bpp] if i >= bpp else 0
                bb = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pp = a + bb - c
                pa, pb, pc = abs(pp - a), abs(pp - bb), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (bb if pb <= pc else c)
                cur[i] = (cur[i] + pr) & 255
        out[y] = cur
        prev = cur
    u = (out[:, 0::2].astype(np.uint32) << 8 | out[:, 1::2]).reshape(h, w, 3)
    return u


def region(img, box, tw, th):
    """Chromogen Source.region area average (no flat), on an already oriented image."""
    x0, y0, w, h = box
    H, W, _ = img.shape
    sx, sy = w / tw, h / th
    out = np.zeros((th, tw, 3))
    for ty in range(th):
        ya = y0 + ty * sy; yb = ya + sy
        ys0, ys1 = max(0, int(np.floor(ya))), min(H, int(np.ceil(yb)))
        for tx in range(tw):
            xa = x0 + tx * sx; xb = xa + sx
            xs0, xs1 = max(0, int(np.floor(xa))), min(W, int(np.ceil(xb)))
            blk = img[ys0:ys1, xs0:xs1].reshape(-1, 3)
            out[ty, tx] = blk.mean(0) if len(blk) else 0
    return out


def sigmaD(data, Treb, keep=None, R=4):
    h, w, _ = data.shape
    res = []
    for k in range(3):
        D = -np.log10(np.maximum(data[..., k], 1e-6) / Treb[k])
        m = np.ones((h, w)) if keep is None else keep.astype(float)
        S = np.zeros((h + 1, w + 1)); C = np.zeros((h + 1, w + 1))
        S[1:, 1:] = np.cumsum(np.cumsum(D * m, 0), 1)
        C[1:, 1:] = np.cumsum(np.cumsum(m, 0), 1)
        dev = []
        for y in range(h):
            for x in range(w):
                if not m[y, x]:
                    continue
                x0, y0, x1, y1 = max(0, x - R), max(0, y - R), min(w, x + R + 1), min(h, y + R + 1)
                n = C[y1, x1] - C[y0, x1] - C[y1, x0] + C[y0, x0]
                if n < 9:
                    continue
                s = S[y1, x1] - S[y0, x1] - S[y1, x0] + S[y0, x0]
                mu = (s - D[y, x]) / (n - 1)
                dev.append(abs(D[y, x] - mu))
        if len(dev) < 60:
            return None
        dev.sort()
        res.append(max(1e-4, 1.4826 * dev[len(dev) >> 1]))
    return res


def main(path):
    u = read_png16(path)
    T = np.maximum(0.05, u / 16.0 - 2) / 4000.0
    T = T[:, ::-1, :]  # flipH as the sample is loaded
    print('shape', T.shape)
    reb = [98, 100, 20, 680]
    crop = [126, 60, 1090, 754]
    rb = region(T, reb, 20, 64)  # rebate(): resampled to at most 64 x 64
    Treb = rb.reshape(-1, 3).mean(0)
    print('Treb (box)          ', Treb, 'counts', Treb * 4000)
    full = region(T, reb, 20, 680)
    s = sigmaD(full, Treb)
    print('sigma rebate full    ', s)
    sc = 640 / 1090
    bw, bh = max(2, round(20 * sc)), max(2, round(680 * sc))
    s2 = sigmaD(region(T, reb, bw, bh), Treb)
    print('sigma rebate 640     ', s2, (bw, bh))
    # auto rebate
    th = max(1, round(256 * crop[3] / crop[2]))
    sm = region(T, crop, 256, th)
    auto = [np.sort(sm[..., k].ravel())[int(sm[..., k].size * 0.997)] * 1.02 for k in range(3)]
    auto = np.array(auto)
    print('Treb (auto)          ', auto)
    print('auto vs box, D       ', -np.log10(auto / Treb))
    # rebate profile along its length: D of rows relative to mean
    prof = full.mean(1)
    Dp = -np.log10(prof / Treb)
    n = len(Dp)
    print('rebate top 10% D     ', Dp[: n // 10].mean(0))
    print('rebate bottom half D ', Dp[n // 2:].mean(0))
    # frame at full size: shadow floor 1st percentile, 25-px bands from rebate edge
    fr = T[crop[1]:crop[1] + crop[3], crop[0]:crop[0] + crop[2]]
    Dfr = -np.log10(np.maximum(fr, 1e-6) / Treb)
    for x0 in (0, 25, 100, 300, 400, 500):
        band = Dfr[:, x0:x0 + 25].reshape(-1, 3)
        print('floor band', x0, np.percentile(band, 1, axis=0).round(4))


if __name__ == '__main__':
    main(sys.argv[1])
