// CHB-027 (F4, F10): the reference engine's sampled previews, staged evaluation and byte-bounded caches.
// A preview at scale < 1 computes only the pixels it samples where the chain is pointwise, and must equal the
// full-resolution path bit for bit; a cancel lands between stages; a print-only change recomputes print stages only.
import { describe, expect, it } from 'vitest';
import { compile, edit, Graph, newDocument, type Document, type SourceInfo } from '@chromobench/contract';
import { set } from '@chromobench/values';
import { nodePacksData, RefEngine } from '../src/index.ts';

const W = 60, H = 40;

function source(kind: 'negative-scan' | 'digital-raw'): { info: SourceInfo; data: Float32Array } {
  const data = new Float32Array(W * H * 3);
  const base = kind === 'negative-scan' ? [0.75, 0.42, 0.2] : [0.3, 0.3, 0.3];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const m = 0.15 + 0.8 * (0.5 + 0.5 * Math.sin((6 * x) / W + (3 * y) / H) * Math.cos((5 * y) / H));
    for (let k = 0; k < 3; k++) data[(y * W + x) * 3 + k] = base[k]! * (kind === 'negative-scan' ? m : 1 - 0.9 * m);
  }
  const info: SourceInfo = {
    sha256: (kind === 'negative-scan' ? '1' : '2').repeat(64), format: 'tiff', width: W, height: H, channels: 3, bits: 16, sample: 'uint',
    encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0, 0, 0], white: [1, 1, 1], from: 'default' }, cfa: 'none', clippedFraction: 0, notes: [],
  };
  return { info, data };
}

function setup(kind: 'negative-scan' | 'digital-raw', o: Omit<ConstructorParameters<typeof RefEngine>[0], 'data'> = {}) {
  const { info, data } = source(kind);
  const g = new Graph();
  g.registerSource(info);
  const mk = (): RefEngine => {
    const e = new RefEngine({ data: nodePacksData(), ...o });
    e.openDecoded(info, data);
    return e;
  };
  const recipe: Document = newDocument(kind, { sha256: info.sha256, name: 's' }, kind === 'negative-scan' ? { umPerPx: 6 } : {});
  const node = (r: Document) => {
    // the display chain below output.frame (geometric: it runs at full resolution, so it is left out here)
    const top = g.get(compile(r, g).display.inputs[0]!)!;
    return { id: top.id, info: top.info, defs: g.closure(top.id) };
  };
  return { mk, recipe, node, g };
}

const mainTime = (r: Document): number => (r.stages.darkroom.stack.items['main'] as unknown as { params: { time_s: number } }).params.time_s;
const withTime = (r: Document, t: number): Document => edit(r, [set('main.params.time_s', t)]).doc;

