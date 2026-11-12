// Frames on a strip (CHB-027 WS-D, F16): a scan of several frames of film (a strip of three 645 frames, six 135
// frames) is cut into one box per frame, measured from the pixels alone. filmLayout finds one image area; this
// finds the inter-frame gaps along the strip.
//
// What a gap is: unexposed film between two frames, so it reads at base density (as the rebate does) right across
// the image band, and it is short along the strip (a few millimetres). The rebate runs along the strip's edges, so
// the search reads only the middle of the film across (inside the image band of any format), and the holder
// around the film is left out.
//
// The steps, on a working image of at most `long` pixels:
//   1. base: the layout's rebate (veil-corrected), else the thinnest 2 % of the film;
//   2. axis: along the long side; across, the film is the longest run of positions that are not holder;
//   3. per position along: the share of the band (the middle 60 % of the film across) within `nearD` of the
//      gaps' own level (rows near base: the thinnest 5 % of row medians, at most 0.12 D above the base);
//   4. separators: runs of positions where that share is ≥ 0.9; runs at the ends are leader;
//   5. segments between separators: a segment shorter than a frame (0.45 × the film's width) inside the strip
//      means a separator was a near-base band in a frame (a dark sky, unexposed shadows): it is merged with its
//      neighbour across the weaker separator; at the ends it is a partial frame or a sliver, and dropped;
//   6. each frame's box: its segment along, the exposed band across (shared by the strip's frames), input pixels.
import type { Box, Diagnostic, Vec3 } from '@chromobench/contract';
import { filmLayout, shrinkRGB, type FilmLayout } from './film-layout.ts';

export interface StripFramesOptions {
  /** Long side of the working image (default 512). */
  long?: number;
  /** Floats per pixel of `rgb` (default 3). */
  stride?: number;
  /** The scan's film layout (conditionScan's), for its base and veil; computed when absent. */
  layout?: FilmLayout | null;
  /** A pixel is at base within this density of the gaps' level, max over channels (default 0.06 D). */
  nearD?: number;
}

export interface StripFrame {
  /** Input pixels. */
  box: Box;
  /** 0…1: how clean its separators are and how well its length matches the strip's frames. */
  confidence: number;
}

export interface StripFrames {
  /** The strip's long axis: frames follow each other along it. */
  axis: 'x' | 'y';
  /** In order along the axis; empty when no frame was found, one entry for a single frame. */
  frames: StripFrame[];
  /** The lowest frame confidence (0 with no frame). */
  confidence: number;
  /** Several frames, found with confidence ≥ STRIP_MIN_CONFIDENCE: open the scan as one frame per box. */
  split: boolean;
  notes: Diagnostic[];
}

/** Below this a strip is not split (the scan opens as one frame). */
export const STRIP_MIN_CONFIDENCE = 0.5;

const LOW = 1e-6;
const lg = (v: number): number => Math.log10(Math.max(v, LOW));
const quantile = (vals: ArrayLike<number>, q: number): number => {
  if (!vals.length) return NaN;
  const s = Float64Array.from(vals).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]!;
};

interface Run { a0: number; a1: number; purity: number }

/** Runs of `ok`, bridging single misses. */
function runs(ok: boolean[], share: Float64Array): Run[] {
  const out: Run[] = [];
  let a0 = -1, last = -1;
  const close = (): void => {
    let s = 0;
    for (let a = a0; a <= last; a++) s += share[a]!;
    out.push({ a0, a1: last, purity: s / (last - a0 + 1) });
  };
  for (let a = 0; a < ok.length; a++) {
    if (!ok[a]) continue;
    if (a0 >= 0 && a - last > 2) close(), (a0 = -1);
    if (a0 < 0) a0 = a;
    last = a;
  }
  if (a0 >= 0) close();
  return out;
}

