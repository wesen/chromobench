// FrameRecipe: the persisted description of what was done to one frame (architecture doc §5.4,
// guide §5.8, merged additions from CHB-003/004/006/009/010/011/012/015; see CONTRACT-DECISIONS.md).
// Every stored coordinate is in sensor pixels of the decoded source (DR-3, CHB-006 DR-7).
//
// This module holds the types and the field schema only. It does not import the registry, so the
// registry can validate argument paths against it. Paths, fold and validation live in paths.ts.
import type { ArgSpec, Box, Cmy, Vec3 } from './spec.ts';
import type { DecodeOptions, SourceRef } from './source.ts';
import type { NodeDef } from './graph-types.ts';

/** 2 since contract 0.3 (migrations[1]: view.frame, scan.baseT, retouch, density masks, roll, the knee rename). */
export const RECIPE_VERSION = 2 as const;

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
  /** The automatic proposal, in log H. For 'roll' and 'match' it is the applied result; `method` records provenance (CHB-020 #6). */
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
  /**
   * Linear value of the film base (veil- and flat-corrected), the zero of scanner density; null = measure on
   * `rebate`. Roll setup writes the roll's base to every frame (CHB-020, contract 0.3).
   */
  baseT: Vec3 | null;
  /** SHA-256 of the flat-field frame, or null. */
  flat: string | null;
  openGate: Box | 'flat' | null;
  /** Scanner flare, percent of the open-gate signal; a vec3 is per channel (R, G, B) (contract 0.3). */
  flare: number | Vec3;
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

/**
 * 'oklch' was called 'cam16-ucs' before contract 0.2; since contract 0.3 'cam16-ucs' is CAM16-UCS proper
 * (CHB-011), and migrations[1] rewrites version-1 recipes' 'cam16-ucs' to 'oklch'.
 */
export type KneeMethod = 'oklch' | 'cam16-ucs' | 'tanh-shoulder' | 'clip';
export const KNEE_METHODS: readonly KneeMethod[] = ['oklch', 'cam16-ucs', 'tanh-shoulder', 'clip'];
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

/**
 * Orientation, straightening and crop, applied last by output.frame (contract 0.3, CHB-022). Both frame
 * kinds have it (it was scan.orientation / scan.crop). Order: the crop box (sensor px of the un-oriented
 * source; null = the whole frame) is cut out with its content rotated by angle_deg about the box centre,
 * then the orientation is applied. angle_deg is clockwise as shown (after the orientation).
 */
export interface FrameSettings { orientation: Orientation; angle_deg: number; crop: Box | null }

/**
 * A neutral silver density mask made from the negative (CHB-010 §6.6, contract 0.3): print.densityMask on the
 * main exposure, applied by print.combine to every exposure through the negative (not to flashes).
 * `kind` is the photographer's name for it (contrast: wide blur; unsharp: thin spacer); the maths is the same.
 */
export interface DensityMask {
  kind: 'contrast' | 'unsharp';
  /** positive lowers large-area contrast; same raises it. */
  polarity: 'positive' | 'same';
  /** Mask gamma γ_m (0.6: large-area contrast falls to 40 %). */
  amount: number;
  /** Gaussian σ of the blur on the film, µm. */
  radius_um: number;
  enabled: boolean;
}

/** One retouch spot (CHB-022 §6.2): sensor px of the un-oriented source, so a crop never moves it. */
export interface RetouchSpot {
  mode: 'heal' | 'clone';
  x: number;
  y: number;
  r: number;
  /** Source centre, sensor px (always explicit). */
  src: { x: number; y: number };
  /** 0..1 of r. */
  feather: number;
  opacity: number;
  enabled: boolean;
}

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
    /** Keyed by id; `set print.densityMasks.<id> null` deletes one (contract 0.3). */
    densityMasks: Record<string, DensityMask>;
    grade: number;
    preflash: number;
  };
  view: { illuminant: string; flare: number; output: OutputSettings; frame: FrameSettings };
  masks: Record<string, MaskSpec>;
  probes: Record<string, Probe>;
  /** Heal and clone on the print (CHB-022); `set retouch.spots.<id> null` deletes a spot. */
  retouch: { spots: Record<string, RetouchSpot> };
  finishing: FinishingSettings;
  /** The roll the frame belongs to (CHB-020); the Roll record itself lives beside the frames (roll.ts). */
  roll: { id: string } | null;
}

// ---------------------------------------------------------------------------------------------
// Field schema. Every settable leaf path, as a pattern ('*' matches a record key or exposure id).
// 'op' means the value is checked by the ArgSpec of the op argument that owns the path (the
// registry verifies each owner exists and agrees). Other rules carry their own ArgSpec-like check.

export type FieldRule =
  | { kind: 'op'; doc?: string }
  | { kind: 'spec'; spec: ArgSpec; nullable?: boolean }
  /** `deletes`: a record entry ('*' last); `set <path> null` removes the key (contract 0.3). */
  | { kind: 'custom'; check: (v: unknown) => string | null; doc: string; deletes?: boolean };

