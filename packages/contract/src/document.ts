// Document format 3 (contract 1.0, CHB-035 design 01 v2 §20–§25): one frame's edit. Five components — Op (the
// catalogue), Mask, Layer, Group, Stage — plus links and bindings, held in a Document. Every list at every depth is a
// Coll from @chromobench/values (stacks, groups' stacks, the mask library, a mask's components, a paint component's
// strokes, a heal layer's spots, probes), so the four mutations of values edit all of them and an id names an item
// wherever it sits. Every stored coordinate is in document pixels (pixels of the full-resolution decoded source);
// physical sizes are in µm on the film or mm on the print, as the catalogue's units say. Nothing reads versions 1
// and 2 (the recipe): there is no migration (design Decision D8).
//
// This module holds the types, the stage and cut tables, and the constructors of a new document. It imports no
// registry, law or compiler, so they can all import it.
import { Coll, type Id, type Json, type JsonObject } from '@chromobench/values';
import type { Domain } from './domains.ts';
import { fail } from './errors.ts';
import type { DecodeOptions, SourceRef } from './source.ts';
import type { Box, Cmy, Vec3 } from './spec.ts';

export const DOCUMENT_FORMAT = 3 as const;

// ---- stages, frame kinds, cuts ---------------------------------------------------------------------------------

export type StageName = 'scan' | 'scene' | 'film' | 'darkroom' | 'print';
/** Pipeline order. */
export const STAGE_NAMES: readonly StageName[] = ['scan', 'scene', 'film', 'darkroom', 'print'];

export type FrameKind = 'negative-scan' | 'digital-raw';
export const FRAME_KINDS: readonly FrameKind[] = ['negative-scan', 'digital-raw'];

/**
 * Named outputs of the compiled graph (design §29): what a reader (viewer, agent, mask, binding) addresses.
 * `negative` is the darkroom's input for both kinds; `darkroom.main` is the main exposure alone (paper log H, before
 * the other entries), which a luminance mask "of the print" reads.
 */
export type CutName = 'source' | 'scan' | 'scene.input' | 'scene' | 'film' | 'negative' | 'darkroom.main' | 'darkroom.H' | 'print' | 'finished' | 'display';

export interface CutDef {
  name: CutName;
  /** Position in the pipeline; a reader may only read cuts at or before its own position. */
  order: number;
  kinds: readonly FrameKind[];
  domain: Domain;
  /** The op of the node the cut names in a default document (the last op before it). */
  doc: string;
}

const BOTH: readonly FrameKind[] = FRAME_KINDS;
export const CUTS: readonly CutDef[] = Object.freeze([
  { name: 'source', order: 0, kinds: BOTH, domain: 'camera-linear', doc: 'The decoded source as opened (source.open): linear sensor values.' },
  { name: 'scan', order: 1, kinds: ['negative-scan'], domain: 'scanner-density', doc: 'The scan in scanner density after the scan stage (flat field, flare, density, dust heal).' },
  { name: 'scene.input', order: 1, kinds: ['digital-raw'], domain: 'scene-xyz', doc: "The scene in XYZ after white balance, before the scene stage: what the scene stage's masks measure." },
  { name: 'scene', order: 2, kinds: ['digital-raw'], domain: 'scene-xyz', doc: 'The scene in XYZ after white balance and the scene stage: what the film is exposed to.' },
  { name: 'film', order: 3, kinds: ['digital-raw'], domain: 'film-dyes', doc: 'The developed film of a camera file (after film.grain): its negative.' },
  { name: 'negative', order: 4, kinds: BOTH, domain: 'film-dyes', doc: "The negative in dye amounts: the darkroom's input (invert.dyes of a scan, the film of a camera file)." },
  { name: 'darkroom.main', order: 5, kinds: BOTH, domain: 'paper-logH', doc: 'The main exposure alone (print.expose of the entry main), before any other darkroom entry.' },
  { name: 'darkroom.H', order: 6, kinds: BOTH, domain: 'paper-logH', doc: 'Paper log exposure after the light law (every darkroom entry), before development.' },
  { name: 'print', order: 7, kinds: BOTH, domain: 'print-xyz', doc: 'The print under the viewing light, adapted (view.adapt), before the print stage.' },
  { name: 'finished', order: 8, kinds: BOTH, domain: 'print-xyz', doc: 'The print after the print stage (retouch, clarity, digital layers).' },
  { name: 'display', order: 9, kinds: BOTH, domain: 'display-rgb', doc: 'Display RGB after output.display and the document geometry (output.frame).' },
] as CutDef[]);
export const CUT_NAMES: readonly CutName[] = Object.freeze(CUTS.map((c) => c.name));

