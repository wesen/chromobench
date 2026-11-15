// CHB-041 (node-side): the budget across both pools, its high-water marks and injected failures, the residency of
// textures per frame, the source sampled on a render's grid, and the budget rule.
import { describe, expect, it } from 'vitest';
import { isChromobenchError } from '@chromobench/contract';
import { Budget, BufferPool, TexturePool, type PoolDevice } from '../src/pool.ts';
import { Residency, gridCoords, sampleSource } from '../src/residency.ts';
import { BUDGET_RULE, budgetFor } from '../src/device.ts';

function fakeDevice(): PoolDevice & { destroyed: string[] } {
  const dev = {
    destroyed: [] as string[],
    createTexture(d: GPUTextureDescriptor) {
      return { label: d.label, destroy: () => dev.destroyed.push(String(d.label)) } as unknown as GPUTexture;
    },
    createBuffer(d: GPUBufferDescriptor) {
      return { label: d.label, size: d.size, destroy: () => dev.destroyed.push(String(d.label)) } as unknown as GPUBuffer;
    },
    pushErrorScope() {},
    async popErrorScope() { return null; },
  };
  return dev;
}

const tex = (w: number) => ({ format: 'rgba32float' as GPUTextureFormat, w, h: 64, usage: 4 });
const MiB = 2 ** 20;

describe('budget (CHB-041)', () => {
  it('trims released buffers to make room for a texture (the owner\'s OOM: free staging buffers stayed in the budget)', () => {
    const dev = fakeDevice();
    const budget = new Budget(3 * 65536);
    const textures = new TexturePool(dev, budget);
    const buffers = new BufferPool(dev, budget);
    const staging = buffers.acquire({ size: 2 * 65536, usage: 1 }, 'staging');
    textures.acquire(tex(64), 'source');
    buffers.release(staging);
    expect(budget.live).toBe(3 * 65536);
    textures.acquire(tex(64), 'next');
    expect(dev.destroyed).toEqual(['staging']);
    expect(budget.live).toBe(2 * 65536);
  });

  it('trims across pools least recently released first', () => {
    const dev = fakeDevice();
    const budget = new Budget(4 * 65536);
    const textures = new TexturePool(dev, budget);
    const buffers = new BufferPool(dev, budget);
    const a = textures.acquire(tex(64), 'a');
    const b = buffers.acquire({ size: 65536, usage: 1 }, 'b');
    const c = textures.acquire(tex(64), 'c');
    buffers.release(b);
    textures.release(a);
    textures.release(c);
    textures.acquire({ ...tex(64), usage: 8 }, 'x'); // fits: nothing trimmed
    textures.acquire({ ...tex(64), usage: 16 }, 'y'); // one must go: b, released first
    expect(dev.destroyed).toEqual(['b']);
  });

  it('asks onShort for the rest, then refuses with E_GPU_OOM', () => {
    const budget = new Budget(2 * 65536);
    const textures = new TexturePool(fakeDevice(), budget);
    const kept = textures.acquire(tex(64), 'kept');
    textures.acquire(tex(64), 'other');
    const asked: number[] = [];
    budget.onShort = (need) => {
      asked.push(need);
      if (asked.length === 1) textures.discard(kept);
    };
    textures.acquire(tex(64), 'third');
    expect(asked).toEqual([65536]);
    expect(() => textures.acquire(tex(64), 'fourth')).toThrow(/fourth: 65536 bytes do not fit the budget/);
    expect(asked.length).toBe(2);
  });

  it('keeps the high-water mark, globally and per window', () => {
    const budget = new Budget(1 << 20);
    const p = new TexturePool(fakeDevice(), budget);
    const a = p.acquire(tex(64), 'a');
    const w = budget.watch();
    const b = p.acquire(tex(128), 'b');
    p.discard(b);
    p.discard(a);
    expect(budget.live).toBe(0);
    expect(w.end()).toBe(3 * 65536);
    expect(budget.peak).toBe(3 * 65536);
    budget.resetPeak();
    expect(budget.peak).toBe(0);
  });

  it('injected failures make the next allocations fail as if the budget were full', () => {
    const budget = new Budget(1 << 20);
    const p = new TexturePool(fakeDevice(), budget);
    budget.inject(1);
    try {
      p.acquire(tex(64), 'x');
      throw new Error('no throw');
    } catch (e) {
      expect(isChromobenchError(e) && e.code).toBe('E_GPU_OOM');
    }
    expect(p.acquire(tex(64), 'y')).toBeDefined();
  });

  it('discard destroys an object no pass holds at once and takes its bytes out of the budget', () => {
    const dev = fakeDevice();
    const budget = new Budget(1 << 20);
    const p = new TexturePool(dev, budget);
    const a = p.acquire(tex(64), 'a');
    p.discard(a);
    expect(dev.destroyed).toEqual(['a']);
    expect(budget.live).toBe(0);
    expect(budget.pending).toBe(0);
    expect(p.liveCount).toBe(0);
  });
});

