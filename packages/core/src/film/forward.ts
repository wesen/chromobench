// The forward film model of one stock, bound once (CHB-012 guide §5.6): the exposure table, the
// reference white, the datasheet curves and sublayers; plus the mid-grey density the print chain
// normalises RAW frames with (spektrafilm FilmingStage._compute_density_spectral_midgray_to_balance_print).
import type { PhysicsData } from '../data/provider.ts';
import { D65, SRGB_TO_XYZ } from '../print/colour.ts';
import { mulMV, type Vec3 } from '../spectral/linalg.ts';
import type { Stock } from '../spectral/stock.ts';
import { FilmCurves } from './curves.ts';
import { xyToXYZ } from '@chromobench/contract';
import { logRaw, makeExposer, spdXY, type AdaptMode } from './expose.ts';
import { buildFilmTable, sigmoidSpectraTable, spectralLocus, type FilmTable, type SpectraTable } from './upsample.ts';

export interface FilmModel {
  stock: Stock;
  table: FilmTable;
  /** The film's reference illuminant as XYZ (Y = 1) and xy. */
  refWhite: Vec3;
  refXY: [number, number];
  curves: FilmCurves;
  spectra: SpectraTable['source'];
}

const sigmoidCache = new WeakMap<object, SpectraTable>();

/** core's fallback spectra (sigmoid fit, 64²) for a data set's CMFs, built once. */
export function fallbackSpectra(data: PhysicsData): SpectraTable {
  const cmf = data.cmf();
  let t = sigmoidCache.get(cmf);
  if (!t) {
    t = sigmoidSpectraTable(cmf, 64);
    sigmoidCache.set(cmf, t);
  }
  return t;
}

/**
 * Seeds the fallback cache with a table built elsewhere (CHB-034: the GPU engine fits it in a worker at creation;
 * the fit takes ~110 ms and would otherwise run on the main thread at the first film). It must be
 * `sigmoidSpectraTable(data.cmf(), 64)`; a table already cached is kept.
 */
export function seedFallbackSpectra(data: PhysicsData, t: SpectraTable): void {
  const cmf = data.cmf();
  if (!sigmoidCache.has(cmf) && t.n === 64 && t.source === 'sigmoid-fit') sigmoidCache.set(cmf, t);
}

/** Bind a film: window + renormalisation + input gamut compression (spektrafilm defaults). */
export function makeFilmModel(data: PhysicsData, stock: Stock, spectra: SpectraTable): FilmModel {
  const cmf = data.cmf();
  const ref = data.illuminant(stock.data.meta.refIlluminant || 'D55');
  const refXY = spdXY(ref, cmf);
  const table = buildFilmTable(spectra, {
    sens: stock.sens, window: stock.data.window ?? null, refIlluminant: ref,
    compress: { refWhiteXY: refXY, locus: spectralLocus(cmf) }, key: `${stock.data.id}:${spectra.source}:${spectra.n}`,
  });
  return { stock, table, refWhite: xyToXYZ(refXY[0], refXY[1]), refXY, curves: FilmCurves.ofStock(stock), spectra: spectra.source };
}

/**
 * Linear raw of a display-referred linear sRGB colour through the film (CAT16 D65 → reference white),
 * spektrafilm's `_rgb_to_film_raw` with the sRGB input it uses for the mid-grey.
 */
export function rawOfLinearSRGB(m: FilmModel, rgb: ArrayLike<number>, o: { adapt?: AdaptMode; ev?: number; interp?: 'cubic' | 'bilinear' } = {}): Float64Array {
  const ex = makeExposer(m.table, { adapt: o.adapt ?? 'to-film-reference', sourceWhite: D65, refWhite: m.refWhite, ev: o.ev ?? 0, interp: o.interp ?? 'cubic' });
  return ex.raw(mulMV(SRGB_TO_XYZ, rgb));
}

/**
 * The film's mid-grey spectral density for the print normalisation of RAW frames: an RGB 0.184 grey
 * through the capture path, the un-normalised datasheet curves and the spectral density (with base).
 */
export function midgrayFilmDensity(m: FilmModel): Float64Array {
  const raw = rawOfLinearSRGB(m, [0.184, 0.184, 0.184]);
  const c = m.stock.rawCurves.map((cv, k) => cv.at(logRaw(raw[k]!)));
  return m.stock.spectral(c);
}
