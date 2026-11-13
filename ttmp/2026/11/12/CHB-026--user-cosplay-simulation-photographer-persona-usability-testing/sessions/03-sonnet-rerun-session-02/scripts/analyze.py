import sys, json
from PIL import Image
import numpy as np
def analyze(path, bg=(153,153,153), tol=6):
    im = np.asarray(Image.open(path).convert('RGB')).astype(float)
    # restrict to the main picture area
    h, w, _ = im.shape
    sub = im[100:735, 245:1135] if w >= 1100 else im
    d = np.abs(sub - np.array(bg)).max(axis=2)
    mask = d > tol
    ys, xs = np.where(mask)
    if len(ys) == 0: return None
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    # drop 12px label region top-left by using inner crop
    crop = sub[y0+30:y1-4, x0+4:x1-4]
    L = crop @ np.array([0.299, 0.587, 0.114])
    gx = np.abs(np.diff(L, axis=1)).mean(); gy = np.abs(np.diff(L, axis=0)).mean()
    lap = (L[1:-1,1:-1]*4 - L[:-2,1:-1] - L[2:,1:-1] - L[1:-1,:-2] - L[1:-1,2:]).var()
    p1 = np.percentile(crop.reshape(-1,3), 1, axis=0)
    p1L = np.percentile(L, 1)
    m = crop.reshape(-1,3).mean(axis=0)
    return dict(bbox=[int(x0+245), int(y0+100), int(x1-x0+1), int(y1-y0+1)], mean=[round(v,1) for v in m], p1rgb=[round(v,1) for v in p1], p1L=round(float(p1L),1), grad=round(float((gx+gy)/2),2), lapvar=round(float(lap),1), BoverR=round(float(m[2]/m[0]),3))
if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(p.split('/')[-1], json.dumps(analyze(p)))
