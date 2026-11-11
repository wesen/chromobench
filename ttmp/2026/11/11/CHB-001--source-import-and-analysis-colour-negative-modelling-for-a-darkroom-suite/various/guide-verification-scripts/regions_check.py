"""Per-region densities and z on the Gold 200 sample. Usage: python3 -I regions_check.py gold200.png"""
import sys, struct
import numpy as np
sys.path.insert(0, '.')
from gold200_check import read_png16

def chunks(path):
    b = open(path, 'rb').read(); p = 8; out = []
    while p < len(b):
        ln = struct.unpack('>I', b[p:p+4])[0]; t = b[p+4:p+8].decode('latin1'); out.append((t, ln)); p += 12 + ln
    return out

path = sys.argv[1]
print('chunks', [c for c in chunks(path) if c[0] != 'IDAT'][:12], 'IDAT count', sum(1 for c in chunks(path) if c[0]=='IDAT'))
u = read_png16(path)
T = (np.maximum(0.05, u / 16.0 - 2) / 4000.0)[:, ::-1, :]
Treb = np.array([0.12053495, 0.67926413, 0.21386581])
sig = np.array([0.00899, 0.00686, 0.01220])
regs = {"stone wall above the sign": [572,80,120,60], "wall, left of the sign": [892,300,70,60], "sign stand (dark plastic)": [736,530,40,60], "deep shadow beside the stand": [592,524,60,34], "sign face (red-pink)": [652,440,70,22], "sunlit leaves": [292,160,50,40]}
for name, (x, y, w, h) in regs.items():
    blk = T[y:y+h, x:x+w].reshape(-1, 3)
    m = blk.mean(0)
    D = -np.log10(m / Treb)
    Dpix = -np.log10(np.maximum(blk, 1e-6) / Treb)
    z = Dpix / sig
    zmin = z.min(1)
    below = (zmin < -3).mean(); blank = ((zmin >= -3) & (zmin <= 3)).mean()
    print(f'{name:30s} Tmean {m.round(4)} D {D.round(3)} z(mean) {(D/sig).round(1)} below {below:.2f} blank {blank:.2f}')
# one pixel trace
x, y = 600, 540
t = T[y, x]
print('pixel', (x, y), 'u', u[:, ::-1, :][y, x], 'T', t.round(5), 'D', (-np.log10(t / Treb)).round(4), 'z', (-np.log10(t / Treb) / sig).round(2))
