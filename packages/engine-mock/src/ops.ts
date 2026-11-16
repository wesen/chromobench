// Mock maths for every catalog op. f64, deterministic, deliberately simple, but each formula moves
// in the same direction as the physics (more red light → more cyan print; longer time → darker).
// Formulas: CHB-002 guide §5.10.
import {
  blendSeparable, DOMAINS, encodingOfDomain, fail, lightH, LOGH_PER_POINT, maskCombine, mixPixel, mulberry32, NON_SEPARABLE_BLENDS, straighten,
  type BlendMode, type Box, type Cmy, type Domain, type ImageInfo, type LightTermSample, type Point, type Vec3,
} from '@chromobench/contract';

export interface Img {
  w: number;
  h: number;
  c: number;
  data: Float64Array;
}

export interface OpCtx {
  args: Readonly<Record<string, unknown>>;
  recv: Img | undefined;
  recvDomain: Domain | undefined;
  /** Images of node-typed args, in argument order. */
  extra: Img[];
  info: ImageInfo | undefined;
  /** Source images by sha256. */
  source(sha: string): Img;
  /** The definition of a node the engine knows (print.combine reads its flashes' print.expose args). */
  def?(id: string): { op: string; args: Readonly<Record<string, unknown>> } | undefined;
  /** The image of any node the engine knows (print.combine's terms, composite.mix's top, mask.combine's other). */
  image?(id: string): Img;
}

const imageOf = (ctx: OpCtx, id: string): Img => ctx.image?.(id) ?? fail('E_EVAL', `no image for node ${id.slice(0, 12)}…`);

export type ImageOp = (ctx: OpCtx) => Img;
export type ValueOp = (ctx: OpCtx) => Record<string, unknown>;

export const newImg = (w: number, h: number, c: number): Img => ({ w, h, c, data: new Float64Array(w * h * c) });

function map(src: Img, c: number, f: (px: number[], x: number, y: number) => number[]): Img {
  const out = newImg(src.w, src.h, c);
  const px: number[] = new Array(src.c);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = y * src.w + x;
      for (let k = 0; k < src.c; k++) px[k] = src.data[i * src.c + k]!;
      const r = f(px, x, y);
      for (let k = 0; k < c; k++) out.data[i * c + k] = r[k]!;
    }
  }
  return out;
}

const rgb3 = (px: number[]): number[] => (px.length >= 3 ? [px[0]!, px[1]!, px[2]!] : [px[0]!, px[0]!, px[0]!]);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// sRGB (D65) ↔ XYZ
export const M: number[][] = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];
function inv3(m: number[][]): number[][] {
  const [a, b, c] = m[0]!;
  const [d, e, f] = m[1]!;
  const [g, h, i] = m[2]!;
  const A = e! * i! - f! * h!, B = -(d! * i! - f! * g!), C = d! * h! - e! * g!;
  const det = a! * A + b! * B + c! * C;
  return [
    [A / det, -(b! * i! - c! * h!) / det, (b! * f! - c! * e!) / det],
    [B / det, (a! * i! - c! * g!) / det, -(a! * f! - c! * d!) / det],
    [C / det, -(a! * h! - b! * g!) / det, (a! * e! - b! * d!) / det],
  ];
}
export const MINV = inv3(M);
const mul = (m: number[][], v: number[]): number[] => m.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
export const srgbEncode = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const srgbDecode = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const WHITE_XYZ = mul(M, [1, 1, 1]);

// ---- the print chain, shared by print.* and darkroom.* -----------------------------------------
export interface PrintSettings { time_s: number; fstop: number; filtration: Cmy; lights: Vec3; grade: number }
export const DEFAULT_PRINT: PrintSettings = { time_s: 10, fstop: 8, filtration: { c: 0, m: 0, y: 0 }, lights: [0, 0, 0], grade: 2 };

export function exposeX(c: number[], s: Pick<PrintSettings, 'time_s' | 'fstop' | 'filtration'>): number[] {
  const f = [s.filtration.c, s.filtration.m, s.filtration.y];
  const base = Math.log10(s.time_s / 10) - 2 * Math.log10(s.fstop / 8);
  return [0, 1, 2].map((k) => -c[k]! + base - f[k]! / 100);
}
export const gammaOf = (grade: number): number => 1.5 * (0.6 + 0.2 * grade);
export const developA = (x: number[], grade: number): number[] => x.map((v) => clamp(0.8 + gammaOf(grade) * (v + 0.7), 0, 2.5));
export const reflectXYZ = (a: number[]): number[] => mul(M, a.map((v) => 10 ** -v));
function printPixel(c: number[], s: PrintSettings): number[] {
  const x = exposeX(c, s).map((v, k) => v + s.lights[k]!);
  return reflectXYZ(developA(x, s.grade));
}

// ---- scan helpers -------------------------------------------------------------------------------
function boxMean(img: Img, b: Box): number[] {
  const out = new Array(img.c).fill(0);
  let n = 0;
  for (let y = Math.max(0, b.y); y < Math.min(img.h, b.y + b.h); y++) {
    for (let x = Math.max(0, b.x); x < Math.min(img.w, b.x + b.w); x++) {
      for (let k = 0; k < img.c; k++) out[k] += img.data[(y * img.w + x) * img.c + k]!;
      n++;
    }
  }
  if (!n) fail('E_ARG_RANGE', 'box lies outside the image');
  return out.map((v) => v / n);
}

/** Automatic rebate: the brightest 5 % column band. */
function autoRebate(img: Img): Box {
  const lum = Array.from({ length: img.w }, (_, x) => {
    let s = 0;
    for (let y = 0; y < img.h; y++) for (let k = 0; k < img.c; k++) s += img.data[(y * img.w + x) * img.c + k]!;
    return { x, s };
  });
  const n = Math.max(1, Math.round(img.w * 0.05));
  const cols = lum.sort((a, b) => b.s - a.s || a.x - b.x).slice(0, n).map((c) => c.x).sort((a, b) => a - b);
  const x0 = cols[0]!;
  return { x: x0, y: 0, w: cols[cols.length - 1]! - x0 + 1, h: img.h };
}

