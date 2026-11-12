// Open mode (CHB-027 WS-A, findings F1 and F15): is an opened file a photo from a digital camera or a scan of a
// colour negative? Guessed from the pixels of the working image (any decode mode: linear RGB, 0 = black,
// 1 = white level), so the studio opens a photographer's NEFs as photos and his negative strip as a negative
// without a checkbox, and can say "this looks like a negative" when he chose otherwise.
//
// The evidence, strongest first:
//   film edge  filmLayout (CHB-020) finds an open gate (it is orange-mask checked there), or a rebate at the edge
//              of the image that carries the orange mask: only film has those;
//   mask       a colour negative's base is orange (blue and green densities ≥ 0.25 D above red, Gold 200 0.56 and
//              0.36 D), and every pixel of the negative sits on that base, so the whole image is orange: red over
//              blue in log units, across nearly all pixels;
//   prior      the file type: a camera RAW leans photo; a scanner TIFF leans negative.
// A warm photo (tungsten light, no white balance) also reads red over blue, so a mask without a film edge is
// "unsure" unless it is strong and nearly uniform: the studio then asks.
import type { Vec3 } from '@chromobench/contract';
import { filmLayout, type FilmLayout } from './film-layout.ts';

export type OpenKind = 'photo' | 'negative';

export interface OpenModeHints {
  /** The decoded format ('raw' for camera RAW through LibRaw, 'dng', 'tiff', 'png', 'image' for JPEG and the like). */
  format?: string;
  /** File name (its extension is used as a prior when `format` says nothing). */
  name?: string;
  /** White-balance multipliers to apply before reading colour (camera-native scan-mode data: daylight multipliers). */
  wb?: Vec3 | null;
  /** A film layout already computed on these pixels (scan conditioning does one), to save the work. */
  layout?: FilmLayout | null;
  /** Floats per pixel (default 3). */
  stride?: number;
}

export interface OpenModeEvidence {
  /** Open gate found by filmLayout (orange-mask checked). */
  openGate: boolean;
  /** A rebate at the image edge (not blank film inside the frame), with its confidence. */
  edgeRebate: number;
  /** The rebate's colour, lg R − lg B (after wb): ≥ 0.25 is an orange mask. */
  rebateCastRB: number | null;
  rebateCastRG: number | null;
  /** An opaque holder around the film. */
  holder: boolean;
  /** Median over the image of lg R − lg B and lg R − lg G (after wb). */
  castRB: number;
  castRG: number;
  /** Share of pixels whose colour is orange (lg R − lg B ≥ 0.2 and lg R − lg G ≥ 0.08). */
  orangeShare: number;
  /** Prior from the file type: 'photo', 'negative' or null. */
  prior: OpenKind | null;
}

export interface OpenModeGuess {
  kind: OpenKind;
  /** false: the studio should ask (with `kind` preselected). */
  confident: boolean;
  /** One line for a photographer: why this guess. */
  why: string;
  evidence: OpenModeEvidence;
}

/** Camera RAW extensions that are photos unless the pixels say otherwise (DNG is left out: scanners write it too). */
const CAMERA_RAW = /\.(nef|nrw|cr2|cr3|crw|arw|srf|sr2|raf|orf|rw2|pef|srw|x3f|3fr|iiq|mos|mrw|erf|kdc|dcr|rwl|raw)$/i;
const PHOTO_EXT = /\.(jpe?g|heic|heif|avif|webp)$/i;
const SCAN_EXT = /\.(tiff?)$/i;

export function openPrior(h: Pick<OpenModeHints, 'format' | 'name'>): OpenKind | null {
  const name = h.name ?? '';
  if (CAMERA_RAW.test(name)) return 'photo';
  if (PHOTO_EXT.test(name) || h.format === 'image') return 'photo';
  if (SCAN_EXT.test(name) || h.format === 'tiff') return 'negative';
  return null;
}

const lg = (v: number): number => Math.log10(Math.max(v, 1e-6));

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[s.length >> 1]!;
}

