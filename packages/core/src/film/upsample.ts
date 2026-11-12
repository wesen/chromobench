// Spectral upsampling and the film exposure table (CHB-012 guide §2.2–2.3, §5.2; LFP §1.4–1.5;
// spektrafilm utils/spectral_upsampling.py and utils/gamut_compression.py at 3bb2c2d).
//
// A colour reaches the film as a smooth irradiance spectrum chosen by its chromaticity (x, y); the
// film never needs the spectrum, only its three layer exposures, so the inner products are folded
// into a per-film table over square coordinates (u, v) = tri2quad(x, y). Per pixel:
// raw = b · table(u, v), b = X + Y + Z.
import { erf } from '../print/paper.ts';
import { NW } from '../spectral/spectrum.ts';
import type { Vec3 } from '../spectral/linalg.ts';

// ---- square coordinates --------------------------------------------------------------------

/** Triangle (x, y) → square (u, v) = ((1 − x)², y / (1 − x)), each clamped to [0, 1] (spektrafilm _tri2quad). */
export function tri2quad(x: number, y: number): [number, number] {
  const v = y / Math.max(1 - x, 1e-10);
  const u = (1 - x) * (1 - x);
  return [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))];
}

/** Square (u, v) → triangle (x, y) = (1 − √u, v √u). */
export function quad2tri(u: number, v: number): [number, number] {
  const s = Math.sqrt(u);
  return [1 - s, v * s];
}

// ---- tables ----------------------------------------------------------------------------------

/** n × n spectra over (u, v), 81 samples each, [i(u)][j(v)][λ]; X + Y + Z ≈ 1 with k = 1/Σȳ. */
export interface SpectraTable { n: number; data: Float64Array; source: 'hanatos2025' | 'sigmoid-fit' | string }

/** A film's linear raw exposure per unit brightness over (u, v): n·n·3, [i][j][layer]. */
export interface FilmTable { n: number; raw: Float64Array; key: string }

/** IEEE half → number. */
export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/** The hanatos2025 table as CHB-004's pack serves it (F16 bits, [n][n][81]). */
export function spectraFromF16(t: { data: Uint16Array; shape: readonly number[] }): SpectraTable {
  const n = t.shape[0]!;
  const data = new Float64Array(t.data.length);
  for (let i = 0; i < data.length; i++) data[i] = halfToFloat(t.data[i]!);
  return { n, data, source: 'hanatos2025' };
}

/** spektrafilm's erf4 band-pass window W(λ) on the 81-point grid. params: (c_uv, σ_uv, c_ir, σ_ir) in nm. */
export function erf4Window(p: readonly [number, number, number, number]): Float64Array {
  const [cuv, suv, cir, sir] = p;
  const w = new Float64Array(NW);
  for (let i = 0; i < NW; i++) {
    const l = 380 + 5 * i;
    w[i] = 0.5 * (1 + erf((l - cuv) / (suv * Math.SQRT2))) * 0.5 * (1 - erf((l - cir) / (sir * Math.SQRT2)));
  }
  return w;
}

/** Window normalisers n_k = Σ S_k W E / Σ S_k E (the reference illuminant keeps its exposures). */
export function windowNormalisers(sens: readonly ArrayLike<number>[], window: ArrayLike<number>, ref: ArrayLike<number>): Vec3 {
  return [0, 1, 2].map((k) => {
    let a = 0, b = 0;
    for (let i = 0; i < NW; i++) {
      const s = sens[k]![i]! * ref[i]!;
      a += s * window[i]!;
      b += s;
    }
    return a / b;
  }) as Vec3;
}

// ---- input gamut compression (spektrafilm InputGamutCompressSpec: radial xy, knee (0, 1, 6)) ----