const rebateOf = (img: Img, box: Box | undefined): { T: number[]; box: Box } => {
  const b = box ?? autoRebate(img);
  return { T: boxMean(img, b), box: b };
};

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i]!;
}

function channelValues(img: Img, k: number, box?: Box, mask?: Img): number[] {
  const b = box ?? { x: 0, y: 0, w: img.w, h: img.h };
  const out: number[] = [];
  for (let y = Math.max(0, b.y); y < Math.min(img.h, b.y + b.h); y++) {
    for (let x = Math.max(0, b.x); x < Math.min(img.w, b.x + b.w); x++) {
      if (mask && mask.data[y * mask.w + x]! < 0.5) continue;
      out.push(img.data[(y * img.w + x) * img.c + Math.min(k, img.c - 1)]!);
    }
  }
  return out;
}

function boxBlur(img: Img, r: number): Img {
  if (r <= 0) return img;
  const rad = Math.round(r);
  const out = newImg(img.w, img.h, img.c);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      for (let k = 0; k < img.c; k++) {
        let s = 0;
        let n = 0;
        for (let dy = -rad; dy <= rad; dy++) {
          const yy = clamp(y + dy, 0, img.h - 1);
          for (let dx = -rad; dx <= rad; dx++) {
            s += img.data[(yy * img.w + clamp(x + dx, 0, img.w - 1)) * img.c + k]!;
            n++;
          }
        }
        out.data[(y * img.w + x) * img.c + k] = s / n;
      }
    }
  }
  return out;
}

/** A hash of (x, y, seed) in [0, 1): grain independent of region and tiling. */
function hash01(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const A = (ctx: OpCtx, k: string): unknown => ctx.args[k];
const num = (ctx: OpCtx, k: string): number => ctx.args[k] as number;
const recv = (ctx: OpCtx): Img => ctx.recv ?? fail('E_INTERNAL', 'mock op without receiver');
const outC = (ctx: OpCtx): number => ctx.info?.channels ?? 3;

/** Identity with the right output channel count (pads with 0, or averages to one channel). */
function reshape(ctx: OpCtx): Img {
  const r = recv(ctx);
  const c = outC(ctx);
  return map(r, c, (px) => (c === 1 ? [px.slice(0, 3).reduce((s, v) => s + v, 0) / Math.min(3, px.length)] : Array.from({ length: c }, (_, k) => px[k] ?? 0)));
}

function orient(img: Img, o: string): Img {
  const swap = o === 'cw90' || o === 'ccw90' || o === 'transpose' || o === 'transverse';
  const w = swap ? img.h : img.w;
  const h = swap ? img.w : img.h;
  const out = newImg(w, h, img.c);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = x, sy = y;
      switch (o) {
        case 'cw90': sx = y; sy = img.h - 1 - x; break;
        case 'ccw90': sx = img.w - 1 - y; sy = x; break;
        case 'rot180': sx = img.w - 1 - x; sy = img.h - 1 - y; break;
        case 'flipH': sx = img.w - 1 - x; break;
        case 'flipV': sy = img.h - 1 - y; break;
        case 'transpose': sx = y; sy = x; break;
        case 'transverse': sx = img.w - 1 - y; sy = img.h - 1 - x; break;
        default: break;
      }
      for (let k = 0; k < img.c; k++) out.data[(y * w + x) * img.c + k] = img.data[(sy * img.w + sx) * img.c + k]!;
    }
  }
  return out;
}

function crop(img: Img, b: Box): Img {
  if (b.x < 0 || b.y < 0 || b.x + b.w > img.w || b.y + b.h > img.h) fail('E_ARG_RANGE', 'crop lies outside the frame', { valid: [`[0, 0, ${img.w}, ${img.h}]`] });
  const out = newImg(b.w, b.h, img.c);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) for (let k = 0; k < img.c; k++) out.data[(y * b.w + x) * img.c + k] = img.data[((y + b.y) * img.w + x + b.x) * img.c + k]!;
  return out;
}

interface MockStroke { points: number[][]; radius: number; hardness?: number; mode?: string }

/**
 * mask.paint (the same rule as core's paintMask, kept here because the mock cannot import core): each
 * stroke covers the pixels within `radius` of its polyline, 1 inside hardness·radius with a smoothstep
 * edge at least one pixel wide; `add` takes the maximum, `erase` multiplies by 1 − coverage.
 */
/** heal / clone: spots in order, each reading the image as the spots before it left it (contract 1.0). */
function repair(ctx: OpCtx, mode: 'heal' | 'clone'): Img {
  const spots = (A(ctx, 'spots') as { x: number; y: number; r: number; src: Point; feather: number; opacity: number }[]).filter((s) => s.r > 0 && s.opacity > 0);
  const src = recv(ctx);
  if (!spots.length) return src;
  const { w: W, h: H, c } = src;
  let cur = src.data;
  for (const s of spots) {
    const prev = cur;
    cur = prev.slice();
    const bil = (x: number, y: number, k: number): number => {
      const fx = clamp(x, 0.5, W - 0.5) - 0.5, fy = clamp(y, 0.5, H - 0.5) - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
      const at = (xx: number, yy: number): number => prev[(yy * W + xx) * c + k]!;
      return (1 - ty) * ((1 - tx) * at(x0, y0) + tx * at(x1, y0)) + ty * ((1 - tx) * at(x0, y1) + tx * at(x1, y1));
    };
    const gain = Array.from({ length: c }, (_, k) => {
      if (mode !== 'heal') return 1;
      let t = 0, q = 0;
      for (let i = 0; i < 32; i++) {
        const th = (2 * Math.PI * i) / 32, rho = s.r + 1.5;
        t += bil(s.x + rho * Math.cos(th), s.y + rho * Math.sin(th), k);
        q += bil(s.src.x + rho * Math.cos(th), s.src.y + rho * Math.sin(th), k);
      }
      return q > 0 ? t / q : 1;
    });
    for (let y = Math.max(0, Math.floor(s.y - s.r)); y < Math.min(H, Math.ceil(s.y + s.r)); y++) {
      for (let x = Math.max(0, Math.floor(s.x - s.r)); x < Math.min(W, Math.ceil(s.x + s.r)); x++) {
        const dx = x + 0.5 - s.x, dy = y + 0.5 - s.y, d = Math.hypot(dx, dy), inner = s.r * (1 - s.feather);
        if (d >= s.r) continue;
        const t = d <= inner ? 0 : (d - inner) / (s.r - inner);
        const a = s.opacity * (1 - t * t * (3 - 2 * t));
        for (let k = 0; k < c; k++) {
          const o = (y * W + x) * c + k;
          cur[o] = (1 - a) * prev[o]! + a * gain[k]! * bil(s.src.x + dx, s.src.y + dy, k);
        }
      }
    }
  }
  return { w: W, h: H, c, data: cur };
}

