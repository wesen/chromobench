// The main-thread side of the engine worker (CHB-027 WS-B, F4): a WorkerClient that posts jobs and matches
// replies, WorkerEngine (the contract's Engine, proxying the reference engine that runs in the worker) and
// workerDecode (decoding, linearising, resampling and conditioning in the worker, for any engine). Pixels move as
// transferables. An aborted signal cancels the job in the worker: a queued job is dropped, a running evaluation
// stops at the next stage boundary. Contract types only: no core, gpu or ingest on this side.
import {
  ChromobenchError, fail,
  type EngineCaps, type Engine, type EngineId, type EvalTarget, type ImageResult, type Measurement, type MeasureSpec, type NodeDef, type NodeRef,
  type SourceInfo, type SourceRef, type TableKey,
} from '@chromobench/contract';
import type { DecodeMode, FromWorker, InitJob, InitReply, ToWorker, WireDecoded, WireResult } from './worker-protocol.ts';

/** What WorkerClient needs of a Worker (a MessagePort-like object; tests pass a fake). */
export interface WorkerLike {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  addEventListener(t: 'message', f: (e: MessageEvent) => void): void;
  addEventListener(t: 'error', f: (e: ErrorEvent) => void): void;
  terminate?(): void;
}

type Job = Exclude<ToWorker, { kind: 'adopt' | 'cancel' | 'dispose' | 'register' | 'forget' }>;
type NoId<T> = T extends unknown ? Omit<T, 'id'> : never;

export class WorkerClient {
  private next = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  readonly worker: WorkerLike;
  /** Jobs posted, replies received, cancels sent (tests and the status line). */
  readonly stats = { jobs: 0, replies: 0, cancels: 0 };

  constructor(worker: WorkerLike) {
    this.worker = worker;
    worker.addEventListener('message', (e: MessageEvent) => {
      const m = e.data as FromWorker;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      this.stats.replies++;
      if (m.ok) p.resolve(m.value);
      else p.reject(new ChromobenchError(m.error));
    });
    worker.addEventListener('error', (e: ErrorEvent) => {
      const err = new ChromobenchError({ code: 'E_INTERNAL', message: `engine worker error: ${e.message ?? 'unknown'}` });
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
  }

  /** Posts a job; an aborted signal cancels it in the worker (the promise rejects with E_CANCELLED). */
  call<T>(job: NoId<Job>, o: { transfer?: Transferable[]; signal?: AbortSignal | undefined } = {}): Promise<T> {
    if (o.signal?.aborted) return Promise.reject(new ChromobenchError({ code: 'E_CANCELLED', message: 'evaluation cancelled' }));
    const id = this.next++;
    this.stats.jobs++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      const onAbort = (): void => {
        if (!this.pending.has(id)) return;
        this.stats.cancels++;
        this.worker.postMessage({ kind: 'cancel', id } satisfies ToWorker);
      };
      o.signal?.addEventListener('abort', onAbort, { once: true });
      this.worker.postMessage({ ...job, id } as ToWorker, o.transfer ?? []);
    });
  }

  post(m: Extract<ToWorker, { kind: 'adopt' | 'dispose' | 'register' | 'forget' }>): void {
    this.worker.postMessage(m);
  }

  init(o: Omit<InitJob, 'kind' | 'id'>): Promise<InitReply> {
    return this.call<InitReply>({ kind: 'init', ...o });
  }

  /**
   * Decodes a file in the worker. keep 'register': the worker's engine keeps the pixels and none come back;
   * 'return': the working image comes back (transferred) for an engine on this thread. The bytes are copied
   * (the caller keeps its buffer).
   */
  decode(bytes: Uint8Array, sha256: string, name: string, mode: DecodeMode, o: { long: number; dust: boolean; keep: 'register' | 'return' }): Promise<WireDecoded> {
    const buf = bytes.slice().buffer as ArrayBuffer;
    return this.call<WireDecoded>({ kind: 'decode', bytes: buf, sha256, name, mode, ...o }, { transfer: [buf] });
  }

  terminate(): void {
    for (const p of this.pending.values()) p.reject(new ChromobenchError({ code: 'E_CANCELLED', message: 'engine worker stopped' }));
    this.pending.clear();
    this.worker.terminate?.();
  }
}

/** The reference engine in the worker, as an Engine on this thread. */
export class WorkerEngine implements Engine {
  readonly id: EngineId = 'reference';
  readonly client: WorkerClient;
  private readonly caps: EngineCaps;

  constructor(client: WorkerClient, caps: EngineCaps) {
    this.client = client;
    this.caps = caps;
  }

  capabilities(): EngineCaps {
    return { ...this.caps, ops: [...this.caps.ops] };
  }

  /** Files reach the worker through HostServices.decode (keep 'register'); a plain open is not supported here. */
  open(_source: SourceRef): Promise<SourceInfo> {
    return Promise.reject(new ChromobenchError({ code: 'E_NOT_IMPLEMENTED', message: 'WorkerEngine.open: decode through the host (StudioEngine.open)' }));
  }

  /** Makes the source's last decode in the worker (keep 'register') the engine's (HostServices.register). */
  register(sha256: string): void {
    this.client.post({ kind: 'register', sha256 });
  }

  /** Drops a source and everything computed from it (RefEngine.forgetSource, in the worker). */
  forgetSource(sha256: string): void {
    this.client.post({ kind: 'forget', sha256 });
  }

  adopt(defs: readonly NodeDef[]): void {
    if (defs.length) this.client.post({ kind: 'adopt', defs: defs.map((d) => ({ op: d.op, inputs: [...d.inputs], args: d.args })) });
  }

  async evaluate(ref: NodeRef, target: EvalTarget): Promise<ImageResult> {
    if (target.signal?.aborted) fail('E_CANCELLED', 'evaluation cancelled');
    const { signal, ...t } = target;
    const w = await this.client.call<WireResult>({ kind: 'evaluate', node: ref.id, target: t }, { signal });
    let data: WireResult['data'] | null = w.data;
    return {
      node: w.node, info: w.info, scale: w.scale, region: w.region, width: w.width, height: w.height, format: w.format,
      // the transferred array the first time, copies after (a reader may keep or change what it got)
      read: async () => {
        const d = data ?? w.data.slice();
        data = null;
        return d;
      },
      warnings: w.warnings, ...(w.preview !== undefined ? { preview: w.preview } : {}),
    };
  }

  measure(ref: NodeRef, spec: MeasureSpec = {}): Promise<Measurement> {
    const { signal, ...s } = spec;
    return this.client.call<Measurement>({ kind: 'measure', node: ref.id, spec: s }, { signal });
  }

  prepare(keys: TableKey[]): Promise<void> {
    return this.client.call<void>({ kind: 'prepare', keys });
  }

  dispose(): void {
    this.client.post({ kind: 'dispose' });
    this.client.terminate();
  }
}