/** Closed CIE 1931 spectral locus polygon in xy, 380–700 nm at 5 nm, from the given CMFs on the grid. */
export function spectralLocus(cmf: readonly ArrayLike<number>[]): Float64Array {
  const m = 65; // 380 … 700 nm
  const out = new Float64Array((m + 1) * 2);
  for (let i = 0; i <= m; i++) {
    const k = i === m ? 0 : i;
    const X = cmf[0]![k]!, Y = cmf[1]![k]!, Z = cmf[2]![k]!;
    const s = Math.max(X + Y + Z, 1e-12);
    out[2 * i] = X / s;
    out[2 * i + 1] = Y / s;
  }
  return out;
}

/** Reinhard knee on a normalised distance: identity below t, asymptotic to `limit` (ACES RGC form). */
export function reinhardKnee(d: number, t: number, limit: number, p: number): number {
  if (!(d > t)) return d;
  const s = limit - t;
  const x = (d - t) / s;
  return t + s * (x / (1 + x ** p) ** (1 / p));
}

function rayPolygon(ox: number, oy: number, dx: number, dy: number, poly: Float64Array): number {
  let tMin = Infinity;
  for (let k = 0; k + 3 < poly.length; k += 2) {
    const ax = poly[k]!, ay = poly[k + 1]!;
    const ex = poly[k + 2]! - ax, ey = poly[k + 3]! - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) <= 1e-12) continue;
    const qx = ox - ax, qy = oy - ay;
    const t = (-qx * ey + qy * ex) / den;
    const s = (-qx * dy + qy * dx) / den;
    if (t > 1e-9 && s >= 0 && s <= 1 && t < tMin) tMin = t;
  }
  return tMin;
}

export interface GamutKnee { threshold: number; limit: number; power: number }
export const INPUT_GAMUT_KNEE: GamutKnee = Object.freeze({ threshold: 0, limit: 1, power: 6 });

/** Radial compression of xy toward the spectral locus about `white` (spektrafilm compress_xy_radial). */
export function compressXY(x: number, y: number, white: readonly [number, number], locus: Float64Array, k: GamutKnee = INPUT_GAMUT_KNEE): [number, number] {
  const dx = x - white[0], dy = y - white[1];
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-9) return [x, y];
  const ux = dx / dist, uy = dy / dist;
  const boundary = rayPolygon(white[0], white[1], ux, uy, locus);
  if (!Number.isFinite(boundary)) return [x, y];
  const dn = reinhardKnee(dist / Math.max(boundary, 1e-12), k.threshold, k.limit, k.power);
  return [white[0] + ux * dn * boundary, white[1] + uy * dn * boundary];
}

// ---- lookups -----------------------------------------------------------------------------------

/** Mitchell–Netravali weight, B = C = ⅓ (spektrafilm fast_interp_lut.mitchell_weight). */
export function mitchell(t: number, B = 1 / 3, C = 1 / 3): number {
  const x = Math.abs(t);
  if (x < 1) return ((12 - 9 * B - 6 * C) * x ** 3 + (-18 + 12 * B + 6 * C) * x ** 2 + (6 - 2 * B)) / 6;
  if (x < 2) return ((-B - 6 * C) * x ** 3 + (6 * B + 30 * C) * x ** 2 + (-12 * B - 48 * C) * x + (8 * B + 24 * C)) / 6;
  return 0;
}

const reflect = (i: number, n: number): number => (i < 0 ? -i : i >= n ? 2 * (n - 1) - i : i);
function baseFrac(c: number, n: number): [number, number] {
  const x = c <= 0 ? 0 : c >= n - 1 ? n - 1 : c;
  if (x >= n - 1) return [n - 2, 1];
  const b = Math.floor(x);
  return [b, x - b];
}

