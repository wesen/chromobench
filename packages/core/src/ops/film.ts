// Reference-engine adapters for the forward path (CHB-012 guide §5.6): source.xyz, capture.expose,
// film.couple, film.halation, film.develop and film.grain over core's film/ modules. The bindings
// (camera matrix, film table, curves, DIR, presets) are shared with packages/gpu through the
// *At(ctx, args) helpers, so both engines read a graph the same way.
import { fail, type ImageInfo, type SourceInfo } from '@chromobench/contract';
import { cameraMatrix } from '../film/camera.ts';
import { coupleImage, dirForStock, precorrectedCurves, type Dir } from '../film/couple.ts';
import type { FilmCurves } from '../film/curves.ts';
import { developmentCurves, type DevelopmentResult } from '../film/develop.ts';
import { logRaw, makeExposer, type Exposer } from '../film/expose.ts';
import type { FilmModel } from '../film/forward.ts';
import { grainImage, grainSpec, sublayersOf, type GrainSpec, type Sublayers } from '../film/grain.ts';
import { applyHalation, halationForStock, type HalationSpec } from '../film/halation.ts';
import { D65 } from '../print/colour.ts';
import type { Mat3 } from '../spectral/linalg.ts';
import type { StockData } from '../spectral/stock.ts';
import { filmOf, type ChainCtx, type Img, type OpCtx } from './ops.ts';

/** Long edge of the simulated format when ImageInfo.umPerPx.film is unset (135 film). */
export const DEFAULT_FORMAT_MM = 36;

/** Film µm per pixel of an image: ImageInfo.umPerPx.film, else a 36 mm long edge over the long side. */
export function filmUmPerPx(info: Pick<ImageInfo, 'width' | 'height' | 'umPerPx'> | undefined, w: number, h: number): number {
  return info?.umPerPx.film ?? (DEFAULT_FORMAT_MM * 1000) / Math.max(w, h, 1);
}

/** The film of film.* ops: capture.expose's stock (core's default film without one, as filmOf). */
const filmStock = (ctx: ChainCtx): string => filmOf(ctx);

/** source.xyz: camera RGB → scene XYZ matrix for the source's camera colour and the white balance. */
export function sceneMatrixAt(camera: SourceInfo['camera'], args: Readonly<Record<string, unknown>>): Mat3 {
  const mode = (args['mode'] as 'daylight' | 'as-shot' | 'custom' | undefined) ?? 'daylight';
  return cameraMatrix(camera, { mode, temperature_K: args['temperature_K'] as number | undefined, tint: args['tint'] as number | undefined }).M;
}

/** capture.expose's per-pixel exposer (adapt to the film reference from D65; exposureEV). */
export function exposerAt(ctx: ChainCtx, args: Readonly<Record<string, unknown>>, interp: 'cubic' | 'bilinear' = 'cubic'): { film: FilmModel; ex: Exposer } {
  const film = ctx.env.film(args['stock'] as string);
  const adapt = args['adapt'] === 'none' ? 'none' : 'to-film-reference';
  return { film, ex: makeExposer(film.table, { adapt, sourceWhite: D65, refWhite: film.refWhite, ev: (args['exposureEV'] as number | undefined) ?? 0, interp }) };
}

/** Stock data of the measured development profiles of a film: id_push1, id_push2 … (Portra 800). */
export function pushProfilesOf(ctx: ChainCtx, stock: string): Map<number, StockData> {
  return ctx.env.cached(`pushProfiles:${stock}`, () => {
    const m = new Map<number, StockData>();
    const ids = ctx.env.data.stockIds();
    const found = ids.filter((id) => id.startsWith(`${stock}_push`));
    if (found.length) m.set(0, ctx.env.data.stock(stock));
    for (const id of found) {
      const n = Number(id.slice(stock.length + 5));
      if (Number.isFinite(n)) m.set(n, ctx.env.data.stock(id));
    }
    return m;
  });
}

/** Datasheet curves of a development (push stops), with the basis. */
export function developmentAt(ctx: ChainCtx, stock: string, push: number): DevelopmentResult {
  return ctx.env.cached(`develop:${stock}:${push}`, () => developmentCurves(ctx.env.data.stock(stock), push, pushProfilesOf(ctx, stock)));
}

/** film.couple's DIR binding (the amount and diffusion of the op). */
export function dirAt(ctx: ChainCtx, stock: string, args: Readonly<Record<string, unknown>> | undefined): Dir {
  return dirForStock(ctx.env.stock(stock), { amount: (args?.['amount'] as number | undefined) ?? 1, diffusion_um: (args?.['diffusion_um'] as number | undefined) ?? 0 });
}

/**
 * film.develop's curves: the development's datasheet curves, or their pre-correction f⁰ for the
 * DIR coupling of the nearest film.couple upstream (amount 1 without one).
 */
