// FrameRecipe: the persisted description of what was done to one frame (architecture doc §5.4,
// guide §5.8, merged additions from CHB-003/004/006/009/010/011/012/015; see CONTRACT-DECISIONS.md).
// Every stored coordinate is in sensor pixels of the decoded source (DR-3, CHB-006 DR-7).
//
// This module holds the types and the field schema only. It does not import the registry, so the
// registry can validate argument paths against it. Paths, fold and validation live in paths.ts.
import type { ArgSpec, Box, Cmy, Vec3 } from './spec.ts';
import type { DecodeOptions, SourceRef } from './source.ts';
import type { NodeDef } from './graph-types.ts';

export const RECIPE_VERSION = 1 as const;

export type Orientation = 'none' | 'cw90' | 'rot180' | 'ccw90' | 'flipH' | 'flipV' | 'transpose' | 'transverse';
export const ORIENTATIONS: readonly Orientation[] = ['none', 'cw90', 'rot180', 'ccw90', 'flipH', 'flipV', 'transpose', 'transverse'];

export type FilmFormat = '135' | '645' | '66' | '67' | '45';

export interface AutoBalance {
  method: 'none' | 'integrate' | 'grey-patch' | 'roll' | 'match' | 'learned';
  alpha: number;
  analysisLongSide_px: number;
  rollConsistency: number | null;
  matchFrame: string | null;
  matchAmount: number | null;
  /** Whether `logH` below was applied to print.lights.logH. */
  applied: boolean;
  /** The automatic proposal, in log H. */
  logH: Vec3;
}

export interface DustSpot { id: string; x: number; y: number; r: number }
export interface DustSettings { spots: DustSpot[]; method: 'patch' | 'diffuse' | 'neutral'; marginPx: number }

export interface ScanSettings {
  scanner: string;
  stock: string;
  format: FilmFormat;
  /** null = automatic detection. */
  rebate: Box | null;
  /** SHA-256 of the flat-field frame, or null. */
  flat: string | null;
  openGate: Box | 'flat' | null;
  /** Scanner flare, percent of the open-gate signal (per-channel flare deferred, see CONTRACT-DECISIONS). */
  flare: number;
  orientation: Orientation;
  crop: Box | null;
  dust: DustSettings;
}

export interface DevelopmentSettings {
  push: number;
  dir: { amount: number; diffusion_um: number };
  halation: { strength: number };
  grain: { amount: number; size_um: number; seed: number };
}

export interface CaptureSettings {
  stock: string;
  exposureEV: number;
  whiteBalance: { mode: 'daylight' | 'as-shot' | 'custom'; temperature_K: number; tint: number };
  adapt: 'to-film-reference' | 'none';
  autoExposure: { method: 'off' | 'mean' | 'grey'; analysisLongSide_px: number };
  format: { longEdge_mm: number };
  development: DevelopmentSettings;
}

export interface Exposure {
  /** Record key in paths: print.exposures.<id>.time_s. */
  id: string;
  /** 'main' is reserved: the main exposure comes from print.enlarger and is not stored here (CHB-010). */
  kind: 'dodge' | 'burn' | 'flash' | 'split';
  enabled: boolean;
  mask: string | null;
  time_s: number | null;
  /** Relative to the main time: burn t_main(2^s − 1), dodge t_main(1 − 2^−s). */
  stops: number | null;
  /** The exposure's own pack (a shift on the database neutral, as print.enlarger.filtration); forbidden on dodge. */
  filtration: Cmy | null;
  through: 'base' | 'open' | null;
}

/** 'oklch' was called 'cam16-ucs' before contract 0.2 (migrateRecipe rewrites it); CAM16-UCS proper is CHB-011's. */
export type KneeMethod = 'oklch' | 'tanh-shoulder' | 'clip';
/** Adapted from CHB-011: one strength parameter (p for oklch, s for tanh-shoulder). */
export interface KneeSpec { method: KneeMethod; strength: number }
export type OutputSpaceId = 'srgb' | 'display-p3' | 'rec2020' | 'adobe-rgb' | 'prophoto';
export const OUTPUT_SPACES: readonly OutputSpaceId[] = ['srgb', 'display-p3', 'rec2020', 'adobe-rgb', 'prophoto'];
export type Intent = 'perceptual' | 'relative' | 'saturation' | 'absolute';

export interface ExportSettings {
  format: 'tiff16' | 'png16' | 'png8' | 'jpeg';
  space: OutputSpaceId;
  knee: KneeSpec;
  scale: 'full' | number;
  dpi: number;
  compression: 'none' | 'deflate';
  signal: 'icc' | 'icc+cicp' | 'none';
  recipe: 'sidecar' | 'embedded' | 'none';
}
export interface ProofSettings { printer: string; intent: Intent; proofIntent: 'absolute' | 'relative'; bpc: boolean; gamutWarning: boolean }
export interface PrinterSettings { profile: string; intent: Intent; bpc: boolean; working: OutputSpaceId }

