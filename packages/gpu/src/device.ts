// GpuRuntime: the only owner of the WebGPU device (guide §5.2). Everything else receives a runtime
// and asks it for buffers, textures and pipelines. Ported from gpu.js gpuDevice (3521–3536).
import { ChromobenchError } from '@chromobench/contract';
import { DEFAULT_LIMITS, negotiate } from './limits.ts';
import { PipelineCache } from './pipelines.ts';
import { Budget, BufferPool, TexturePool } from './pool.ts';
import { GpuTimer } from './timing.ts';

export interface GpuCaps {
  available: boolean;
  why?: string;
  adapter: { vendor: string; architecture: string; description: string; fallback: boolean };
  limits: {
    maxTextureDimension2D: number; maxTextureDimension3D: number; maxBufferSize: number;
    maxStorageBufferBindingSize: number; maxComputeWorkgroupStorageSize: number; maxComputeInvocationsPerWorkgroup: number;
  };
  features: { f16: boolean; float32Filterable: boolean; timestamps: boolean };
  /** Our own memory budget; WebGPU cannot report free memory. */
  budgetBytes: number;
  /** how budgetBytes was chosen (CHB-041: budgetFor's rule with its inputs, or "given") */
  budgetRule: string;
}

/** The floor of every budget (and the budget before CHB-041): what SwiftShader runs the whole browser suite in. */
export const DEFAULT_BUDGET = 512 * 2 ** 20;

/**
 * The budget rule (CHB-041). WebGPU reports no memory size, so the engine sizes its own budget from what the platform
 * says: the device memory the browser reports (navigator.deviceMemory, GiB, rounded by the browser; ASSUMED when it
 * reports none) times FRACTION, no more than the adapter's maxBufferSize (Chrome's tier for the adapter: 4 GiB on Apple
 * Silicon, 1 GiB on SwiftShader), within [FLOOR, CAP] — a software adapter (SwiftShader, memory of the CPU) within
 * [FLOOR, SOFTWARE_CAP]. A GPU on unified memory (Apple Silicon) shares the RAM with the system, the browser and the
 * photographer's other programs: an eighth of it is what the studio takes for textures.
 */
export const BUDGET_RULE = Object.freeze({ fraction: 1 / 8, floor: DEFAULT_BUDGET, cap: 2 * 2 ** 30, softwareCap: 2 ** 30, assumedMemoryGiB: 4 });

/** The engine's budget for an adapter and the device memory the browser reports (GiB; undefined: not reported). */
export function budgetFor(a: { maxBufferSize: number; fallback: boolean }, deviceMemoryGiB?: number | null): { bytes: number; rule: string } {
  const R = BUDGET_RULE;
  const reported = typeof deviceMemoryGiB === 'number' && deviceMemoryGiB > 0;
  const mem = reported ? deviceMemoryGiB : R.assumedMemoryGiB;
  const cap = a.fallback ? R.softwareCap : R.cap;
  const share = mem * 2 ** 30 * R.fraction;
  const bytes = Math.floor(Math.max(R.floor, Math.min(cap, a.maxBufferSize, share)) / 2 ** 20) * 2 ** 20;
  const MB = (x: number): string => `${Math.round(x / 2 ** 20)} MiB`;
  const rule = `min(${mem} GiB device memory${reported ? '' : ' (assumed: not reported)'} × 1/8, maxBufferSize ${MB(a.maxBufferSize)}) within [${MB(R.floor)}, ${MB(cap)}]${a.fallback ? ' (software adapter)' : ''} = ${MB(bytes)}`;
  return { bytes, rule };
}

/** navigator.deviceMemory where there is one (GiB), else undefined. */
function deviceMemory(): number | undefined {
  const n = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  return typeof n?.deviceMemory === 'number' ? n.deviceMemory : undefined;
}

export function unavailableCaps(why: string, budgetBytes = DEFAULT_BUDGET): GpuCaps {
  return {
    available: false, why,
    adapter: { vendor: '', architecture: '', description: '', fallback: false },
    limits: {
      maxTextureDimension2D: DEFAULT_LIMITS.maxTextureDimension2D, maxTextureDimension3D: DEFAULT_LIMITS.maxTextureDimension3D,
      maxBufferSize: DEFAULT_LIMITS.maxBufferSize, maxStorageBufferBindingSize: DEFAULT_LIMITS.maxStorageBufferBindingSize,
      maxComputeWorkgroupStorageSize: DEFAULT_LIMITS.maxComputeWorkgroupStorageSize, maxComputeInvocationsPerWorkgroup: DEFAULT_LIMITS.maxComputeInvocationsPerWorkgroup,
    },
    features: { f16: false, float32Filterable: false, timestamps: false },
    budgetBytes, budgetRule: 'no device',
  };
}

