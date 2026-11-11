// The rebate (guide §2.3, §5.8): the unexposed processed film edge sets the zero of scanner density.
// The picked box is Chromogen's (05-inline.js 2630–2637). The automatic estimate is a region search
// with a confidence (DR-11); Chromogen's bright percentile is only the fallback, with W_REBATE_PERCENTILE.
import type { Box, Diagnostic, ScannerForward, Vec3 } from '@chromobench/contract';
import type { CameraLinear } from '../decode/linear.ts';
import { region, type RegionOptions } from './resample.ts';

export interface RebateEstimate {
  /** Mean linear transmittance of the rebate (after flat, open gate, flare as given). */
  T: Vec3;
  /** Sensor coordinates. */
  box: Box | null;
  from: 'box' | 'auto-region' | 'auto-percentile';
  confidence: number;
  notes: Diagnostic[];
}

/** Mean of the box resampled to at most 64×64 (Chromogen's picked-box rebate). */
export function rebateFromBox(src: CameraLinear, box: Box, cond: RegionOptions = {}): RebateEstimate {
  const bw = Math.max(1, Math.min(64, Math.round(box.w)));
  const bh = Math.max(1, Math.min(64, Math.round(box.h)));
  const v = region(src, box, bw, bh, { ...cond, channels: 3 });
  const T = [0, 1, 2].map((k) => {
    let t = 0;
    for (let i = k; i < v.length; i += 3) t += v[i]!;
    return t / (bw * bh);
  }) as Vec3;
  return { T, box, from: 'box', confidence: 1, notes: [] };
}

/** Chromogen's automatic rebate: 99.7th percentile × 1.02 of the crop resampled to 256 px wide. */
export function rebatePercentile(src: CameraLinear, crop: Box | null, cond: RegionOptions = {}): RebateEstimate {
  const c = crop ?? { x: 0, y: 0, w: src.width, h: src.height };
  const tw = 256;
  const th = Math.max(1, Math.round((256 * c.h) / c.w));
  const sm = region(src, c, tw, th, { ...cond, channels: 3 });
  const T = [0, 1, 2].map((k) => {
    const a = new Float64Array(tw * th);
    for (let i = 0; i < tw * th; i++) a[i] = sm[3 * i + k]!;
    a.sort();
    return a[Math.floor(a.length * 0.997)]! * 1.02;
  }) as Vec3;
  return {
    T, box: null, from: 'auto-percentile', confidence: 0,
    notes: [{ code: 'W_REBATE_PERCENTILE', message: 'The rebate was estimated from a bright percentile of the frame, not from film edge: densities read too high, blank film is under-counted and below-base pixels vanish.', hint: 'Pick a rebate box (scan.rebate) on the unexposed film edge.' }],
  };
}

/** Largest axis-aligned rectangle of 1s in a w×h mask (histogram method). */
export function largestRectangle(mask: Uint8Array, w: number, h: number): Box | null {
  const hist = new Int32Array(w);
  let best: Box | null = null;
  let bestA = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) hist[x] = mask[y * w + x] ? hist[x]! + 1 : 0;
    const stack: number[] = [];
    for (let x = 0; x <= w; x++) {
      const cur = x < w ? hist[x]! : 0;
      while (stack.length && hist[stack[stack.length - 1]!]! >= cur) {
        const top = stack.pop()!;
        const hh = hist[top]!;
        const left = stack.length ? stack[stack.length - 1]! + 1 : 0;
        const a = hh * (x - left);
        if (a > bestA) {
          bestA = a;
          best = { x: left, y: y - hh + 1, w: x - left, h: hh };
        }
      }
      stack.push(x);
    }
  }
  return best;
}

export interface AutoRebateOptions extends RegionOptions {
  /** Open gate in linear units, to exclude open-gate pixels. */
  openGateT?: Vec3 | null;
  /** Long side of the working image (default 1024). */
  long?: number;
}

/**
 * Region search (guide §5.8): pixels outside the crop (grown by 0.5 %) and within a ring of 12 % of the
 * long side around it, not open gate, low local texture, clustered by channel ratios; the largest
 * cluster brighter than the frame's median wins, its largest rectangle is the box. Falls back to the
 * percentile when there is no crop or the confidence is below 0.5.
 */