const spec = (s: ArgSpec, nullable = false): FieldRule => ({ kind: 'spec', spec: s, nullable });
const OP: FieldRule = { kind: 'op' };
const custom = (doc: string, check: (v: unknown) => string | null): FieldRule => ({ kind: 'custom', doc, check });
const entry = (doc: string, check: (v: unknown) => string | null): FieldRule => ({ kind: 'custom', doc, check, deletes: true });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(fin);
const frac = (v: unknown): boolean => fin(v) && v >= 0 && v <= 1;

function checkDensityMask(v: unknown): string | null {
  if (!isObj(v)) return 'expected {kind, polarity, amount, radius_um, enabled}';
  if (v['kind'] !== 'contrast' && v['kind'] !== 'unsharp') return "kind must be 'contrast' or 'unsharp'";
  if (v['polarity'] !== 'positive' && v['polarity'] !== 'same') return "polarity must be 'positive' or 'same'";
  if (!frac(v['amount'])) return 'amount must be in [0, 1]';
  if (!fin(v['radius_um']) || v['radius_um'] < 0 || v['radius_um'] > 5000) return 'radius_um must be in [0, 5000]';
  if (typeof v['enabled'] !== 'boolean') return 'enabled must be a boolean';
  const extra = Object.keys(v).filter((k) => !['kind', 'polarity', 'amount', 'radius_um', 'enabled'].includes(k));
  return extra.length ? `unknown field ${extra[0]}` : null;
}

function checkSpot(v: unknown): string | null {
  if (!isObj(v)) return 'expected {mode, x, y, r, src: {x, y}, feather, opacity, enabled}';
  if (v['mode'] !== 'heal' && v['mode'] !== 'clone') return "mode must be 'heal' or 'clone'";
  if (!fin(v['x']) || !fin(v['y'])) return 'x and y must be numbers (sensor px)';
  if (!fin(v['r']) || v['r'] <= 0) return 'r must be a positive number (px)';
  const src = v['src'];
  if (!isObj(src) || !fin(src['x']) || !fin(src['y'])) return 'src must be {x, y} in sensor px';
  if (!frac(v['feather']) || !frac(v['opacity'])) return 'feather and opacity must be in [0, 1]';
  if (typeof v['enabled'] !== 'boolean') return 'enabled must be a boolean';
  return null;
}

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
  'scan.baseT': OP,
  'scan.flat': OP,
  'scan.openGate': custom('Box, "flat" or null (sensor px)', (v) => (v === null || v === 'flat' || (isObj(v) && ['x', 'y', 'w', 'h'].every((k) => fin(v[k]))) ? null : 'expected a box, "flat" or null')),
  'scan.flare': OP,
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
  'print.densityMasks.*': entry('DensityMask {kind, polarity, amount, radius_um, enabled}; null deletes', checkDensityMask),
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
  'view.output.export.knee.method': spec({ type: 'enum', values: [...KNEE_METHODS], doc: 'export knee' }),
  'view.output.export.knee.strength': spec({ type: 'number', unit: 'none', min: 0, max: 20, doc: 'export knee strength' }),
  'view.output.export.scale': custom("'full' or a number in (0, 1]", (v) => (v === 'full' || (fin(v) && v > 0 && v <= 1) ? null : "expected 'full' or a number in (0, 1]")),
  'view.output.export.dpi': OP,
  'view.output.export.compression': OP,
  'view.output.export.signal': spec({ type: 'enum', values: ['icc', 'icc+cicp', 'none'], doc: 'colour signalling' }),
  'view.output.export.recipe': spec({ type: 'enum', values: ['sidecar', 'embedded', 'none'], doc: 'recipe storage' }),
  'view.output.printer': custom('PrinterSettings or null', (v) => (v === null || isObj(v) ? null : 'expected PrinterSettings or null')),
  // frame (contract 0.3: was scan.orientation / scan.crop; output.frame owns them)
  'view.frame.orientation': OP,
  'view.frame.angle_deg': OP,
  'view.frame.crop': OP,
  // retouch (CHB-022) and roll (CHB-020)
  'retouch.spots.*': entry('RetouchSpot {mode, x, y, r, src, feather, opacity, enabled} in sensor px; null deletes', checkSpot),
  'roll': custom('{id} or null', (v) => (v === null || (isObj(v) && typeof v['id'] === 'string' && v['id'].length > 0 && Object.keys(v).length === 1) ? null : 'expected {id: string} or null')),
  // probes (CHB-009) and finishing (CHB-015)
  'probes.*': custom('{x, y, r} in sensor px', (v) => (isObj(v) && fin(v['x']) && fin(v['y']) && fin(v['r']) && v['r'] > 0 ? null : 'expected {x, y, r} with r > 0')),
  'finishing.look': spec({ type: 'number', unit: 'fraction', min: 0, max: 1, doc: 'look amount' }),
  'finishing.values.clarity': OP,
  'finishing.values.clarity_radius_px': OP,
  'finishing.hues.*': custom('[shift_deg, saturation, luminance]', (v) => (vec3(v) ? null : 'expected [shift_deg, saturation, luminance]')),
});

/** Splits a dotted path. Record keys and exposure ids must not contain dots. */
export const splitPath = (p: string): string[] => p.split('.');
