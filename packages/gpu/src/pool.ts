// Buffer and texture pools with our own byte budget (guide §5.2). WebGPU cannot report free memory,
// so the engine counts what it allocated, reuses released objects with the same descriptor, and
// treats an out-of-memory error scope as a signal to trim, halve the budget and retry once.
import { ChromobenchError } from '@chromobench/contract';

export interface TexDesc { format: GPUTextureFormat; w: number; h: number; d?: number; dimension?: '2d' | '3d'; usage: number }
export interface BufDesc { size: number; usage: number }

/** The subset of GPUDevice the pools use (node tests pass a fake). */
export interface PoolDevice {
  createTexture(d: GPUTextureDescriptor): GPUTexture;
  createBuffer(d: GPUBufferDescriptor): GPUBuffer;
  pushErrorScope(f: GPUErrorFilter): void;
  popErrorScope(): Promise<GPUError | null>;
}

const TEXEL_BYTES: Partial<Record<GPUTextureFormat, number>> = {
  rgba32float: 16, rgba32uint: 16, rgba16float: 8, rgba16uint: 8, rg32float: 8, r32float: 4, r32uint: 4,
  rgba8unorm: 4, bgra8unorm: 4, r16float: 2, rg16float: 4,
};

export function texBytes(d: TexDesc): number {
  const b = TEXEL_BYTES[d.format];
  if (!b) throw new Error(`pool: unknown texel size for ${d.format}`);
  return d.w * d.h * (d.d ?? 1) * b;
}

/**
 * The engine's own count of GPU bytes (WebGPU cannot report free memory), shared by the texture and buffer pools.
 * CHB-041: it keeps the high-water mark (`peak`, and per window: `watch`), and when an allocation does not fit it makes
 * room in order — the free lists of both pools, least recently released first, then `onShort` (the runtime's reclaimers:
 * textures of frames not on screen) — before the pool refuses with E_GPU_OOM.
 */
export class Budget {
  private bytes = 0;
  limit: number;
  /** the most bytes live at once since resetPeak() */
  peak = 0;
  /** asked for room when an allocation does not fit after the free lists are trimmed; frees what it can (CHB-041) */
  onShort: ((need: number) => void) | null = null;
  private readonly pools: { freeEntries(): { at: number; drop(): void }[] }[] = [];
  private readonly windows = new Set<{ peak: number }>();
  private failing = 0;
  private tick = 0;
  constructor(limit: number) {
    this.limit = limit;
  }
  get live(): number { return this.bytes; }
  set live(v: number) {
    this.bytes = v;
    if (v > this.peak) this.peak = v;
    for (const w of this.windows) if (v > w.peak) w.peak = v;
  }
  fits(bytes: number): boolean { return this.bytes + bytes <= this.limit; }
  resetPeak(): void { this.peak = this.bytes; }
  /** A window over which the high-water mark is kept (one render); end() returns it. */
  watch(): { end(): number } {
    const w = { peak: this.bytes };
    this.windows.add(w);
    return { end: () => { this.windows.delete(w); return w.peak; } };
  }
  /** the shared clock of releases (the pools trim least recently released first, across both) */
  clock(): number { return ++this.tick; }
  register(pool: { freeEntries(): { at: number; drop(): void }[] }): void { this.pools.push(pool); }
  /** Tests (CHB-041): the next `count` acquisitions (reused or new) fail as if the budget were full. */
  inject(count: number): void { this.failing = count; }
  /** One injected failure taken, if any (the pools ask before every acquisition). */
  injected(): boolean {
    if (this.failing <= 0) return false;
    this.failing--;
    return true;
  }
  /** Makes room for `bytes`: the free lists of every pool, then onShort. True when they fit. */
  makeRoom(bytes: number): boolean {
    if (this.fits(bytes)) return true;
    this.trimFree(this.limit - bytes);
    if (!this.fits(bytes)) this.onShort?.(this.bytes + bytes - this.limit);
    if (!this.fits(bytes)) this.trimFree(this.limit - bytes);
    return this.fits(bytes);
  }
  /** Destroys released objects of every pool, least recently released first, until live bytes ≤ target. */
  trimFree(target: number): void {
    const all = this.pools.flatMap((p) => p.freeEntries()).sort((a, b) => a.at - b.at);
    for (const e of all) {
      if (this.bytes <= target) break;
      e.drop();
    }
  }
}

function oom(message: string): ChromobenchError {
  return new ChromobenchError({ code: 'E_GPU_OOM', message, hint: 'retry with smaller tiles (planTiles budgetBytes)' });
}

interface Entry<T> { obj: T; key: string; bytes: number; releasedAt: number }

abstract class Pool<T extends { destroy(): void }, D> {
  protected readonly free = new Map<string, Entry<T>[]>();
  protected readonly live = new Map<T, Entry<T>>();
  private readonly pins = new Map<T, string>();
  protected readonly device: PoolDevice;
  readonly budget: Budget;
  /** registers with the budget, which trims the free lists of all its pools together, oldest release first */
  constructor(device: PoolDevice, budget: Budget) {
    this.device = device;
    this.budget = budget;
    budget.register(this);
  }

  protected abstract keyOf(d: D): string;
  protected abstract bytesOf(d: D): number;
  protected abstract create(d: D, label: string): T;