export function cutDef(name: string): CutDef | undefined {
  return CUTS.find((c) => c.name === name);
}

export type LawName = 'light' | 'composite' | 'repair';

export interface StageDef {
  name: StageName;
  kinds: readonly FrameKind[];
  /** The stage's law; null: the stage takes no entries yet (film). */
  law: LawName | null;
  /** The cut the stage's stack reads as its input: masks with `reads: 'stage-input'` measure it. */
  input: CutName;
  /** The cut after the stage's stack. */
  output: CutName;
  /** The last cut computed before the stage's medium is used: a binding in the medium may read up to it. */
  mediumAfter: CutName | null;
  doc: string;
}

export const STAGES: Readonly<Record<StageName, StageDef>> = Object.freeze({
  scan: { name: 'scan', kinds: ['negative-scan'], law: 'repair', input: 'source', output: 'scan', mediumAfter: null, doc: 'Negative scans: scanner, stock and base; heal and clone on the negative (dust).' },
  scene: { name: 'scene', kinds: ['digital-raw'], law: 'composite', input: 'scene.input', output: 'scene', mediumAfter: 'source', doc: 'Camera files: white balance; digital adjustments before the film (scene-linear).' },
  film: { name: 'film', kinds: ['digital-raw'], law: null, input: 'scene', output: 'film', mediumAfter: 'scene', doc: 'Camera files: the film the scene is shot on and its development.' },
  darkroom: { name: 'darkroom', kinds: FRAME_KINDS, law: 'light', input: 'negative', output: 'darkroom.H', mediumAfter: 'negative', doc: 'The enlarger and the paper: light on the paper (exposures, dodges, burns, flashes, masks, filters).' },
  // the print medium's illuminant is the darkroom's aim view, so it is used before darkroom.H
  print: { name: 'print', kinds: FRAME_KINDS, law: 'composite', input: 'print', output: 'finished', mediumAfter: 'negative', doc: 'The print under the viewing light: retouch, clarity, digital layers (print-referred).' },
});

/** Cuts an entry of `stage` may read (bindings: `binding`; masks also read `darkroom.main` in the darkroom). */
export function readableCuts(stage: StageName, kind: FrameKind, use: 'mask' | 'binding' | 'medium'): CutName[] {
  const s = STAGES[stage];
  const limit = use === 'medium' ? s.mediumAfter : s.input;
  if (limit === null) return [];
  const max = cutDef(limit)!.order;
  const out = CUTS.filter((c) => c.kinds.includes(kind) && c.order <= max).map((c) => c.name);
  if (use === 'mask' && stage === 'darkroom') out.push('darkroom.main');
  return out;
}

// ---- entries ---------------------------------------------------------------------------------------------------

/**
 * Blend modes of the composite law (contract 1.1): the W3C Compositing and Blending set. Separable modes act per
 * channel in linear RGB (white = 1); hue, saturation, colour and luminosity act in OkLCh (design §5, §22).
 */
export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'colour-dodge', 'colour-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'colour', 'luminosity',
] as const;
/** The blend modes defined through lightness, chroma and hue (OkLCh), not per channel. */
export const NON_SEPARABLE_BLENDS: readonly BlendMode[] = ['hue', 'saturation', 'colour', 'luminosity'];
export type BlendMode = (typeof BLEND_MODES)[number];
/** A layer blends with a mode; a group is 'pass' (children act on the backdrop) or isolated with a mode. */
export type EntryBlend = BlendMode | 'pass';

/** Who or what made an entry: `{ kind: 'user' }`, `{ kind: 'agent', turn, step }`, `{ kind: 'auto', by }`, a look, a roll, a script line. */
export interface Provenance extends JsonObject {
  readonly kind: string;
}