describe('leases and pending bytes (CHB-045: GPUC-1, GPUC-4)', () => {
  it('a leased object released mid-pass is not handed out again until its lease ends (an export\'s field and a preview)', () => {
    const p = new TexturePool(fakeDevice(), new Budget(1 << 20));
    const field = p.acquire(tex(64), 'field');
    const done = p.lease(field); // a tile took the field and awaits its pipeline
    p.release(field); // a preview drops the fields
    expect(p.bytesFree).toBe(0);
    const other = p.acquire(tex(64), 'other render');
    expect(other).not.toBe(field); // before: the field itself, written by the other render
    done(); // the tile submitted
    expect(p.bytesFree).toBe(65536);
    expect(p.acquire(tex(64), 'next')).toBe(field);
  });

  it('an object leased twice returns to the pool only after both leases; ending a lease twice counts once', () => {
    const p = new TexturePool(fakeDevice(), new Budget(1 << 20));
    const f = p.acquire(tex(64), 'f');
    const a = p.lease(f), b = p.lease(f);
    p.release(f);
    a();
    a();
    expect(p.bytesFree).toBe(0);
    b();
    expect(p.bytesFree).toBe(65536);
  });

  it('a leased object discarded is pending: counted in the budget until its last lease ends, then destroyed', () => {
    const dev = fakeDevice();
    const budget = new Budget(3 * 65536);
    const p = new TexturePool(dev, budget);
    const a = p.acquire(tex(64), 'a');
    const done = p.lease(a);
    p.discard(a);
    expect(dev.destroyed).toEqual([]);
    expect(budget.live).toBe(0);
    expect(budget.pending).toBe(65536);
    expect(budget.held).toBe(65536);
    expect(p.pendingCount).toBe(1);
    // allocation counts it: two more fit, a third does not (before: four fitted in a budget of three)
    p.acquire(tex(64), 'b');
    p.acquire(tex(64), 'c');
    expect(() => p.acquire(tex(64), 'd')).toThrow(/d: 65536 bytes do not fit the budget/);
    done();
    expect(dev.destroyed).toEqual(['a']);
    expect(budget.pending).toBe(0);
    expect(p.pendingCount).toBe(0);
    expect(p.acquire(tex(64), 'd')).toBeDefined();
  });

  it('the high-water marks include pending bytes', () => {
    const budget = new Budget(1 << 20);
    const p = new TexturePool(fakeDevice(), budget);
    const a = p.acquire(tex(64), 'a');
    const done = p.lease(a);
    const w = budget.watch();
    p.discard(a);
    p.acquire(tex(128), 'b'); // live 2·65536, pending 65536
    expect(w.end()).toBe(3 * 65536);
    expect(budget.peak).toBe(3 * 65536);
    done();
    budget.resetPeak();
    expect(budget.peak).toBe(2 * 65536);
  });

  it('trimming the free lists destroys at once (a released object has no lease); released then discarded while leased: destroyed once, at the lease\'s end', () => {
    const dev = fakeDevice();
    const budget = new Budget(2 * 65536);
    const p = new TexturePool(dev, budget);
    const a = p.acquire(tex(64), 'a');
    p.release(a);
    p.acquire({ ...tex(64), usage: 8 }, 'b');
    p.acquire({ ...tex(64), usage: 16 }, 'c'); // trims a
    expect(dev.destroyed).toEqual(['a']);
    expect(budget.held).toBe(2 * 65536);
    const q = new TexturePool(dev, new Budget(1 << 20));
    const f = q.acquire(tex(64), 'f');
    const done = q.lease(f);
    q.release(f);
    q.discard(f);
    expect(q.bytesFree).toBe(0);
    done();
    expect(dev.destroyed).toEqual(['a', 'f']);
    expect(q.bytesFree).toBe(0);
    expect(q.budget.held).toBe(0);
  });

  it('destroyAll destroys pending objects too', () => {
    const dev = fakeDevice();
    const budget = new Budget(1 << 20);
    const p = new TexturePool(dev, budget);
    const a = p.acquire(tex(64), 'a');
    p.lease(a);
    p.discard(a);
    p.destroyAll();
    expect(dev.destroyed).toEqual(['a']);
    expect(budget.held).toBe(0);
  });
});

