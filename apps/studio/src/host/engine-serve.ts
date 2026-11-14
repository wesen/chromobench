// The engine worker's job loop (CHB-027 WS-B, F4): decoding, linearising, the working-image resample and scan
// conditioning for every engine, and without WebGPU the reference engine itself, off the main thread. The worker
// entry (host/engine-worker.ts) serves its global scope; tests serve one end of a MessageChannel. The main thread
// talks to it through host/worker-engine.ts (WorkerClient, WorkerEngine). A host file: it imports core, gpu (the
// data pack loader) and ingest (tools/scripts/check-boundaries.ts names it).
//
// Jobs run one at a time in arrival order (the thread is single anyway); adopt and cancel are handled at once. A
// cancel drops a queued job, or aborts a running evaluation at the next stage boundary (RefEngine yields between
// stages with a macrotask, so the cancel message lands): the main thread's render queue aborts superseded renders,
// and the worker stops spending time on them.
import {
  toDiagnostic, type Engine, type EngineCaps, type EvalTarget, type ImageResult, type Measurement, type MeasureSpec, type NodeDef, type NodeRef, type SourceInfo,
  type SourceRef, type TableKey,
} from '@chromobench/contract';
import { RefEngine, type RefEngineOptions } from '@chromobench/core';
import { loadDefaultPhysicsData } from '@chromobench/gpu';
import { LibRawDecoder, setLibRawWasm, type FrameBase, type RawDecoder } from '@chromobench/ingest';
import { decodeFile } from './decode.ts';
import type { FromWorker, InitReply, ToWorker, WireDecoded, WireResult } from './worker-protocol.ts';

/** A worker's global scope, or a MessagePort. */
export interface EngineScope {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  addEventListener(t: 'message', f: (e: MessageEvent) => void): void;
}

/** A macrotask yield (MessageChannel: no 4 ms timer clamp), so queued messages (cancel, adopt) run between stages. */
function macrotasks(): () => Promise<void> {
  const channel = new MessageChannel();
  const waiting: (() => void)[] = [];
  channel.port1.onmessage = () => waiting.shift()?.();
  // Node's ports keep the process alive while referenced
  (channel.port1 as unknown as { unref?: () => void }).unref?.();
  return () => new Promise((r) => {
    waiting.push(r);
    channel.port2.postMessage(0);
  });
}

type Job = Exclude<ToWorker, { kind: 'adopt' | 'cancel' | 'dispose' | 'register' | 'forget' }>;

/** What the studio's hosts use of a reference engine (RefEngine, or TabulatedPreviews over two of them). */
export type RefLike = Engine & Pick<RefEngine, 'openDecoded' | 'forgetSource'>;

/**
 * The reference engine as the studio runs it by default (CHB-031 F10): previews through core's tables ('tabulated',
 * what the GPU engine's previews compute; 2–5× faster than exact on the CPU) and the export precision exact (every
 * pixel through the physics, as the GPU engine's export path). Two RefEngines on the same sources, each with its own
 * caches; the exact one is used only by exports (and measurements asked at export precision).
 */
export class TabulatedPreviews implements Engine {
  readonly id = 'reference' as const;
  readonly preview: RefEngine;
  readonly exact: RefEngine;
  constructor(o: RefEngineOptions) {
    this.preview = new RefEngine({ ...o, mode: 'tabulated' });
    // exports run at full resolution and are not repeated: a small cache
    this.exact = new RefEngine({ ...o, mode: 'exact', cacheLimit: 8, cacheBytes: Math.min(o.cacheBytes ?? Infinity, 256 * 2 ** 20) });
  }
  capabilities(): EngineCaps {
    return this.preview.capabilities();
  }
  async open(source: SourceRef): Promise<SourceInfo> {
    await this.exact.open(source);
    return this.preview.open(source);
  }
  openDecoded(info: SourceInfo, data: Float32Array | Float64Array): SourceInfo {
    this.exact.openDecoded(info, data);
    return this.preview.openDecoded(info, data);
  }
  forgetSource(sha: string): void {
    this.exact.forgetSource(sha);
    this.preview.forgetSource(sha);
  }
  adopt(defs: readonly NodeDef[]): void {
    this.preview.adopt(defs);
    this.exact.adopt(defs);
  }
  evaluate(node: NodeRef, target: EvalTarget): Promise<ImageResult> {
    return (target.precision === 'export' ? this.exact : this.preview).evaluate(node, target);
  }
  measure(node: NodeRef, spec?: MeasureSpec): Promise<Measurement> {
    return (spec?.precision === 'export' ? this.exact : this.preview).measure(node, spec);
  }
  prepare(keys: TableKey[]): Promise<void> {
    return this.preview.prepare(keys);
  }
  dispose(): void {
    this.preview.dispose();
    this.exact.dispose();
  }
}

/** A reference engine in `mode`: 'exact' everywhere, or 'tabulated' previews with exact exports (TabulatedPreviews). */
export function referenceEngine(o: RefEngineOptions): RefLike {
  return o.mode === 'tabulated' ? new TabulatedPreviews(o) : new RefEngine({ ...o, mode: 'exact' });
}

