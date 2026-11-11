// Op adapters for the reference engine (guide §5.7): one per catalog op CHB-003 owns, applying core's
// pure functions to f64 images. Upstream context (stock, paper, viewing light) is found by walking the
// node's inputs (`ctx.up`), because a pointwise op's own args do not name it.
import { DOMAINS, fail, mulberry32, type Box, type Cmy, type Domain, type ImageInfo, type Point } from '@chromobench/contract';
import type { PhysicsData } from '../data/provider.ts';
import { makePrintChain, type Aim, type OutputSpace, type PrintChain } from '../print/chain.ts';
import { adaptBradford, addFlare, D50, D65, observe, paperWhiteXYZ, reflectance, whiteXYZ, type Viewing } from '../print/colour.ts';
import { DEFAULT_COMPRESS, type CompressSpec } from '../print/gamut.ts';
import { displayEncode } from '../print/chain.ts';
import { gradeToGamma, paperDeveloper } from '../print/paper.ts';
import { CLASS_CODE, classify } from '../scan/classify.ts';
import { makeScanner } from '../scan/scanner.ts';
import { makeForward, solveDyes, type ForwardModel } from '../scan/solve.ts';
import { statusM } from '../spectral/channels.ts';
import type { Conventions } from '../spectral/conventions.ts';
import type { Vec3 } from '../spectral/linalg.ts';
import { resolveStock, type Stock } from '../spectral/stock.ts';

export interface Img { w: number; h: number; c: number; data: Float64Array }
export const newImg = (w: number, h: number, c: number): Img => ({ w, h, c, data: new Float64Array(w * h * c) });

export interface UpNode { op: string; args: Readonly<Record<string, unknown>>; id: string; inputs: readonly string[] }

export interface OpCtx {
  args: Readonly<Record<string, unknown>>;
  recv: Img | undefined;
  recvDomain: Domain | undefined;
  extra: Img[];
  info: ImageInfo | undefined;
  source(sha: string): Img;
  /** Nearest upstream node (receiver chain, self excluded) with this op, or undefined. */
  up(op: string): UpNode | undefined;
  /** Evaluates an upstream node by id (full resolution). */
  image(id: string): Img;
  env: PhysicsEnv;
}

/** Engine-wide physics settings plus memoised bindings (stock, scanner, chain). */
export class PhysicsEnv {
  private readonly memo = new Map<string, unknown>();
  readonly data: PhysicsData;
  readonly conv: Conventions;
  constructor(data: PhysicsData, conv: Conventions) {
    this.data = data;
    this.conv = conv;
  }
  cached<T>(key: string, make: () => T): T {
    if (!this.memo.has(key)) this.memo.set(key, make());
    return this.memo.get(key) as T;
  }
  stock(id: string): Stock {
    return this.cached(`stock:${id}`, () => resolveStock(this.data.stock(id), this.conv));
  }
  forward(stock: string, scanner: string): ForwardModel {
    return this.cached(`fwd:${stock}:${scanner}`, () => makeForward(makeScanner(this.data, scanner), this.stock(stock)));
  }
  /** The print chain of a print.expose node: filtration is a shift on the database neutral pack; the aim is neutral under `aimView`. */
  chain(o: ExposeSettings): PrintChain {
    return this.cached(`chain:${JSON.stringify(o)}`, () => makePrintChain({
      data: this.data, conv: this.conv, film: this.stock(o.film), paper: this.stock(o.paper), lamp: o.lamp, filtrationShift: o.filtration,
      mode: o.mode, ...(o.mode === 'real' ? { real: { time_s: o.time_s, fstop: o.fstop } } : {}), aim: o.aim, view: o.aimView,
    }));
  }
  viewing(paper: string, illuminant: string): Viewing {
    return this.cached(`view:${paper}:${illuminant}`, () => makePrintChain({ data: this.data, conv: this.conv, film: this.stock('kodak_portra_400'), paper: this.stock(paper), view: illuminant, aim: 'midgray-normalised' }).viewing);
  }
}

/** print.expose's arguments plus the upstream film: everything its chain depends on. */
export interface ExposeSettings {
  film: string; paper: string; lamp: string; mode: 'normalised' | 'real'; filtration: Cmy; time_s: number; fstop: number; aim: Aim; aimView: string;
}

/** Contract defaults for nodes adopted from an older contract (args are filled by bindArgs otherwise). */
export const DEFAULT_SIGMA_D: Vec3 = [0.0043, 0.0033, 0.0057];

export type ImageOp = (ctx: OpCtx) => Img;
export type ValueOp = (ctx: OpCtx) => Record<string, unknown>;

