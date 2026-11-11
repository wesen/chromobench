// The Engine interface (architecture doc §5.3, guide §5.9, CHB-005/008/009/010/011 additions).
// Three engines implement it — mock (CHB-002), reference f64 (CHB-003), WebGPU (CHB-005) — and all
// pass the conformance suite generated from the registry.
//
// Semantic rules, checked by @chromobench/conformance:
// - evaluate() accepts Image nodes only; measure() accepts Value nodes only (else E_WRONG_KIND).
// - measure() defaults to full resolution and export precision.
// - Cache key: (node id, scale rounded to 1e-4, region, precision). A hit returns the original warnings.
// - Determinism: same node + same target → bit-identical data in the same engine. Seeds come from args.
// - Cancellation: an aborted signal rejects with E_CANCELLED and leaves nothing partial in the cache.
// - An op not in capabilities().ops throws E_NOT_IMPLEMENTED.
// - Callers make a node known with adopt(closure(id)) before evaluating it (ids are content hashes).
import type { ImageInfo } from './domains.ts';
import type { Diagnostic } from './errors.ts';
import type { NodeDef, NodeRef } from './graph-types.ts';
import type { SourceInfo, SourceRef } from './source.ts';
import type { Box } from './spec.ts';

export type EngineId = 'mock' | 'reference' | 'gpu';
export type Precision = 'preview' | 'export';

export interface EngineCaps {
  /** Ops this engine implements; the conformance suite runs exactly these. */
  ops: string[];
  /** Largest image side the engine accepts. */
  maxSize: number;
  f16: boolean;
  timestamps: boolean;
  precision: Precision[];
  /** CHB-005: false when the engine cannot run here (no WebGPU), with the reason. */
  available: boolean;
  why?: string;
  adapter?: { name: string; fallback: boolean };
  maxTextureDimension2D?: number;
  maxBufferSize?: number;
  float32Filterable?: boolean;
  budgetBytes?: number;
  /** PhysicsConventions version the engine computes under (CHB-003). */
  conventions?: string;
}

export interface EvalTarget {
  /** Preview scale (0, 1] or full resolution. */
  scale: number | 'full';
  /** Region in the node's own pixel grid at full resolution. */
  region?: Box;
  precision: Precision;
  /** Cancellation: last request wins in the viewer. */
  signal?: AbortSignal;
}

export type SampleData = Float32Array | Float64Array | Uint16Array;

export interface ImageResult {
  node: string;
  info: ImageInfo;
  /** Effective scale (1 = full resolution). */
  scale: number;
  /** Region of the full-resolution grid this result covers. */
  region: Box;
  /** Result size in pixels (region × scale, rounded). */
  width: number;
  height: number;
  format: 'f32' | 'f64' | 'u16';
  /** Interleaved samples, info.channels per pixel, row-major. Lazy so the GPU can skip read-back. */
  read(): Promise<SampleData>;
  /** Present when the engine shares the presenter's device (CHB-005/009). */
  gpu?: { texture: unknown };
  /** True while an engine shows an approximate state (CHB-010 Jacobian preview). */
  preview?: boolean;
  warnings: Diagnostic[];
}

export interface MeasureSpec {
  /** Default 'full'. */
  scale?: number | 'full';
  /** Default 'export'. */
  precision?: Precision;
  signal?: AbortSignal;
}

export interface Measurement {
  node: string;
  /** An object with every field of the node's ValueInfo.fields. */
  value: Record<string, unknown>;
  preview?: boolean;
  warnings: Diagnostic[];
}

export type Hash = string;

/**
 * Content-keyed table identity (CHB-005 §5.4, CHB-004 content hashes). Keys hash the data the
 * builder consumes, always include the domain and N, the scan's sha256 when an input is per scan,
 * the builder and the physics conventions version.
 */
export type TableKey =
  | { kind: 'solve'; schema: 1; channels: Hash; film: Hash; domain: { lo: number; hi: number; N: number };
      solver: { lo: number; hi: number; tol: number; gtol: number; maxIt: number; activeSet: boolean };
      scan?: string; builder: 'f64' | 'gpu-f32'; kernel?: Hash; conventions: string }
  | { kind: 'pd'; schema: 1; film: Hash; printing: Hash; domain: { lo: number; hi: number; N: number };
      builder: 'f64' | 'gpu-f32'; kernel?: Hash; conventions: string }
  | { kind: 'print'; schema: 1; paper: Hash; viewing: Hash; adaptTo: [number, number, number];
      domain: { lo: number; hi: number; N: number }; builder: 'f64' | 'gpu-f32'; kernel?: Hash; conventions: string }
  | { kind: 'curve'; schema: 1; stock: Hash; which: 'film-fwd' | 'film-inv' | 'paper';
      domain: { lo: number; hi: number; N: number }; conventions: string };

/** Tiled-export plan (CHB-005 → CHB-011). */
export interface TilePlan {
  frame: { w: number; h: number; umPerPx: number };
  tile: number;
  halo: number;
  tiles: { index: number; core: Box; read: Box }[];
  bytesPerTile: number;
}

/** Physics conventions (CHB-003): versioned, carried by engines and table keys. */
export interface PhysicsConventions {
  version: string;
  grid: string;
  greyCard: number;
  aim: 'grey-0.184' | 'midgray-normalised';
  notes?: string;
}

export interface Engine {
  readonly id: EngineId;
  capabilities(): EngineCaps;
  /** Decode + hash (delegates to ingest). The caller then graph.registerSource(info). */
  open(source: SourceRef): Promise<SourceInfo>;
  /** Makes nodes known (closure order). Idempotent; ids must recompute equal. */
  adopt(defs: readonly NodeDef[]): void;
  evaluate(node: NodeRef, target: EvalTarget): Promise<ImageResult>;
  measure(node: NodeRef, spec?: MeasureSpec): Promise<Measurement>;
  /** Build or load content-keyed tables. */
  prepare(keys: TableKey[]): Promise<void>;
  /** Optional (GPU engine): the tile plan for a full-resolution export. */
  plan?(node: NodeRef, target: EvalTarget): Promise<TilePlan>;
  dispose(): void;
}

/** Quantises a scale for cache keys (goja-cv QuantizeScale). */
export function quantizeScale(s: number | 'full'): number {
  return s === 'full' ? 1 : Math.round(s * 1e4) / 1e4;
}