describe('RefEngine sampled previews (CHB-027)', () => {
  for (const kind of ['negative-scan', 'digital-raw'] as const) {
    it(`${kind}: a sampled preview equals the full-resolution path bit for bit, and computes fewer pixels`, async () => {
      const { mk, recipe, node } = setup(kind);
      const plain = mk();
      const fast = (() => {
        const s = setup(kind, { sampled: true });
        return s.mk();
      })();
      const n = node(recipe);
      plain.adopt(n.defs);
      fast.adopt(n.defs);
      for (const t of [
        { scale: 0.37, precision: 'preview' as const },
        { scale: 0.5, precision: 'preview' as const, region: { x: 7, y: 3, w: 31, h: 22 } },
        { scale: 1, precision: 'preview' as const, region: { x: 10, y: 10, w: 9, h: 13 } },
      ]) {
        const [a, b] = [await plain.evaluate(n, t), await fast.evaluate(n, t)];
        expect([b.width, b.height]).toEqual([a.width, a.height]);
        expect(Array.from(await b.read())).toEqual(Array.from(await a.read()));
      }
      expect(fast.computed.pixels).toBeLessThan(plain.computed.pixels);
    });
  }

  it('a print-only change recomputes the print stages only, on the sample grid', async () => {
    const { mk, recipe, node, g } = setup('negative-scan', { sampled: true, cacheLimit: 48 });
    const e = mk();
    const t = { scale: 0.5, precision: 'preview' as const };
    const n1 = node(recipe);
    e.adopt(n1.defs);
    await e.evaluate(n1, t);
    const before = { ...e.computed };
    const n2 = node(withTime(recipe, mainTime(recipe) * 1.12));
    e.adopt(n2.defs);
    await e.evaluate(n2, t);
    const after = e.computed;
    // invert.dyes and everything upstream are cached: only the nodes the change made new run, print.expose
    // onwards, at the grid's 30×20 pixels
    const ids = (defs: typeof n1.defs): Set<string> => new Set(g.adopt(defs).map((m) => m.id));
    const old = ids(n1.defs);
    const fresh = g.adopt(n2.defs).filter((m) => !old.has(m.id)).map((m) => m.op);
    expect(fresh[0]).toBe('print.expose');
    expect(fresh).not.toContain('invert.dyes');
    expect(after.full).toBe(before.full);
    expect(after.sampled - before.sampled).toBe(fresh.length);
    expect(after.pixels - before.pixels).toBe(fresh.length * 30 * 20);
  });

  it('a cancel between stages rejects with E_CANCELLED; the next evaluation completes from the cached stages', async () => {
    let stages = 0;
    const ctl = new AbortController();
    const { mk, recipe, node } = setup('negative-scan', {
      sampled: true,
      yield: async () => {
        if (++stages === 3) ctl.abort();
      },
    });
    const e = mk();
    const n = node(recipe);
    e.adopt(n.defs);
    await expect(e.evaluate(n, { scale: 0.5, precision: 'preview', signal: ctl.signal })).rejects.toMatchObject({ code: 'E_CANCELLED' });
    const done = e.computed.full + e.computed.sampled;
    expect(done).toBeGreaterThanOrEqual(3);
    expect(done).toBeLessThan(n.defs.length);
    const r = await e.evaluate(n, { scale: 0.5, precision: 'preview' });
    expect(r.width).toBe(30);
    const plain = setup('negative-scan').mk();
    plain.adopt(n.defs);
    expect(Array.from(await r.read())).toEqual(Array.from(await (await plain.evaluate(n, { scale: 0.5, precision: 'preview' })).read()));
  });

  it('previews on many grids never push the full-resolution stages out of the cache', async () => {
    const { mk, recipe, node } = setup('negative-scan', { sampled: true, cacheLimit: 8 });
    const e = mk();
    const n = node(recipe);
    e.adopt(n.defs);
    await e.evaluate(n, { scale: 0.5, precision: 'preview' });
    const full = e.computed.full;
    for (const scale of [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.55, 0.6, 0.65, 0.7]) {
      const m = node(withTime(recipe, 10 + scale));
      e.adopt(m.defs);
      await e.evaluate(m, { scale, precision: 'preview' });
    }
    expect(e.computed.full).toBe(full);
  });

  it('cacheBytes bounds the caches; evicted stages are recomputed to the same pixels', async () => {
    const { mk, recipe, node } = setup('negative-scan', { cacheBytes: 3 * W * H * 4 * 8 });
    const e = mk();
    const n = node(recipe);
    e.adopt(n.defs);
    const a = Array.from(await (await e.evaluate(n, { scale: 'full', precision: 'preview' })).read());
    const n2 = node(withTime(recipe, 20));
    e.adopt(n2.defs);
    await e.evaluate(n2, { scale: 'full', precision: 'preview' });
    const full0 = e.computed.full;
    const b = Array.from(await (await e.evaluate(n, { scale: 'full', precision: 'export' })).read());
    expect(e.computed.full).toBeGreaterThan(full0); // evicted, recomputed
    expect(b).toEqual(a);
  });
});
