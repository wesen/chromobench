// Stage 1 (node-side): uniform packing, limits negotiation, pools, backend policy, compile diagnostics.
import { describe, expect, it } from 'vitest';
import { isChromobenchError } from '@chromobench/contract';
import { defineStruct } from '../src/layout.ts';
import { negotiate, WANT_LIMITS } from '../src/limits.ts';
import { Budget, BufferPool, TexturePool, type PoolDevice } from '../src/pool.ts';
import { backendOrder } from '../src/device.ts';
import { compileDiagnostic } from '../src/pipelines.ts';
import { SOLVE_PARAMS, SPECTRAL_PARAMS } from '../src/tables/build-gpu.ts';

describe('layout: WGSL struct packing', () => {
  it("reproduces the Studio's 112-byte SOLVE layout (gpu.js gpuSolve 3584–3595)", () => {
    const L = SOLVE_PARAMS;
    expect(L.size).toBe(112);
    expect(L.offset('K')).toBe(0);
    expect(L.offset('Dbase')).toBe(48);   // float 12
    expect(L.offset('rng')).toBe(64);     // float 16
    expect(L.offset('N')).toBe(80);       // u32 20
    expect(L.offset('maxIt')).toBe(92);
    expect(L.offset('tol')).toBe(96);     // tolerance at byte 96
    expect(L.offset('gtol')).toBe(100);
    expect(L.offset('activeSet')).toBe(104); // activeSet at byte 104
  });

  it('packs the SOLVE uniform byte-identically to the hand packer', () => {
    const K = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const mine = SOLVE_PARAMS.pack({ K, Dbase: [0.1, 0.2, 0.3, 0], rng: [-0.25, 2.55, 0, 4], N: 33, n: 81, total: 35937, maxIt: 50, tol: 1e-12, gtol: 1e-6, activeSet: 1 });
    // the Studio's hand packing
    const buf = new ArrayBuffer(112);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) f[4 * c + r] = K[r]![c]!;
    f.set([0.1, 0.2, 0.3, 0], 12);
    f.set([-0.25, 2.55, 0, 4], 16);
    u.set([33, 81, 35937, 50], 20);
    f.set([1e-12, 1e-6], 24);
    u[26] = 1;
    expect(new Uint8Array(mine)).toEqual(new Uint8Array(buf));
  });

  it('SPECTRAL layout is 80 bytes with mode at u32 19', () => {
    expect(SPECTRAL_PARAMS.size).toBe(80);
    expect(SPECTRAL_PARAMS.offset('rng')).toBe(48);
    expect(SPECTRAL_PARAMS.offset('mode')).toBe(76);
  });

  it('applies vec3 / array alignment rules', () => {
    const S = defineStruct('S', [['a', 'f32'], ['v', 'vec3f'], ['b', 'f32'], ['w', { array: 'vec4f', n: 3 }], ['s', { array: 'f32', n: 2 }]]);
    expect(S.offset('v')).toBe(16);
    expect(S.offset('b')).toBe(28);       // a scalar packs into a vec3's tail
    expect(S.offset('w')).toBe(32);
    expect(S.offset('s')).toBe(80);       // uniform arrays of f32 have a 16-byte stride
    expect(S.size).toBe(112);
    const T = defineStruct('T', [['s', { array: 'f32', n: 2 }]], 'storage');
    expect(T.size).toBe(8);
    expect(S.wgsl()).toContain('v: vec3<f32>,');
  });

  it('the rowMajor bug variant transposes matrices (used by the parity broken variant)', () => {
    const L = defineStruct('M', [['M', 'mat3x3f']]);
    const M = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const a = new Float32Array(L.pack({ M }));
    const b = new Float32Array(L.pack({ M }, { rowMajor: true }));
    expect(Array.from(a.slice(0, 3))).toEqual([1, 4, 7]); // first column
    expect(Array.from(b.slice(0, 3))).toEqual([1, 2, 3]);
  });

  it('refuses unknown fields and overlong vectors', () => {
    expect(() => SOLVE_PARAMS.pack({ nope: 1 })).toThrow(/unknown field/);
    expect(() => SOLVE_PARAMS.pack({ Dbase: [1, 2, 3, 4, 5] })).toThrow(/room for 4/);
  });
});

describe('limits negotiation', () => {
  it('never requests more than the adapter reports, and skips unreported limits', () => {
    const adapter = {
      limits: { maxTextureDimension2D: 8192, maxBufferSize: 4 * 2 ** 30, maxStorageBufferBindingSize: 2 ** 27 },
      features: new Set(['float32-filterable', 'subgroups']),
    };
    const n = negotiate(adapter);
    expect(n.requiredLimits).toEqual({ maxTextureDimension2D: 8192, maxBufferSize: WANT_LIMITS.maxBufferSize, maxStorageBufferBindingSize: 2 ** 27 });
    expect(n.requiredFeatures).toEqual(['float32-filterable']);
    for (const [k, v] of Object.entries(n.requiredLimits)) expect(v).toBeLessThanOrEqual((adapter.limits as Record<string, number>)[k]!);
  });
});