/** Serves engine jobs on scope. `raw` replaces LibRaw (tests). */
export function serveEngine(scope: EngineScope, o: { raw?: RawDecoder } = {}): void {
  let engine: RefLike | null = null;
  let raw: RawDecoder | null = o.raw ?? null;
  const roll = new Map<string, FrameBase>();
  /** The last 'register' decode per source, waiting for its 'register' message. */
  const decoded = new Map<string, Awaited<ReturnType<typeof decodeFile>>>();
  const macrotask = macrotasks();
  const queue: Job[] = [];
  const running = new Map<number, AbortController>();
  let busy = false;

  const reply = (m: FromWorker, transfer: Transferable[] = []): void => scope.postMessage(m, transfer);
  const need = (): RefLike => {
    if (!engine) throw new Error('the engine worker hosts no engine (init with engine: "reference")');
    return engine;
  };

  async function run(job: Job): Promise<{ value: unknown; transfer?: Transferable[] }> {
    switch (job.kind) {
      case 'init': {
        if (!raw) {
          setLibRawWasm(job.librawWasmUrl);
          raw = new LibRawDecoder();
        }
        if (job.engine === 'reference') {
          const data = await loadDefaultPhysicsData(job.packsBase);
          engine = referenceEngine({
            data, yield: macrotask, sampled: job.sampled ?? true, mode: job.mode ?? 'exact',
            ...(job.cacheLimit ? { cacheLimit: job.cacheLimit } : {}), ...(job.cacheBytes ? { cacheBytes: job.cacheBytes } : {}),
          });
        }
        return { value: { caps: engine?.capabilities() ?? null } satisfies InitReply };
      }
      case 'decode': {
        const t0 = performance.now();
        if (!raw) throw new Error('the engine worker is not initialised');
        const d = await decodeFile(new Uint8Array(job.bytes), job.sha256, job.name, job.mode, { long: job.long, dust: job.dust, roll, raw, ...(job.analysisLong ? { analysisLong: job.analysisLong } : {}) });
        if (job.keep === 'register') {
          need();
          decoded.set(job.sha256, d);
          const { data: _kept, analysis, ...rest } = d;
          return { value: { ...rest, ...(analysis ? { analysis: { info: analysis.info, frames: analysis.frames ?? null } } : {}), ms: performance.now() - t0 } satisfies WireDecoded };
        }
        const transfer = [d.data.buffer, ...(d.analysis?.data ? [d.analysis.data.buffer] : [])];
        return { value: { ...d, ms: performance.now() - t0 } satisfies WireDecoded, transfer };
      }
      case 'evaluate': {
        const ctl = new AbortController();
        running.set(job.id, ctl);
        try {
          const ref = { id: job.node, info: { kind: 'Image' } } as unknown as NodeRef;
          const r = await need().evaluate(ref, { ...job.target, signal: ctl.signal });
          const data = await r.read();
          const w: WireResult = {
            node: r.node, info: r.info, scale: r.scale, region: r.region, width: r.width, height: r.height, format: r.format, warnings: r.warnings,
            ...(r.preview !== undefined ? { preview: r.preview } : {}), data,
          };
          return { value: w, transfer: [data.buffer] };
        } finally {
          running.delete(job.id);
        }
      }
      case 'measure': {
        const ctl = new AbortController();
        running.set(job.id, ctl);
        try {
          const ref = { id: job.node, info: { kind: 'Value' } } as unknown as NodeRef;
          return { value: await need().measure(ref, { ...job.spec, signal: ctl.signal }) };
        } finally {
          running.delete(job.id);
        }
      }
      case 'prepare':
        await need().prepare(job.keys);
        return { value: null };
    }
  }

  async function pump(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          const { value, transfer } = await run(job);
          reply({ id: job.id, ok: true, value }, transfer);
        } catch (e) {
          reply({ id: job.id, ok: false, error: toDiagnostic(e) });
        }
      }
    } finally {
      busy = false;
    }
  }

  scope.addEventListener('message', (ev: MessageEvent) => {
    const m = ev.data as ToWorker;
    switch (m.kind) {
      case 'adopt':
        try {
          need().adopt(m.defs);
        } catch (e) {
          // an unknown source and the like: the evaluation that needs the node reports it
          console.warn('engine worker: adopt failed', e);
        }
        return;
      case 'register': {
        const d = decoded.get(m.sha256);
        decoded.delete(m.sha256);
        if (d) {
          need().openDecoded(d.info, d.data);
          // the first print's analysis image (CHB-034 fusz) goes with it
          if (d.analysis?.data) need().openDecoded(d.analysis.info, d.analysis.data);
        } else console.warn(`engine worker: no decode of ${m.sha256.slice(0, 12)}… to register`);
        return;
      }
      case 'forget':
        engine?.forgetSource(m.sha256);
        return;
      case 'cancel': {
        const i = queue.findIndex((j) => j.id === m.id);
        if (i >= 0) {
          queue.splice(i, 1);
          reply({ id: m.id, ok: false, error: { code: 'E_CANCELLED', message: 'evaluation cancelled' } });
        }
        running.get(m.id)?.abort();
        return;
      }
      case 'dispose':
        engine?.dispose();
        engine = null;
        queue.length = 0;
        return;
      default:
        queue.push(m);
        void pump();
    }
  });
}