export interface OutputSettings {
  rendering: 'print-as-seen' | 'scan-of-print';
  /** Adaptation white for view.adapt. */
  white: 'D50' | 'D65';
  display: { knee: KneeSpec; proof: ProofSettings | null };
  export: ExportSettings;
  printer: PrinterSettings | null;
}

/** A mask stored as the node definitions that build it (closure of a mask-domain node). */
export interface MaskSpec { version: 1; nodes: NodeDef[] }

export interface Probe { x: number; y: number; r: number }

export interface FinishingSettings {
  look: number;
  values: Record<string, number>;
  hues: Record<string, Vec3>;
}

export interface FrameRecipe {
  version: typeof RECIPE_VERSION;
  frame: string;
  kind: 'negative-scan' | 'digital-raw';
  source: Omit<SourceRef, 'bytes'> & { decode: DecodeOptions };
  /** Data pack the frame was created with (CHB-004). */
  data: { pack: string; packHash: string } | null;
  scan?: ScanSettings;
  capture?: CaptureSettings;
  print: {
    paper: string;
    aim: 'grey-0.184' | 'midgray-normalised';
    enlarger: { mode: 'real' | 'normalised'; lamp: string; filtration: Cmy; time_s: number; fstop: number; magnification: number | null };
    lights: { logH: Vec3; auto: AutoBalance };
    exposures: Exposure[];
    grade: number;
    preflash: number;
  };
  view: { illuminant: string; flare: number; output: OutputSettings };
  masks: Record<string, MaskSpec>;
  probes: Record<string, Probe>;
  finishing: FinishingSettings;
}

// ---------------------------------------------------------------------------------------------
// Field schema. Every settable leaf path, as a pattern ('*' matches a record key or exposure id).
// 'op' means the value is checked by the ArgSpec of the op argument that owns the path (the
// registry verifies each owner exists and agrees). Other rules carry their own ArgSpec-like check.

export type FieldRule =
  | { kind: 'op'; doc?: string }
  | { kind: 'spec'; spec: ArgSpec; nullable?: boolean }
  | { kind: 'custom'; check: (v: unknown) => string | null; doc: string };

const spec = (s: ArgSpec, nullable = false): FieldRule => ({ kind: 'spec', spec: s, nullable });
const OP: FieldRule = { kind: 'op' };
const custom = (doc: string, check: (v: unknown) => string | null): FieldRule => ({ kind: 'custom', doc, check });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(fin);

