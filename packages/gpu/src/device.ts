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
}

export const DEFAULT_BUDGET = 512 * 2 ** 20;

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
    budgetBytes,
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

export interface RuntimeOptions {
  forceFallback?: boolean;
  budgetBytes?: number;
  /** Injected navigator.gpu (tests). */
  gpu?: GPU;
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
  private constructor(device: GPUDevice, caps: GpuCaps) {
    this.device = device;
    this.caps = caps;
    this.budget = new Budget(caps.budgetBytes);
    this.buffers = new BufferPool(device, this.budget);
    this.textures = new TexturePool(device, this.budget);
    this.pipelines = new PipelineCache(device);
    this.timer = new GpuTimer(device);
    device.lost.then((info) => {
      this.lost = info;
      for (const cb of this.lostCbs) cb(info);
    });
  }

  /** Probe without creating a device: returns caps.available = false with a reason on failure. */
  static async create(opts: RuntimeOptions = {}): Promise<GpuRuntime> {
    const gpu = opts.gpu ?? (typeof navigator !== 'undefined' ? navigator.gpu : undefined);
    const budgetBytes = opts.budgetBytes ?? DEFAULT_BUDGET;
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
      budgetBytes,
    };
    return new GpuRuntime(device, caps);
  }

  get name(): string {
    const a = this.caps.adapter;
    return [a.vendor, a.architecture, a.description].filter(Boolean).join(' ') || 'GPU';
  }

  onLost(cb: (info: GPUDeviceLostInfo) => void): void {
    this.lostCbs.push(cb);
    if (this.lost) cb(this.lost);
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