function paint(r: Img, strokes: readonly MockStroke[]): Img {
  const out = newImg(r.w, r.h, 1);
  for (const s of strokes) {
    const pts = s.points ?? [];
    if (!pts.length || !(s.radius > 0)) continue;
    const ew = Math.max((1 - (s.hardness ?? 0.5)) * s.radius, 1);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const X = x + 0.5, Y = y + 0.5;
        let d = Infinity;
        for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
          const a = pts[i]!, b = pts[Math.min(i + 1, pts.length - 1)]!;
          const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!;
          const l2 = dx * dx + dy * dy;
          const t = l2 > 0 ? clamp(((X - a[0]!) * dx + (Y - a[1]!) * dy) / l2, 0, 1) : 0;
          d = Math.min(d, Math.hypot(X - a[0]! - t * dx, Y - a[1]! - t * dy));
        }
        const t = clamp((s.radius - d) / ew, 0, 1);
        const c = t * t * (3 - 2 * t);
        const k = y * r.w + x;
        out.data[k] = s.mode === 'erase' ? out.data[k]! * (1 - c) : Math.max(out.data[k]!, c);
      }
    }
  }
  return out;
}

const norm = (v: number, d: Domain | undefined): number => {
  const [lo, hi] = DOMAINS[d ?? 'mask'].range;
  return (v - lo) / (hi - lo);
};

// ---- the digital layers (contract 1.1; CHB-037 P3b): the mock's own closed forms (core composite/*.ts is the
// reference). Working encodings of the mock: its stage XYZ (mul(M, rgb)), linear RGB, OkLab over that RGB.
const OK1 = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]];
const OK2 = [[0.2104542553, 0.793617785, -0.0040720468], [1.9779984951, -2.428592205, 0.4505937099], [0.0259040371, 0.7827717662, -0.808675766]];
const OK1I = inv3(OK1), OK2I = inv3(OK2);
const toOklab = (rgb: number[]): number[] => mul(OK2, mul(OK1, rgb).map(Math.cbrt));
const fromOklab = (lab: number[]): number[] => mul(OK1I, mul(OK2I, lab).map((v) => v * v * v));
type Enc = 'stage' | 'linear' | 'oklab';
const encOf = (d: Domain | undefined): Enc => (d ? encodingOfDomain(d)?.encoding : undefined) ?? 'stage';
const toLinear = (v: number[], e: Enc): number[] => (e === 'stage' ? mul(MINV, v) : e === 'oklab' ? fromOklab(v) : v);
const fromLinear = (v: number[], e: Enc): number[] => (e === 'stage' ? mul(M, v) : e === 'oklab' ? toOklab(v) : v);

/** A tone function on one channel: L of OkLab (0), or R, G, B of linear RGB on their cube roots (1–3). */
const tone = (px: number[], ch: string, f: (v: number) => number): number[] => {
  const k = ['L', 'R', 'G', 'B'].indexOf(ch);
  const o = rgb3(px);
  if (k <= 0) o[0] = f(o[0]!);
  else o[k - 1] = f(Math.cbrt(o[k - 1]!)) ** 3;
  return o;
};
/** The mock's curve: straight segments through the points (core's is a monotone cubic through the same points). */
function polyline(points: readonly { x: number; y: number }[]): (v: number) => number {
  const p = [...points].sort((a, b) => a.x - b.x);
  return (v) => {
    if (!p.length) return v;
    if (v <= p[0]!.x) return p[0]!.y + (v - p[0]!.x) * (p.length > 1 ? (p[1]!.y - p[0]!.y) / (p[1]!.x - p[0]!.x || 1) : 1);
    for (let i = 1; i < p.length; i++) if (v <= p[i]!.x) return p[i - 1]!.y + ((v - p[i - 1]!.x) * (p[i]!.y - p[i - 1]!.y)) / (p[i]!.x - p[i - 1]!.x || 1);
    const n = p.length;
    return p[n - 1]!.y + (v - p[n - 1]!.x) * (n > 1 ? (p[n - 1]!.y - p[n - 2]!.y) / (p[n - 1]!.x - p[n - 2]!.x || 1) : 1);
  };
}
const smoothstep = (e0: number, e1: number, x: number): number => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
/** B(b, s) of one pixel in encoding e: separable modes per channel in linear RGB (the contrast modes in the display encoding: contract blendSeparable), the others on OkLab's L and chroma. */
function blend(mode: BlendMode, b: number[], s: number[], e: Enc): number[] {
  if (mode === 'normal') return s;
  if (NON_SEPARABLE_BLENDS.includes(mode)) {
    const [lb, ls] = e === 'oklab' ? [b, s] : [toOklab(toLinear(b, e)), toOklab(toLinear(s, e))];
    const Cb = Math.hypot(lb[1]!, lb[2]!), Cs = Math.hypot(ls[1]!, ls[2]!);
    const r = mode === 'luminosity' ? [ls[0]!, lb[1]!, lb[2]!]
      : mode === 'colour' ? [lb[0]!, ls[1]!, ls[2]!]
      : mode === 'hue' ? (Cs > 0 ? [lb[0]!, (Cb * ls[1]!) / Cs, (Cb * ls[2]!) / Cs] : lb)
      : (Cb > 0 ? [lb[0]!, (Cs * lb[1]!) / Cb, (Cs * lb[2]!) / Cb] : lb);
    return e === 'oklab' ? r : fromLinear(fromOklab(r), e);
  }
  const bl = toLinear(b, e), sl = toLinear(s, e);
  return fromLinear([0, 1, 2].map((k) => blendSeparable(mode, bl[k]!, sl[k]!)), e);
}