export type Backend = 'gpu' | 'workers' | 'main';
export type AccelChoice = 'auto' | Backend;

/**
 * Backend order for table builds (accel.js Accel.order, 3721–3727): under 'auto' a hardware
 * adapter first, then workers, then the main thread; a fallback (software) adapter only if forced.
 */
export function backendOrder(choice: AccelChoice, caps: Pick<GpuCaps, 'available' | 'adapter'>, workers = true): Backend[] {
  const gpuOk = caps.available;
  if (choice === 'gpu') return gpuOk ? ['gpu', ...(workers ? ['workers' as const] : []), 'main'] : [...(workers ? ['workers' as const] : []), 'main'];
  if (choice === 'workers') return workers ? ['workers', 'main'] : ['main'];
  if (choice === 'main') return ['main'];
  const out: Backend[] = [];
  if (gpuOk && !caps.adapter.fallback) out.push('gpu');
  if (workers) out.push('workers');
  out.push('main');
  return out;
}

/**
 * What a runtime reports about its device (CHB-038), for a host's diagnostics journal: the device it made (adapter,
 * features, limits), every error nobody caught (WebGPU's uncapturederror: validation, out-of-memory, internal), the
 * device's loss, and — with `debug` — the errors of each queue submit, caught in error scopes. `during` is the work
 * the engine started last (a node's op and id): with renders in flight it is a hint, not a proof.
 */
export type GpuEvent =
  | { kind: 'device'; name: string; adapter: GpuCaps['adapter']; features: string[]; limits: Record<string, number>; requested: { features: string[]; limits: Record<string, number> }; budget?: { bytes: number; rule: string } }
  | { kind: 'error'; type: 'validation' | 'out-of-memory' | 'internal' | 'unknown'; message: string; during: string | null; scope?: 'submit' }
  | { kind: 'lost'; reason: string; message: string }
  | { kind: 'recreate'; why: string }
  | GpuMemoryEvent;

/**
 * The engine's memory (CHB-041), in bytes: each render's high-water mark (`render`; live + pending, the bytes let go
 * but not destroyed yet while a pass that binds them has not been submitted, CHB-045), textures of frames not on screen
 * let go to make room (`evict`), and the recovery after an E_GPU_OOM (`recover`: everything not needed let go and the
 * render tried once more; ok false when that failed too). `limit` is the budget, `live` what is allocated after.
 */
export type GpuMemoryEvent =
  | { kind: 'memory'; what: 'render'; during: string; peak: number; live: number; pending: number; limit: number; resident: number }
  | { kind: 'memory'; what: 'evict'; freed: number; frames: number; live: number; limit: number; during: string | null }
  | { kind: 'memory'; what: 'recover'; ok: boolean; freed: number; live: number; limit: number; during: string; message: string };

export interface RuntimeOptions {
  forceFallback?: boolean;
  /** The engine's memory budget; default budgetFor(adapter, navigator.deviceMemory) (CHB-041). */
  budgetBytes?: number;
  /** The device memory to size the budget for (GiB; tests); default navigator.deviceMemory. */
  deviceMemory?: number;
  /** Injected navigator.gpu (tests). */
  gpu?: GPU;
  /** Receives the device's events (a host's diagnostics journal); kept for a device made again after a loss. */
  events?: (e: GpuEvent) => void;
  /** Wraps every queue submit in validation and out-of-memory error scopes (slower; the host's ?debug). */
  debug?: boolean;
}

/** The kind of a GPUError, by its class (each browser names the classes alike). */
export function gpuErrorType(e: GPUError): 'validation' | 'out-of-memory' | 'internal' | 'unknown' {
  const n = e?.constructor?.name ?? '';
  return n === 'GPUValidationError' ? 'validation' : n === 'GPUOutOfMemoryError' ? 'out-of-memory' : n === 'GPUInternalError' ? 'internal' : 'unknown';
}

export class GpuRuntime {
  readonly buffers: BufferPool;
  readonly textures: TexturePool;
  readonly pipelines: PipelineCache;
  readonly timer: GpuTimer;
  readonly budget: Budget;
  private lostCbs: ((info: GPUDeviceLostInfo) => void)[] = [];
  lost: GPUDeviceLostInfo | null = null;
  private destroyed = false;

