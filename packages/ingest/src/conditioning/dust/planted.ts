// A synthetic negative with planted dust (guide §8.3), until CHB-004's synthetic frames exist:
// smooth, differently structured density per layer, independent per-channel grain, and opaque specks
// that multiply T by (1 − a(x)) in every channel — or, as decoys, single-channel blobs.
import type { Vec3 } from '@chromobench/contract';

export interface PlantedSpeck { cx: number; cy: number; r: number; a: number; channel?: number }
export interface PlantedFrame { w: number; h: number; truth: Float32Array[]; D: Float32Array[]; specks: PlantedSpeck[]; decoys: PlantedSpeck[]; sigma: Vec3 }

export function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Coverage of a disc of radius r centred at (cx, cy) over pixel (x, y), by 4×4 supersampling. */
function coverage(x: number, y: number, cx: number, cy: number, r: number): number {
  let n = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if ((x + (i + 0.5) / 4 - cx) ** 2 + (y + (j + 0.5) / 4 - cy) ** 2 <= r * r) n++;
  return n / 16;
}

export function plantedFrame(o: { w?: number; h?: number; seed?: number; n?: number; decoys?: number; sigma?: Vec3; minSnr?: number } = {}): PlantedFrame {
  const w = o.w ?? 256, h = o.h ?? 256;
  const rnd = mulberry(o.seed ?? 1);
  const g = (): number => Math.sqrt(-2 * Math.log(rnd() + 1e-300)) * Math.cos(2 * Math.PI * rnd());
  const sigma = o.sigma ?? [0.01, 0.008, 0.012];
  const truth = [0, 1, 2].map((k) => {
    const p = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      p[y * w + x] = 0.3 + 0.4 * u * (k + 1) / 3 + 0.25 * Math.sin(6 * v + 2 * k) * Math.cos(4 * u - k) + 0.1 * (k === 1 ? Math.sin(8 * u) : k === 2 ? Math.cos(6 * v) : u * v);
    }
    return p;
  });
  // grain: independent per channel, lightly correlated (2×2 mean of a finer field, scaled back to σ)
  const D = truth.map((t, k) => {
    const raw = new Float32Array(w * h).map(() => g());
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x1 = Math.min(w - 1, x + 1), y1 = Math.min(h - 1, y + 1);
      out[y * w + x] = t[y * w + x]! + sigma[k]! * (raw[y * w + x]! + raw[y * w + x1]! + raw[y1 * w + x]! + raw[y1 * w + x1]!) / 2;
    }
    return out;
  });
  const truthNoisy = D.map((p) => p.slice());
  const specks: PlantedSpeck[] = [];
  const decoys: PlantedSpeck[] = [];
  const nS = o.n ?? 30, nD = o.decoys ?? 10;
  const sN = 1 / Math.sqrt(sigma.reduce((s, v) => s + 1 / (v * v), 0)); // neutral-plane noise
  const minSnr = o.minSnr ?? 5;
  const free = (cx: number, cy: number, r: number): boolean => [...specks, ...decoys].every((s) => Math.hypot(s.cx - cx, s.cy - cy) > s.r + r + 12);
  let guard = 0;
  while ((specks.length < nS || decoys.length < nD) && guard++ < 10000) {
    const r = 1.2 + 3 * rnd();
    const cx = 12 + rnd() * (w - 24), cy = 12 + rnd() * (h - 24);
    if (!free(cx, cy, r)) continue;
    const delta = (minSnr + 15 * rnd()) * sN * 2; // the residual noise after background removal is about 2× the neutral-plane σ
    const a = 1 - 10 ** -delta;
    if (specks.length < nS) specks.push({ cx, cy, r, a });
    else decoys.push({ cx, cy, r, a, channel: decoys.length % 3 });
  }
  for (const s of [...specks, ...decoys]) {
    for (let y = Math.floor(s.cy - s.r - 1); y <= Math.ceil(s.cy + s.r + 1); y++) for (let x = Math.floor(s.cx - s.r - 1); x <= Math.ceil(s.cx + s.r + 1); x++) {
      const cov = coverage(x, y, s.cx, s.cy, s.r);
      if (!cov) continue;
      const dD = -Math.log10(1 - s.a * cov);
      // a decoy puts the whole neutral-plane contrast into one channel
      if (s.channel === undefined) for (let k = 0; k < 3; k++) D[k]![y * w + x]! += dD;
      else {
        const wk = 1 / sigma[s.channel]! ** 2;
        const tot = sigma.reduce((t, v) => t + 1 / (v * v), 0);
        D[s.channel]![y * w + x]! += (dD * tot) / wk;
      }
    }
  }
  return { w, h, truth: truthNoisy, D, specks, decoys, sigma };
}