/** Colour statistics over a subsample of at most ~40 000 pixels, skipping near-black and clipped ones. */
function castOf(rgb: ArrayLike<number>, n: number, stride: number, wb: Vec3): { rb: number; rg: number; orange: number; count: number } {
  const step = Math.max(1, Math.floor(n / 40000));
  const rb: number[] = [];
  const rg: number[] = [];
  let orange = 0;
  for (let i = 0; i < n; i += step) {
    const r = rgb[i * stride]! * wb[0], g = rgb[i * stride + 1]! * wb[1], b = rgb[i * stride + 2]! * wb[2];
    const mx = Math.max(r, g, b);
    if (mx < 0.004 || rgb[i * stride]! >= 0.98 || rgb[i * stride + 1]! >= 0.98 || rgb[i * stride + 2]! >= 0.98) continue;
    const a = lg(r) - lg(b), c = lg(r) - lg(g);
    rb.push(a);
    rg.push(c);
    if (a >= 0.2 && c >= 0.08) orange++;
  }
  return { rb: median(rb), rg: median(rg), orange: rb.length ? orange / rb.length : 0, count: rb.length };
}

/** Photo or negative, from the pixels and the file type. */
export function guessOpenMode(rgb: ArrayLike<number>, width: number, height: number, h: OpenModeHints = {}): OpenModeGuess {
  const stride = h.stride ?? 3;
  const wb: Vec3 = h.wb && h.wb.every((v) => Number.isFinite(v) && v > 0) ? normalise(h.wb) : [1, 1, 1];
  const layout = h.layout ?? filmLayout(rgb, width, height, { long: 256, stride });
  const c = castOf(rgb, width * height, stride, wb);
  const reb = layout.rebate && layout.rebate.from === 'edge' ? layout.rebate : null;
  const rebateCastRB = reb ? lg(reb.Traw[0] * wb[0]) - lg(reb.Traw[2] * wb[2]) : null;
  const rebateCastRG = reb ? lg(reb.Traw[0] * wb[0]) - lg(reb.Traw[1] * wb[1]) : null;
  const ev: OpenModeEvidence = {
    openGate: !!layout.openGate,
    edgeRebate: reb ? reb.confidence : 0,
    rebateCastRB,
    rebateCastRG,
    holder: !!layout.surround && layout.surround.fraction >= 0.01,
    castRB: c.rb,
    castRG: c.rg,
    orangeShare: c.orange,
    prior: openPrior(h),
  };
  // the mask: red over green over blue, across nearly the whole image (raw010.dng: 0.59 / 0.31 D, every pixel)
  const maskStrong = c.rb >= 0.4 && c.rg >= 0.15 && c.orange >= 0.7;
  const maskWeak = c.rb >= 0.25 && c.rg >= 0.08 && c.orange >= 0.6;
  // a film edge: a rebate at the border that carries the mask. filmLayout's open gate alone is no evidence: on a
  // photo, blown highlights and sky pass its test (D750 NEFs), so it counts only together with a mask.
  const orangeRebate = reb !== null && reb.confidence >= 0.5 && (rebateCastRB ?? 0) >= 0.25 && (ev.rebateCastRG ?? 0) >= 0.1;
  const edge = orangeRebate || (ev.openGate && maskWeak);
  const say = (kind: OpenKind, confident: boolean, why: string): OpenModeGuess => ({ kind, confident, why, evidence: ev });
  if (edge && (maskWeak || maskStrong)) return say('negative', orangeRebate || ev.prior !== 'photo', orangeRebate ? 'film edge and an orange mask' : 'sprocket holes or a film gap and an orange mask');
  if (edge) return say('negative', ev.prior !== 'photo', 'a film edge with an orange base');
  // a strong mask with no edge: a tightly cropped negative, or a photo under tungsten light without white balance
  if (maskStrong) return say('negative', ev.prior !== 'photo', 'an orange mask over the whole image');
  if (maskWeak) return say(ev.prior === 'photo' ? 'photo' : 'negative', false, 'orange throughout, but no film edge: an orange mask or warm light');
  if (c.count === 0) return say(ev.prior ?? 'photo', false, 'too dark to tell');
  return say('photo', ev.prior !== 'negative', 'no orange mask and no film edge');
}

function normalise(v: Vec3): Vec3 {
  return [v[0] / v[1], 1, v[2] / v[1]];
}

/** "Colour negative" / "Photo" in a sentence, for notes and the status line. */
export function describeGuess(g: OpenModeGuess): string {
  return `${g.kind === 'negative' ? 'looks like a colour negative' : 'looks like a photo'} (${g.why}${g.confident ? '' : ', not sure'})`;
}