describe('residency (CHB-041)', () => {
  const t = (name: string) => ({ label: name }) as unknown as GPUTexture;
  const made = () => {
    const gone: string[] = [];
    const held: string[] = [];
    const r = new Residency((x) => gone.push((x as unknown as { label: string }).label), (x) => {
      const l = (x as unknown as { label: string }).label;
      held.push(l);
      return () => held.splice(held.indexOf(l), 1);
    });
    return { r, gone, held };
  };

  it('evicts frames not on screen first, least recently used first, and stops when enough is free', () => {
    const { r, gone } = made();
    r.put('A', 'full|a', t('A'), 100);
    r.put('B', 'full|b', t('B'), 100);
    r.put('C', 'full|c', t('C'), 100);
    r.get('full|a'); // A used last
    r.pin(['C']);
    expect(r.evict(50)).toEqual({ bytes: 100, frames: ['B'] });
    expect(gone).toEqual(['B']);
    expect(r.evict(Infinity)).toEqual({ bytes: 100, frames: ['A'] }); // C is on screen
    expect(r.stats()).toMatchObject({ bytes: 100, pinnedBytes: 100, frames: 1 });
  });

  it('never evicts a texture a render holds, nor a pinned frame, unless all; a lease is a pool lease too', () => {
    const { r, gone, held } = made();
    r.put('A', 'full|a', t('A'), 100);
    r.put('B', 'full|b', t('B'), 100);
    const doneA = r.lease('full|a');
    expect(held).toEqual(['A']);
    r.pin(['B']);
    expect(r.evict(Infinity).bytes).toBe(0);
    doneA();
    doneA();
    expect(held).toEqual([]);
    expect(r.evict(Infinity).frames).toEqual(['A']);
    r.lease('full|b');
    expect(r.evict(Infinity, { all: true }).frames).toEqual(['B']);
    expect(gone).toEqual(['A', 'B']);
    expect(held).toEqual(['B']); // the pool destroys B when that render's lease ends
  });

  it('a frame\'s proxies hold no more than its full-size texture would', () => {
    const { r, gone } = made();
    r.put('A', 'proxy|0', t('p0'), 60, { proxy: true, cap: 100 });
    r.put('A', 'proxy|1', t('p1'), 30, { proxy: true, cap: 100 });
    r.put('A', 'proxy|2', t('p2'), 30, { proxy: true, cap: 100 });
    expect(gone).toEqual(['p0']);
    expect(r.stats().bytes).toBe(60);
  });

  it('keeps the newest proxies of a frame and forgets a frame whole', () => {
    const { r, gone } = made();
    for (let i = 0; i < Residency.PROXIES_KEPT + 2; i++) r.put('A', `proxy|${i}`, t(`p${i}`), 10, { proxy: true });
    r.put('A', 'full|a', t('full'), 100);
    expect(gone).toEqual(['p0', 'p1']);
    expect(r.keysOf('A').length).toBe(Residency.PROXIES_KEPT + 1);
    expect(r.forget('A')).toBe(10 * Residency.PROXIES_KEPT + 100);
    expect(r.stats().textures).toBe(0);
  });
});

