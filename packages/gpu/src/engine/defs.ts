// GpuEngine's op sets, kernel constants and internal types (split from engine-gpu.ts, CHB-032).
import { ChromobenchError, type Box, type Diagnostic, type Node } from '@chromobench/contract';
import pack16Code from '../../kernels/pack16.wgsl?raw';
import combineCode from '../../kernels/combine.wgsl?raw';
import { WORKING_WGSL } from '../chain/working.ts';
import type { Segment } from '../chain/program.ts';
import { FILM_OPS } from '../film.ts';

export const GPU_OPS = [
  'source.open', 'source.pattern', 'scan.flare', 'scan.density', 'invert.dyes', 'print.expose', 'print.develop',
  'view.reflect', 'view.flare', 'view.adapt', 'output.display', 'film.grain',
  'measure.stats', 'measure.histogram', 'measure.patches', 'measure.densitometer',
  // the darkroom's light law (contract 1.0: one print.combine with terms, densities, filters, preflash) and masks
  'print.combine', 'print.densityMask',
  'mask.luminance', 'mask.linear', 'mask.ellipse', 'mask.paint', 'mask.constant', 'mask.combine', 'mask.feather', 'mask.invert',
  // the composite and repair laws: an entry's mix, coalesced heal and clone runs, clarity on the print
  'composite.mix', 'heal', 'clone', 'clarity',
  // contract 1.1: the digital layers of the composite stages, their encodings and mask components (engine/lower.ts)
  'composite.encode', 'exposure', 'curve', 'levels', 'hsl', 'vibrance', 'grade', 'mixer', 'vignette', 'sharpen', 'mask.radial', 'mask.colour',
  // CHB-012: the forward film path (src/film.ts)
  'source.xyz', 'capture.expose', 'film.couple', 'film.halation', 'film.develop',
] as const;

/**
 * Multi-input or spatial ops: materialised, computed from materialised inputs (combine.wgsl, blur.wgsl, retouch.wgsl).
 * print.combine is one only when a term reads a texture (engine/light.ts combineIsPointwise); otherwise it fuses.
 */
export const BARRIER_OPS: ReadonlySet<string> = new Set(['print.combine', 'print.densityMask', 'mask.feather', 'mask.combine', 'composite.mix', 'heal', 'clone', 'clarity', 'sharpen', ...FILM_OPS]);
/** Masks from coordinates, strokes or a constant: their receiver's values are never read. */
export const GENERATOR_OPS: ReadonlySet<string> = new Set(['mask.linear', 'mask.radial', 'mask.ellipse', 'mask.paint', 'mask.constant']);
/** Pointwise ops a fused composite.mix may run between SAVE and MIX (one program op each; engine/dag.ts fusedMixTop). */
export const FUSIBLE_TOP_OPS: ReadonlySet<string> = new Set(['composite.encode', 'exposure', 'curve', 'levels', 'hsl', 'vibrance', 'grade', 'mixer', 'vignette']);
/** Largest σ (output px) of one blur pass (spatial.ts MAX_RADIUS = 3σ); wider blurs run on a downsampled field (engine/textures.ts gaussianBlur). */
export const MAX_PASS_SIGMA = 32;
export const COMBINE_WGSL = `${WORKING_WGSL}\n${combineCode}`;

/** The output grid every materialised texture of one evaluation shares. */
export interface GridTarget { outW: number; outH: number; frameW: number; frameH: number; region: Box; precision: 'preview' | 'export' }
/** How one materialised node is computed: a barrier from its inputs, or a pointwise tail from a root. */
export type Plan =
  | { kind: 'barrier'; reads: string[] }
  | { kind: 'tail'; reads: string[]; nodes: Node[]; from: number; root: 'source' | 'texture' | 'none'; rootId?: string };

export const PACK16_WGSL: string = pack16Code;

/**
 * A source image on the CPU: f32 samples (patterns, 8-bit files), or a 16-bit scan kept as its
 * Uint16Array (`u16`, `samples` per pixel; CHB-011), uploaded tile by tile as rgba16uint.
 */
export interface SourceImg { w: number; h: number; c: number; data?: Float32Array; u16?: Uint16Array; samples?: number; max?: number }
export interface Lowered { root: Node; segments: Segment[]; warnings: Diagnostic[] }
export interface Cached { data: Float32Array; width: number; height: number; region: Box; scale: number; warnings: Diagnostic[] }

/** Result-cache budget: oldest entries go first (tiles of a large export must not pile up). */
export const RESULT_CACHE_BYTES = 256 * 2 ** 20;

/** CHB-011: 16-bit RGB codes of a display-rgb node, packed on the GPU (pack2x16unorm). */
export interface U16Result { node: string; width: number; height: number; region: Box; scale: number; data: Uint16Array; warnings: Diagnostic[] }

export const cancelled = () => new ChromobenchError({ code: 'E_CANCELLED', message: 'evaluation cancelled' });

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