const A = (ctx: OpCtx, k: string): unknown => ctx.args[k];
const num = (ctx: OpCtx, k: string): number => ctx.args[k] as number;
const recv = (ctx: OpCtx): Img => ctx.recv ?? fail('E_EVAL', 'op needs a receiver image');

function mapPx(src: Img, c: number, f: (px: Float64Array, out: Float64Array, i: number) => void): Img {
  const out = newImg(src.w, src.h, c);
  const px = new Float64Array(src.c);
  const o = new Float64Array(c);
  for (let i = 0; i < src.w * src.h; i++) {
    for (let k = 0; k < src.c; k++) px[k] = src.data[i * src.c + k]!;
    f(px, o, i);
    for (let k = 0; k < c; k++) out.data[i * c + k] = o[k]!;
  }
  return out;
}

const DEFAULT_FILM = 'kodak_portra_400';
const DEFAULT_PAPER = 'kodak_portra_endura';
const filmOf = (ctx: OpCtx): string => (ctx.up('invert.dyes')?.args['stock'] as string | undefined) ?? (ctx.up('capture.expose')?.args['stock'] as string | undefined) ?? DEFAULT_FILM;
const paperOf = (ctx: OpCtx): string => (ctx.up('print.develop')?.args['paper'] as string | undefined) ?? DEFAULT_PAPER;
const viewOf = (ctx: OpCtx): string => (ctx.up('view.reflect')?.args['illuminant'] as string | undefined) ?? 'D50';

/** White of print-xyz at this point: the view.adapt target if one is upstream, else the viewing white. */
function currentWhite(ctx: OpCtx): Vec3 {
  const ad = ctx.up('view.adapt');
  if (ad) return ad.args['to'] === 'D50' ? D50 : D65;
  return whiteXYZ(ctx.env.viewing(paperOf(ctx), viewOf(ctx)));
}

export const IMAGE_OPS: Record<string, ImageOp> = {
  'source.open': (ctx) => ctx.source(A(ctx, 'source') as string),
  'source.pattern': (ctx) => {
    const info = ctx.info!;
    const rng = mulberry32(num(ctx, 'seed'));
    const [lo, hi] = DOMAINS[info.domain].range;
    const out = newImg(info.width, info.height, info.channels);
    for (let i = 0; i < out.data.length; i++) out.data[i] = info.domain === 'scan-classes' ? Math.floor(rng.next() * 4) : lo + rng.next() * (hi - lo);
    return out;
  },
  'invert.dyes': (ctx) => {
    const f = ctx.env.forward(A(ctx, 'stock') as string, A(ctx, 'scanner') as string);
    const d = [0, 0, 0];
    return mapPx(recv(ctx), 4, (px, o) => {
      for (let k = 0; k < 3; k++) d[k] = px[Math.min(k, px.length - 1)]! + f.Dbase[k]!;
      const r = solveDyes(f, d);
      o[0] = r.c[0]; o[1] = r.c[1]; o[2] = r.c[2]; o[3] = r.residual_D;
    });
  },
  'invert.classes': (ctx) => classesOf(ctx),
  'print.expose': (ctx) => {
    const ch = ctx.env.chain(exposeSettings(ctx.args, filmOf(ctx)));
    return mapPx(recv(ctx), 3, (px, o) => {
      const x = ch.xOfDyes(px);
      o[0] = x[0]; o[1] = x[1]; o[2] = x[2];
    });
  },
  'print.lights': (ctx) => {
    const l = A(ctx, 'logH') as Vec3;
    return mapPx(recv(ctx), 3, (px, o) => { for (let k = 0; k < 3; k++) o[k] = px[k]! + l[k]!; });
  },
  'print.preflash': (ctx) => {
    // φ as a fraction of the grey card's exposure; at the aim the grey card has x ≈ 0, i.e. H = 1.
    const phi = num(ctx, 'amount');
    return mapPx(recv(ctx), 3, (px, o) => { for (let k = 0; k < 3; k++) o[k] = Math.log10(10 ** px[k]! + phi); });
  },
  'print.develop': (ctx) => {
    const paper = A(ctx, 'paper') as string;
    const grade = num(ctx, 'grade');
    const dev = ctx.env.cached(`dev:${paper}:${grade}`, () => paperDeveloper(ctx.env.stock(paper), { gamma: gradeToGamma(grade), fast: 1, slow: 1, rgb: [1, 1, 1], exhaustion: 0 }));
    return mapPx(recv(ctx), 3, (px, o) => { const c = dev(px); o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; });
  },
  'view.reflect': (ctx) => {
    const v = ctx.env.viewing(paperOf(ctx), A(ctx, 'illuminant') as string);
    const R = new Float64Array(81);
    return mapPx(recv(ctx), 3, (px, o) => { const X = observe(v, reflectance(v, px, R)); o[0] = X[0]; o[1] = X[1]; o[2] = X[2]; });
  },
  'view.flare': (ctx) => {
    // Percent of the paper white (Chromogen's `Blacks` convention), in the frame where it physically happens.
    const f = num(ctx, 'flare') / 100;
    let W = paperWhiteXYZ(ctx.env.viewing(paperOf(ctx), viewOf(ctx)));
    const ad = ctx.up('view.adapt');
    if (ad) W = adaptBradford(W, whiteXYZ(ctx.env.viewing(paperOf(ctx), viewOf(ctx))), ad.args['to'] === 'D50' ? D50 : D65);
    return mapPx(recv(ctx), 3, (px, o) => { const X = addFlare(px, f, W); o[0] = X[0]; o[1] = X[1]; o[2] = X[2]; });
  },
  'view.adapt': (ctx) => {
    const from = currentWhite(ctx);
    const to = A(ctx, 'to') === 'D50' ? D50 : D65;
    return mapPx(recv(ctx), 3, (px, o) => { const X = adaptBradford(px, from, to); o[0] = X[0]; o[1] = X[1]; o[2] = X[2]; });
  },
  'output.display': (ctx) => {
    const from = currentWhite(ctx);
    const space = A(ctx, 'space') as OutputSpace;
    const kneeArg = A(ctx, 'knee') as string;
    // 'oklch' (contract 0.2; 'cam16-ucs' before): OkLCh with spektrafilm's knee parameters (guide §5.4 decision).
    const compress: CompressSpec = { ...DEFAULT_COMPRESS, algorithm: kneeArg === 'clip' ? 'clip' : kneeArg === 'tanh-shoulder' ? 'tanh-shoulder' : 'oklch' };
    let gain = 1;
    if (A(ctx, 'rendering') === 'scan-of-print') {
      const v = ctx.env.viewing(paperOf(ctx), viewOf(ctx));
      gain = 1 / paperWhiteXYZ(v)[1];
    }
    return mapPx(recv(ctx), 3, (px, o) => {
      const X = adaptBradford([px[0]! * gain, px[1]! * gain, px[2]! * gain], from, D65);
      const e = displayEncode(X, space, compress);
      o[0] = e[0]; o[1] = e[1]; o[2] = e[2];
    });
  },
};

