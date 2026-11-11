// Stage 5 (started): the neutral-wedge frames carry the textbook's numbers (§3.7) and stable ids.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSafetensors, sha256Hex } from '../src/index.ts';

const ROOT = new URL('../../../fixtures/synthetic/neutral-wedge/', import.meta.url);
const frame = (id: string) => ({
  truth: JSON.parse(readFileSync(new URL(`${id}/truth.json`, ROOT), 'utf8')),
  cam: parseSafetensors(new Uint8Array(readFileSync(new URL(`${id}/camera_linear.safetensors`, ROOT)))),
  tru: parseSafetensors(new Uint8Array(readFileSync(new URL(`${id}/truth.safetensors`, ROOT)))),
});
const TEXTBOOK_FLARE_005 = [0, 0.495, 0.981, 1.438, 1.826, 2.09, 2.224]; // textbook §3.7, tolerance 0.001 D

describe('synthetic neutral wedge', () => {
  it('with 0.5 % flare the steps read the textbook values (to 0.001 D), from the pixels and from truth.json', () => {
    const f = frame('flat-0-3D-flare005permille');
    const cam = f.cam.tensors.get('camera_linear')!;
    const [h, w] = cam.shape as [number, number, number];
    expect(cam.dtype).toBe('F32');
    f.truth.regions.forEach((r: any, i: number) => {
      const x = r.box.x + r.box.w / 2;
      const px = cam.data[((h / 2) * w + x) * 3]!;
      expect(Math.abs(-Math.log10(px) - TEXTBOOK_FLARE_005[i]!)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(r.read_D[0] - TEXTBOOK_FLARE_005[i]!)).toBeLessThanOrEqual(0.001);
      expect(r.true_D[0]).toBe(0.5 * i);
    });
  });

  it('without flare the reading is the density', () => {
    const f = frame('flat-0-3D-flare000permille');
    for (const r of f.truth.regions) expect(Math.abs(r.read_D[1] - r.true_D[1])).toBeLessThan(1e-12);
    const t = f.tru.tensors.get('scanner_density_true')!;
    expect(t.data[t.data.length - 1]).toBe(3);
  });

  it('ids and split buckets are stable (sha256(group) mod 100)', () => {
    for (const id of ['flat-0-3D-flare000permille', 'flat-0-3D-flare005permille']) {
      const t = frame(id).truth;
      expect(t.id).toBe(`neutral-wedge/${id}`);
      const h = BigInt(`0x${sha256Hex(new TextEncoder().encode(t.group))}`);
      expect(t.splitBucket).toBe(Number(h % 100n));
      expect(t.images.camera_linear.domain).toBe('camera-linear');
      expect(t.images.scanner_density_true.domain).toBe('scanner-density');
    }
  });
});
