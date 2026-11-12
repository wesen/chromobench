// Op adapters for the reference engine (guide §5.7): one per catalog op CHB-003 owns, applying core's
// pure functions to f64 images. Upstream context (stock, paper, viewing light) is found by walking the
// node's inputs (`ctx.up`), because a pointwise op's own args do not name it.
import { DOMAINS, fail, mulberry32, type Box, type Cmy, type Diagnostic, type Domain, type ImageInfo, type Point } from '@chromobench/contract';
import type { PhysicsData } from '../data/provider.ts';
import { filtrationForLights } from '../print/balance.ts';
import { makePrintChain, type Aim, type PrintChain } from '../print/chain.ts';
import { adaptBradford, addFlare, D50, D65, observe, OUTPUT_SPACE_IDS, paperWhiteXYZ, reflectance, whiteXYZ, type OutputSpaceId, type Viewing } from '../print/colour.ts';
import { displayPixel, displaySetup, type DisplaySetup, type KneeName } from '../print/gamut.ts';
import { gradeToGamma, gradeX, paperDeveloper } from '../print/paper.ts';
import { combinePixel, combineRatio, type CombineTerm } from '../print/exposures.ts';
import { ellipseAt, featherSigma, fullGrid, gaussianBlur1, gradientAt, gridCentres, luminanceAt, paintMask, parseStrokes } from '../print/masks.ts';
import { densityMaskSigma, maskDensityPolar } from '../print/densityMask.ts';
import { buildPdTable, buildPrintTable, buildSolveTable, look3, N3, type Table3 } from '../tables/tables.ts';
import { CLASS_CODE, classify } from '../scan/classify.ts';
import { makeScanner } from '../scan/scanner.ts';
import { makeForward, solveDyes, type ForwardModel } from '../scan/solve.ts';
import { statusM } from '../spectral/channels.ts';
import type { Conventions } from '../spectral/conventions.ts';
import type { Vec3 } from '../spectral/linalg.ts';
import { resolveStock, type Stock } from '../spectral/stock.ts';

export interface Img { w: number; h: number; c: number; data: Float64Array; warnings?: Diagnostic[] }
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
  /** The definition of any node the engine knows (print.combine reads its exposures' print.expose args). */
  node(id: string): UpNode | undefined;
  env: PhysicsEnv;
}