/** print.expose arguments → chain settings (shared with the tabulated mode and packages/gpu). */
export function exposeSettings(a: Readonly<Record<string, unknown>>, film: string): ExposeSettings {
  return {
    film, paper: a['paper'] as string, lamp: a['lamp'] as string, mode: a['mode'] as 'normalised' | 'real',
    filtration: a['filtration'] as Cmy, time_s: a['time_s'] as number, fstop: a['fstop'] as number,
    aim: (a['aim'] as Aim | undefined) ?? 'grey-0.184', aimView: (a['aimView'] as string | undefined) ?? 'D50',
  };
}

/** Per-pixel class codes. Needs the upstream invert.dyes input (density above rebate); σ from the sigma argument. */
function classesOf(ctx: OpCtx): Img {
  const r = recv(ctx);
  const inv = ctx.up('invert.dyes');
  const scan = inv ? ctx.image(inv.inputs[0]!) : undefined;
  const sigma = (ctx.args['sigma'] as Vec3 | undefined) ?? DEFAULT_SIGMA_D;
  return mapPx(r, 1, (px, o, i) => {
    const res = r.c >= 4 ? px[3]! : 0;
    if (scan) {
      const D = [0, 1, 2].map((k) => scan.data[i * scan.c + Math.min(k, scan.c - 1)]!);
      o[0] = CLASS_CODE[classify(D, sigma, res).cls];
    } else o[0] = res > 0.01 ? CLASS_CODE.gamut : CLASS_CODE.ok;
  });
}

// ---- measurements --------------------------------------------------------------------------------

function values(img: Img, k: number, box?: Box, mask?: Img): number[] {
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
const pct = (s: number[], p: number): number => (s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]! : 0);
function boxMean(img: Img, b: Box): Vec3 {
  return [0, 1, 2].map((k) => { const v = values(img, k, b); return v.length ? v.reduce((a, c) => a + c, 0) / v.length : NaN; }) as Vec3;
}