  readonly device: GPUDevice;
  readonly caps: GpuCaps;
  /** the work started last (the engine sets it: a node's op and id), named in the errors this runtime reports */
  activity: string | null = null;
  /** the host's events hook (a diagnostics journal), or null */
  readonly events: ((e: GpuEvent) => void) | null;
  private constructor(device: GPUDevice, caps: GpuCaps, opts: RuntimeOptions = {}) {
    this.device = device;
    this.caps = caps;
    const events = opts.events;
    this.events = events ?? null;
    if (events) {
      device.addEventListener('uncapturederror', (ev) => {
        const err = (ev as GPUUncapturedErrorEvent).error;
        events({ kind: 'error', type: gpuErrorType(err), message: err.message, during: this.activity });
      });
      device.lost.then((info) => events({ kind: 'lost', reason: String(info.reason), message: info.message }));
      if (opts.debug) this.scopeSubmits(events);
    }
    this.budget = new Budget(caps.budgetBytes);
    this.buffers = new BufferPool(device, this.budget);
    this.textures = new TexturePool(device, this.budget);
    this.pipelines = new PipelineCache(device);
    this.timer = new GpuTimer(device);
    this.budget.onShort = (need) => void this.reclaim(need);
    device.lost.then((info) => {
      this.lost = info;
      for (const cb of this.lostCbs) cb(info);
    });
  }

