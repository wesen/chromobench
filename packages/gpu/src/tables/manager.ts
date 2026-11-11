// Table resolution: memory → OPFS → build, with the backend order of device.ts backendOrder.
// The builder is part of the key (decision D6): previews may take either; exports name 'f64'.
import type { TableKey } from '@chromobench/contract';
import { backendOrder, type AccelChoice, type Backend, type GpuRuntime } from '../device.ts';
import { buildTableF64, coreOracle, type F64Oracle } from '../physics/oracle.ts';
import { buildTableGpu } from './build-gpu.ts';
import type { WorkerPool } from './build-workers.ts';
import { TableCache } from './cache.ts';
import { keyFor, tableId } from './keys.ts';
import type { SolveInputs, SpectralInputs, Table } from './inputs.ts';

export interface ResolvedTable { key: TableKey; id: string; table: Table; texture: GPUTexture; backend: Backend | 'cache' }

/** Float32 → IEEE half bits (render.js toHalf 2696–2713), round to nearest even. */
export function toHalf(f: number): number {
  const fv = new Float32Array([f]);
  const x = new Uint32Array(fv.buffer)[0]!;
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15;
  let m = x & 0x7fffff;
  if (((x >>> 23) & 0xff) === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0);
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    m |= 0x800000;
    const shift = 14 - e;
    let h = m >>> shift;
    const rem = m & ((1 << shift) - 1);
    const half = 1 << (shift - 1);
    if (rem > half || (rem === half && h & 1)) h++;
    return sign | h;
  }
  let h = (e << 10) | (m >>> 13);
  const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && h & 1)) h++;
  return sign | h;
}

export function uploadTable3D(rt: GpuRuntime, t: Table, format: 'rgba32float' | 'rgba16float' = 'rgba32float', label = 'table'): GPUTexture {
  const N = t.N;
  const tex = rt.textures.acquire({ format, w: N, h: N, d: N, dimension: '3d', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC }, label);
  if (format === 'rgba32float') {
    // writeTexture has no 256-byte bytesPerRow rule (copyBufferToTexture does: 33 × 16 = 528)
    rt.device.queue.writeTexture({ texture: tex }, t.data as Float32Array<ArrayBuffer>, { bytesPerRow: N * 16, rowsPerImage: N }, [N, N, N]);
  } else {
    const h = Uint16Array.from(t.data, toHalf);
    rt.device.queue.writeTexture({ texture: tex }, h, { bytesPerRow: N * 8, rowsPerImage: N }, [N, N, N]);
  }
  return tex;
}

export interface TableManagerOptions {
  accel?: AccelChoice;
  /** The f64 oracle of the main-thread build (default core's; workers always use core's). */
  oracle?: F64Oracle;
  /** TableKey.conventions (default core's conventions id). */
  conventions?: string;
  workers?: WorkerPool | null;
  cache?: TableCache;
}

export class TableManager {
  readonly cache: TableCache;
  private readonly live = new Map<string, Promise<ResolvedTable>>();
  readonly log: { id: string; kind: string; backend: string; ms: number }[] = [];
  private readonly rt: GpuRuntime;
  private readonly opts: TableManagerOptions;
  constructor(rt: GpuRuntime, opts: TableManagerOptions = {}) {
    this.rt = rt;
    this.opts = opts;
    this.cache = opts.cache ?? new TableCache(null);
  }

  /** Resolves a table, building with the first backend that succeeds. `builder` pins the key's builder. */
  resolve(inp: SolveInputs | SpectralInputs, o: { builder?: 'f64' | 'gpu-f32'; scan?: string; urgent?: boolean } = {}): Promise<ResolvedTable> {
    const order = o.builder === 'f64' ? (['workers', 'main'] as Backend[]).filter((b) => b !== 'workers' || this.opts.workers)
      : o.builder === 'gpu-f32' ? (['gpu'] as Backend[])
      : backendOrder(this.opts.accel ?? 'auto', this.rt.caps, !!this.opts.workers);
    const memoKey = `${inp.kind}|${o.builder ?? 'any'}|${tableId(keyFor(inp, { builder: 'f64', ...this.keyOpts(o) }))}`;
    let p = this.live.get(memoKey);
    if (!p) {
      p = this.build(inp, order, o);
      this.live.set(memoKey, p);
      p.catch(() => this.live.delete(memoKey));
    }
    return p;
  }

  private async build(inp: SolveInputs | SpectralInputs, order: Backend[], o: { scan?: string; urgent?: boolean }): Promise<ResolvedTable> {
    let lastErr: unknown;
    for (const backend of order) {
      const builder = backend === 'gpu' ? 'gpu-f32' : 'f64';
      const key = keyFor(inp, { builder, ...this.keyOpts(o) });
      const id = tableId(key);
      const t0 = performance.now();
      try {
        const hit = await this.cache.get(key);
        if (hit) return { key, id, table: hit, texture: uploadTable3D(this.rt, hit, 'rgba32float', `${inp.kind}.cached`), backend: 'cache' };
        let table: Table;
        let texture: GPUTexture;
        if (backend === 'gpu') {
          const g = await buildTableGpu(this.rt, inp);
          table = { N: g.N, range: g.range, data: g.data };
          texture = g.texture;
        } else {
          table = backend === 'workers' ? await this.opts.workers!.build(inp, { urgent: !!o.urgent }) : buildTableF64(this.opts.oracle ?? coreOracle, inp);
          texture = uploadTable3D(this.rt, table, 'rgba32float', `${inp.kind}.${backend}`);
        }
        await this.cache.put(key, table);
        this.log.push({ id, kind: inp.kind, backend, ms: performance.now() - t0 });
        return { key, id, table, texture, backend };
      } catch (e) {
        lastErr = e; // fall through to the next backend (accel.js any, 3769–3784)
      }
    }
    throw lastErr;
  }

  private keyOpts(o: { scan?: string }): { scan?: string; conventions?: string } {
    return { ...(o.scan ? { scan: o.scan } : {}), ...(this.opts.conventions ? { conventions: this.opts.conventions } : {}) };
  }

  clear(): void { this.live.clear(); this.cache.clearMemory(); }
}