/** Cubic (Mitchell–Netravali) lookup of a c-channel n × n table at (u, v) ∈ [0, 1]² (apply_lut_cubic_2d). */
export function lookupCubic(t: { n: number; raw: Float64Array }, u: number, v: number, c = 3, out: Float64Array | number[] = new Float64Array(c)): typeof out {
  const n = t.n;
  const [xb, xf] = baseFrac(u * (n - 1), n);
  const [yb, yf] = baseFrac(v * (n - 1), n);
  const wx = [mitchell(xf + 1), mitchell(xf), mitchell(xf - 1), mitchell(xf - 2)];
  const wy = [mitchell(yf + 1), mitchell(yf), mitchell(yf - 1), mitchell(yf - 2)];
  for (let k = 0; k < c; k++) out[k] = 0;
  let ws = 0;
  for (let i = 0; i < 4; i++) {
    const xi = reflect(xb - 1 + i, n);
    for (let j = 0; j < 4; j++) {
      const yj = reflect(yb - 1 + j, n);
      const w = wx[i]! * wy[j]!;
      ws += w;
      const o = (xi * n + yj) * c;
      for (let k = 0; k < c; k++) out[k] = out[k]! + w * t.raw[o + k]!;
    }
  }
  if (ws !== 0) for (let k = 0; k < c; k++) out[k] = out[k]! / ws;
  return out;
}

/** Bilinear lookup with clamped coordinates (the GPU's model: node-centred, clamp to edge). */
export function lookupBilinear(t: { n: number; raw: Float64Array }, u: number, v: number, c = 3, out: Float64Array | number[] = new Float64Array(c)): typeof out {
  const n = t.n;
  const fx = Math.min(n - 1, Math.max(0, u * (n - 1)));
  const fy = Math.min(n - 1, Math.max(0, v * (n - 1)));
  const x0 = Math.min(n - 2, Math.floor(fx)), y0 = Math.min(n - 2, Math.floor(fy));
  const tx = fx - x0, ty = fy - y0;
  for (let k = 0; k < c; k++) {
    const a = t.raw[(x0 * n + y0) * c + k]!, b = t.raw[((x0 + 1) * n + y0) * c + k]!;
    const d = t.raw[(x0 * n + y0 + 1) * c + k]!, e = t.raw[((x0 + 1) * n + y0 + 1) * c + k]!;
    out[k] = (1 - tx) * ((1 - ty) * a + ty * d) + tx * ((1 - ty) * b + ty * e);
  }
  return out;
}

// ---- building ------------------------------------------------------------------------------------

export interface BuildFilmTableOptions {
  /** Film layer sensitivities (linear, missing → 0). */
  sens: readonly ArrayLike<number>[];
  /** erf4 window params, or null for bare sensitivities. */
  window: readonly [number, number, number, number] | null;
  /** The film's reference illuminant SPD on the grid (window renormalisation). */
  refIlluminant: ArrayLike<number>;
  /** Input gamut compression baked in about `refWhiteXY` (spektrafilm default on). */
  compress?: { refWhiteXY: readonly [number, number]; locus: Float64Array; knee?: GamutKnee } | null;
  key?: string;
}

/** raw_k(u, v) = Σ spectrum · S_k · W / n_k on the spectra grid, with the gamut compression baked in. */
export function buildFilmTable(spectra: SpectraTable, o: BuildFilmTableOptions): FilmTable {
  const n = spectra.n;
  const w = o.window ? erf4Window(o.window) : new Float64Array(NW).fill(1);
  const nk = o.window ? windowNormalisers(o.sens, w, o.refIlluminant) : [1, 1, 1];
  const S = [0, 1, 2].map((k) => Float64Array.from({ length: NW }, (_, i) => (o.sens[k]![i]! * w[i]!) / nk[k]!));
  const raw = new Float64Array(n * n * 3);
  for (let p = 0; p < n * n; p++) {
    const off = p * NW;
    for (let k = 0; k < 3; k++) {
      const s = S[k]!;
      let acc = 0;
      for (let i = 0; i < NW; i++) acc += spectra.data[off + i]! * s[i]!;
      raw[p * 3 + k] = acc;
    }
  }
  const t: FilmTable = { n, raw, key: o.key ?? `${spectra.source}:${n}` };
  return o.compress ? remapForCompression(t, o.compress.refWhiteXY, o.compress.locus, o.compress.knee) : t;
}