function fakeDevice(oomOn: Set<number> = new Set()): PoolDevice & { created: number; destroyed: number } {
  let n = 0;
  let scopeErr: GPUError | null = null;
  const dev = {
    created: 0, destroyed: 0,
    createTexture(d: GPUTextureDescriptor) {
      dev.created++;
      if (oomOn.has(++n)) scopeErr = { message: 'oom' } as GPUError;
      return { label: d.label, destroy: () => { dev.destroyed++; } } as unknown as GPUTexture;
    },
    createBuffer(d: GPUBufferDescriptor) {
      dev.created++;
      return { label: d.label, size: d.size, destroy: () => { dev.destroyed++; } } as unknown as GPUBuffer;
    },
    pushErrorScope() { scopeErr = null; },
    async popErrorScope() { const e = scopeErr; scopeErr = null; return e; },
  };
  return dev;
}

describe('pools', () => {
  const desc = { format: 'rgba32float' as GPUTextureFormat, w: 64, h: 64, usage: 4 };
  it('reuses released textures with the same descriptor and counts bytes', () => {
    const dev = fakeDevice();
    const p = new TexturePool(dev, new Budget(1 << 20));
    const a = p.acquire(desc, 'a');
    expect(p.bytesLive).toBe(64 * 64 * 16);
    p.release(a);
    const b = p.acquire(desc, 'b');
    expect(b).toBe(a);
    expect(dev.created).toBe(1);
  });

  it('trims least recently released textures to make room, then refuses with E_GPU_OOM', () => {
    const dev = fakeDevice();
    const budget = new Budget(3 * 65536);
    const p = new TexturePool(dev, budget);
    const t = [p.acquire(desc, '0'), p.acquire(desc, '1'), p.acquire(desc, '2')];
    p.release(t[0]!);
    p.acquire({ ...desc, format: 'rgba16float', w: 128 }, 'big'); // same bytes, other key: trims t0
    expect(dev.destroyed).toBe(1);
    try {
      p.acquire(desc, 'over');
      throw new Error('no throw');
    } catch (e) {
      expect(isChromobenchError(e) && e.code).toBe('E_GPU_OOM');
    }
  });

  it('pinned textures survive release until their owner unpins', () => {
    const p = new TexturePool(fakeDevice(), new Budget(1 << 20));
    const a = p.acquire(desc, 'field');
    p.pin(a, 'export-1');
    p.release(a);
    expect(p.liveCount).toBe(1);
    p.unpinAll('export-1');
    expect(p.liveCount).toBe(0);
    expect(p.bytesFree).toBe(65536);
  });

  it('retries once after an out-of-memory error scope, halving the budget', async () => {
    const dev = fakeDevice(new Set([1]));
    const budget = new Budget(1 << 20);
    const p = new TexturePool(dev, budget);
    const t = await p.acquireChecked(desc, 'x');
    expect(t).toBeDefined();
    expect(budget.limit).toBe(1 << 19);
    const dev2 = fakeDevice(new Set([1, 2]));
    const p2 = new TexturePool(dev2, new Budget(1 << 20));
    await expect(p2.acquireChecked(desc, 'x')).rejects.toMatchObject({ code: 'E_GPU_OOM' });
  });

  it('buffers are bucketed to 256 bytes', () => {
    const p = new BufferPool(fakeDevice(), new Budget(1 << 20));
    const a = p.acquire({ size: 100, usage: 1 }, 'a');
    p.release(a);
    expect(p.acquire({ size: 200, usage: 1 }, 'b')).toBe(a);
  });
});

describe('backend policy (accel.js Accel.order)', () => {
  const hw = { available: true, adapter: { vendor: 'x', architecture: '', description: '', fallback: false } };
  const sw = { ...hw, adapter: { ...hw.adapter, fallback: true } };
  const none = { ...hw, available: false };
  it('auto uses a hardware adapter first, never a fallback adapter', () => {
    expect(backendOrder('auto', hw)).toEqual(['gpu', 'workers', 'main']);
    expect(backendOrder('auto', sw)).toEqual(['workers', 'main']);
    expect(backendOrder('auto', none, false)).toEqual(['main']);
  });
  it('a forced GPU uses the fallback adapter', () => {
    expect(backendOrder('gpu', sw)).toEqual(['gpu', 'workers', 'main']);
  });
});

describe('compile diagnostics', () => {
  it('carry the first error line and all messages', () => {
    const d = compileDiagnostic('k', [
      { type: 'warning', lineNum: 1, linePos: 1, message: 'w' },
      { type: 'error', lineNum: 7, linePos: 3, message: 'unresolved identifier' },
    ])!;
    expect(d.code).toBe('E_KERNEL_COMPILE');
    expect(d.where).toEqual({ line: 7, col: 3 });
    expect(d.message).toContain('line 7:3');
    expect(compileDiagnostic('k', [])).toBeNull();
  });
});