/** A parameter computed at compile time by a registered binding function (design §28). */
export interface BindingRef {
  readonly bind: string;
  readonly version: number;
  readonly args?: JsonObject;
  /** The cut the binding measures; strictly upstream of where its value is used. */
  readonly reads?: CutName;
}

/** Op arguments as stored: list arguments are Colls; any value may be a BindingRef. */
export type Params = Readonly<Record<string, Json>>;

export interface EntryBase {
  readonly name: string;
  readonly enabled: boolean;
  /** The law's fade: light scales time and density; composite and repair mix (opacity). */
  readonly amount: number;
  /** A mask in Document.masks, or null. */
  readonly mask: Id | null;
  readonly blend: EntryBlend;
  readonly source: Provenance;
}

export interface Layer extends EntryBase {
  readonly kind: 'layer';
  readonly op: string;
  readonly params: Params;
}

export interface Group extends EntryBase {
  readonly kind: 'group';
  readonly stack: Coll<Entry>;
}

export type LinkRef = { readonly roll: Id } | { readonly look: string; readonly version: number } | { readonly preset: Id };

/** An entry whose content comes from a shared definition (design §27); it expands to a group at compile time. */
export interface LinkEntry extends EntryBase {
  readonly kind: 'link';
  readonly ref: LinkRef;
  /** The look function's parameters (looks); empty for rolls and presets. */
  readonly params: Params;
  /** Per-frame changes to the expanded group: path inside it (`b1.amount`) → value. */
  readonly overrides: Readonly<Record<string, Json>>;
}

export type Entry = Layer | Group | LinkEntry;

/** A medium whose fields come from a link (a roll), with per-frame overrides (field path → value). */
export interface Linked {
  readonly link: LinkRef;
  readonly overrides: Readonly<Record<string, Json>>;
}

export interface Stage<M> {
  readonly medium: M | Linked;
  readonly stack: Coll<Entry>;
}

export function isLinked(m: unknown): m is Linked {
  return typeof m === 'object' && m !== null && 'link' in m && 'overrides' in m;
}

// ---- media -----------------------------------------------------------------------------------------------------

export type FilmFormat = '135' | '645' | '66' | '67' | '45';
export const FILM_FORMATS: readonly FilmFormat[] = ['135', '645', '66', '67', '45'];
/** Long edge of the image area of each format, mm (135: 36; 120 formats: their long side; 4×5 in: 120). */
export const FORMAT_LONG_EDGE_MM: Readonly<Record<FilmFormat, number>> = Object.freeze({ '135': 36, '645': 56, '66': 56, '67': 70, '45': 120 });

export interface ScanMedium {
  readonly scanner: string;
  readonly stock: string;
  readonly format: FilmFormat;
  /** Film µm per document pixel: the scan's pitch on the film (explicit; nothing has a default). */
  readonly umPerPx: number;
  /** null = automatic detection. */
  readonly rebate: Box | null;
  /** Linear value of the film base, the zero of scanner density (the roll's, CHB-020); null = measure on `rebate`. */
  readonly baseT: Vec3 | null;
  /** SHA-256 of the flat-field frame, or null. */
  readonly flat: string | null;
  readonly openGate: Box | 'flat' | null;
  /** Scanner flare, percent of the open-gate signal; a vec3 is per channel. */
  readonly flare: number | Vec3;
}

export interface SceneMedium {
  readonly whiteBalance: { readonly mode: 'daylight' | 'as-shot' | 'custom'; readonly temperature_K: number; readonly tint: number };
}

export interface FilmMedium {
  readonly stock: string;
  /** Exposure of the film relative to the stock reference. */
  readonly exposureEV: number;
  /** The simulated film format: its long edge over the source's long side is the film pitch. */
  readonly format: { readonly longEdge_mm: number };
  readonly push: number;
  readonly dir: { readonly amount: number; readonly diffusion_um: number };
  readonly halation: { readonly strength: number };
  readonly grain: { readonly amount: number; readonly size_um: number; readonly seed: number };
}