/** new[node] = old[tri2quad(compress(quad2tri(node)))], bilinear with clamped edges (remap_tc_lut_for_compression). */
export function remapForCompression(t: FilmTable, white: readonly [number, number], locus: Float64Array, k: GamutKnee = INPUT_GAMUT_KNEE): FilmTable {
  const n = t.n;
  const raw = new Float64Array(t.raw.length);
  const px = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const [x, y] = quad2tri(i / (n - 1), j / (n - 1));
      const [cx, cy] = compressXY(x, y, white, locus, k);
      const [u, v] = tri2quad(cx, cy);
      lookupBilinear(t, u, v, 3, px);
      raw.set(px, (i * n + j) * 3);
    }
  }
  return { n, raw, key: `${t.key}+gc` };
}

/** Filmbench's 64² table (log₂ raw, int16/1024 already decoded to floats by CHB-004) as a linear FilmTable. */
export function filmTableFromLog2(n: number, log2: ArrayLike<number>, key = 'filmbench-lut64'): FilmTable {
  const raw = new Float64Array(n * n * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = 2 ** log2[i]!;
  return { n, raw, key };
}

/** Resample a film table to n' nodes (cubic), e.g. 192 → 64 for the GPU. */
export function resampleFilmTable(t: FilmTable, n: number): FilmTable {
  const raw = new Float64Array(n * n * 3);
  const px = new Float64Array(3);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) raw.set(lookupCubic(t, i / (n - 1), j / (n - 1), 3, px) as Float64Array, (i * n + j) * 3);
  return { n, raw, key: `${t.key}@${n}` };
}

// ---- a fallback spectra table: sigmoid-quadratic irradiance spectra fitted per node ---------------

/**
 * When the hanatos2025 table is not available (it is an on-demand pack file, guide §9 risk), core
 * fits its own smooth spectra: f(λ) = S(c₀t² + c₁t + c₂), S(x) = ½ + x / (2√(1 + x²)), t = (λ − 380)/400,
 * the form of Jakob–Hanika and of hanatos' coefficients, solved per node for the chromaticity alone by
 * damped minimum-norm Gauss–Newton from c = 0 (warm-started from the previous node), then scaled to
 * X + Y + Z = 1. Not hanatos' choice within the one-parameter family of solutions: saturated colours
 * differ by up to ≈ 0.7 stops in a layer (diary, CHB-012 Step 17). Labelled 'sigmoid-fit'.
 */
