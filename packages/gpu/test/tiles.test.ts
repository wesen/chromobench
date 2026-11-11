// Stage 2: tile planner. The 100 MP worked example of guide §5.3, and properties over random frames.
import { describe, expect, it } from 'vitest';
import { haloOverhead, planTiles, type SpatialKernel } from '../src/tiles.ts';

const caps = (budgetBytes = 512 * 2 ** 20, maxTextureDimension2D = 16384) => ({ budgetBytes, limits: { maxTextureDimension2D } });

describe('planTiles: 100 MP 6×7 negative (guide §5.3)', () => {
  const umPerPx = 69.5e3 / 11600; // 5.99 µm
  const kernels: SpatialKernel[] = [
    { id: 'film.halation/b1', sigmaUm: 65, fieldOk: true, field: 'halation' },
    { id: 'film.halation/b2', sigmaUm: 65 * Math.SQRT2, fieldOk: true, field: 'halation' },
    { id: 'film.halation/b3', sigmaUm: 65 * Math.sqrt(3), fieldOk: true, field: 'halation' },
    { id: 'print.contrastMask/base', radiusPx: 464, fieldOk: true, field: 'guided', fieldLongSide: 640 },
    { id: 'print.clarity/base', radiusPx: 93, fieldOk: true, field: 'guided', fieldLongSide: 640 },
    { id: 'pd.grainReduction', radiusPx: 2, fieldOk: false },
    { id: 'print.texture', radiusPx: 2, fieldOk: false },
    { id: 'out.sharpen', radiusPx: 1, fieldOk: false },
  ];
  const p = planTiles({ w: 11600, h: 8700, umPerPx }, kernels, caps());

  it('chooses 1024-px tiles with an 8-px halo: 12 × 9 = 108 tiles', () => {
    expect(p.tile).toBe(1024);
    expect(p.halo).toBe(8);
    expect(p.tiles.length).toBe(108);
    expect(p.bytesPerTile).toBe(1040 * 1040 * 80); // 87 MB
    expect(p.diagnostics).toEqual([]);
  });

  it('puts the halation bounces in one global field at downsample 4 (2,900 × 2,175)', () => {
    const h = p.fields.find((f) => f.field === 'halation')!;
    expect(h.downsample).toBe(4);
    expect([h.w, h.h]).toEqual([2900, 2175]);
    expect(h.sigmaPx).toBeGreaterThanOrEqual(2);
    expect(h.sigmaPx).toBeCloseTo(2.71, 2);
    const g = p.fields.find((f) => f.field === 'guided')!;
    expect(g.w).toBe(640);
  });

  it('the halo costs 3.2 % extra pixels', () => {
    expect(haloOverhead(p)).toBeGreaterThan(0.025);
    expect(haloOverhead(p)).toBeLessThan(0.032);
    // interior tiles are exactly the guide's ((1024+16)/1024)² − 1 = 3.2 %
    expect((1040 / 1024) ** 2 - 1).toBeCloseTo(0.0315, 3);
  });

  it('reports statistics size with the plan', () => {
    expect(p.stats).toEqual({ w: 640, h: 480 });
  });
});

describe('planTiles: properties', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  it('every pixel belongs to exactly one tile core; read rects stay in the frame', () => {
    for (let t = 0; t < 60; t++) {
      const w = 1 + Math.floor(rnd() * 3000);
      const h = 1 + Math.floor(rnd() * 3000);
      const ks: SpatialKernel[] = [{ id: 'a', radiusPx: Math.floor(rnd() * 10), fieldOk: false }];
      const p = planTiles({ w, h, umPerPx: 5 }, ks, caps(2 ** 26), { minTile: 64 });
      const cover = new Uint8Array(w * h);
      for (const tile of p.tiles) {
        const { core, read } = tile;
        expect(read.x).toBeGreaterThanOrEqual(0);
        expect(read.y).toBeGreaterThanOrEqual(0);
        expect(read.x + read.w).toBeLessThanOrEqual(w);
        expect(read.y + read.h).toBeLessThanOrEqual(h);
        expect(read.x).toBeLessThanOrEqual(core.x);
        expect(core.x - read.x).toBe(Math.min(p.halo, core.x));
        for (let y = core.y; y < core.y + core.h; y++) for (let x = core.x; x < core.x + core.w; x++) cover[y * w + x]!++;
      }
      expect(cover.every((c) => c === 1)).toBe(true);
      expect(p.tiles.map((x) => x.index)).toEqual(p.tiles.map((_, i) => i));
    }
  }, 30_000); // ~4–5 s of pixel bookkeeping on a loaded runner; the 5 s default timed out (CHB-010 diary Step 19)

  it('halos sum along a chain and take the max across chains', () => {
    const p1 = planTiles({ w: 4000, h: 3000, umPerPx: 5 }, [
      { id: 'a', radiusPx: 5, fieldOk: false, chain: 'x' },
      { id: 'b', radiusPx: 6, fieldOk: false, chain: 'x' },
      { id: 'c', radiusPx: 9, fieldOk: false, chain: 'y' },
    ], caps(), { haloAlign: 1 });
    expect(p1.halo).toBe(1 + 11);
    const p2 = planTiles({ w: 4000, h: 3000, umPerPx: 5 }, [{ id: 'c', radiusPx: 9, fieldOk: false }], caps(), { haloAlign: 1 });
    expect(p2.halo).toBe(10);
  });

  it('kernels in µm convert by the frame scale', () => {
    const p = planTiles({ w: 4000, h: 3000, umPerPx: 2 }, [{ id: 'g', sigmaUm: 4, fieldOk: false }], caps(), { haloAlign: 1 });
    expect(p.local[0]!.rPx).toBe(6);
  });

  it('a non-field kernel wider than a quarter tile yields E_HALO_TOO_WIDE', () => {
    const p = planTiles({ w: 4000, h: 3000, umPerPx: 1 }, [{ id: 'bilateral', radiusPx: 300, fieldOk: false }], caps(2 ** 26), { minTile: 256, maxHaloPx: 32 });
    expect(p.diagnostics.map((d) => d.code)).toContain('E_HALO_TOO_WIDE');
  });

  it('a wide field-capable kernel becomes a field and does not grow the halo', () => {
    const p = planTiles({ w: 4000, h: 3000, umPerPx: 1 }, [{ id: 'blur', sigmaUm: 40, fieldOk: true }], caps());
    expect(p.halo).toBe(0);
    expect(p.fields[0]!.downsample).toBe(16); // σ 40 px: 40/16 = 2.5 ≥ 2, 40/32 < 2
  });

  it('respects maxTextureDimension2D and the budget', () => {
    const p = planTiles({ w: 20000, h: 20000, umPerPx: 1 }, [], caps(2 ** 34, 8192));
    expect(p.tile).toBeLessThanOrEqual(8192);
    const q = planTiles({ w: 20000, h: 20000, umPerPx: 1 }, [], caps(2 ** 26));
    expect((q.tile ** 2) * 80).toBeLessThanOrEqual(2 ** 25);
  });
});