export const IMAGE_OPS: Record<string, ImageOp> = {
  'source.open': (ctx) => {
    const img = ctx.source(A(ctx, 'source') as string);
    const enc = A(ctx, 'encoding');
    if (enc === 'linear') return img;
    return map(img, img.c, (px) => px.map((v) => (enc === 'srgb' ? srgbDecode(v) : v ** 2.2)));
  },
  'source.pattern': (ctx) => {
    const info = ctx.info!;
    const rng = mulberry32(num(ctx, 'seed'));
    const [lo, hi] = DOMAINS[info.domain].range;
    const out = newImg(info.width, info.height, info.channels);
    for (let i = 0; i < out.data.length; i++) out.data[i] = info.domain === 'scan-classes' ? Math.floor(rng.next() * 4) : lo + rng.next() * (hi - lo);
    return out;
  },
  'source.xyz': (ctx) => map(recv(ctx), 3, (px) => {
    const gain = A(ctx, 'mode') === 'custom' ? [1, 1, 6500 / num(ctx, 'temperature_K')] : [1, 1, 1];
    return mul(M, rgb3(px).map((v, k) => v * gain[k]!));
  }),
  'scan.flatField': (ctx) => {
    const r = recv(ctx);
    if (A(ctx, 'flat') === undefined) return r;
    const flat = ctx.source(A(ctx, 'flat') as string);
    if (flat.w !== r.w || flat.h !== r.h) fail('E_EVAL', 'flat field size differs from the source');
    return map(r, r.c, (px, x, y) => px.map((v, k) => v / Math.max(flat.data[(y * flat.w + x) * flat.c + Math.min(k, flat.c - 1)]!, 1e-8)));
  },
  'scan.flare': (ctx) => {
    // T = T′(1 + f) − f per channel, T′ relative to the open gate (contract 0.3; ingest removeFlareValue)
    const r = recv(ctx);
    const a = A(ctx, 'flare') as number | Vec3;
    const f = [0, 1, 2].map((k) => (Array.isArray(a) ? a[k]! : a) / 100);
    return map(r, r.c, (px) => px.map((v, k) => (k < 3 ? v * (1 + f[k]!) - f[k]! : v)));
  },
  'scan.density': (ctx) => {
    const r = recv(ctx);
    const base = A(ctx, 'baseT') as Vec3 | undefined;
    const T = base ?? rebateOf(r, A(ctx, 'rebate') as Box | undefined).T;
    return map(r, outC(ctx), (px) => Array.from({ length: outC(ctx) }, (_, k) => -Math.log10(Math.max(px[k] ?? 0, 1e-8) / T[Math.min(k, T.length - 1)]!)));
  },
  'scan.baseClass': (ctx) => map(recv(ctx), 1, (px) => {
    const m = Math.min(...rgb3(px));
    return [A(ctx, 'class') === 'below' ? (m < 0 ? 1 : 0) : Math.max(...rgb3(px).map(Math.abs)) < 0.02 ? 1 : 0];
  }),
  'scan.conditioning': (ctx) => map(recv(ctx), 1, () => [1]),
  'invert.dyes': (ctx) => map(recv(ctx), 4, (px) => [...rgb3(px), 0]),
  'invert.classes': (ctx) => map(recv(ctx), 1, (px) => {
    const c = rgb3(px);
    return [c.some((v) => v < -0.02) ? 2 : c.every((v) => Math.abs(v) < 0.02) ? 1 : c.some((v) => v > 3) ? 3 : 0];
  }),
  'capture.expose': (ctx) => map(recv(ctx), 3, (px) => mul(MINV, rgb3(px)).map((v) => Math.log10(Math.max(v, 1e-6) / 0.184) + num(ctx, 'exposureEV') * Math.log10(2))),
  'film.couple': (ctx) => recv(ctx),
  'film.halation': (ctx) => recv(ctx),
  'film.develop': (ctx) => map(recv(ctx), 3, (px) => rgb3(px).map((v) => clamp(0.687 + 0.6 * (v + num(ctx, 'push') * Math.log10(2)), 0, 3))),
  'film.grain': (ctx) => {
    const r = recv(ctx);
    const a = num(ctx, 'amount') * 0.01;
    const seed = num(ctx, 'seed');
    return map(r, r.c, (px, x, y) => px.map((v, k) => (k < 3 ? v + a * (hash01(x, y, seed * 3 + k) - 0.5) : v)));
  },
  'print.expose': (ctx) => map(recv(ctx), 3, (px) => exposeX(rgb3(px), { time_s: num(ctx, 'time_s'), fstop: num(ctx, 'fstop'), filtration: A(ctx, 'filtration') as Cmy })),
  'print.combine': (ctx) => {
    // the light law (contract 1.0): the contract's lightH per pixel; a flash is its print.expose evaluated uniformly
    // at dye amounts 0 (the mock's film has no base: open = base); the mock has no normalised-mode time ratio
    type Arg = Record<string, unknown>;
    const a = ctx.args;
    const list = (k: string): Arg[] => (a[k] as Arg[] | undefined) ?? [];
    const terms = list('terms'), dens = list('densities'), filters = list('filters'), pre = list('preflash');
    const img = (id: unknown): Img | undefined => (typeof id === 'string' ? imageOf(ctx, id) : undefined);
    const cover = (m: Img | undefined, i: number): number => (m ? m.data[i * m.c]! : 1);
    const tX = terms.map((t): Img | number[] => {
      const d = ctx.def?.(t['image'] as string);
      if (String(t['role']).startsWith('flash') && d?.op === 'print.expose') return exposeX([0, 0, 0], { time_s: d.args['time_s'] as number, fstop: d.args['fstop'] as number, filtration: d.args['filtration'] as Cmy });
      return img(t['image'])!;
    });
    const tM = terms.map((t) => img(t['mask'])), dI = dens.map((d) => img(d['image'])!), dM = dens.map((d) => img(d['mask']));
    const fM = filters.map((f) => img(f['mask'])), pM = pre.map((p) => img(p['mask']));
    const mainMask = img(a['mainMask']);
    const r = recv(ctx);
    const out = newImg(r.w, r.h, 3);
    const o = [0, 0, 0];
    for (let i = 0; i < r.w * r.h; i++) {
      lightH({
        xMain: rgb3(Array.from(r.data.subarray(i * r.c, i * r.c + r.c))), wMain: ((a['mainAmount'] as number | undefined) ?? 1) * cover(mainMask, i),
        terms: terms.map((t, j): LightTermSample => {
          const e = tX[j]!;
          return { role: t['role'] as LightTermSample['role'], x: Array.isArray(e) ? e : Array.from(e.data.subarray(i * e.c, i * e.c + 3)), w: (t['amount'] as number) * cover(tM[j], i) };
        }),
        densities: dens.map((d, j) => ({ d: dI[j]!.data[i * dI[j]!.c]!, w: (d['amount'] as number) * cover(dM[j], i) })),
        filters: filters.map((f, j) => ({ logH: f['logH'] as number[], w: (f['amount'] as number) * cover(fM[j], i) })),
        preflash: pre.map((p, j) => ({ fraction: p['fraction'] as number, w: (p['amount'] as number) * cover(pM[j], i) })),
      }, o);
      out.data.set(o, i * 3);
    }
    return out;
  },
  'print.develop': (ctx) => map(recv(ctx), 3, (px) => developA(rgb3(px), num(ctx, 'grade'))),
  'print.densityMask': (ctx) => {
    // d_m from the blurred mean transmittance 10^−PD, PD = −x in the mock (its clear film is x = 0); box blur of
    // radius_um over the film pitch (contract 1.0: the image must carry it, as in core)
    const r = recv(ctx);
    const a = num(ctx, 'gamma');
    if (a === 0) return newImg(r.w, r.h, 1);
    const pitch = ctx.info?.umPerPx.film ?? fail('E_EVAL', 'print.densityMask: the image has no film pitch (ImageInfo.umPerPx.film)');
    const T = map(r, 1, (px) => [rgb3(px).reduce((s, v) => s + 10 ** v, 0) / 3]);
    const Hm = boxBlur(T, num(ctx, 'radius_um') / pitch);
    let lo = Infinity, hi = -Infinity;
    for (const v of Hm.data) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const same = A(ctx, 'polarity') === 'same';
    return map(Hm, 1, (px) => [same ? a * (Math.log10(hi) - Math.log10(px[0]!)) : a * (Math.log10(px[0]!) - Math.log10(lo))]);
  },
  // CHB-022, contract 1.0: the mock's naive heal and clone (repair below; core print/retouch.ts is the reference)
  heal: (ctx) => repair(ctx, 'heal'),
  clone: (ctx) => repair(ctx, 'clone'),
  clarity: (ctx) => {
    // local contrast v + s·(v − blur(v)), box blur of radius_mm over the print pitch (core print/clarity.ts is the reference)
    const r = recv(ctx);
    const a = num(ctx, 'strength');
    if (a === 0) return r;
    const pitch = ctx.info?.umPerPx.paper ?? fail('E_EVAL', 'clarity: the image has no print pitch (ImageInfo.umPerPx.paper)');
    const blur = boxBlur(r, (num(ctx, 'radius_mm') * 1000) / pitch);
    return map(r, r.c, (px, x, y) => px.map((v, k) => v + a * (v - blur.data[(y * r.w + x) * r.c + k]!)));
  },
  'composite.mix': (ctx) => {
    // the composite law per entry (contract 1.1): mixPixel(back, B(back, top), amount · mask) in the shared encoding
    const back = recv(ctx);
    const top = imageOf(ctx, A(ctx, 'top') as string);
    const m = A(ctx, 'mask') === undefined ? undefined : imageOf(ctx, A(ctx, 'mask') as string);
    const amount = num(ctx, 'amount');
    const mode = ((A(ctx, 'blend') as BlendMode | undefined) ?? 'normal');
    const e = encOf(ctx.recvDomain);
    if (mode !== 'normal' && e === 'stage') fail('E_DOMAIN', `composite.mix: the blend ${mode} needs a working encoding (rgb or oklab), not ${ctx.recvDomain}`);
    return map(back, back.c, (px, x, y) => {
      const t = Array.from({ length: back.c }, (_, k) => top.data[(y * top.w + x) * top.c + k]!);
      const B = mode === 'normal' ? t : [...blend(mode, rgb3(px), rgb3(t), e), ...t.slice(3)];
      return px.map((v, k) => mixPixel(v, B[k]!, amount * (m ? m.data[y * m.w + x]! : 1)));
    });
  },
  'composite.encode': (ctx) => {
    const from = encOf(ctx.recvDomain), to = encOf(A(ctx, 'to') as Domain);
    return map(recv(ctx), 3, (px) => fromLinear(toLinear(rgb3(px), from), to));
  },
  exposure: (ctx) => {
    const g = 2 ** num(ctx, 'stops'), off = num(ctx, 'offset');
    return map(recv(ctx), 3, (px) => rgb3(px).map((v) => v * g + off));
  },
  curve: (ctx) => {
    const f = polyline(A(ctx, 'points') as { x: number; y: number }[]);
    return map(recv(ctx), 3, (px) => tone(px, A(ctx, 'channel') as string, f));
  },
  levels: (ctx) => {
    const [b, w, g, ob, ow] = ['black', 'white', 'gamma', 'outBlack', 'outWhite'].map((k) => num(ctx, k)) as [number, number, number, number, number];
    const f = (v: number): number => { const t = (v - b) / (w - b); return ob + (ow - ob) * (t <= 0 || t >= 1 ? t : t ** (1 / g)); };
    return map(recv(ctx), 3, (px) => tone(px, A(ctx, 'channel') as string, f));
  },
  // hsl and grade: pass-throughs (the mock does not model hue bands or wheels; at their identity params they are exact)
  hsl: (ctx) => map(recv(ctx), 3, rgb3),
  grade: (ctx) => map(recv(ctx), 3, rgb3),
  vibrance: (ctx) => {
    // chroma gain: vibrance weighted towards low chroma, saturation uniform (core vibranceGain)
    const v = num(ctx, 'vibrance'), sat = num(ctx, 'saturation');
    return map(recv(ctx), 3, (px) => {
      const C = Math.hypot(px[1]!, px[2]!), u = 1 - C / 0.3;
      const g = (C < 0.3 ? 1 + v * u * u : 1) * (1 + sat);
      return [px[0]!, px[1]! * g, px[2]! * g];
    });
  },
  mixer: (ctx) => {
    const g = A(ctx, 'grey') as number[] | undefined;
    const Mx = A(ctx, 'monochrome') && g ? [g, g, g] : [A(ctx, 'red'), A(ctx, 'green'), A(ctx, 'blue')] as number[][];
    return map(recv(ctx), 3, (px) => mul(Mx, rgb3(px)));
  },
  vignette: (ctx) => {
    const r = recv(ctx);
    const stops = num(ctx, 'stops'), size = num(ctx, 'size'), feather = num(ctx, 'feather');
    const e1 = size + feather * (1 - size);
    return map(r, 3, (px, x, y) => {
      const dx = (x + 0.5 - r.w / 2) / (r.w / 2), dy = (y + 0.5 - r.h / 2) / (r.h / 2);
      const rho = Math.sqrt((dx * dx + dy * dy) / 2);
      const t = e1 - size > 1e-6 ? smoothstep(size, e1, rho) : rho >= size ? 1 : 0;
      return rgb3(px).map((v) => v * 2 ** (stops * t));
    });
  },
  sharpen: (ctx) => {
    // the mock's clarity (an unsharp mask with a box blur) at the sharpen radius
    const r = recv(ctx);
    const a = num(ctx, 'strength');
    if (a === 0) return r;
    const pitch = ctx.info?.umPerPx.paper ?? fail('E_EVAL', 'sharpen: the image has no print pitch (ImageInfo.umPerPx.paper)');
    const blur = boxBlur(r, (num(ctx, 'radius_mm') * 1000) / pitch);
    return map(r, r.c, (px, x, y) => px.map((v, k) => v + a * (v - blur.data[(y * r.w + x) * r.c + k]!)));
  },
  'view.reflect': (ctx) => map(recv(ctx), 3, (px) => reflectXYZ(rgb3(px))),
  'view.flare': (ctx) => {
    const f = num(ctx, 'flare') / 100;
    return map(recv(ctx), 3, (px) => rgb3(px).map((v, k) => v + f * WHITE_XYZ[k]!));
  },
  'view.adapt': (ctx) => recv(ctx),
  'view.inspect': (ctx) => map(recv(ctx), 3, (px) => {
    if (A(ctx, 'mode') === 'classes') return [px[0]! / 3, px[0]! / 3, px[0]! / 3];
    return rgb3(px).map((v) => srgbEncode(clamp(norm(v, ctx.recvDomain), 0, 1)));
  }),
  'output.display': (ctx) => map(recv(ctx), 3, (px) => mul(MINV, rgb3(px)).map((v) => srgbEncode(clamp(v, 0, 1)))),
  'output.frame': (ctx) => {
    const src = recv(ctx);
    const c = A(ctx, 'crop') as Box | undefined;
    const angle = (A(ctx, 'angle_deg') as number | undefined) ?? 0;
    const o = A(ctx, 'orientation') as string;
    if (angle !== 0) {
      // straighten: the crop's content turned about its centre (the contract's reference sampling)
      const b = c ?? { x: 0, y: 0, w: src.w, h: src.h };
      const data = straighten(src.data, src.w, src.h, src.c, { x: 0, y: 0 }, src.w, src.h, b, angle, o);
      return orient({ w: b.w, h: b.h, c: src.c, data }, o);
    }
    const r = c ? crop(src, c) : src;
    return orient(r, o);
  },
  'mask.luminance': (ctx) => map(recv(ctx), 1, (px) => {
    // above ≤ 0 / below ≥ 1 leave that side open (core's rule: compile's whole-frame mask stays 1 off-range)
    const L = norm(rgb3(px).reduce((s, v) => s + v, 0) / 3, ctx.recvDomain);
    const s = Math.max(num(ctx, 'softness'), 1e-9);
    const up = num(ctx, 'above') <= 0 ? 1 : clamp((L - num(ctx, 'above')) / s + 0.5, 0, 1);
    const down = num(ctx, 'below') >= 1 ? 1 : clamp((num(ctx, 'below') - L) / s + 0.5, 0, 1);
    return [Math.min(up, down)];
  }),
  'mask.linear': (ctx) => {
    const f = A(ctx, 'from') as Point;
    const t = A(ctx, 'to') as Point;
    const dx = t.x - f.x, dy = t.y - f.y;
    const len2 = dx * dx + dy * dy || 1;
    // at pixel centres, as core and the GPU
    return map(recv(ctx), 1, (_, x, y) => [clamp(1 - ((x + 0.5 - f.x) * dx + (y + 0.5 - f.y) * dy) / len2, 0, 1)]);
  },
  'mask.ellipse': (ctx) => {
    const b = A(ctx, 'box') as Box;
    const t = ((ctx.args['angle_deg'] as number | undefined) ?? 0) * (Math.PI / 180);
    const [cos, sin] = [Math.cos(t), Math.sin(t)];
    return map(recv(ctx), 1, (_, x, y) => {
      // rotate the pixel into the box frame (the box is the ellipse before rotation about its centre)
      const dx = x + 0.5 - (b.x + b.w / 2);
      const dy = y + 0.5 - (b.y + b.h / 2);
      const u = (cos * dx + sin * dy) / (b.w / 2);
      const v = (-sin * dx + cos * dy) / (b.h / 2);
      return [u * u + v * v <= 1 ? 1 : 0];
    });
  },
  // structured strokes (contract 1.0): round brushes along each polyline, as core's paintMask (CHB-010)
  'mask.radial': (ctx) => {
    // the rotated ellipse inscribed in the box: 1 inside 1 − feather, smoothstep down to 0 at its edge
    const b = A(ctx, 'box') as Box;
    const t = num(ctx, 'angle_deg') * (Math.PI / 180), f = num(ctx, 'feather');
    const [cos, sin] = [Math.cos(t), Math.sin(t)];
    return map(recv(ctx), 1, (_, x, y) => {
      const dx = x + 0.5 - (b.x + b.w / 2), dy = y + 0.5 - (b.y + b.h / 2);
      const d = Math.hypot((cos * dx + sin * dy) / Math.max(b.w / 2, 1e-9), (-sin * dx + cos * dy) / Math.max(b.h / 2, 1e-9));
      return [d <= 1 - f ? 1 : 1 - smoothstep(1 - f, 1 - f + Math.max(1e-4, f), d)];
    });
  },
  'mask.colour': (ctx) => {
    // OkLab distance from the sample: 1 within the tolerance, smoothstep to 0 over the softness
    const ref = A(ctx, 'colour') as number[];
    const tol = num(ctx, 'tolerance'), soft = num(ctx, 'softness');
    return map(recv(ctx), 1, (px) => {
      const d = Math.hypot(px[0]! - ref[0]!, px[1]! - ref[1]!, px[2]! - ref[2]!);
      return [d <= tol ? 1 : soft > 0 ? 1 - smoothstep(tol, tol + soft, d) : 0];
    });
  },
  'mask.paint': (ctx) => paint(recv(ctx), A(ctx, 'strokes') as MockStroke[]),
  'mask.feather': (ctx) => boxBlur(recv(ctx), num(ctx, 'radius_px') / 2),
  'mask.constant': (ctx) => map(recv(ctx), 1, () => [num(ctx, 'value')]),
  'mask.combine': (ctx) => {
    const o = imageOf(ctx, A(ctx, 'other') as string);
    const mode = A(ctx, 'mode') as 'add' | 'subtract' | 'intersect';
    return map(recv(ctx), 1, (px, x, y) => [maskCombine(mode, px[0]!, o.data[y * o.w + x]!, num(ctx, 'amount'))]);
  },
  'mask.invert': (ctx) => map(recv(ctx), 1, (px) => [1 - px[0]!]),
  'darkroom.testStrip': (ctx) => {
    const r = recv(ctx);
    const steps = num(ctx, 'steps');
    const step = num(ctx, 'step');
    const vary = A(ctx, 'vary') as string;
    const vertical = A(ctx, 'direction') === 'vertical';
    return map(r, 3, (px, x, y) => {
      const band = Math.min(steps - 1, Math.floor(((vertical ? x : y) * steps) / (vertical ? r.w : r.h)));
      const o = (band - (steps - 1) / 2) * step;
      const s: PrintSettings = { ...DEFAULT_PRINT, filtration: { ...DEFAULT_PRINT.filtration }, lights: [0, 0, 0] };
      if (vary === 'time') s.time_s = 10 * 2 ** o;
      else if (vary === 'grade') s.grade = clamp(2 + o, 0, 5);
      else if (vary.startsWith('lights.')) s.lights['rgb'.indexOf(vary.slice(-1))] = o * 0.025;
      // filtration is a signed shift on the neutral pack (contract 0.2): bands step it around 0, as the studio labels them
      else s.filtration[vary.slice(-1) as keyof Cmy] = o;
      return printPixel(rgb3(px), s);
    });
  },
  'darkroom.ringAround': (ctx) => {
    // Printer lights in points (contract 0.2): cells +Y +R +M / +G current +B / −1 step +C +1 step.
    // A colour cell moves the lights by (v − mean v)·1.5·step, so its dominant component is the step.
    const r = recv(ctx);
    const st = num(ctx, 'step_pt') * LOGH_PER_POINT;
    const dir = (v: Vec3): Vec3 => { const m = (v[0] + v[1] + v[2]) / 3; return v.map((x) => (x - m) * 1.5 * st) as Vec3; };
    const cells: Vec3[] = [dir([0, 0, 1]), dir([0, 1, 1]), dir([0, 1, 0]), dir([1, 0, 1]), [0, 0, 0], dir([1, 1, 0]), [-st, -st, -st], dir([1, 0, 0]), [st, st, st]];
    return map(r, 3, (px, x, y) => {
      const cell = Math.min(2, Math.floor((y * 3) / r.h)) * 3 + Math.min(2, Math.floor((x * 3) / r.w));
      return printPixel(rgb3(px), { ...DEFAULT_PRINT, lights: cells[cell]! });
    });
  },
  'darkroom.contactSheet': (ctx) => {
    const info = ctx.info!;
    const out = newImg(info.width, info.height, 3);
    out.data.fill(0.18);
    return out;
  },
};