export function sigmoidSpectraTable(cmf: readonly ArrayLike<number>[], n = 64): SpectraTable {
  const xb = Float64Array.from(cmf[0]!), yb = Float64Array.from(cmf[1]!), zb = Float64Array.from(cmf[2]!);
  const k = 1 / yb.reduce((a, b) => a + b, 0);
  // nodes beyond RMAX of the way from E to the locus are fitted at RMAX: a sigmoid-quadratic reaches
  // narrow-band chromaticities only with huge coefficients, and the baked-in gamut compression reads
  // the table at most ≈ 0.9 of the way out; the fallback therefore desaturates the last stretch
  const RMAX = 0.85;
  const locus = spectralLocus(cmf);
  const t = Float64Array.from({ length: NW }, (_, i) => (5 * i) / 400);
  const data = new Float64Array(n * n * NW);
  const spec = new Float64Array(NW);
  const J = new Float64Array(9);
  let X = 0, Y = 0, Z = 0;
  const eval3 = (c0: number, c1: number, c2: number, grad: boolean): void => {
    X = 0; Y = 0; Z = 0;
    if (grad) J.fill(0);
    for (let i = 0; i < NW; i++) {
      const ti = t[i]!;
      const x = (c0 * ti + c1) * ti + c2;
      const r = 1 / Math.sqrt(1 + x * x);
      const v = 0.5 + 0.5 * x * r;
      spec[i] = v;
      const xi = xb[i]!, yi = yb[i]!, zi = zb[i]!;
      X += v * xi; Y += v * yi; Z += v * zi;
      if (grad) {
        const d = 0.5 * r * r * r, g0 = ti * ti * d, g1 = ti * d;
        J[0]! += xi * g0; J[1]! += xi * g1; J[2]! += xi * d;
        J[3]! += yi * g0; J[4]! += yi * g1; J[5]! += yi * d;
        J[6]! += zi * g0; J[7]! += zi * g1; J[8]! += zi * d;
      }
    }
  };
  const a = new Float64Array(6);
  // damped minimum-norm Gauss–Newton on (x, y) − target; returns the residual norm, c updated in place
  const fit = (tx: number, ty: number, c: Float64Array): number => {
    eval3(c[0]!, c[1]!, c[2]!, false);
    let b = X + Y + Z, r0 = X / b - tx, r1 = Y / b - ty, rn = Math.hypot(r0, r1);
    for (let it = 0; it < 30 && rn > 1e-10; it++) {
      eval3(c[0]!, c[1]!, c[2]!, true);
      b = X + Y + Z;
      for (let m = 0; m < 3; m++) {
        const db = J[m]! + J[3 + m]! + J[6 + m]!;
        a[m] = (J[m]! * b - X * db) / (b * b);
        a[3 + m] = (J[3 + m]! * b - Y * db) / (b * b);
      }
      const A00 = a[0]! * a[0]! + a[1]! * a[1]! + a[2]! * a[2]!;
      const A01 = a[0]! * a[3]! + a[1]! * a[4]! + a[2]! * a[5]!;
      const A11 = a[3]! * a[3]! + a[4]! * a[4]! + a[5]! * a[5]!;
      const det = A00 * A11 - A01 * A01;
      if (!(Math.abs(det) > 1e-300)) break;
      const y0 = (-r0 * A11 + r1 * A01) / det, y1 = (r0 * A01 - r1 * A00) / det;
      const s0 = a[0]! * y0 + a[3]! * y1, s1 = a[1]! * y0 + a[4]! * y1, s2 = a[2]! * y0 + a[5]! * y1;
      let lam = 1, ok = false;
      for (; lam > 2e-3; lam /= 2) {
        eval3(c[0]! + lam * s0, c[1]! + lam * s1, c[2]! + lam * s2, false);
        const bb = X + Y + Z, q0 = X / bb - tx, q1 = Y / bb - ty, qn = Math.hypot(q0, q1);
        if (qn < rn) { r0 = q0; r1 = q1; rn = qn; ok = true; break; }
      }
      if (!ok) break;
      c[0]! += lam * s0; c[1]! += lam * s1; c[2]! += lam * s2;
    }
    return rn;
  };
  const warm = new Float64Array(3), c = new Float64Array(3), alt = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    c.set(warm);
    for (let j = 0; j < n; j++) {
      let [x, y] = quad2tri(i / (n - 1), j / (n - 1));
      const dx = x - 1 / 3, dy = y - 1 / 3, d = Math.hypot(dx, dy);
      if (d > 1e-9) {
        const bd = rayPolygon(1 / 3, 1 / 3, dx / d, dy / d, locus);
        if (Number.isFinite(bd) && d > RMAX * bd) { x = 1 / 3 + (dx / d) * RMAX * bd; y = 1 / 3 + (dy / d) * RMAX * bd; }
      }
      const r = fit(x, y, c);
      if (r > 1e-3) {
        alt.fill(0);
        if (fit(x, y, alt) < r) c.set(alt);
      }
      if (j === 0) warm.set(c);
      eval3(c[0]!, c[1]!, c[2]!, false);
      const s = 1 / (k * (X + Y + Z));
      const off = (i * n + j) * NW;
      for (let q = 0; q < NW; q++) data[off + q] = spec[q]! * s;
    }
  }
  return { n, data, source: 'sigmoid-fit' };
}
