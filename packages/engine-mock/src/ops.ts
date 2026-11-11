// Mock maths for every catalog op. f64, deterministic, deliberately simple, but each formula moves
// in the same direction as the physics (more red light → more cyan print; longer time → darker).
// Formulas: CHB-002 guide §5.10.
import { DOMAINS, fail, mulberry32, type Box, type Cmy, type Domain, type ImageInfo, type Point, type Vec3 } from '@chromobench/contract';

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
}

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

const norm = (v: number, d: Domain | undefined): number => {
  const [lo, hi] = DOMAINS[d ?? 'mask'].range;
  return (v - lo) / (hi - lo);
};

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
    const r = recv(ctx);
    const mean = boxMean(r, { x: 0, y: 0, w: r.w, h: r.h });
    const f = num(ctx, 'flare') / 100;
    return map(r, r.c, (px) => px.map((v, k) => Math.max(0, v - f * mean[k]!)));
  },
  'scan.density': (ctx) => {
    const r = recv(ctx);
    const { T } = rebateOf(r, A(ctx, 'rebate') as Box | undefined);
    return map(r, outC(ctx), (px) => Array.from({ length: outC(ctx) }, (_, k) => -Math.log10(Math.max(px[k] ?? 0, 1e-8) / T[Math.min(k, T.length - 1)]!)));
  },
  'scan.baseClass': (ctx) => map(recv(ctx), 1, (px) => {
    const m = Math.min(...rgb3(px));
    return [A(ctx, 'class') === 'below' ? (m < 0 ? 1 : 0) : Math.max(...rgb3(px).map(Math.abs)) < 0.02 ? 1 : 0];
  }),
  'scan.conditioning': (ctx) => map(recv(ctx), 1, () => [1]),
  'scan.heal': (ctx) => recv(ctx),
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
  'print.lights': (ctx) => {
    const l = A(ctx, 'logH') as Vec3;
    return map(recv(ctx), 3, (px) => rgb3(px).map((v, k) => v + l[k]!));
  },
  'print.preflash': (ctx) => map(recv(ctx), 3, (px) => rgb3(px).map((v) => Math.log10(10 ** v + num(ctx, 'amount')))),
  'print.combine': (ctx) => {
    const exps = (A(ctx, 'exposures') as string[]).length;
    const modes = A(ctx, 'modes') as string[];
    const r = recv(ctx);
    return map(r, 3, (px, x, y) => rgb3(px).map((v, k) => {
      let H = 10 ** v;
      for (let i = 0; i < exps; i++) {
        const e = ctx.extra[i]!;
        const m = ctx.extra[exps + i]!;
        const w = m.data[y * m.w + x]!;
        H += (modes[i] === 'subtract' ? -1 : 1) * w * 10 ** e.data[(y * e.w + x) * e.c + k]!;
      }
      return Math.log10(Math.max(H, 1e-8));
    }));
  },
  'print.develop': (ctx) => map(recv(ctx), 3, (px) => developA(rgb3(px), num(ctx, 'grade'))),
  'print.densityMask': (ctx) => {
    const r = recv(ctx);
    const a = num(ctx, 'amount');
    if (a === 0) return r;
    const blur = boxBlur(r, 4);
    return map(r, r.c, (px, x, y) => px.map((v, k) => v - a * (blur.data[(y * r.w + x) * r.c + k]! - v)));
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
    const c = A(ctx, 'crop') as Box | undefined;
    const r = c ? crop(recv(ctx), c) : recv(ctx);
    return orient(r, A(ctx, 'orientation') as string);
  },
  'mask.luminance': (ctx) => map(recv(ctx), 1, (px) => {
    const L = norm(rgb3(px).reduce((s, v) => s + v, 0) / 3, ctx.recvDomain);
    const s = Math.max(num(ctx, 'softness'), 1e-9);
    const up = clamp((L - num(ctx, 'above')) / s + 0.5, 0, 1);
    const down = clamp((num(ctx, 'below') - L) / s + 0.5, 0, 1);
    return [Math.min(up, down)];
  }),
  'mask.gradient': (ctx) => {
    const f = A(ctx, 'from') as Point;
    const t = A(ctx, 'to') as Point;
    const dx = t.x - f.x, dy = t.y - f.y;
    const len2 = dx * dx + dy * dy || 1;
    return map(recv(ctx), 1, (_, x, y) => [clamp(1 - ((x - f.x) * dx + (y - f.y) * dy) / len2, 0, 1)]);
  },
  'mask.ellipse': (ctx) => {
    const b = A(ctx, 'box') as Box;
    return map(recv(ctx), 1, (_, x, y) => {
      const u = (x + 0.5 - (b.x + b.w / 2)) / (b.w / 2);
      const v = (y + 0.5 - (b.y + b.h / 2)) / (b.h / 2);
      return [u * u + v * v <= 1 ? 1 : 0];
    });
  },
  'mask.paint': (ctx) => map(recv(ctx), 1, () => [0]),
  'mask.feather': (ctx) => boxBlur(recv(ctx), num(ctx, 'radius_px') / 2),
  'mask.and': (ctx) => map(recv(ctx), 1, (px, x, y) => [Math.min(px[0]!, ctx.extra[0]!.data[y * ctx.extra[0]!.w + x]!)]),
  'mask.or': (ctx) => map(recv(ctx), 1, (px, x, y) => [Math.max(px[0]!, ctx.extra[0]!.data[y * ctx.extra[0]!.w + x]!)]),
  'mask.not': (ctx) => map(recv(ctx), 1, (px) => [1 - px[0]!]),
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
      else s.filtration[vary.slice(-1) as keyof Cmy] = band * step;
      return printPixel(rgb3(px), s);
    });
  },
  'darkroom.ringAround': (ctx) => {
    const r = recv(ctx);
    const st = num(ctx, 'step_cc');
    const deltas: [number, number, number][] = [[st, 0, 0], [0, st, 0], [0, 0, st], [0, 0, 0], [0, 0, 0], [st, st, 0], [0, st, st], [st, 0, st], [0, 0, 0]];
    return map(r, 3, (px, x, y) => {
      const cell = Math.min(2, Math.floor((y * 3) / r.h)) * 3 + Math.min(2, Math.floor((x * 3) / r.w));
      const d = deltas[cell]!;
      return printPixel(rgb3(px), { ...DEFAULT_PRINT, filtration: { c: d[0], m: d[1], y: d[2] } });
    });
  },
  'darkroom.contactSheet': (ctx) => {
    const info = ctx.info!;
    const out = newImg(info.width, info.height, 3);
    out.data.fill(0.18);
    return out;
  },
  'finishing.clarity': (ctx) => {
    const r = recv(ctx);
    const a = num(ctx, 'amount');
    if (a === 0) return r;
    const blur = boxBlur(r, num(ctx, 'radius_px') / 8);
    return map(r, r.c, (px, x, y) => px.map((v, k) => v + a * (v - blur.data[(y * r.w + x) * r.c + k]!)));
  },
  'finishing.hue': (ctx) => recv(ctx),
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
    return { filtration: { c: 100 * (top - l[0]), m: 100 * (top - l[1]), y: 100 * (top - l[2]) }, residual: 0 };
  },
  'output.encode': (ctx) => {
    const r = recv(ctx);
    const f = A(ctx, 'format') as string;
    const bps = f.endsWith('16') ? 2 : 1;
    return { format: f, name: `export.${f.replace(/\d+$/, '')}`, bytes: r.w * r.h * 3 * bps, sha256: '0'.repeat(64) };
  },
};