export const RECIPE_FIELDS: Readonly<Record<string, FieldRule>> = Object.freeze({
  // source (identity is fixed by frame.add; decode options are settable)
  'source.decode.encoding': OP,
  'source.decode.mode': spec({ type: 'enum', values: ['scan', 'photo'], doc: 'LibRaw mode' }),
  // data pack
  'data': custom('{pack, packHash} or null', (v) => (v === null || (isObj(v) && typeof v['pack'] === 'string' && typeof v['packHash'] === 'string') ? null : 'expected {pack, packHash} or null')),
  // scan (negative-scan)
  'scan.scanner': OP,
  'scan.stock': OP,
  'scan.format': spec({ type: 'enum', values: ['135', '645', '66', '67', '45'], doc: 'film format; sets umPerPx.film' }),
  'scan.rebate': OP,
  'scan.flat': OP,
  'scan.openGate': custom('Box, "flat" or null (sensor px)', (v) => (v === null || v === 'flat' || (isObj(v) && ['x', 'y', 'w', 'h'].every((k) => fin(v[k]))) ? null : 'expected a box, "flat" or null')),
  'scan.flare': OP,
  'scan.orientation': OP,
  'scan.crop': OP,
  'scan.dust.spots': custom('DustSpot[] in sensor px', (v) => (Array.isArray(v) && v.every((d) => isObj(d) && typeof d['id'] === 'string' && fin(d['x']) && fin(d['y']) && fin(d['r'])) ? null : 'expected [{id, x, y, r}]')),
  'scan.dust.method': OP,
  'scan.dust.marginPx': OP,
  // capture (digital-raw, CHB-012)
  'capture.stock': OP,
  'capture.exposureEV': OP,
  'capture.whiteBalance.mode': OP,
  'capture.whiteBalance.temperature_K': OP,
  'capture.whiteBalance.tint': OP,
  'capture.adapt': spec({ type: 'enum', values: ['to-film-reference', 'none'], doc: 'adapt the scene white to the film reference' }),
  'capture.autoExposure.method': spec({ type: 'enum', values: ['off', 'mean', 'grey'], doc: 'automatic exposure' }),
  'capture.autoExposure.analysisLongSide_px': spec({ type: 'number', unit: 'px', min: 16, max: 4096, integer: true, doc: 'analysis size' }),
  'capture.format.longEdge_mm': spec({ type: 'number', unit: 'none', min: 10, max: 300, doc: 'long edge of the simulated film format in mm; sets umPerPx.film' }),
  'capture.development.push': OP,
  'capture.development.dir.amount': OP,
  'capture.development.dir.diffusion_um': OP,
  'capture.development.halation.strength': OP,
  'capture.development.grain.amount': OP,
  'capture.development.grain.size_um': OP,
  'capture.development.grain.seed': OP,
  // print
  'print.paper': OP,
  'print.aim': OP,
  'print.enlarger.mode': OP,
  'print.enlarger.lamp': OP,
  'print.enlarger.filtration': OP,
  'print.enlarger.time_s': OP,
  'print.enlarger.fstop': OP,
  'print.enlarger.magnification': OP,
  'print.lights.logH': OP,
  'print.lights.auto': custom('AutoBalance', (v) => {
    if (!isObj(v)) return 'expected an AutoBalance object';
    if (!['none', 'integrate', 'grey-patch', 'roll', 'match', 'learned'].includes(String(v['method']))) return 'unknown auto method';
    if (!fin(v['alpha']) || !fin(v['analysisLongSide_px']) || typeof v['applied'] !== 'boolean' || !vec3(v['logH'])) return 'malformed AutoBalance';
    return null;
  }),
  'print.exposures.*.kind': spec({ type: 'enum', values: ['dodge', 'burn', 'flash', 'split'], doc: 'exposure kind' }),
  'print.exposures.*.enabled': spec({ type: 'bool', doc: 'switch an exposure off while comparing' }),
  'print.exposures.*.mask': spec({ type: 'string', doc: 'mask id in masks' }, true),
  'print.exposures.*.time_s': spec({ type: 'number', unit: 's', min: 0, max: 600, doc: 'absolute time' }, true),
  'print.exposures.*.stops': spec({ type: 'number', unit: 'stop', min: -6, max: 6, doc: 'relative to the main time' }, true),
  'print.exposures.*.filtration': spec({ type: 'cmy', unit: 'CC', min: -100, max: 200, doc: "the exposure's own pack, a shift on the database neutral like print.enlarger.filtration" }, true),
  'print.exposures.*.through': spec({ type: 'enum', values: ['base', 'open'], doc: 'flash through the base or open gate' }, true),
  'print.grade': OP,
  'print.preflash': OP,
  // view and output (CHB-011)
  'view.illuminant': OP,
  'view.flare': OP,
  'view.output.rendering': OP,
  'view.output.white': OP,
  'view.output.display.knee.method': OP,
  'view.output.display.knee.strength': spec({ type: 'number', unit: 'none', min: 0, max: 20, doc: 'knee strength (p or s)' }),
  'view.output.display.proof': custom('ProofSettings or null', (v) => (v === null || isObj(v) ? null : 'expected ProofSettings or null')),
  'view.output.export.format': OP,
  'view.output.export.space': spec({ type: 'enum', values: [...OUTPUT_SPACES], doc: 'export colour space' }),
  'view.output.export.knee.method': spec({ type: 'enum', values: ['oklch', 'tanh-shoulder', 'clip'], doc: 'export knee' }),
  'view.output.export.knee.strength': spec({ type: 'number', unit: 'none', min: 0, max: 20, doc: 'export knee strength' }),
  'view.output.export.scale': custom("'full' or a number in (0, 1]", (v) => (v === 'full' || (fin(v) && v > 0 && v <= 1) ? null : "expected 'full' or a number in (0, 1]")),
  'view.output.export.dpi': OP,
  'view.output.export.compression': OP,
  'view.output.export.signal': spec({ type: 'enum', values: ['icc', 'icc+cicp', 'none'], doc: 'colour signalling' }),
  'view.output.export.recipe': spec({ type: 'enum', values: ['sidecar', 'embedded', 'none'], doc: 'recipe storage' }),
  'view.output.printer': custom('PrinterSettings or null', (v) => (v === null || isObj(v) ? null : 'expected PrinterSettings or null')),
  // probes (CHB-009) and finishing (CHB-015)
  'probes.*': custom('{x, y, r} in sensor px', (v) => (isObj(v) && fin(v['x']) && fin(v['y']) && fin(v['r']) && v['r'] > 0 ? null : 'expected {x, y, r} with r > 0')),
  'finishing.look': spec({ type: 'number', unit: 'fraction', min: 0, max: 1, doc: 'look amount' }),
  'finishing.values.clarity': OP,
  'finishing.values.clarity_radius_px': OP,
  'finishing.hues.*': custom('[shift_deg, saturation, luminance]', (v) => (vec3(v) ? null : 'expected [shift_deg, saturation, luminance]')),
});

/** Splits a dotted path. Record keys and exposure ids must not contain dots. */
export const splitPath = (p: string): string[] => p.split('.');
