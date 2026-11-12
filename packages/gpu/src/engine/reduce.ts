// measure() reductions on the GPU (split from engine-gpu.ts, CHB-032): stats, histogram, patches and the
// densitometer over an uploaded receiver texture; densities of a mean pixel come from core (passed in).
import { DOMAINS, fail, type Box, type ImageInfo } from '@chromobench/contract';
import type { densitiesOf } from '@chromobench/core';
import { histPercentile, type Reducer } from '../measure.ts';

export async function reduceMeasure(reducer: Reducer, op: string, a: Record<string, unknown>, tex: GPUTexture, w: number, h: number, info: ImageInfo, densities: (mean: number[]) => ReturnType<typeof densitiesOf>): Promise<Record<string, unknown>> {
  const full: Box = { x: 0, y: 0, w, h };
  const nc = Math.min(3, info.channels);
  const [dlo, dhi] = DOMAINS[info.domain].range;
  switch (op) {
    case 'measure.stats': {
      // TODO: the optional mask argument is not applied yet
      const box = (a['box'] as Box | undefined) ?? full;
      const m = await reducer.moments(tex, box);
      const p01: number[] = [];
      const p99: number[] = [];
      let low = 0, high = 0;
      for (let k = 0; k < info.channels; k++) {
        const lo = m.min[k]!;
        const hi = m.max[k]! > lo ? m.max[k]! : lo + 1e-6;
        const bins = await reducer.histogram(tex, box, k, lo, hi * (1 + 1e-7) + 1e-12, 4096);
        p01.push(histPercentile(bins, lo, hi, 0.01));
        p99.push(histPercentile(bins, lo, hi, 0.99));
        if (k < nc) {
          const lb = await reducer.histogram(tex, box, k, dlo, dhi, 4096);
          low += lb[0]!;
          high += lb[4095]!;
        }
      }
      const N = m.count * nc;
      return { mean: m.mean.slice(0, info.channels), p01, p99, clipLow: N ? low / N : 0, clipHigh: N ? high / N : 0 };
    }
    case 'measure.histogram': {
      const bins = a['bins'] as number;
      const chName = a['channel'] as string;
      const ch = chName === 'L' ? (info.channels >= 3 ? 3 : 0) : Math.min('rgb'.indexOf(chName), info.channels - 1);
      const counts = await reducer.histogram(tex, full, ch, dlo, dhi, bins);
      return { edges: Array.from({ length: bins + 1 }, (_, i) => dlo + ((dhi - dlo) * i) / bins), counts: Array.from(counts) };
    }
    case 'measure.patches': {
      const b = (a['box'] as Box | undefined) ?? full;
      const cols = a['cols'] as number, rows = a['rows'] as number;
      const cells = [];
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const cb = { x: b.x + Math.floor((i * b.w) / cols), y: b.y + Math.floor((j * b.h) / rows), w: Math.max(1, Math.floor(b.w / cols)), h: Math.max(1, Math.floor(b.h / rows)) };
        const m = await reducer.moments(tex, cb);
        const d = densities([0, 1, 2].map((k) => m.mean[Math.min(k, info.channels - 1)]!));
        cells.push({ cell: j * cols + i, D: d.D, visual: d.visual ?? (d.D[0] + d.D[1] + d.D[2]) / 3 });
      }
      return { cells };
    }
    case 'measure.densitometer': {
      const at = a['at'] as { x: number; y: number };
      const r = (a['aperture_px'] as number) / 2;
      const x0 = Math.max(0, Math.floor(at.x - r)), y0 = Math.max(0, Math.floor(at.y - r));
      const x1 = Math.min(w - 1, Math.ceil(at.x + r)), y1 = Math.min(h - 1, Math.ceil(at.y + r));
      if (x1 < x0 || y1 < y0) fail('E_ARG_RANGE', 'densitometer aperture lies outside the image');
      const m = await reducer.moments(tex, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, { cx: at.x, cy: at.y, r });
      if (!m.count) fail('E_ARG_RANGE', 'densitometer aperture lies outside the image');
      const d = densities([0, 1, 2].map((k) => m.mean[Math.min(k, info.channels - 1)]!));
      return d.visual === undefined ? { D: d.D } : { D: d.D, visual: d.visual };
    }
    default:
      return fail('E_NOT_IMPLEMENTED', `${op} has no GPU reduction`);
  }
}