export function rebateAuto(src: CameraLinear, crop: Box | null, o: AutoRebateOptions = {}): RebateEstimate {
  if (!crop) return rebatePercentile(src, crop, o);
  const long = o.long ?? 1024;
  const sc = Math.min(1, long / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * sc));
  const h = Math.max(1, Math.round(src.height * sc));
  const img = region(src, { x: 0, y: 0, w: src.width, h: src.height }, w, h, { ...o, channels: 3 });
  const L = Math.max(w, h);
  const grow = Math.max(1, Math.round(0.005 * L));
  const ring = Math.round(0.12 * L);
  const cx0 = crop.x * sc - grow;
  const cy0 = crop.y * sc - grow;
  const cx1 = (crop.x + crop.w) * sc + grow;
  const cy1 = (crop.y + crop.h) * sc + grow;
  const N = w * h;
  const Dsum = new Float64Array(N);
  const cand = new Uint8Array(N);
  const frameG: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const T = [img[3 * i]!, img[3 * i + 1]!, img[3 * i + 2]!];
    Dsum[i] = T.reduce((s, t) => s - Math.log10(Math.max(t, 1e-6)), 0);
    const inside = x + 0.5 >= cx0 && x + 0.5 < cx1 && y + 0.5 >= cy0 && y + 0.5 < cy1;
    const inRing = x + 0.5 >= cx0 - ring && x + 0.5 < cx1 + ring && y + 0.5 >= cy0 - ring && y + 0.5 < cy1 + ring;
    if (inside) {
      frameG.push(T[1]!);
      continue;
    }
    if (!inRing) continue;
    const g = o.openGateT;
    if (g && T.every((t, k) => Math.abs(Math.log10(Math.max(t, 1e-6) / g[k]!)) < 0.05)) continue;
    cand[i] = 1;
  }
  if (!frameG.length) return rebatePercentile(src, crop, o);
  // Texture: 5×5 spread of summed density.
  const spread = new Float64Array(N);
  const spreads: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!cand[i]) continue;
    let s = 0, s2 = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const v = Dsum[yy * w + xx]!;
      s += v; s2 += v * v; n++;
    }
    spread[i] = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
    spreads.push(spread[i]!);
  }
  if (spreads.length < 16) return rebatePercentile(src, crop, o);
  const medSpread = Float64Array.from(spreads).sort()[spreads.length >> 1]!;
  const medFrameG = Float64Array.from(frameG).sort()[frameG.length >> 1]!;
  // Cluster by channel ratios (0.03 D bins of D_R − D_G and D_B − D_G).
  const bins = new Map<string, number[]>();
  for (let i = 0; i < N; i++) {
    if (!cand[i] || spread[i]! > 2 * medSpread + 1e-9) continue;
    if (img[3 * i + 1]! <= medFrameG) continue;
    const d = [0, 1, 2].map((k) => -Math.log10(Math.max(img[3 * i + k]!, 1e-6)));
    const key = `${Math.round((d[0]! - d[1]!) / 0.03)},${Math.round((d[2]! - d[1]!) / 0.03)}`;
    (bins.get(key) ?? bins.set(key, []).get(key)!).push(i);
  }
  // Merge each bin with its 8 neighbours, take the best-populated.
  let bestKey = '';
  let bestN = 0;
  for (const key of bins.keys()) {
    const [a, b] = key.split(',').map(Number) as [number, number];
    let n = 0;
    for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) n += bins.get(`${a + da},${b + db}`)?.length ?? 0;
    if (n > bestN) { bestN = n; bestKey = key; }
  }
  if (!bestN) return rebatePercentile(src, crop, o);
  const mask = new Uint8Array(N);
  const [ba, bb] = bestKey.split(',').map(Number) as [number, number];
  for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (const i of bins.get(`${ba + da},${bb + db}`) ?? []) mask[i] = 1;
  const r = largestRectangle(mask, w, h);
  if (!r || r.w * r.h < 8) return rebatePercentile(src, crop, o);
  // Shrink by one working pixel on each side where possible (edges are blurred), map to sensor pixels.
  const s = { x: r.w > 2 ? r.x + 1 : r.x, y: r.h > 2 ? r.y + 1 : r.y, w: r.w > 2 ? r.w - 2 : r.w, h: r.h > 2 ? r.h - 2 : r.h };
  const box: Box = { x: Math.round(s.x / sc), y: Math.round(s.y / sc), w: Math.max(1, Math.round(s.w / sc)), h: Math.max(1, Math.round(s.h / sc)) };
  const est = rebateFromBox(src, box, o);
  // Confidence: area (≥ 200 working px is full credit) times uniformity (spread inside vs. outside).
  let ins = 0, n = 0;
  for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) { ins += spread[y * w + x]!; n++; }
  const uniform = Math.min(1, (2 * medSpread + 1e-6) / (ins / n + 1e-6) / 2);
  const area = Math.min(1, (s.w * s.h) / 200);
  const confidence = Math.max(0, Math.min(1, 0.5 * area + 0.5 * uniform));
  if (confidence < 0.5) {
    const p = rebatePercentile(src, crop, o);
    p.notes.push({ code: 'W_REBATE_PERCENTILE', message: `Automatic rebate search found only a weak candidate (confidence ${confidence.toFixed(2)}).` });
    return p;
  }
  return { ...est, from: 'auto-region', confidence, notes: [] }; // the caller proposes the box as a pending mutation
}

export interface BaseCheck { measuredD: Vec3; modelD: Vec3; maxDiffD: number; warn: boolean; notes: Diagnostic[] }

/** Absolute rebate density against the stock's modelled base (warn above 0.02 D, program.js). */
export function baseCheck(rebateT: Vec3, openGate: Vec3 | null, stock: string, fwd: ScannerForward, tol = 0.02): BaseCheck | null {
  if (!openGate) return null;
  const measuredD = [0, 1, 2].map((k) => -Math.log10(rebateT[k]! / openGate[k]!)) as Vec3;
  const modelD = fwd.readBase(stock);
  const maxDiffD = Math.max(...measuredD.map((d, k) => Math.abs(d - modelD[k]!)));
  const warn = maxDiffD > tol;
  return {
    measuredD, modelD, maxDiffD, warn,
    notes: warn ? [{ code: 'W_BASE_MISMATCH', message: `The rebate reads (${measuredD.map((d) => d.toFixed(3)).join(', ')}) D; ${stock}'s base through ${fwd.scanner} reads (${modelD.map((d) => d.toFixed(3)).join(', ')}): ${maxDiffD.toFixed(3)} D apart. The stock or the flat field is wrong.` }] : [],
  };
}