describe('the source sampled on a render grid (CHB-041)', () => {
  // kernels/pointwise.wgsl: fp = outMap.xy + floor((p + 0.5) * outMap.zw), all f32, outMap.zw = f32(region / out)
  const f32Mul = (a: number, b: number): number => {
    const x = new Float32Array([a, b]);
    return new Float32Array([x[0]! * x[1]!])[0]!;
  };
  it('reads the pixel the shader reads, in f32', () => {
    for (const [span, n, origin] of [[4000, 1152, 0], [6000, 160, 0], [2667, 768, 0], [1000, 333, 17], [7, 3, 2]] as const) {
      const xs = gridCoords(origin, span, n, origin + span);
      const z = new Float32Array([span / n])[0]!;
      for (let p = 0; p < n; p++) expect(xs[p]).toBe(origin + Math.floor(f32Mul(p + 0.5, z)));
      expect(Math.max(...xs)).toBeLessThan(origin + span);
    }
  });

  it('samples f32 and 16-bit sources at those pixels', () => {
    const w = 10, h = 6;
    const data = new Float32Array(w * h * 3).map((_, i) => i);
    const s = sampleSource({ w, h, c: 3, data }, { x: 2, y: 1, w: 6, h: 4 }, 3, 2);
    const xs = gridCoords(2, 6, 3, w), ys = gridCoords(1, 4, 2, h);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) for (let k = 0; k < 3; k++) expect(s.data![(y * 3 + x) * 3 + k]).toBe(data[(ys[y]! * w + xs[x]!) * 3 + k]);
    const u16 = new Uint16Array(w * h).map((_, i) => i);
    const g = sampleSource({ w, h, c: 3, u16, samples: 1, max: 65535 }, { x: 0, y: 0, w, h }, 5, 3);
    expect(g.samples).toBe(1);
    expect(g.max).toBe(65535);
    const row = gridCoords(0, h, 3, h)[0]!;
    expect([...g.u16!.slice(0, 5)]).toEqual([...gridCoords(0, w, 5, w)].map((x) => row * w + x));
  });
});

describe('the budget rule (CHB-041)', () => {
  it('an eighth of the device memory, no more than maxBufferSize, within the floor and the cap', () => {
    // Apple M1 Max in Chrome: maxBufferSize 4 GiB, deviceMemory 32 → the cap
    expect(budgetFor({ maxBufferSize: 4294967292, fallback: false }, 32).bytes).toBe(BUDGET_RULE.cap);
    // 8 GB machine: 1 GiB
    expect(budgetFor({ maxBufferSize: 4294967292, fallback: false }, 8).bytes).toBe(1024 * MiB);
    // SwiftShader: maxBufferSize 1 GiB, a software adapter → at most 1 GiB
    expect(budgetFor({ maxBufferSize: 2 ** 30, fallback: true }, 32).bytes).toBe(BUDGET_RULE.softwareCap);
    // no device memory reported: 4 GiB assumed → the floor
    const r = budgetFor({ maxBufferSize: 2 ** 30, fallback: true });
    expect(r.bytes).toBe(BUDGET_RULE.floor);
    expect(r.rule).toMatch(/assumed/);
    // a small adapter still gets the floor
    expect(budgetFor({ maxBufferSize: 256 * MiB, fallback: false }, 2).bytes).toBe(512 * MiB);
    expect(budgetFor({ maxBufferSize: 4294967292, fallback: false }, 16).rule).toBe('min(16 GiB device memory × 1/8, maxBufferSize 4096 MiB) within [512 MiB, 2048 MiB] = 2048 MiB');
  });
});
