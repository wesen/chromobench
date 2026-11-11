// Dense and sparse kernels for dust (JS reference, guide §5.11 DR-10), ported from goja-cv
// pkg/cv/kernels (filter.go Gaussian, morph.go squareMinMax, mask.go BoxMean/DistanceToSet,
// label.go Components, specks.go oddPad/MAD). Single-plane Float32Array, row-major.

export function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 <= e0) return x >= e0 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Median of a copy. */
export function medianOf(xs: ArrayLike<number>): number {
  if (!xs.length) return 0;
  const c = Float64Array.from(xs).sort();
  return c[c.length >> 1]!;
}

/** [median, 1.4826 · MAD]. */
export function mad(xs: ArrayLike<number>): [number, number] {
  const m = medianOf(xs);
  const d = new Float64Array(xs.length);
  for (let i = 0; i < xs.length; i++) d[i] = Math.abs(xs[i]! - m);
  return [m, 1.4826 * medianOf(d)];
}

export function gaussianKernel(sigma: number): Float64Array {
  const rad = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float64Array(2 * rad + 1);
  let s = 0;
  for (let i = 0; i < k.length; i++) {
    const x = i - rad;
    k[i] = Math.exp((-x * x) / (2 * sigma * sigma));
    s += k[i]!;
  }
  for (let i = 0; i < k.length; i++) k[i]! /= s;
  return k;
}

/** Mirror without repeating the edge sample (…2 1 | 0 1 2 … n−1 | n−2 …). */
export function reflect101(i: number, n: number): number {
  if (n === 1) return 0;
  const period = 2 * n - 2;
  let j = i % period;
  if (j < 0) j += period;
  return j >= n ? period - j : j;
}

/** Separable Gaussian blur, mirrored borders. */
export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return src.slice();
  const k = gaussianKernel(sigma);
  const rad = k.length >> 1;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const xi = new Int32Array(w + 2 * rad);
  for (let i = 0; i < xi.length; i++) xi[i] = reflect101(i - rad, w);
  const yi = new Int32Array(h + 2 * rad);
  for (let i = 0; i < yi.length; i++) yi[i] = reflect101(i - rad, h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = 0; j < k.length; j++) s += k[j]! * src[o + xi[x + j]!]!;
      tmp[o + x] = s;
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let j = 0; j < k.length; j++) s += k[j]! * tmp[yi[y + j]! * w + x]!;
    out[y * w + x] = s;
  }
  return out;
}

/** Odd (point) reflection padding by p px: v(−k) = 2 v(0) − v(k), continues linear trends. */
export function oddPad(src: Float32Array, w: number, h: number, p: number): { pad: Float32Array; pw: number; ph: number } {
  const pw = w + 2 * p;
  const ph = h + 2 * p;
  const out = new Float32Array(pw * ph);
  const refl = (i: number, n: number): [number, number, boolean] =>
    i < 0 ? [0, Math.min(-i, n - 1), true] : i >= n ? [n - 1, Math.max(2 * (n - 1) - i, 0), true] : [i, i, false];
  for (let y = 0; y < h; y++) for (let x = -p; x < w + p; x++) {
    const [e, m, r] = refl(x, w);
    const v = src[y * w + e]!;
    out[(y + p) * pw + x + p] = r ? 2 * v - src[y * w + m]! : v;
  }
  for (let y = -p; y < h + p; y++) {
    const [e, m, r] = refl(y, h);
    if (!r) continue;
    for (let x = 0; x < pw; x++) out[(y + p) * pw + x] = 2 * out[(e + p) * pw + x]! - out[(m + p) * pw + x]!;
  }
  return { pad: out, pw, ph };
}

/** (2r+1)² square minimum or maximum, separable; windows clipped at the borders. */
export function squareMinMax(p: Float32Array, w: number, h: number, r: number, isMax: boolean): Float32Array {
  if (r <= 0) return p.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const f = isMax ? Math.max : Math.min;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = p[y * w + x]!;
    for (let d = Math.max(0, x - r); d <= Math.min(w - 1, x + r); d++) m = f(m, p[y * w + d]!);
    tmp[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = tmp[y * w + x]!;
    for (let d = Math.max(0, y - r); d <= Math.min(h - 1, y + r); d++) m = f(m, tmp[d * w + x]!);
    out[y * w + x] = m;
  }
  return out;
}

export const squareOpening = (p: Float32Array, w: number, h: number, r: number): Float32Array => squareMinMax(squareMinMax(p, w, h, r, false), w, h, r, true);
export const squareClosing = (p: Float32Array, w: number, h: number, r: number): Float32Array => squareMinMax(squareMinMax(p, w, h, r, true), w, h, r, false);

/** Mean over a (2r+1)² window clipped to the image (f64 integral image). */
export function boxMean(p: Float32Array, w: number, h: number, r: number): Float32Array {
  const W1 = w + 1;
  const ii = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += p[y * w + x]!;
      ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1]! + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      out[y * w + x] = (ii[yb * W1 + xb]! - ii[ya * W1 + xb]! - ii[yb * W1 + xa]! + ii[ya * W1 + xa]!) / ((yb - ya) * (xb - xa));
    }
  }
  return out;
}

/** 8-connected components (two-pass union-find), pixel lists in raster order of first pixels. */
export function components(fg: Uint8Array, w: number, h: number): Int32Array[] {
  const lab = new Int32Array(w * h).fill(-1);
  const parent: number[] = [];
  const find = (a: number): number => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]!]!; a = parent[a]!; }
    return a;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!fg[i]) continue;
    let l = -1;
    for (const [dx, dy] of [[-1, 0], [-1, -1], [0, -1], [1, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w) continue;
      const nl = lab[ny * w + nx]!;
      if (nl < 0) continue;
      if (l < 0) l = nl;
      else if (nl !== l) {
        const a = find(l), b = find(nl);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
    if (l < 0) { l = parent.length; parent.push(l); }
    lab[i] = l;
  }
  const index = new Map<number, number[]>();
  const order: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (lab[i]! < 0) continue;
    const r = find(lab[i]!);
    let list = index.get(r);
    if (!list) { list = []; index.set(r, list); order.push(r); }
    list.push(i);
  }
  return order.map((r) => Int32Array.from(index.get(r)!));
}

/** Exact Euclidean distance (px) to the nearest set pixel (Felzenszwalb–Huttenlocher). */
export function distanceToSet(set: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = set[i] ? 0 : INF;
  const dt1d = (f: Float64Array, d: Float64Array, n: number): void => {
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) { k--; s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1]! < q) k++;
      d[q] = (q - v[k]!) ** 2 + f[v[k]!]!;
    }
  };
  const fc = new Float64Array(h), dc = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) fc[y] = g[y * w + x]!;
    dt1d(fc, dc, h);
    for (let y = 0; y < h; y++) g[y * w + x] = dc[y]!;
  }
  const fr = new Float64Array(w), dr = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) fr[x] = g[y * w + x]!;
    dt1d(fr, dr, w);
    for (let x = 0; x < w; x++) g[y * w + x] = dr[x]!;
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(g[i]!);
  return out;
}