  /** Reuse a released object with the same descriptor, else create one inside the budget. */
  acquire(d: D, label: string): T {
    if (this.budget.injected()) throw oom(`${label}: ${this.bytesOf(d)} bytes do not fit the budget (an injected failure; ${this.budget.live} of ${this.budget.limit} live)`);
    const key = this.keyOf(d);
    const list = this.free.get(key);
    const hit = list?.pop();
    if (hit) {
      this.live.set(hit.obj, hit);
      return hit.obj;
    }
    const bytes = this.bytesOf(d);
    if (!this.budget.makeRoom(bytes)) throw oom(`${label}: ${bytes} bytes do not fit the budget (${this.budget.live} of ${this.budget.limit} live)`);
    const obj = this.create(d, label);
    this.budget.live += bytes;
    const e: Entry<T> = { obj, key, bytes, releasedAt: 0 };
    this.live.set(obj, e);
    return obj;
  }

  /**
   * acquire() inside an out-of-memory error scope. On a GPUOutOfMemoryError: trim the free lists,
   * halve the budget and retry once; a second failure throws E_GPU_OOM.
   */
  async acquireChecked(d: D, label: string): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      this.device.pushErrorScope('out-of-memory');
      let obj: T | undefined;
      try {
        obj = this.acquire(d, label);
      } finally {
        const err = await this.device.popErrorScope();
        if (err && obj) {
          this.drop(obj);
          obj = undefined;
          this.trimAll(0);
          this.budget.limit = Math.floor(this.budget.limit / 2);
        }
      }
      if (obj) return obj;
    }
    throw oom(`${label}: out of GPU memory after one retry`);
  }

  release(obj: T): void {
    const e = this.live.get(obj);
    if (!e) return;
    if (this.pins.has(obj)) return; // pinned objects stay live until their owner unpins
    this.live.delete(obj);
    e.releasedAt = this.budget.clock();
    const list = this.free.get(e.key) ?? [];
    list.push(e);
    this.free.set(e.key, list);
  }

  pin(obj: T, owner: string): void { this.pins.set(obj, owner); }

  /** Unpins and releases everything pinned by owner. */
  unpinAll(owner: string): void {
    for (const [o, w] of [...this.pins]) if (w === owner) { this.pins.delete(o); this.release(o); }
  }

  /**
   * How a trimmed object is destroyed: the runtime defers it while GPU work is in flight (GpuRuntime.retire), because a
   * released object may still be bound by a pass that has not been submitted yet (CHB-038). Default: at once.
   */
  retire: ((obj: T) => void) | null = null;

  /** Destroys least-recently released objects until live bytes ≤ targetBytes or the free lists are empty (every pool on the budget). */
  trimAll(targetBytes: number): void {
    this.budget.trimFree(targetBytes);
  }

  /** This pool's released objects for Budget.trimFree: when each was released, and how to destroy it. */
  freeEntries(): { at: number; drop(): void }[] {
    return [...this.free.values()].flat().map((e) => ({
      at: e.releasedAt,
      drop: () => {
        const list = this.free.get(e.key)!;
        list.splice(list.indexOf(e), 1);
        if (this.retire) this.retire(e.obj);
        else e.obj.destroy();
        this.budget.live -= e.bytes;
      },
    }));
  }

  /**
   * Lets go of a live object for good (CHB-041: a resident texture evicted): out of the budget now, destroyed when no
   * GPU work is in flight (retire), since a pass that has not been submitted may still bind it.
   */
  discard(obj: T): void {
    const e = this.live.get(obj);
    if (!e) return;
    this.live.delete(obj);
    this.pins.delete(obj);
    if (this.retire) this.retire(obj);
    else obj.destroy();
    this.budget.live -= e.bytes;
  }

  /** The bytes of a live object (0 when the pool does not hold it). */
  bytesOfLive(obj: T): number {
    return this.live.get(obj)?.bytes ?? 0;
  }

  /** Forget an object entirely (destroyed). */
  drop(obj: T): void {
    const e = this.live.get(obj);
    if (!e) return;
    this.live.delete(obj);
    this.pins.delete(obj);
    obj.destroy();
    this.budget.live -= e.bytes;
  }

  get bytesLive(): number {
    let s = 0;
    for (const e of this.live.values()) s += e.bytes;
    return s;
  }
  get bytesFree(): number {
    let s = 0;
    for (const l of this.free.values()) for (const e of l) s += e.bytes;
    return s;
  }
  get liveCount(): number { return this.live.size; }

  destroyAll(): void {
    for (const e of this.live.values()) e.obj.destroy();
    for (const l of this.free.values()) for (const e of l) e.obj.destroy();
    this.budget.live -= this.bytesLive + this.bytesFree;
    this.live.clear();
    this.free.clear();
    this.pins.clear();
  }
}

export class TexturePool extends Pool<GPUTexture, TexDesc> {
  protected keyOf(d: TexDesc): string { return `${d.format}|${d.w}x${d.h}x${d.d ?? 1}|${d.dimension ?? '2d'}|${d.usage}`; }
  protected bytesOf(d: TexDesc): number { return texBytes(d); }
  protected create(d: TexDesc, label: string): GPUTexture {
    return this.device.createTexture({ label, format: d.format, size: [d.w, d.h, d.d ?? 1], dimension: d.dimension ?? '2d', usage: d.usage });
  }
}

/** Buffers are bucketed to multiples of 256 bytes so near-equal sizes share entries. */
export class BufferPool extends Pool<GPUBuffer, BufDesc> {
  static round(size: number): number { return Math.max(256, Math.ceil(size / 256) * 256); }
  protected keyOf(d: BufDesc): string { return `${BufferPool.round(d.size)}|${d.usage}`; }
  protected bytesOf(d: BufDesc): number { return BufferPool.round(d.size); }
  protected create(d: BufDesc, label: string): GPUBuffer {
    return this.device.createBuffer({ label, size: BufferPool.round(d.size), usage: d.usage });
  }
}