function statsOf(img: Img, domain: Domain | undefined, box?: Box, mask?: Img): Record<string, unknown> {
  const [lo, hi] = DOMAINS[domain ?? 'mask'].range;
  const mean: number[] = [], p01: number[] = [], p99: number[] = [];
  let low = 0, high = 0, n = 0;
  for (let k = 0; k < 3; k++) {
    const vals = channelValues(img, k, box, mask);
    const s = [...vals].sort((a, b) => a - b);
    mean.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
    p01.push(percentile(s, 0.01));
    p99.push(percentile(s, 0.99));
    if (k < img.c) {
      low += vals.filter((v) => v <= lo).length;
      high += vals.filter((v) => v >= hi).length;
      n += vals.length;
    }
  }
  return { mean, p01, p99, clipLow: n ? low / n : 0, clipHigh: n ? high / n : 0 };
}

export const VALUE_OPS: Record<string, ValueOp> = {
  'source.info': (ctx) => {
    const r = recv(ctx);
    return { width: r.w, height: r.h, bits: 16, encoding: 'linear', sha256: String(ctx.args['__source'] ?? '') };
  },
  'scan.rebate': (ctx) => {
    const { T, box } = rebateOf(recv(ctx), A(ctx, 'rebate') as Box | undefined);
    return { T: rgb3(T), box };
  },
  'scan.noise': (ctx) => {
    const r = recv(ctx);
    const sigma = [0, 1, 2].map((k) => {
      const v = channelValues(r, k, A(ctx, 'box') as Box | undefined);
      const m = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
      return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length));
    });
    return { sigma };
  },
  'scan.rankStocks': () => ({ ranking: [{ stock: 'kodak_portra_400', score: 1 }] }),
  'scan.specks': () => ({ count: 0, regions: [] }),
  'scan.checkDust': () => ({ count: 0, coverage: 0 }),
  'invert.classify': (ctx) => {
    const r = recv(ctx);
    let reach = 0, blank = 0, below = 0, unreach = 0;
    const n = r.w * r.h;
    for (let i = 0; i < n; i++) {
      const c = [r.data[i * r.c]!, r.data[i * r.c + 1]!, r.data[i * r.c + 2]!];
      if (c.some((v) => v < -0.02)) below++;
      else if (c.every((v) => Math.abs(v) < 0.02)) blank++;
      else if (c.some((v) => v > 3)) unreach++;
      else reach++;
    }
    return { reachable: reach / n, blank: blank / n, belowBase: below / n, unreachable: unreach / n };
  },
  'measure.stats': (ctx) => statsOf(recv(ctx), ctx.recvDomain, A(ctx, 'box') as Box | undefined, ctx.extra[0]),
  'measure.histogram': (ctx) => {
    const r = recv(ctx);
    const bins = num(ctx, 'bins');
    const [lo, hi] = DOMAINS[ctx.recvDomain ?? 'mask'].range;
    const ch = A(ctx, 'channel') as string;
    const vals = ch === 'L' ? channelValues(r, 0).map((_, i) => [0, 1, 2].reduce((s, k) => s + channelValues(r, k)[i]!, 0) / 3) : channelValues(r, 'rgb'.indexOf(ch));
    const counts = new Array(bins).fill(0);
    for (const v of vals) counts[clamp(Math.floor(((v - lo) / (hi - lo)) * bins), 0, bins - 1)]++;
    return { edges: Array.from({ length: bins + 1 }, (_, i) => lo + ((hi - lo) * i) / bins), counts };
  },
  'measure.densitometer': (ctx) => {
    const r = recv(ctx);
    const at = A(ctx, 'at') as Point;
    const rad = num(ctx, 'aperture_px') / 2;
    const acc = [0, 0, 0];
    let n = 0;
    for (let y = Math.floor(at.y - rad); y <= Math.ceil(at.y + rad); y++) {
      for (let x = Math.floor(at.x - rad); x <= Math.ceil(at.x + rad); x++) {
        if (x < 0 || y < 0 || x >= r.w || y >= r.h || (x - at.x) ** 2 + (y - at.y) ** 2 > rad * rad + 1e-9) continue;
        for (let k = 0; k < 3; k++) acc[k]! += r.data[(y * r.w + x) * r.c + Math.min(k, r.c - 1)]!;
        n++;
      }
    }
    if (!n) fail('E_ARG_RANGE', 'densitometer aperture lies outside the image');
    const mean = acc.map((v) => v / n);
    if (ctx.recvDomain === 'print-xyz') {
      const R = mul(MINV, mean);
      return { D: R.map((v) => -Math.log10(Math.max(v, 1e-8))), visual: -Math.log10(Math.max(mean[1]!, 1e-8)) };
    }
    return { D: mean };
  },
  'measure.patches': (ctx) => {
    const r = recv(ctx);
    const b = (A(ctx, 'box') as Box | undefined) ?? { x: 0, y: 0, w: r.w, h: r.h };
    const cols = num(ctx, 'cols'), rows = num(ctx, 'rows');
    const cells = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const cb = { x: b.x + Math.floor((i * b.w) / cols), y: b.y + Math.floor((j * b.h) / rows), w: Math.max(1, Math.floor(b.w / cols)), h: Math.max(1, Math.floor(b.h / rows)) };
        const D = rgb3(boxMean(r, cb));
        cells.push({ cell: j * cols + i, D, visual: (D[0]! + D[1]! + D[2]!) / 3 });
      }
    }
    return { cells };
  },
  'darkroom.lightsToFiltration': (ctx) => {
    const l = A(ctx, 'logH') as Vec3;
    const top = Math.max(...l);
    return { filtration: { c: 100 * (top - l[0]), m: 100 * (top - l[1]), y: 100 * (top - l[2]) }, time_s: num(ctx, 'time_s') ?? 10, stops: 0, lights: [0, 0, 0], residual: 0 };
  },
  'output.encode': (ctx) => {
    const r = recv(ctx);
    const f = A(ctx, 'format') as string;
    const bps = f.endsWith('16') ? 2 : 1;
    return {
      format: f, name: `export.${f.replace(/\d+$/, '')}`, bytes: r.w * r.h * 3 * bps, sha256: '0'.repeat(64),
      mime: f.startsWith('png') ? 'image/png' : f === 'jpeg' ? 'image/jpeg' : 'image/tiff', width: r.w, height: r.h, bits: 8 * bps, space: 'srgb', iccSha256: '', documentSha256: '',
    };
  },
};