export function developCurvesAt(ctx: ChainCtx, args: Readonly<Record<string, unknown>>): { curves: FilmCurves; basis: DevelopmentResult['basis']; key: string } {
  const stock = filmStock(ctx);
  const push = (args['push'] as number | undefined) ?? 0;
  const dev = developmentAt(ctx, stock, push);
  if (args['curves'] !== 'precorrected') return { curves: dev.curves, basis: dev.basis, key: `${stock}|${push}|datasheet` };
  const dir = dirAt(ctx, stock, ctx.up('film.couple')?.args);
  return { curves: ctx.env.cached(`f0:${stock}:${push}:${dir.amount}`, () => precorrectedCurves(dev.curves, dir)), basis: dev.basis, key: `${stock}|${push}|f0|${dir.amount}` };
}

/** film.couple's inhibitor source curves: the stock's nominal datasheet curves (see CONTRACT-REQUESTS R3). */
export function coupleCurvesAt(ctx: ChainCtx): FilmCurves {
  return developmentAt(ctx, filmStock(ctx), 0).curves;
}

export function halationAt(ctx: ChainCtx, args: Readonly<Record<string, unknown>>): HalationSpec {
  return halationForStock(ctx.env.stock(filmStock(ctx)), { strength: (args['strength'] as number | undefined) ?? 1 });
}

export function grainAt(ctx: ChainCtx, args: Readonly<Record<string, unknown>>): { spec: GrainSpec; sub: Sublayers } {
  const stock = filmStock(ctx);
  const spec = grainSpec({ amount: args['amount'] as number, size_um: args['size_um'] as number, seed: args['seed'] as number });
  const sub = ctx.env.cached(`sublayers:${stock}:${spec.particleArea_um2}`, () => sublayersOf(developmentAt(ctx, stock, 0).curves, ctx.env.data.stock(stock).sublayerCurves, spec));
  return { spec, sub };
}

const recv = (ctx: OpCtx): Img => ctx.recv ?? fail('E_EVAL', 'op needs a receiver image');
const rgb = (img: Img): Float64Array => {
  if (img.c === 3) return img.data;
  const out = new Float64Array(img.w * img.h * 3);
  for (let i = 0; i < img.w * img.h; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = img.data[i * img.c + Math.min(k, img.c - 1)]!;
  return out;
};

export const FILM_IMAGE_OPS: Record<string, (ctx: OpCtx) => Img> = {
  'source.xyz': (ctx) => {
    const r = recv(ctx);
    const sha = ctx.up('source.open')?.args['source'] as string | undefined;
    const M = sceneMatrixAt(sha ? ctx.sourceInfo?.(sha)?.camera : undefined, ctx.args);
    const src = rgb(r);
    const out = new Float64Array(r.w * r.h * 3);
    for (let i = 0; i < r.w * r.h; i++) {
      const a = src[i * 3]!, b = src[i * 3 + 1]!, c = src[i * 3 + 2]!;
      for (let k = 0; k < 3; k++) out[i * 3 + k] = M[k]![0]! * a + M[k]![1]! * b + M[k]![2]! * c;
    }
    return { w: r.w, h: r.h, c: 3, data: out };
  },
  'capture.expose': (ctx) => {
    const r = recv(ctx);
    const { ex } = exposerAt(ctx, ctx.args);
    const src = rgb(r);
    const out = new Float64Array(r.w * r.h * 3);
    const px = new Float64Array(3);
    for (let i = 0; i < r.w * r.h; i++) {
      ex.raw(src.subarray(i * 3, i * 3 + 3), px);
      for (let k = 0; k < 3; k++) out[i * 3 + k] = logRaw(px[k]!);
    }
    return { w: r.w, h: r.h, c: 3, data: out };
  },
  'film.couple': (ctx) => {
    const r = recv(ctx);
    const stock = filmStock(ctx);
    const dir = dirAt(ctx, stock, ctx.args);
    if (dir.amount === 0) return r;
    return { w: r.w, h: r.h, c: 3, data: coupleImage(rgb(r), r.w, r.h, filmUmPerPx(ctx.info, r.w, r.h), coupleCurvesAt(ctx), dir) };
  },
  'film.halation': (ctx) => {
    const r = recv(ctx);
    const s = halationAt(ctx, ctx.args);
    return { w: r.w, h: r.h, c: 3, data: applyHalation(rgb(r), r.w, r.h, filmUmPerPx(ctx.info, r.w, r.h), s) };
  },
  'film.develop': (ctx) => {
    const r = recv(ctx);
    const { curves } = developCurvesAt(ctx, ctx.args);
    const src = rgb(r);
    const out = new Float64Array(r.w * r.h * 3);
    for (let i = 0; i < r.w * r.h; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = curves.at(k as 0, src[i * 3 + k]!);
    return { w: r.w, h: r.h, c: 3, data: out };
  },
  'film.grain': (ctx) => {
    const r = recv(ctx);
    const { spec, sub } = grainAt(ctx, ctx.args);
    if (spec.amount === 0) return r;
    return { w: r.w, h: r.h, c: 3, data: grainImage(rgb(r), r.w, r.h, { umPerPx: filmUmPerPx(ctx.info, r.w, r.h) }, sub, spec) };
  },
};