/** Densities of a mean pixel by domain; Status A data waits for CHB-004, so Status M stands in for paper. */
function densities(ctx: OpCtx, mean: Vec3): { D: Vec3; visual?: number } {
  switch (ctx.recvDomain) {
    case 'film-dyes': { const s = ctx.env.stock(filmOf(ctx)); return { D: statusM().masked(s.pass).read(s.spectral(mean)) }; }
    case 'paper-dyes': { const s = ctx.env.stock(paperOf(ctx)); return { D: statusM().masked(s.pass).read(s.spectral(mean)) }; }
    case 'print-xyz': {
      const W = currentWhite(ctx);
      return { D: mean.map((v, k) => -Math.log10(Math.max(v / W[k]!, 1e-8))) as Vec3, visual: -Math.log10(Math.max(mean[1], 1e-8)) };
    }
    default: return { D: mean };
  }
}

export const VALUE_OPS: Record<string, ValueOp> = {
  'measure.stats': (ctx) => {
    const img = recv(ctx);
    const [lo, hi] = DOMAINS[ctx.recvDomain ?? 'mask'].range;
    const box = A(ctx, 'box') as Box | undefined;
    const mask = ctx.extra[0];
    const mean: number[] = [], p01: number[] = [], p99: number[] = [];
    let low = 0, high = 0, n = 0;
    for (let k = 0; k < 3; k++) {
      const v = values(img, k, box, mask);
      const s = [...v].sort((a, b) => a - b);
      mean.push(v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
      p01.push(pct(s, 0.01));
      p99.push(pct(s, 0.99));
      if (k < img.c) { low += v.filter((x) => x <= lo).length; high += v.filter((x) => x >= hi).length; n += v.length; }
    }
    return { mean, p01, p99, clipLow: n ? low / n : 0, clipHigh: n ? high / n : 0 };
  },
  'measure.histogram': (ctx) => {
    const img = recv(ctx);
    const bins = num(ctx, 'bins');
    const [lo, hi] = DOMAINS[ctx.recvDomain ?? 'mask'].range;
    const ch = A(ctx, 'channel') as string;
    const n = img.w * img.h;
    const counts = new Array<number>(bins).fill(0);
    for (let i = 0; i < n; i++) {
      const v = ch === 'L'
        ? [0, 1, 2].reduce((s, k) => s + img.data[i * img.c + Math.min(k, img.c - 1)]!, 0) / 3
        : img.data[i * img.c + Math.min('rgb'.indexOf(ch), img.c - 1)]!;
      counts[Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)))]!++;
    }
    return { edges: Array.from({ length: bins + 1 }, (_, i) => lo + ((hi - lo) * i) / bins), counts };
  },
  'measure.densitometer': (ctx) => {
    const img = recv(ctx);
    const at = A(ctx, 'at') as Point;
    const rad = num(ctx, 'aperture_px') / 2;
    const acc = [0, 0, 0];
    let n = 0;
    for (let y = Math.floor(at.y - rad); y <= Math.ceil(at.y + rad); y++) {
      for (let x = Math.floor(at.x - rad); x <= Math.ceil(at.x + rad); x++) {
        if (x < 0 || y < 0 || x >= img.w || y >= img.h || (x - at.x) ** 2 + (y - at.y) ** 2 > rad * rad + 1e-9) continue;
        for (let k = 0; k < 3; k++) acc[k]! += img.data[(y * img.w + x) * img.c + Math.min(k, img.c - 1)]!;
        n++;
      }
    }
    if (!n) fail('E_ARG_RANGE', 'densitometer aperture lies outside the image');
    const r = densities(ctx, acc.map((v) => v / n) as Vec3);
    return r.visual === undefined ? { D: r.D } : { D: r.D, visual: r.visual };
  },
  'measure.patches': (ctx) => {
    const img = recv(ctx);
    const b = (A(ctx, 'box') as Box | undefined) ?? { x: 0, y: 0, w: img.w, h: img.h };
    const cols = num(ctx, 'cols'), rows = num(ctx, 'rows');
    const cells = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const cb = { x: b.x + Math.floor((i * b.w) / cols), y: b.y + Math.floor((j * b.h) / rows), w: Math.max(1, Math.floor(b.w / cols)), h: Math.max(1, Math.floor(b.h / rows)) };
        const d = densities(ctx, boxMean(img, cb));
        cells.push({ cell: j * cols + i, D: d.D, visual: d.visual ?? (d.D[0] + d.D[1] + d.D[2]) / 3 });
      }
    }
    return { cells };
  },
  'invert.classify': (ctx) => {
    const cls = classesOf(ctx);
    const n = cls.w * cls.h;
    const count = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) count[cls.data[i]!]!++;
    return { reachable: count[0]! / n, blank: count[1]! / n, belowBase: count[2]! / n, unreachable: count[3]! / n };
  },
};