export interface DarkroomMedium {
  readonly paper: string;
  readonly aim: 'grey-0.184' | 'midgray-normalised';
  readonly mode: 'real' | 'normalised';
  readonly lamp: string;
  /** Enlarger magnification: light ∝ 1/(m + 1)² in real mode, and the print's pitch (paper µm/px = film µm/px × m). */
  readonly magnification: number;
  /** Contrast grade: a gamma of the paper's development about the aim grey (not light: it stays in the medium). */
  readonly grade: number;
}

export interface PrintMedium {
  /** The viewing light (also the darkroom's aim view). */
  readonly illuminant: string;
  /** Viewing flare, percent of the paper white. */
  readonly flare: number;
}

export interface Stages {
  readonly scan?: Stage<ScanMedium>;
  readonly scene?: Stage<SceneMedium>;
  readonly film?: Stage<FilmMedium>;
  readonly darkroom: Stage<DarkroomMedium>;
  readonly print: Stage<PrintMedium>;
}

export interface Media {
  scan: ScanMedium;
  scene: SceneMedium;
  film: FilmMedium;
  darkroom: DarkroomMedium;
  print: PrintMedium;
}

// ---- masks -----------------------------------------------------------------------------------------------------

/**
 * Mask components (design §25), each the op `mask.<kind>`: geometric (linear, radial, ellipse, paint: document pixels)
 * or a range of the image the mask reads (luminance, colour).
 */
export type MaskComponentKind = 'linear' | 'radial' | 'ellipse' | 'paint' | 'luminance' | 'colour';
export const MASK_COMPONENT_KINDS: readonly MaskComponentKind[] = ['linear', 'radial', 'ellipse', 'paint', 'luminance', 'colour'];
/** Components that measure the image the mask reads (the others depend on position only). */
export const RANGE_COMPONENTS: readonly MaskComponentKind[] = ['luminance', 'colour'];
export type MaskCombine = 'add' | 'subtract' | 'intersect';
export const MASK_COMBINES: readonly MaskCombine[] = ['add', 'subtract', 'intersect'];

export interface MaskComponent {
  readonly kind: MaskComponentKind;
  /** Arguments of the op `mask.<kind>` (document pixels); a paint component's `strokes` is a Coll<Stroke>. */
  readonly params: Params;
  readonly combine: MaskCombine;
  /** How much the component acts: v ← v + amount·(combine(v, c) − v). */
  readonly amount: number;
  readonly enabled: boolean;
}

export interface Stroke {
  /** [x, y, pressure] in document pixels. */
  readonly points: readonly (readonly [number, number, number])[];
  readonly radius: number;
  readonly hardness: number;
  readonly mode: 'add' | 'erase';
}

/** A coverage function in 0…1 (design §25): components folded from the empty mask, then feather, then invert. */
export interface Mask {
  readonly name: string;
  readonly components: Coll<MaskComponent>;
  /** Gaussian feather radius in mm on the print (σ = radius / 2, as mask.feather). */
  readonly feather_mm: number;
  readonly invert: boolean;
  /** What range components (luminance, colour) measure: the input of the stage using the mask, or a named cut. */
  readonly reads: 'stage-input' | CutName;
}

// ---- geometry, output, probes -----------------------------------------------------------------------------------

export type Orientation = 'none' | 'cw90' | 'rot180' | 'ccw90' | 'flipH' | 'flipV' | 'transpose' | 'transverse';
export const ORIENTATIONS: readonly Orientation[] = ['none', 'cw90', 'rot180', 'ccw90', 'flipH', 'flipV', 'transpose', 'transverse'];

/**
 * Orientation, straightening and crop, applied last by output.frame. The crop box (document px of the un-oriented
 * source; null = the whole frame) is cut out with its content rotated by angle_deg about the box centre, then the
 * orientation is applied. angle_deg is clockwise as shown (after the orientation).
 */
export interface Geometry {
  readonly orientation: Orientation;
  readonly angle_deg: number;
  readonly crop: Box | null;
}