/** Finds the frames on a scan of a strip of film. */
export function stripFrames(rgb: ArrayLike<number>, width: number, height: number, o: StripFramesOptions = {}): StripFrames {
  const stride = o.stride ?? 3;
  const s = Math.min(1, (o.long ?? 512) / Math.max(width, height));
  const w = Math.max(1, Math.round(width * s));
  const h = Math.max(1, Math.round(height * s));
  const img = shrinkRGB(rgb, width, height, w, h, stride);
  const notes: Diagnostic[] = [];
  const axis: StripFrames['axis'] = w > h ? 'x' : 'y';
  const n = axis === 'x' ? w : h; // positions along
  const m = axis === 'x' ? h : w; // positions across
  const at = (a: number, c: number): number => 3 * (axis === 'x' ? c * w + a : a * w + c);
  const none = (why: Diagnostic): StripFrames => ({ axis, frames: [], confidence: 0, split: false, notes: [...notes, why] });

  // ── 1. base and veil ──
  const layout = o.layout === undefined ? filmLayout(rgb, width, height, { stride }) : o.layout;
  const veil: Vec3 = layout?.surround?.L ?? [0, 0, 0];
  let base: Vec3 | null = layout?.rebate?.T ?? null;
  if (!base) {
    const mean = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) mean[i] = (lg(img[3 * i]! - veil[0]) + lg(img[3 * i + 1]! - veil[1]) + lg(img[3 * i + 2]! - veil[2])) / 3;
    const top = quantile(mean, 0.98);
    const acc = [0, 0, 0];
    let k = 0;
    for (let i = 0; i < w * h; i++) if (mean[i]! >= top && img[3 * i]! < 0.98 && img[3 * i + 1]! < 0.98 && img[3 * i + 2]! < 0.98) {
      for (let c = 0; c < 3; c++) acc[c]! += img[3 * i + c]! - veil[c]!;
      k++;
    }
    if (!k) return none({ code: 'W_STRIP_NO_BASE', message: 'No thin film found: the frames on the scan cannot be told apart.' });
    base = acc.map((v) => Math.max(LOW, v / k)) as Vec3;
  }
  const lb = base.map(lg) as Vec3;
  /** density above base, max over channels (the densest layer decides whether the film was exposed) */
  const dmax = (i: number): number => Math.max(lb[0] - lg(img[i]! - veil[0]), lb[1] - lg(img[i + 1]! - veil[1]), lb[2] - lg(img[i + 2]! - veil[2]));
  /** density above base, min over channels (exposed when > 0.12 D in every channel, as filmLayout's crop) */
  const dmin = (i: number): number => Math.min(lb[0] - lg(img[i]! - veil[0]), lb[1] - lg(img[i + 1]! - veil[1]), lb[2] - lg(img[i + 2]! - veil[2]));

  // ── 2. the film across: positions that are not holder (≥ 1 D denser than base in every channel) ──
  const film: boolean[] = [];
  for (let c = 0; c < m; c++) {
    let dark = 0;
    for (let a = 0; a < n; a++) if (dmin(at(a, c)) > 1.0) dark++;
    film.push(dark < 0.5 * n);
  }
  let f0 = -1, f1 = -1;
  for (let c = 0, start = -1; c <= m; c++) {
    if (c < m && film[c]) { if (start < 0) start = c; continue; }
    if (start >= 0 && c - 1 - start > f1 - f0) { f0 = start; f1 = c - 1; }
    start = -1;
  }
  const F = f1 - f0 + 1;
  if (f0 < 0 || F < 8) return none({ code: 'W_STRIP_NO_FILM', message: 'No film across the scan: the frames cannot be told apart.' });
  const b0 = f0 + Math.round(0.2 * F), b1 = f1 - Math.round(0.2 * F);

  // ── 3. per position along: median density of the band, and its share near the gaps' level ──
  const med = new Float64Array(n);
  const row = new Float64Array(b1 - b0 + 1);
  for (let a = 0; a < n; a++) {
    for (let c = b0; c <= b1; c++) row[c - b0] = dmax(at(a, c));
    med[a] = quantile(row, 0.5);
  }
  const level = quantile(med, 0.05);
  if (!(level < 0.12)) return { axis, frames: [], confidence: 0, split: false, notes };
  const nearD = o.nearD ?? 0.06;
  const share = new Float64Array(n);
  for (let a = 0; a < n; a++) {
    let k = 0;
    for (let c = b0; c <= b1; c++) if (dmax(at(a, c)) < level + nearD) k++;
    share[a] = k / (b1 - b0 + 1);
  }

  // ── 4. separators ──
  const maxGap = 0.25 * F;
  const all = runs(Array.from(share, (v) => v >= 0.9), share);
  const lead0 = all.find((r) => r.a0 <= 1);
  const lead1 = all.find((r) => r.a1 >= n - 2 && r !== lead0);
  // interior runs: a long one is a blank frame or leader in the middle, it separates too (it is no frame)
  const seps = all.filter((r) => r !== lead0 && r !== lead1);

  // ── 5. which separators are gaps: the choice whose segments make the most frames of one length ──
  //    Every segment inside the strip must be frame-long (a short one means a near-base band in a frame was taken
  //    for a gap); the end segments may be partial frames or slivers, which are dropped. Few candidates (≤ 14, the
  //    cleanest kept), so every subset is scored.
  const minLen = 0.45 * F;
  interface Seg { a0: number; a1: number; before: Run | null; after: Run | null }
  const start = lead0 ? lead0.a1 + 1 : 0, end = lead1 ? lead1.a0 - 1 : n - 1;
  if (end - start + 1 < minLen) return { axis, frames: [], confidence: 0, split: false, notes };
  const cand = [...seps].sort((p, q) => q.purity - p.purity).slice(0, 14).sort((p, q) => p.a0 - q.a0);
  const len = (g: Seg): number => g.a1 - g.a0 + 1;
  const isInner = (i: number, k: number): boolean => i > 0 && i < k - 1;
  const keepOf = (segs: Seg[], M: number): Seg[] => segs.filter((g, i) => len(g) >= minLen && (isInner(i, segs.length) || len(g) >= 0.75 * M));
  let chosen: { score: number; segs: Seg[]; M: number } | null = null;
  for (let mask = 0; mask < 1 << cand.length; mask++) {
    const cuts = cand.filter((_, i) => mask & (1 << i));
    const segs: Seg[] = [];
    let a = start;
    let before: Run | null = lead0 ?? null;
    for (const r of cuts) {
      segs.push({ a0: a, a1: r.a0 - 1, before, after: r });
      a = r.a1 + 1;
      before = r;
    }
    segs.push({ a0: a, a1: end, before, after: lead1 ?? null });
    if (segs.some((g, i) => isInner(i, segs.length) && len(g) < minLen)) continue;
    const inner = segs.slice(1, -1).map(len);
    const M = inner.length ? quantile(inner, 0.5) : Math.max(...segs.map(len));
    const keep = keepOf(segs, M);
    if (!keep.length) continue;
    // inner frames off the strip's frame length cost; end frames only when longer (a partial frame is shorter)
    let dev = 0;
    segs.forEach((g, i) => {
      const r = len(g) / M - 1;
      if (keep.includes(g)) dev += Math.max(0, (isInner(i, segs.length) ? Math.abs(r) : r) - 0.08);
    });
    const score = keep.length - 3 * dev + 0.01 * cuts.reduce((t, r) => t + r.purity, 0);
    if (!chosen || score > chosen.score) chosen = { score, segs, M };
  }
  if (!chosen) return { axis, frames: [], confidence: 0, split: false, notes };
  // a separator longer than a gap inside the strip: say so (a blank frame between frames)
  for (const g of chosen.segs) {
    const r = g.after;
    if (r && r !== lead1 && r.a1 - r.a0 + 1 > maxGap) notes.push({ code: 'W_STRIP_BLANK', message: `Blank film ${Math.round((r.a1 - r.a0 + 1) / s)} px long between frames (an unexposed frame?): it is not opened as a frame.` });
  }
  const segs = keepOf(chosen.segs, chosen.M);

  // ── 6. boxes: along, the segment; across, the band exposed in the frames (shared by all of them) ──
  const exposed: boolean[] = [];
  for (let c = 0; c < m; c++) {
    let e = 0, k = 0;
    for (const g of segs) for (let a = g.a0; a <= g.a1; a++, k++) { const i = at(a, c); if (dmax(i) >= level + nearD && dmin(i) <= 1.0) e++; }
    exposed.push(c >= f0 && c <= f1 && e >= 0.1 * k);
  }
  let c0 = -1, c1 = -1;
  for (let c = 0, st = -1, miss = 0; c <= m; c++) {
    if (c < m && exposed[c]) { if (st < 0) st = c; miss = 0; continue; }
    if (st >= 0 && c < m && ++miss <= Math.max(1, Math.round(0.02 * m))) continue;
    const e1 = c - 1 - (c < m ? miss - 1 : 0);
    if (st >= 0 && e1 - st > c1 - c0) { c0 = st; c1 = e1; }
    st = -1;
    miss = 0;
  }
  // a thin strip with little exposed film: the film's width
  if (c0 < 0 || c1 - c0 + 1 < 0.5 * F) { c0 = f0; c1 = f1; }
  const toInput = (a0: number, a1: number): Box => {
    // inwards: the box stays inside the working-image segment, less one working pixel and 1 % a side (the
    // blurred edge of the frame against the gap and the rebate; a negative carrier masks it too)
    const ia = 1 + 0.01 * (a1 - a0 + 1), ic = 1 + 0.01 * (c1 - c0 + 1);
    const p0 = Math.ceil((a0 + ia) / s), p1 = Math.min(axis === 'x' ? width : height, Math.floor((a1 + 1 - ia) / s));
    const q0 = Math.ceil((c0 + ic) / s), q1 = Math.min(axis === 'x' ? height : width, Math.floor((c1 + 1 - ic) / s));
    return axis === 'x' ? { x: p0, y: q0, w: Math.max(1, p1 - p0), h: Math.max(1, q1 - q0) } : { x: q0, y: p0, w: Math.max(1, q1 - q0), h: Math.max(1, p1 - p0) };
  };
  const M2 = quantile(segs.map(len), 0.5);
  const frames: StripFrame[] = segs.map((g) => {
    const sepConf = Math.min(...[g.before, g.after].map((r) => (r ? Math.min(1, Math.max(0, (r.purity - 0.9) / 0.08)) : 1)));
    const lenConf = segs.length > 1 ? Math.max(0, 1 - Math.max(0, Math.abs(len(g) / M2 - 1) - 0.1) / 0.3) : 1;
    return { box: toInput(g.a0, g.a1), confidence: Number(Math.min(sepConf, lenConf).toFixed(3)) };
  });
  const confidence = Math.min(...frames.map((f) => f.confidence));
  return { axis, frames, confidence, split: frames.length >= 2 && confidence >= STRIP_MIN_CONFIDENCE, notes };
}