  /** Probe without creating a device: returns caps.available = false with a reason on failure. */
  static async create(opts: RuntimeOptions = {}): Promise<GpuRuntime> {
    const gpu = opts.gpu ?? (typeof navigator !== 'undefined' ? navigator.gpu : undefined);
    if (!gpu) throw new ChromobenchError({ code: 'E_EVAL', message: 'this browser has no WebGPU', hint: 'use the reference engine' });
    let adapter = opts.forceFallback ? null : await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) adapter = await gpu.requestAdapter({ forceFallbackAdapter: true });
    if (!adapter) throw new ChromobenchError({ code: 'E_EVAL', message: 'no GPU adapter', hint: 'use the reference engine' });
    const info = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean };
    const fallback = !!(info.isFallbackAdapter ?? (adapter as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter);
    const { requiredLimits, requiredFeatures } = negotiate(adapter);
    let device: GPUDevice;
    try {
      device = await adapter.requestDevice({ requiredLimits, requiredFeatures });
    } catch (e) {
      throw new ChromobenchError({ code: 'E_EVAL', message: `requestDevice failed: ${e instanceof Error ? e.message : String(e)}` });
    }
    const L = device.limits;
    const budget = opts.budgetBytes !== undefined
      ? { bytes: opts.budgetBytes, rule: `given: ${Math.round(opts.budgetBytes / 2 ** 20)} MiB` }
      // the adapter's maxBufferSize (the device's is what negotiate asked for, at most 1 GiB)
      : budgetFor({ maxBufferSize: (adapter.limits as unknown as Record<string, number>)['maxBufferSize'] ?? L.maxBufferSize, fallback }, opts.deviceMemory ?? deviceMemory());
    const caps: GpuCaps = {
      available: true,
      adapter: { vendor: info.vendor, architecture: info.architecture, description: info.description, fallback },
      limits: {
        maxTextureDimension2D: L.maxTextureDimension2D, maxTextureDimension3D: L.maxTextureDimension3D, maxBufferSize: L.maxBufferSize,
        maxStorageBufferBindingSize: L.maxStorageBufferBindingSize, maxComputeWorkgroupStorageSize: L.maxComputeWorkgroupStorageSize,
        maxComputeInvocationsPerWorkgroup: L.maxComputeInvocationsPerWorkgroup,
      },
      features: {
        f16: device.features.has('shader-f16'),
        float32Filterable: device.features.has('float32-filterable'),
        timestamps: device.features.has('timestamp-query'),
      },
      budgetBytes: budget.bytes, budgetRule: budget.rule,
    };
    if (opts.events) {
      const lim: Record<string, number> = {};
      for (const k in L) {
        const v = (L as unknown as Record<string, unknown>)[k];
        if (typeof v === 'number') lim[k] = v;
      }
      opts.events({
        kind: 'device', name: [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'GPU', adapter: caps.adapter,
        features: [...device.features].map(String).sort(), limits: lim,
        requested: { features: [...requiredFeatures].map(String), limits: { ...(requiredLimits as Record<string, number>) } },
        budget,
      });
    }
    return new GpuRuntime(device, caps, opts);
  }

  /** ?debug: every queue submit inside validation and out-of-memory error scopes, its errors reported with `during` */
  private scopeSubmits(events: (e: GpuEvent) => void): void {
    const device = this.device;
    const queue = device.queue;
    const submit = queue.submit.bind(queue);
    const report = (err: GPUError | null, during: string | null): void => {
      if (err) events({ kind: 'error', type: gpuErrorType(err), message: err.message, during, scope: 'submit' });
    };
    queue.submit = (buffers: Iterable<GPUCommandBuffer>): undefined => {
      device.pushErrorScope('validation');
      device.pushErrorScope('out-of-memory');
      const during = this.activity;
      try {
        submit(buffers);
      } finally {
        void device.popErrorScope().then((e) => report(e, during), () => undefined);
        void device.popErrorScope().then((e) => report(e, during), () => undefined);
      }
      return undefined;
    };
  }

  get name(): string {
    const a = this.caps.adapter;
    return [a.vendor, a.architecture, a.description].filter(Boolean).join(' ') || 'GPU';
  }

  onLost(cb: (info: GPUDeviceLostInfo) => void): void {
    this.lostCbs.push(cb);
    if (this.lost) cb(this.lost);
  }

  // ── lifetimes (CHB-038, CHB-045) ──
  // A texture or buffer may be bound by a pass that has been encoded but not submitted yet: every pass awaits its
  // pipeline first, so another render can run in between. Destroying it then makes that submit a validation error
  // ("Destroyed texture … used in a submit"); handing it to another render lets that render overwrite what the pass
  // reads. The pools' leases cover that window per object (pool.ts: lease, release, discard): what a pass may still
  // bind waits for that pass's submit, and its bytes stay in the budget (pending) until it is destroyed.
  // ── memory (CHB-041) ──
  // Who keeps GPU memory between renders that the runtime may take back (the engine's resident textures, the film
  // grain's textures of ones): asked in the order they were added when an allocation does not fit after the pools'
  // free lists are trimmed (`all` false: only what is not on screen nor in use), and by relieve() after an E_GPU_OOM
  // (`all` true). Each returns the bytes it let go of.
  private readonly reclaimers: ((need: number, all: boolean) => number)[] = [];
  /** Adds a reclaimer; returns its removal (an engine disposed on a shared runtime). */
  addReclaimer(f: (need: number, all: boolean) => number): () => void {
    this.reclaimers.push(f);
    return () => {
      const i = this.reclaimers.indexOf(f);
      if (i >= 0) this.reclaimers.splice(i, 1);
    };
  }
  /** Asks the reclaimers for `need` bytes (frames not on screen first); returns what they let go of. */
  reclaim(need: number, all = false): number {
    let freed = 0;
    for (const f of this.reclaimers) {
      if (freed >= need) break;
      freed += f(need - freed, all);
    }
    return freed;
  }
  /** After an E_GPU_OOM: everything kept between renders and every released object let go; returns the bytes. */
  relieve(): number {
    const before = this.budget.live;
    this.reclaim(Infinity, true);
    this.budget.trimFree(0);
    return before - this.budget.live;
  }

  /** Throws E_DEVICE_LOST if the device is gone. */
  check(): void {
    if (this.lost || this.destroyed) throw new ChromobenchError({ code: 'E_DEVICE_LOST', message: `GPU device lost${this.lost ? `: ${this.lost.reason} ${this.lost.message}` : ''}`, hint: 'the engine recreates the device on the next call' });
  }

  /** Runs `fn` inside a validation error scope; a validation error becomes E_EVAL. */
  async validated<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
    this.device.pushErrorScope('validation');
    let out: T;
    try {
      out = await fn();
    } finally {
      const err = await this.device.popErrorScope();
      if (err) throw new ChromobenchError({ code: 'E_EVAL', message: `${label}: ${err.message}` });
    }
    return out;
  }

  /** Copies `bytes` of `src` into a mappable buffer and returns them. */
  async readBuffer(src: GPUBuffer, bytes: number, offset = 0): Promise<ArrayBuffer> {
    this.check();
    const rb = this.buffers.acquire({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }, 'readback');
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(src, offset, rb, 0, Math.ceil(bytes / 4) * 4);
    this.device.queue.submit([enc.finish()]);
    try {
      await rb.mapAsync(GPUMapMode.READ, 0, BufferPool.round(bytes));
    } catch (e) {
      this.buffers.drop(rb);
      // a destroyed or crashed device fails the map before device.lost has resolved: wait briefly
      const lost = await Promise.race([this.device.lost.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 100))]);
      if (lost) {
        this.lost ??= { reason: 'unknown', message: 'lost during read-back' } as GPUDeviceLostInfo;
        this.check();
      }
      throw e;
    }
    const out = rb.getMappedRange(0, Math.ceil(bytes / 4) * 4).slice(0, bytes);
    rb.unmap();
    this.buffers.release(rb);
    return out;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.buffers.destroyAll();
    this.textures.destroyAll();
    this.pipelines.clear();
    this.timer.destroy();
    this.device.destroy();
  }
}