/** Engine-wide physics settings plus memoised bindings (stock, scanner, chain). */
export class PhysicsEnv {
  private readonly memo = new Map<string, unknown>();
  readonly data: PhysicsData;
  readonly conv: Conventions;
  /** 'tabulated': invert.dyes, print.expose and view.reflect read core's f64 tables (tables.ts) through look3. */
  readonly mode: 'exact' | 'tabulated';
  readonly N: number;
  constructor(data: PhysicsData, conv: Conventions, o: { mode?: 'exact' | 'tabulated'; N?: number } = {}) {
    this.data = data;
    this.conv = conv;
    this.mode = o.mode ?? 'exact';
    this.N = o.N ?? N3;
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
  /**
   * The print chain of a print.expose node: filtration is a shift on the database neutral pack, the
   * calibration is that neutral pack at REFERENCE_OPTICS, the aim is neutral under `aimView`. Normalised
   * mode ignores the optics, so they are left out of its key.
   */
  chain(o: ExposeSettings): PrintChain {
    const k = o.mode === 'real' ? o : { ...o, time_s: null, fstop: null, magnification: null };
    return this.cached(`chain:${JSON.stringify(k)}`, () => makePrintChain({
      data: this.data, conv: this.conv, film: this.stock(o.film), paper: this.stock(o.paper), lamp: o.lamp, filtrationShift: o.filtration,
      mode: o.mode, ...(o.mode === 'real' ? { optics: { time_s: o.time_s, fstop: o.fstop, ...(o.magnification !== null ? { magnification: o.magnification } : {}) } } : {}),
      aim: o.aim, view: o.aimView,
    }));
  }
  viewing(paper: string, illuminant: string): Viewing {
    return this.cached(`view:${paper}:${illuminant}`, () => makePrintChain({ data: this.data, conv: this.conv, film: this.stock('kodak_portra_400'), paper: this.stock(paper), view: illuminant, aim: 'midgray-normalised' }).viewing);
  }
  // ---- the f64 tables of the tabulated mode (Studio node order, the GPU's domains) ----
  solveTable(stock: string, scanner: string): Table3 {
    return this.cached(`solveT:${stock}:${scanner}:${this.N}`, () => buildSolveTable(this.forward(stock, scanner), { N: this.N }).table);
  }
  /** Printing density = clear − x depends on film, paper, lamp and pack only (not on κ, optics, aim or mode). */
  pdTable(o: ExposeSettings): Table3 {
    const key = JSON.stringify([o.film, o.paper, o.lamp, o.filtration]);
    return this.cached(`pdT:${key}:${this.N}`, () => buildPdTable(this.chain(o), { N: this.N }));
  }
  printTable(paper: string, illuminant: string): Table3 {
    return this.cached(`printT:${paper}:${illuminant}:${this.N}`, () => buildPrintTable({ viewing: this.viewing(paper, illuminant) }, { N: this.N }));
  }
}

/** print.expose's arguments plus the upstream film: everything its chain depends on. */
export interface ExposeSettings {
  film: string; paper: string; lamp: string; mode: 'normalised' | 'real'; filtration: Cmy; time_s: number; fstop: number;
  /** null: the calibration's reference magnification (the arg is optional in the contract). */
  magnification: number | null;
  aim: Aim; aimView: string;
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

// Upstream context, shared with packages/gpu's lowering so both engines read a graph the same way.
/** What the context helpers need: the upstream walk and the physics environment. */
export interface ChainCtx {
  up(op: string): UpNode | undefined;
  env: PhysicsEnv;
}
export const DEFAULT_FILM = 'kodak_portra_400';
export const DEFAULT_PAPER = 'kodak_portra_endura';
export const filmOf = (ctx: Pick<ChainCtx, 'up'>): string => (ctx.up('invert.dyes')?.args['stock'] as string | undefined) ?? (ctx.up('capture.expose')?.args['stock'] as string | undefined) ?? DEFAULT_FILM;
export const paperOf = (ctx: Pick<ChainCtx, 'up'>): string => (ctx.up('print.develop')?.args['paper'] as string | undefined) ?? DEFAULT_PAPER;
export const viewOf = (ctx: Pick<ChainCtx, 'up'>): string => (ctx.up('view.reflect')?.args['illuminant'] as string | undefined) ?? 'D50';

/** White of print-xyz at this point: the view.adapt target if one is upstream, else the viewing white. */
export function whiteAt(ctx: ChainCtx): Vec3 {
  const ad = ctx.up('view.adapt');
  if (ad) return ad.args['to'] === 'D50' ? D50 : D65;
  return whiteXYZ(ctx.env.viewing(paperOf(ctx), viewOf(ctx)));
}
const currentWhite = whiteAt;

/** view.flare's white: the paper white, adapted when a view.adapt is upstream. */
export function flareWhite(ctx: ChainCtx): Vec3 {
  let W = paperWhiteXYZ(ctx.env.viewing(paperOf(ctx), viewOf(ctx)));
  const ad = ctx.up('view.adapt');
  if (ad) W = adaptBradford(W, whiteXYZ(ctx.env.viewing(paperOf(ctx), viewOf(ctx))), ad.args['to'] === 'D50' ? D50 : D65);
  return W;
}

/**
 * output.display's setup (CHB-011, guide §5.2), shared with packages/gpu's lowering: the rendering's
 * Bradford source white (print-xyz's white for print-as-seen, the paper white for scan-of-print), the
 * output space's matrix and TRC, and the knee with its lightness rule. The paper white is
 * flareWhite(ctx): the paper's white in print-xyz's frame, without flare.
 */
export function displaySetupAt(ctx: ChainCtx, args: Readonly<Record<string, unknown>>): DisplaySetup {
  const k = args['knee'];
  // 'cam16-ucs' and 'cam16ucs' select CAM16-UCS once the contract allows them (packages/output/CONTRACT-REQUESTS.md R1)
  const knee: KneeName = k === 'clip' || k === 'tanh-shoulder' ? k : k === 'cam16-ucs' || k === 'cam16ucs' ? 'cam16-ucs' : 'oklch';
  const space = (OUTPUT_SPACE_IDS as readonly unknown[]).includes(args['space']) ? (args['space'] as OutputSpaceId) : 'srgb';
  return displaySetup({ rendering: args['rendering'] === 'print-as-seen' ? 'print-as-seen' : 'scan-of-print', white: whiteAt(ctx), paperWhite: flareWhite(ctx), space, knee });
}

/** x of an exposure through clear film (no negative) for the nearest upstream print.expose; 0 without one. */
export function clearExposure(ctx: Pick<OpCtx, 'up' | 'env'>): Vec3 {
  const ex = ctx.up('print.expose');
  if (!ex) return [0, 0, 0];
  const ch = ctx.env.chain(exposeSettings(ex.args, filmOf(ctx)));
  return ch.aimLights.apply(ch.enlarger.clear());
}

/**
 * The uniform x of a flash term of print.combine (contract 0.3): the exposure's print.expose settings through
 * the film base with no image (dye amounts 0, 'flash-base') or through an empty gate ('flash-open'); null for
 * other modes. Shared with packages/gpu's lowering.
 */
export function flashExposure(ctx: Pick<OpCtx, 'node' | 'up' | 'env'>, id: string, mode: string): Vec3 | null {
  if (mode !== 'flash-base' && mode !== 'flash-open') return null;
  const n = ctx.node(id);
  if (!n || n.op !== 'print.expose') return null;
  const ch = ctx.env.chain(exposeSettings(n.args, filmOf(ctx)));
  return mode === 'flash-open' ? ch.aimLights.apply(ch.enlarger.clear()) : ch.xOfDyes([0, 0, 0]);
}

/** scan.density's rebate: the given box, else the brightest 5 % column band (as the mock engine). */
export function rebateBox(w: number, h: number, c: number, data: ArrayLike<number>, box?: Box): Box {
  if (box) return box;
  const lum = Array.from({ length: w }, (_, x) => {
    let s = 0;
    for (let y = 0; y < h; y++) for (let k = 0; k < c; k++) s += data[(y * w + x) * c + k]!;
    return { x, s };
  });
  const n = Math.max(1, Math.round(w * 0.05));
  const cols = lum.sort((a, b) => b.s - a.s || a.x - b.x).slice(0, n).map((q) => q.x).sort((a, b) => a - b);
  return { x: cols[0]!, y: 0, w: cols[cols.length - 1]! - cols[0]! + 1, h };
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
  'scan.flare': (ctx) => {
    // T = T′(1 + f) − f per channel, T′ relative to the open gate (contract 0.3; ingest removeFlareValue)
    const a = A(ctx, 'flare') as number | Vec3;
    const f = [0, 1, 2].map((k) => (Array.isArray(a) ? a[k]! : (a as number)) / 100);
    const r = recv(ctx);
    return mapPx(r, r.c, (px, o) => { for (let k = 0; k < r.c; k++) o[k] = k < 3 ? px[k]! * (1 + f[k]!) - f[k]! : px[k]!; });
  },
  'scan.density': (ctx) => {
    // d = −log10(T / T_base) per channel: T_base = baseT (the roll's, contract 0.3) or the rebate box mean (as the mock)
    const r = recv(ctx);
    const baseT = A(ctx, 'baseT') as Vec3 | undefined;
    const b = baseT ? undefined : rebateBox(r.w, r.h, r.c, r.data, A(ctx, 'rebate') as Box | undefined);
    const T = baseT ?? [0, 1, 2].map((k) => { const v = values(r, k, b); return v.length ? v.reduce((a, q) => a + q, 0) / v.length : 1; });
    return mapPx(r, 3, (px, o) => { for (let k = 0; k < 3; k++) o[k] = -Math.log10(Math.max(px[Math.min(k, px.length - 1)]!, 1e-8) / T[k]!); });
  },
  'invert.dyes': (ctx) => {
    const f = ctx.env.forward(A(ctx, 'stock') as string, A(ctx, 'scanner') as string);
    if (ctx.env.mode === 'tabulated') {
      const T = ctx.env.solveTable(A(ctx, 'stock') as string, A(ctx, 'scanner') as string);
      const K = f.Kinv;
      const out = new Float64Array(4);
      return mapPx(recv(ctx), 4, (px, o) => {
        const p = [px[0]!, px[Math.min(1, px.length - 1)]!, px[Math.min(2, px.length - 1)]!];
        look3(T, [0, 1, 2].map((k) => K[k]![0]! * p[0]! + K[k]![1]! * p[1]! + K[k]![2]! * p[2]!), out);
        o[0] = out[0]!; o[1] = out[1]!; o[2] = out[2]!; o[3] = out[3]!;
      });
    }
    const d = [0, 0, 0];
    return mapPx(recv(ctx), 4, (px, o) => {
      for (let k = 0; k < 3; k++) d[k] = px[Math.min(k, px.length - 1)]! + f.Dbase[k]!;
      const r = solveDyes(f, d);
      o[0] = r.c[0]; o[1] = r.c[1]; o[2] = r.c[2]; o[3] = r.residual_D;
    });
  },
  'invert.classes': (ctx) => classesOf(ctx),
  'print.expose': (ctx) => {
    const es = exposeSettings(ctx.args, filmOf(ctx));
    const ch = ctx.env.chain(es);
    if (ctx.env.mode === 'tabulated') {
      const T = ctx.env.pdTable(es);
      const base = ch.aimLights.apply(ch.enlarger.clear());
      const out = new Float64Array(4);
      return mapPx(recv(ctx), 3, (px, o) => { look3(T, px, out); for (let k = 0; k < 3; k++) o[k] = base[k]! - out[k]!; });
    }
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
    const { develop } = developerAt(ctx, A(ctx, 'paper') as string, num(ctx, 'grade'));
    return mapPx(recv(ctx), 3, (px, o) => { const c = develop(px); o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; });
  },
  'print.combine': (ctx) => {
    // CHB-010 §6.5: exposures add in linear H on the main exposure (dodges withheld from it), one log at the end
    const r = recv(ctx);
    const ids = A(ctx, 'exposures') as string[];
    const maskIds = A(ctx, 'masks') as string[];
    const modes = A(ctx, 'modes') as string[];
    if (ids.length === 0 && !((A(ctx, 'densityMasks') as string[] | undefined) ?? []).length) return r;
    const main = ctx.up('print.expose')?.args;
    const ex = ids.map((id) => ctx.image(id));
    const ms = maskIds.map((id) => ctx.image(id));
    const ratio = ids.map((id) => combineRatio(main, ctx.node(id)?.op === 'print.expose' ? ctx.node(id)!.args : undefined));
    const flashX = ids.map((id, i) => flashExposure(ctx, id, modes[i]!));
    const terms: CombineTerm[] = ids.map((_, i) => ({ x: [0, 0, 0], m: 0, sign: modes[i] === 'subtract' ? -1 : 1, ratio: ratio[i]!, flash: flashX[i] !== null }));
    const dms = ((A(ctx, 'densityMasks') as string[] | undefined) ?? []).map((id) => ctx.image(id));
    let clamped = 0;
    const out = mapPx(r, 3, (px, o, i) => {
      terms.forEach((t, j) => {
        const e = ex[j]!;
        t.x = flashX[j] ?? e.data.subarray(i * e.c, i * e.c + 3);
        t.m = ms[j]!.data[i * ms[j]!.c]!;
      });
      let dm = 0;
      for (const d of dms) dm += d.data[i * d.c]!;
      if (combinePixel(px, terms, o, dm)) clamped++;
    });
    if (clamped) out.warnings = [{ code: 'W_DODGE_EXCEEDS_MAIN', message: `dodges hold back more than the main exposure at ${clamped} pixel(s); clamped at no light` }];
    return out;
  },
  'print.densityMask': (ctx) => {
    // CHB-010 §6.6, contract 0.3: d_m of a neutral silver mask from the blurred transmittance 10^−PD of the
    // negative, PD = x_clear − x recovered from the main print.expose's paper log exposure (x_clear = 0 without one)
    const r = recv(ctx);
    const clear = clearExposure(ctx);
    const pd = new Float64Array(r.w * r.h * 3);
    for (let i = 0; i < r.w * r.h; i++) for (let k = 0; k < 3; k++) pd[i * 3 + k] = clear[k]! - r.data[i * r.c + Math.min(k, r.c - 1)]!;
    const sigma = densityMaskSigma(num(ctx, 'radius_um'), ctx.info?.umPerPx.film);
    const amount = num(ctx, 'amount');
    const data = amount === 0 ? new Float64Array(r.w * r.h) : maskDensityPolar(pd, r.w, r.h, 3, amount, sigma, A(ctx, 'polarity') === 'same' ? 'same' : 'positive');
    return { w: r.w, h: r.h, c: 1, data };
  },
  'retouch.heal': (ctx) => {
    // contract 0.3 stub: CHB-022 implements heal and clone; the print passes through
    const r = recv(ctx);
    const spots = Object.keys(JSON.parse(String(A(ctx, 'spots') ?? '{}')) as object).length;
    return spots ? { ...r, warnings: [{ code: 'W_PREVIEW_APPROX', message: `retouch.heal is not implemented yet (CHB-022): ${spots} spot(s) not applied` }] } : r;
  },
  'mask.luminance': (ctx) => {
    const [lo, hi] = DOMAINS[ctx.recvDomain ?? 'mask'].range;
    const above = num(ctx, 'above'), below = num(ctx, 'below'), soft = num(ctx, 'softness');
    return mapPx(recv(ctx), 1, (px, o) => {
      const n = px.length;
      const L = (px[0]! + px[Math.min(1, n - 1)]! + px[Math.min(2, n - 1)]!) / 3;
      o[0] = luminanceAt((L - lo) / (hi - lo), above, below, soft);
    });
  },
  'mask.gradient': (ctx) => coordMask(ctx, (X, Y) => gradientAt(X, Y, A(ctx, 'from') as Point, A(ctx, 'to') as Point)),
  'mask.ellipse': (ctx) => coordMask(ctx, (X, Y) => ellipseAt(X, Y, A(ctx, 'box') as Box, (A(ctx, 'angle_deg') as number | undefined) ?? 0)),
  'mask.paint': (ctx) => {
    const info = ctx.info!;
    return { w: info.width, h: info.height, c: 1, data: paintMask(parseStrokes(A(ctx, 'strokes') as string), fullGrid(info.width, info.height)) };
  },
  'mask.feather': (ctx) => {
    const r = recv(ctx);
    return { w: r.w, h: r.h, c: 1, data: gaussianBlur1(r.data, r.w, r.h, featherSigma(num(ctx, 'radius_px'))) };
  },
  'mask.and': (ctx) => maskPair(ctx, Math.min),
  'mask.or': (ctx) => maskPair(ctx, Math.max),
  'mask.not': (ctx) => mapPx(recv(ctx), 1, (px, o) => { o[0] = 1 - px[0]!; }),
  'view.reflect': (ctx) => {
    if (ctx.env.mode === 'tabulated') {
      const T = ctx.env.printTable(paperOf(ctx), A(ctx, 'illuminant') as string);
      const out = new Float64Array(4);
      return mapPx(recv(ctx), 3, (px, o) => { look3(T, px, out); o[0] = out[0]!; o[1] = out[1]!; o[2] = out[2]!; });
    }
    const v = ctx.env.viewing(paperOf(ctx), A(ctx, 'illuminant') as string);
    const R = new Float64Array(81);
    return mapPx(recv(ctx), 3, (px, o) => { const X = observe(v, reflectance(v, px, R)); o[0] = X[0]; o[1] = X[1]; o[2] = X[2]; });
  },
  'view.flare': (ctx) => {
    // Percent of the paper white (Chromogen's `Blacks` convention), in the frame where it physically happens.
    const f = num(ctx, 'flare') / 100;
    const W = flareWhite(ctx);
    return mapPx(recv(ctx), 3, (px, o) => { const X = addFlare(px, f, W); o[0] = X[0]; o[1] = X[1]; o[2] = X[2]; });
  },
  'view.adapt': (ctx) => {
    const from = currentWhite(ctx);
    const to = A(ctx, 'to') === 'D50' ? D50 : D65;
    return mapPx(recv(ctx), 3, (px, o) => { const X = adaptBradford(px, from, to); o[0] = X[0]; o[1] = X[1]; o[2] = X[2]; });
  },
  'output.display': (ctx) => {
    // rendering → Bradford to the space's white → matrix → knee (last colour step) → TRC (CHB-011).
    // 'oklch' (contract 0.2; 'cam16-ucs' before): OkLCh with spektrafilm's knee parameters (guide §5.4).
    const s = displaySetupAt(ctx, ctx.args);
    return mapPx(recv(ctx), 3, (px, o) => {
      const e = displayPixel(px, s);
      o[0] = e[0]; o[1] = e[1]; o[2] = e[2];
    });
  },
};

/** A mask from frame coordinates (pixel centres, source px) at the node's size. */
function coordMask(ctx: OpCtx, f: (X: number, Y: number) => number): Img {
  const info = ctx.info!;
  const { xs, ys } = gridCentres(fullGrid(info.width, info.height));
  const out = newImg(info.width, info.height, 1);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) out.data[y * info.width + x] = f(xs[x]!, ys[y]!);
  return out;
}

function maskPair(ctx: OpCtx, f: (a: number, b: number) => number): Img {
  const o = ctx.image(A(ctx, 'other') as string);
  return mapPx(recv(ctx), 1, (px, out, i) => { out[0] = f(px[0]!, o.data[i * o.c]!); });
}

/** print.expose arguments → chain settings (shared with the tabulated mode and packages/gpu). */
export function exposeSettings(a: Readonly<Record<string, unknown>>, film: string): ExposeSettings {
  return {
    film, paper: a['paper'] as string, lamp: a['lamp'] as string, mode: a['mode'] as 'normalised' | 'real',
    filtration: a['filtration'] as Cmy, time_s: a['time_s'] as number, fstop: a['fstop'] as number,
    magnification: (a['magnification'] as number | undefined) ?? null,
    aim: (a['aim'] as Aim | undefined) ?? 'grey-0.184', aimView: (a['aimView'] as string | undefined) ?? 'D50',
  };
}

/**
 * The grade's pivot: the aim grey's paper exposure of the upstream print.expose (Chromogen aim().g),
 * so a grade change leaves the grey card where it is. [0, 0, 0] (spektrafilm's morph centre) when no
 * print.expose is upstream.
 */
export function gradePivot(ctx: ChainCtx): Vec3 {
  const ex = ctx.up('print.expose');
  return ex ? ctx.env.chain(exposeSettings(ex.args, filmOf(ctx))).aimX : [0, 0, 0];
}

/**
 * print.develop's developer, shared with packages/gpu: the paper curve after the grade,
 * x′ = pivot + γ(grade)·(x − pivot) (CHB-010 guide §6.8). `id` names the function for caches.
 */
export function developerAt(ctx: ChainCtx, paper: string, grade: number): { id: string; develop: (x: ArrayLike<number>) => Vec3 } {
  const g = gradeToGamma(grade);
  const dev = ctx.env.cached(`dev:${paper}`, () => paperDeveloper(ctx.env.stock(paper)));
  if (g === 1) return { id: `${paper}|1`, develop: dev };
  const pivot = gradePivot(ctx);
  return { id: `${paper}|${g}|${pivot.join(',')}`, develop: (x) => dev(gradeX(x, g, pivot)) };
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
const densities = (ctx: OpCtx, mean: Vec3): { D: Vec3; visual?: number } => densitiesOf(ctx, ctx.recvDomain, mean);

/** Densities of a mean pixel of `domain` (measure.densitometer / measure.patches; shared with packages/gpu). */
export function densitiesOf(ctx: ChainCtx, domain: Domain | undefined, mean: Vec3): { D: Vec3; visual?: number } {
  switch (domain) {
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
  'darkroom.lightsToFiltration': (ctx) => {
    // Contract 0.2 gives this op only `logH` on a film-dyes receiver, so the print settings are not
    // visible: the defaults of print.expose are used (Portra Endura, TH-KG3, the database neutral pack,
    // real mode, 10 s at f/8) unless the args carry them (CHB-010 CONTRACT-REQUESTS R1 adds them).
    const a = ctx.args;
    const es = exposeSettings({
      paper: a['paper'] ?? DEFAULT_PAPER, mode: a['mode'] ?? 'real', lamp: a['lamp'] ?? 'TH-KG3', filtration: a['filtration'] ?? { c: 0, m: 0, y: 0 },
      time_s: a['time_s'] ?? 10, fstop: a['fstop'] ?? 8, magnification: a['magnification'], aim: a['aim'], aimView: a['aimView'],
    }, filmOf(ctx));
    const fit = filtrationForLights({
      data: ctx.env.data, conv: ctx.env.conv, film: ctx.env.stock(es.film), paper: ctx.env.stock(es.paper), lamp: es.lamp, filtrationShift: es.filtration, mode: es.mode,
      optics: { time_s: es.time_s, fstop: es.fstop, ...(es.magnification !== null ? { magnification: es.magnification } : {}) }, aim: es.aim, view: es.aimView,
    }, A(ctx, 'logH') as Vec3);
    return {
      filtration: fit.shift, residual: Math.max(...fit.residual_pt.map(Math.abs)) * 0.025,
      time_s: fit.time_s, stops: fit.stops, lights: fit.lights, residual_pt: fit.residual_pt,
    };
  },
  'invert.classify': (ctx) => {
    const cls = classesOf(ctx);
    const n = cls.w * cls.h;
    const count = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) count[cls.data[i]!]!++;
    return { reachable: count[0]! / n, blank: count[1]! / n, belowBase: count[2]! / n, unreachable: count[3]! / n };
  },
};

