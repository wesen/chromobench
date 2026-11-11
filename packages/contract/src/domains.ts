// Domains: what kind of number an image holds (architecture doc §5.1, guide §5.2).
import type { Unit } from './units.ts';

export type Domain =
  | 'camera-linear'     // linear sensor values: a negative scan, or a RAW photo before colour conversion
  | 'scene-xyz'         // scene-referred CIE XYZ (forward path input)
  | 'scanner-density'   // −log10(T/T_rebate) per scanner channel
  | 'film-logH'         // log10 exposure per film layer; grey card = 0      (spektrafilm tap log_e_film)
  | 'film-dyes'         // dye amounts c per layer (+ optional residual)    (tap cmy_film)
  | 'printing-density'  // density of the negative as the paper sees it
  | 'paper-logH'        // log10 exposure per paper layer                    (tap log_e_print)
  | 'paper-dyes'        // paper dye amounts                                 (tap cmy_print)
  | 'print-xyz'         // XYZ of the print under the viewing light
  | 'display-rgb'       // encoded output RGB                                (tap rgb_out)
  | 'mask'              // one channel, 0..1
  | 'scan-classes'      // one channel, integer class codes (CHB-003/006)
  | 'scalar-field'      // one channel, unbounded numeric map: noise gain, z maps (CHB-006)
  | 'silver-density';   // reserved for black-and-white (CHB-014)

export interface DomainInfo {
  /** Default channel count; OpDef.channels may override (invert.dyes → 4). */
  channels: 1 | 3 | 4;
  unit: Unit;
  /** Values a conformance input may contain. Bounds the generator; never clamps real data. */
  range: [number, number];
  /** spektrafilm / Filmbench tap name. */
  tap?: string;
  /** Meaning of a fourth channel when present. */
  channel4?: string;
  doc: string;
}

export const DOMAINS: Readonly<Record<Domain, DomainInfo>> = Object.freeze({
  'camera-linear': { channels: 3, unit: 'fraction', range: [0, 1], channel4: 'infrared (CHB-006, DecodeOptions.ir)', doc: 'linear sensor signal; T = signal / flat' },
  'scene-xyz': { channels: 3, unit: 'none', range: [0, 4], doc: 'scene XYZ, Y = 1 for diffuse white' },
  'scanner-density': { channels: 3, unit: 'D', range: [-0.2, 4], channel4: 'infrared density (dust)', doc: '−log10(T / T_rebate) per scanner channel' },
  'film-logH': { channels: 3, unit: 'logH', range: [-4, 3], tap: 'log_e_film', doc: 'grey card = 0' },
  'film-dyes': { channels: 3, unit: 'none', range: [0, 3], tap: 'cmy_film', channel4: 'solve residual in D (invert.dyes)', doc: 'dye amounts in unit dye spectra' },
  'printing-density': { channels: 3, unit: 'D', range: [0, 4], doc: 'negative density as the paper sees it' },
  'paper-logH': { channels: 3, unit: 'logH', range: [-4, 3], tap: 'log_e_print', doc: 'paper log exposure' },
  'paper-dyes': { channels: 3, unit: 'none', range: [0, 3], tap: 'cmy_print', doc: 'paper dye amounts' },
  'print-xyz': { channels: 3, unit: 'none', range: [0, 1.2], doc: 'print under the viewing light' },
  'display-rgb': { channels: 3, unit: 'none', range: [0, 1], tap: 'rgb_out', doc: 'encoded output RGB' },
  mask: { channels: 1, unit: 'fraction', range: [0, 1], doc: 'one channel, 0..1' },
  'scan-classes': { channels: 1, unit: 'none', range: [0, 3], doc: 'class codes: 0 ok, 1 blank, 2 below base, 3 out of gamut' },
  'scalar-field': { channels: 1, unit: 'none', range: [0, 10], doc: 'one-channel numeric map, unbounded (noise gain 1/σ, z maps)' },
  'silver-density': { channels: 1, unit: 'D', range: [0, 4], doc: 'reserved for CHB-014: net visual density of developed silver' },
});

export const DOMAIN_NAMES = Object.keys(DOMAINS) as Domain[];

/** What a `display-rgb` image's numbers mean (CHB-011). */
export interface ColourEncoding {
  space: string; // OutputSpaceId | 'canvas-srgb' | 'canvas-p3'
  transfer: 'encoded' | 'linear';
  bits: 8 | 16;
}

export interface ImageInfo {
  kind: 'Image';
  domain: Domain;
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  /** Physical scale; spatial physics is specified in µm. */
  umPerPx: { film?: number; paper?: number };
  /** Only for camera-linear sources before decoding. */
  encoding?: 'linear' | 'srgb' | 'gamma22';
  /** For print-xyz: the white the XYZ is relative to (CHB-003). */
  whiteXYZ?: [number, number, number];
  /** For display-rgb (CHB-011). */
  colour?: ColourEncoding;
}

export function isDomain(x: unknown): x is Domain {
  return typeof x === 'string' && Object.hasOwn(DOMAINS, x);
}