export type KneeMethod = 'oklch' | 'cam16-ucs' | 'tanh-shoulder' | 'clip';
export const KNEE_METHODS: readonly KneeMethod[] = ['oklch', 'cam16-ucs', 'tanh-shoulder', 'clip'];
export interface KneeSpec { readonly method: KneeMethod; readonly strength: number }
export type OutputSpaceId = 'srgb' | 'display-p3' | 'rec2020' | 'adobe-rgb' | 'prophoto';
export const OUTPUT_SPACES: readonly OutputSpaceId[] = ['srgb', 'display-p3', 'rec2020', 'adobe-rgb', 'prophoto'];
export type Intent = 'perceptual' | 'relative' | 'saturation' | 'absolute';

export interface ExportSettings {
  readonly format: 'tiff16' | 'png16' | 'png8' | 'jpeg';
  readonly space: OutputSpaceId;
  readonly knee: KneeSpec;
  readonly scale: 'full' | number;
  readonly dpi: number;
  readonly compression: 'none' | 'deflate';
  readonly signal: 'icc' | 'icc+cicp' | 'none';
  /** How the document travels with an export. */
  readonly document: 'sidecar' | 'embedded' | 'none';
}
export interface ProofSettings { readonly printer: string; readonly intent: Intent; readonly proofIntent: 'absolute' | 'relative'; readonly bpc: boolean; readonly gamutWarning: boolean }
export interface PrinterSettings { readonly profile: string; readonly intent: Intent; readonly bpc: boolean; readonly working: OutputSpaceId }

/** How the print is shown (design §21: not a stage). `rendering` and `white` also set view.flare and view.adapt. */
export interface OutputSettings {
  readonly rendering: 'print-as-seen' | 'scan-of-print';
  /** Adaptation white for view.adapt. */
  readonly white: 'D50' | 'D65';
  readonly display: { readonly knee: KneeSpec; readonly proof: ProofSettings | null };
  readonly export: ExportSettings;
  readonly printer: PrinterSettings | null;
}

/** A densitometer probe (CHB-009), document px. */
export interface Probe { readonly x: number; readonly y: number; readonly r: number }

export type SourceDoc = Omit<SourceRef, 'bytes'> & { readonly decode: DecodeOptions };

// ---- the document ----------------------------------------------------------------------------------------------

export interface Document {
  readonly format: typeof DOCUMENT_FORMAT;
  /** The frame id. */
  readonly frame: string;
  readonly source: SourceDoc;
  /** Data pack the frame was created with (CHB-004). */
  readonly data: { readonly pack: string; readonly packHash: string } | null;
  readonly stages: Stages;
  readonly masks: Coll<Mask>;
  readonly probes: Coll<Probe>;
  readonly geometry: Geometry;
  readonly output: OutputSettings;
}

/** Root keys: reserved, never ids (a path's first segment is an id or one of these). */
export const ROOT_KEYS: readonly string[] = ['format', 'frame', 'source', 'data', 'stages', 'masks', 'probes', 'geometry', 'output'];

/** A negative scan has a scan stage; a camera file has scene and film stages. */
export function documentKind(d: Pick<Document, 'stages'>): FrameKind {
  return d.stages.scan ? 'negative-scan' : 'digital-raw';
}

/** The stages a document has, in pipeline order. */
export function stagesOf(d: Pick<Document, 'stages'>): StageName[] {
  return STAGE_NAMES.filter((s) => d.stages[s] !== undefined);
}

// ---- constructors ----------------------------------------------------------------------------------------------

/** Entry fields every layer and group carries, at their neutral values. */
export function entryBase(name: string, over: Partial<EntryBase> = {}): EntryBase {
  return { name, enabled: true, amount: 1, mask: null, blend: 'normal', source: { kind: 'user' }, ...over };
}

export function layerEntry(op: string, params: Params = {}, over: Partial<EntryBase> = {}): Layer {
  return { kind: 'layer', op, params, ...entryBase(op, over) };
}

export function groupEntry(name: string, stack: Coll<Entry> = Coll.empty(), over: Partial<EntryBase> = {}): Group {
  return { kind: 'group', stack, ...entryBase(name, { blend: 'pass', ...over }) };
}

