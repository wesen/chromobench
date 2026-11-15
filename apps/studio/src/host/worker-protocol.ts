// The engine worker's messages (CHB-027 WS-B, F4). The main thread posts jobs; the worker (host/engine-worker.ts)
// decodes files and, without WebGPU, hosts the reference engine. Pixels move as transferables both ways.
// Contract types only, so the main-thread side (host/worker-engine.ts) stays free of core, gpu and ingest.
import type { Box, Diagnostic, EngineCaps, ImageInfo, MeasureSpec, NodeDef, Precision, TableKey } from '@chromobench/contract';
import type { Decoded } from './studio-engine.ts';

/** How a file is opened: a photo (scene light shot on film, CHB-012) or a scan of a negative. */
export type DecodeMode = 'photo' | 'scan';

export interface InitJob {
  kind: 'init';
  id: number;
  /** 'reference': the worker hosts RefEngine; 'none': it only decodes (the GPU engine runs on the main thread). */
  engine: 'reference' | 'none';
  /** libraw.wasm as the host serves it. */
  librawWasmUrl: string;
  /** Data packs' base URL (default `<origin>/packs/`). */
  packsBase?: string;
  cacheLimit?: number;
  cacheBytes?: number;
  /** RefEngine computes previews on the sample grid (CHB-027). */
  sampled?: boolean;
  /**
   * The reference engine's physics (CHB-031 F10): 'exact' (default) per pixel; 'tabulated': previews through core's
   * tables as the GPU engine's previews, exports exact (engine-serve.ts TabulatedPreviews).
   */
  mode?: 'exact' | 'tabulated';
}

export interface DecodeJob {
  kind: 'decode';
  id: number;
  /** The file's bytes, transferred. */
  bytes: ArrayBuffer;
  sha256: string;
  name: string;
  mode: DecodeMode;
  /** Working image long side (0 = the file's own size). */
  long: number;
  dust: boolean;
  /** The first print's analysis image's long side (CHB-034 fusz; decode.ts withAnalysis); absent: none. */
  analysisLong?: number;
  /**
   * 'register': the pixels stay in the worker (no copy back) until a 'register' message makes them the engine's
   * source (StudioEngine.openAs may decode twice, or forget the old decode first); 'return': they come back (the GPU
   * engine registers them).
   */
  keep: 'register' | 'return';
}

export interface EvaluateJob {
  kind: 'evaluate';
  id: number;
  node: string;
  target: { scale: number | 'full'; region?: Box; precision: Precision };
}

export interface MeasureJob {
  kind: 'measure';
  id: number;
  node: string;
  spec: Omit<MeasureSpec, 'signal'>;
}

export type ToWorker =
  | InitJob
  | DecodeJob
  | EvaluateJob
  | MeasureJob
  | { kind: 'prepare'; id: number; keys: TableKey[] }
  /** Registers the last 'register' decode of a source with the worker's engine (no reply; ordered before later jobs). */
  | { kind: 'register'; sha256: string }
  /** Drops a source and everything computed from it (RefEngine.forgetSource; no reply). */
  | { kind: 'forget'; sha256: string }
  /** Makes nodes known to the worker's engine (no reply; ordered before later jobs). */
  | { kind: 'adopt'; defs: NodeDef[] }
  /** Drops a queued job, or aborts a running one between stages (no reply; the job rejects with E_CANCELLED). */
  | { kind: 'cancel'; id: number }
  | { kind: 'dispose' };

export interface WireResult {
  node: string;
  info: ImageInfo;
  scale: number;
  region: Box;
  width: number;
  height: number;
  format: 'f32' | 'f64' | 'u16';
  warnings: Diagnostic[];
  preview?: boolean;
  /** Transferred. */
  data: Float64Array | Float32Array | Uint16Array;
}

/** A decoded file: without data when the worker's engine registered it ('register'). */
export type WireDecoded = Omit<Decoded, 'data'> & { data?: Float32Array; ms: number };

export interface InitReply {
  caps: EngineCaps | null;
}

export type FromWorker =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: Diagnostic }
  /** CHB-038: what the worker would have written to its console, for the page's diagnostics journal */
  | { id: 0; log: WorkerLog };

/** One event of the worker for the journal (source 'worker'). */
export interface WorkerLog {
  level: 'info' | 'warn' | 'error';
  message: string;
  code?: string;
  data?: unknown;
}
