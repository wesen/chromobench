// CHB-048 (LAY-1): the mock's source.xyz applies the contract's white balance (CAT16 from the light's white to D65)
// after its linear-sRGB camera, so the mock moves the same way as core: "None" leaves the camera's XYZ, a white
// balanced to the light makes a grey under that light D65-neutral.
import { describe, expect, it } from 'vitest';
import { D65_XYZ, Graph, NO_CORRECTION, sceneMatrix, sha256Hex, xyOf } from '@chromobench/contract';
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';

describe('mock source.xyz: the contract\'s white balance', () => {
  it('equals the contract\'s scene matrix (a camera of linear sRGB) for None and for a tungsten white', async () => {
    const e = new MockEngine();
    const g = new Graph();
    const bytes = makeM1Tiff();
    const info = await e.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
    g.registerSource(info);
    const src = g.intern('source.open', [], { source: info.sha256, encoding: 'linear', umPerPx: 6 }).node;
    e.adopt(g.closure(src.id));
    const rgb = Array.from(await (await e.evaluate(src, { scale: 'full', precision: 'preview' })).read());
    for (const wb of [NO_CORRECTION, { temperature_K: 3200, tint: 12 }]) {
      const n = g.intern('source.xyz', [src.id], { ...wb }).node;
      e.adopt(g.closure(n.id));
      const xyz = Array.from(await (await e.evaluate(n, { scale: 'full', precision: 'preview' })).read());
      const M = sceneMatrix(undefined, wb);
      for (const i of [0, 777, 3000]) {
        const p = rgb.slice(i * 3, i * 3 + 3);
        for (let k = 0; k < 3; k++) expect(Math.abs(xyz[i * 3 + k]! - (M[k]![0]! * p[0]! + M[k]![1]! * p[1]! + M[k]![2]! * p[2]!))).toBeLessThan(1e-12);
      }
    }
    // D65 stays D65 under None (the camera's own XYZ)
    const [x, y] = xyOf(sceneMatrix(undefined, NO_CORRECTION).map((r) => r[0]! + r[1]! + r[2]!)), [x0, y0] = xyOf(D65_XYZ);
    expect(Math.abs(x - x0) + Math.abs(y - y0)).toBeLessThan(1e-6);
  });
});