export interface NewSource {
  sha256: string;
  kind?: SourceRef['kind'];
  path?: string;
  name?: string;
  /** Size of the decoded source: a scan's pitch follows from it and the film format when umPerPx is not given. */
  width?: number;
  height?: number;
}

export interface NewDocumentOptions {
  frame?: string;
  decode?: Partial<DecodeOptions>;
  /** A scan's film µm per document pixel (else from the format's long edge over the source's long side). */
  umPerPx?: number;
  format?: FilmFormat;
}

/** Film pitch of a scan of `format` that is `width × height` document pixels. */
export function scanPitch(format: FilmFormat, width: number, height: number): number {
  return (FORMAT_LONG_EDGE_MM[format] * 1000) / Math.max(width, height);
}

/**
 * A complete document with neutral settings (frame.add writes it, so a frame never depends on later default
 * changes). The darkroom holds the main exposure (`main`, 10 s at f/8, neutral pack) and the printer lights
 * (`lights`, a filter at 0); every other stack is empty.
 */
export function newDocument(kind: FrameKind, source: NewSource, opts: NewDocumentOptions = {}): Document {
  const src: SourceDoc = {
    kind: source.kind ?? 'file',
    sha256: source.sha256,
    ...(source.path !== undefined ? { path: source.path } : {}),
    ...(source.name !== undefined ? { name: source.name } : {}),
    decode: { mode: kind === 'digital-raw' ? 'photo' : 'scan', encoding: 'linear', ...opts.decode },
  };
  const knee: KneeSpec = { method: 'oklch', strength: 6 };
  const darkroom = Coll.of<Entry>([
    ['main', layerEntry('expose', { time_s: 10, fstop: 8, filtration: { c: 0, m: 0, y: 0 } }, { name: 'Main exposure' })],
    ['lights', layerEntry('filter', { logH: [0, 0, 0] }, { name: 'Printer lights' })],
  ]);
  let stages: Stages;
  if (kind === 'negative-scan') {
    const format = opts.format ?? '135';
    const umPerPx = opts.umPerPx ?? (source.width && source.height ? scanPitch(format, source.width, source.height)
      : fail('E_DOCUMENT', 'a negative scan needs its film pitch', { hint: 'pass umPerPx, or the source width and height with the film format' }));
    stages = {
      scan: {
        medium: { scanner: 'xt5-rgb-led', stock: 'kodak_portra_400', format, umPerPx, rebate: null, baseT: null, flat: null, openGate: null, flare: 0 },
        stack: Coll.empty(),
      },
      darkroom: { medium: darkroomMedium(), stack: darkroom },
      print: { medium: { illuminant: 'D50', flare: 0.48 }, stack: Coll.empty() },
    };
  } else {
    stages = {
      scene: { medium: { whiteBalance: { mode: 'daylight', temperature_K: 5500, tint: 0 } }, stack: Coll.empty() },
      film: {
        medium: {
          stock: 'kodak_portra_400', exposureEV: 0, format: { longEdge_mm: 36 }, push: 0,
          dir: { amount: 1, diffusion_um: 0 }, halation: { strength: 1 }, grain: { amount: 1, size_um: 12, seed: 1 },
        },
        stack: Coll.empty(),
      },
      darkroom: { medium: darkroomMedium(), stack: darkroom },
      print: { medium: { illuminant: 'D50', flare: 0.48 }, stack: Coll.empty() },
    };
  }
  return {
    format: DOCUMENT_FORMAT,
    frame: opts.frame ?? `frame_${source.sha256.slice(0, 8)}`,
    source: src,
    data: null,
    stages,
    masks: Coll.empty(),
    probes: Coll.empty(),
    geometry: { orientation: 'none', angle_deg: 0, crop: null },
    output: {
      rendering: 'scan-of-print',
      white: 'D65',
      display: { knee, proof: null },
      export: { format: 'tiff16', space: 'prophoto', knee, scale: 'full', dpi: 300, compression: 'deflate', signal: 'icc', document: 'sidecar' },
      printer: null,
    },
  };
}

function darkroomMedium(): DarkroomMedium {
  return { paper: 'kodak_portra_endura', aim: 'grey-0.184', mode: 'real', lamp: 'TH-KG3', magnification: 8, grade: 2 };
}
