// Film layout of a scan (CHB-020, roll setup): where the opaque holder, the open gate (sprocket holes, a
// gap at the film edge), the image frame and the unexposed rebate are, measured from the pixels alone.
//
// Why: the brightest-columns rule (scan.density with no box) picks sprocket holes or a holder gap when the
// scan shows them, so the "base" is the light itself; and nothing measured the scanner's veiling flare.
// The opaque holder around the film reads the veil directly (flare plus any black-level residue): every
// pixel of the scan carries the same additive veil, so subtracting it is the flare correction of the
// textbook's §3.1 (T = T_measured − f·T_open), with f·T_open read in linear units. With an open gate in
// view, f itself follows (veil / open gate).
//
// The steps, on a working image of at most `long` pixels:
//   1. open gate: a population of pixels brighter than all the film by ≥ 0.2 D (a gap in the histogram of
//      mean log T) that lacks the orange mask (gains ≥ 0.25 D more in blue or green than in red), or clipped;
//      checked against the light's colour when it is known. Colour negatives only;
//   2. surround: dark pixels connected to the border (the holder), grown over its spill-lit edge;
//      the veil is the per-channel median of the holder 1.5–6 % of the long side away from the film;
//   3. base, first pass: the thinnest low-texture film, clustered by channel ratios;
//   4. crop: the longest run of columns and rows where ≥ 15 % of the film is exposed (> 0.12 D);
//   5. rebate: low-texture thin film outside the crop, the best-populated ratio cluster, its largest
//      rectangle; else blank film inside the frame (W_REBATE_BLANK, low confidence).
import type { Box, Diagnostic, Vec3 } from '@chromobench/contract';
import { largestRectangle } from './rebate.ts';

export interface FilmLayoutOptions {
  /** Long side of the working image (default 512). */
  long?: number;
  /** Floats per pixel of `rgb` (default 3; the first three are R, G, B). */
  stride?: number;
  /** The light's colour (open-gate channel values, any scale), to recognise the open gate by. */
  lightRatio?: Vec3 | null;
  /** Below this the rebate is reported as blank film (default 0.5). */
  minConfidence?: number;
  /** Look for the opaque holder (default true). */
  surround?: boolean;
}

export interface OpenGateRegion {
  /** Mean linear value of the open gate (not veil-corrected: the light plus the veil). */
  T: Vec3;
  /** Bounding box, input pixels. */
  box: Box;
  /** Share of the working image. */
  fraction: number;
}

export interface VeilEstimate {
  /** Per-channel veil in linear units (flare + black-level residue), read on the opaque holder. */
  L: Vec3;
  /** Bounding box of the holder pixels it was read on, input pixels. */
  box: Box;
  /** Share of the working image that is holder. */
  fraction: number;
  pixels: number;
}

export interface RebateFound {
  /** Veil-corrected mean linear value of the rebate: the zero of scanner density. */
  T: Vec3;
  /** The same before veil correction. */
  Traw: Vec3;
  /** Input pixels. */
  box: Box;
  /** 'edge': film outside the image frame; 'blank': unexposed film inside the frame (a fallback). */
  from: 'edge' | 'blank';
  confidence: number;
  /** Density difference between the box's two halves along its long side (non-uniformity), max over channels. */
  spreadD: number;
}

export interface FilmLayout {
  /** Input size. */
  width: number;
  height: number;
  /** Working pixels per input pixel. */
  scale: number;
  surround: VeilEstimate | null;
  openGate: OpenGateRegion | null;
  /** The exposed image area (≈ the frame; blank film at its edge may fall outside), input pixels. */
  crop: Box | null;
  rebate: RebateFound | null;
  /** Flare as a fraction of the open-gate signal, L / (T_open − L), per channel (needs both). */
  flare: Vec3 | null;
  /** The veil as a fraction of the rebate signal, L / T_reb (what it does to densities near base). */
  veilOfBase: Vec3 | null;
  notes: Diagnostic[];
}

const LOW = 1e-6;
const lg = (v: number): number => Math.log10(Math.max(v, LOW));

/** Area mean of interleaved `stride`-float pixels down to tw×th (three channels out). */
export function shrinkRGB(rgb: ArrayLike<number>, w: number, h: number, tw: number, th: number, stride = 3): Float32Array {
  const out = new Float32Array(tw * th * 3);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * h) / th), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * w) / tw), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / tw));
      let a = 0, b = 0, c = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * stride;
        a += rgb[i]!; b += rgb[i + 1]!; c += rgb[i + 2]!; n++;
      }
      const o = (ty * tw + tx) * 3;
      out[o] = a / n; out[o + 1] = b / n; out[o + 2] = c / n;
    }
  }
  return out;
}

const quantile = (vals: number[] | Float64Array, q: number): number => {
  if (!vals.length) return NaN;
  const s = Float64Array.from(vals).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]!;
};

/** Mean of the input pixels inside a box (input coordinates), three channels. */
function boxMeanInput(rgb: ArrayLike<number>, w: number, b: Box, stride: number): Vec3 {
  const acc = [0, 0, 0];
  let n = 0;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = (y * w + x) * stride;
    acc[0]! += rgb[i]!; acc[1]! += rgb[i + 1]!; acc[2]! += rgb[i + 2]!; n++;
  }
  return acc.map((v) => v / Math.max(n, 1)) as Vec3;
}

/** Largest run of true in `ok`, bridging gaps of at most `gap`. */
function longestRun(ok: boolean[], gap: number): [number, number] | null {
  let best: [number, number] | null = null;
  let start = -1, last = -1;
  for (let i = 0; i <= ok.length; i++) {
    if (i < ok.length && ok[i]) {
      if (start < 0 || i - last - 1 > gap) {
        if (start >= 0 && (!best || last - start > best[1] - best[0])) best = [start, last];
        start = i;
      }
      last = i;
    }
  }
  if (start >= 0 && (!best || last - start > best[1] - best[0])) best = [start, last];
  return best;
}

/** Best-populated cluster of pixels `idx` by (D_R − D_G, D_B − D_G) in 0.03 D bins, merged with the 8 neighbours. */
function ratioCluster(idx: number[], logT: Float64Array, bin = 0.03): number[] {
  const bins = new Map<string, number[]>();
  for (const i of idx) {
    const a = Math.round((logT[3 * i + 1]! - logT[3 * i]!) / bin);
    const b = Math.round((logT[3 * i + 1]! - logT[3 * i + 2]!) / bin);
    const key = `${a},${b}`;
    (bins.get(key) ?? bins.set(key, []).get(key)!).push(i);
  }
  let bestKey = '';
  let bestN = 0;
  for (const key of bins.keys()) {
    const [a, b] = key.split(',').map(Number) as [number, number];
    let n = 0;
    for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) n += bins.get(`${a + da},${b + db}`)?.length ?? 0;
    if (n > bestN || (n === bestN && key < bestKey)) { bestN = n; bestKey = key; }
  }
  if (!bestN) return [];
  const [a, b] = bestKey.split(',').map(Number) as [number, number];
  const out: number[] = [];
  for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) out.push(...(bins.get(`${a + da},${b + db}`) ?? []));
  return out;
}

export function filmLayout(rgb: ArrayLike<number>, width: number, height: number, o: FilmLayoutOptions = {}): FilmLayout {
  const stride = o.stride ?? 3;
  const long = o.long ?? 512;
  const s = Math.min(1, long / Math.max(width, height));
  const w = Math.max(1, Math.round(width * s));
  const h = Math.max(1, Math.round(height * s));
  const img = s < 1 ? shrinkRGB(rgb, width, height, w, h, stride) : shrinkRGB(rgb, width, height, width, height, stride);
  const N = w * h;
  const L = Math.max(w, h);
  const notes: Diagnostic[] = [];
  const toInput = (b: Box): Box => {
    const x0 = Math.max(0, Math.floor(b.x / s)), y0 = Math.max(0, Math.floor(b.y / s));
    const x1 = Math.min(width, Math.ceil((b.x + b.w) / s)), y1 = Math.min(height, Math.ceil((b.y + b.h) / s));
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  };
  const bbox = (idx: number[]): Box => {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (const i of idx) {
      const x = i % w, y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  const meanOf = (idx: number[], src: Float32Array | Float64Array = img): Vec3 => {
    const a = [0, 0, 0];
    for (const i of idx) for (let k = 0; k < 3; k++) a[k]! += src[3 * i + k]!;
    return a.map((v) => v / Math.max(1, idx.length)) as Vec3;
  };
  const medianOf = (idx: number[], src: Float32Array | Float64Array = img): Vec3 =>
    [0, 1, 2].map((k) => quantile(idx.map((i) => src[3 * i + k]!), 0.5)) as Vec3;

  // ── per pixel: mean log T (m), clipping ──
  const m = new Float64Array(N);
  const cls = new Uint8Array(N); // 0 film, 1 open gate, 2 surround
  for (let i = 0; i < N; i++) {
    m[i] = (lg(img[3 * i]!) + lg(img[3 * i + 1]!) + lg(img[3 * i + 2]!)) / 3;
    if (img[3 * i]! >= 0.98 || img[3 * i + 1]! >= 0.98 || img[3 * i + 2]! >= 0.98) cls[i] = 1;
  }

  // ── 1. open gate: a bright population above a gap of ≥ 0.2 D ──
  {
    const idx: number[] = [];
    for (let i = 0; i < N; i++) if (!cls[i]) idx.push(i);
    if (idx.length) {
      const B = 0.025;
      let lo = Infinity, hi = -Infinity;
      for (const i of idx) { lo = Math.min(lo, m[i]!); hi = Math.max(hi, m[i]!); }
      const nb = Math.max(1, Math.ceil((hi - lo) / B) + 1);
      const hist = new Int32Array(nb);
      for (const i of idx) hist[Math.min(nb - 1, Math.floor((m[i]! - lo) / B))]!++;
      // From the top: once enough pixels are above, 8 bins (0.2 D) in a row each below 15 % of the peak
      // above them are the gap. A film histogram rises steadily from its thin end, so it has no such gap.
      const minOpen = Math.max(12, 0.0003 * N);
      let above = 0;
      let peak = 0;
      let run = 0;
      let cut = -1;
      for (let b = nb - 1; b >= 0; b--) {
        const c = hist[b]!;
        if (above >= minOpen && c <= Math.max(2, 0.15 * peak)) {
          run++;
          if (run >= 8) { cut = b + run; break; }
        } else {
          run = 0;
          peak = Math.max(peak, c);
        }
        above += c;
        if (above > 0.25 * idx.length) break;
      }
      if (cut >= 0) {
        const thr = lo + cut * B;
        const open = idx.filter((i) => m[i]! >= thr);
        const film = idx.filter((i) => m[i]! < thr - 8 * B);
        const To = meanOf(open);
        const Tf = [0, 1, 2].map((k) => quantile(film.map((i) => img[3 * i + k]!), 0.98)) as Vec3;
        // Brighter in every channel, and without the orange mask: through a colour negative's base, blue and
        // green lose ≥ 0.25 D more than red (Gold 200: 0.56 and 0.36 D), so the open gate gains that much more
        // in blue or green. Blank film in a dark scene (bright above a gap, too) gains about equally.
        const gain = To.map((t, k) => lg(t) - lg(Tf[k]!));
        let ok = gain.every((g) => g >= 0.15) && Math.max(gain[2]! - gain[0]!, gain[1]! - gain[0]!) >= 0.25;
        const lr = o.lightRatio;
        if (ok && lr) ok = [0, 2].every((k) => Math.abs(lg(To[k]! / To[1]!) - lg(lr[k]! / lr[1]!)) < 0.05);
        if (ok) for (const i of open) cls[i] = 1;
      }
    }
  }
  const openIdx: number[] = [];
  for (let i = 0; i < N; i++) if (cls[i] === 1) openIdx.push(i);
  let openGate: OpenGateRegion | null = null;
  if (openIdx.length >= Math.max(4, 0.0002 * N)) {
    // the core of the open gate: drop its blurred edge (the darkest 30 %)
    const thr = quantile(openIdx.map((i) => m[i]!), 0.3);
    const core = openIdx.filter((i) => m[i]! >= thr);
    openGate = { T: meanOf(core), box: toInput(bbox(openIdx)), fraction: openIdx.length / N };
  } else {
    for (const i of openIdx) cls[i] = 0;
    notes.push({ code: 'W_NO_OPEN_GATE', message: 'No open gate in view (no sprocket hole or gap brighter than the film): the flare fraction and absolute base density are unknown; stock ranking is by shape only.', hint: 'Include sprocket holes or a gap at the film edge in the capture.' });
  }

  // ── 2. surround: dark pixels connected to the border. The border's darker part (its 20th percentile, mB)
  //    must be ≥ 1 D below the thinnest film; the threshold is mB + 1 D, at most 1.2 D below the thinnest
  //    film. (A strong veil lifts the holder towards the film's densest parts, so no fixed gap works.)
  const filmM: number[] = [];
  for (let i = 0; i < N; i++) if (!cls[i]) filmM.push(m[i]!);
  const mTop = quantile(filmM, 0.98);
  const borderM: number[] = [];
  for (let x = 0; x < w; x++) borderM.push(m[x]!, m[(h - 1) * w + x]!);
  for (let y = 1; y < h - 1; y++) borderM.push(m[y * w]!, m[y * w + w - 1]!);
  const mB = quantile(borderM, 0.2);
  const darkThr = o.surround === false || !(mB < mTop - 1.0) ? -Infinity : Math.min(mTop - 1.2, mB + 1.0);
  {
    // from the border at darkThr; then grown, from what was found, over pixels ≥ 2.2 D below the thinnest
    // film (the holder's blurred edge next to the film, lit by spill)
    let thr = darkThr;
    const q: number[] = [];
    const push = (i: number): void => {
      if (cls[i] || m[i]! >= thr) return;
      cls[i] = 2;
      q.push(i);
    };
    const fill = (): void => {
      while (q.length) {
        const i = q.pop()!;
        const x = i % w, y = (i / w) | 0;
        if (x > 0) push(i - 1);
        if (x < w - 1) push(i + 1);
        if (y > 0) push(i - w);
        if (y < h - 1) push(i + w);
      }
    };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    fill();
    if (darkThr > -Infinity && mTop - 2.2 > darkThr) {
      thr = mTop - 2.2;
      for (let i = 0; i < N; i++) if (cls[i] === 2) q.push(i);
      fill();
    }
  }
  let surround: VeilEstimate | null = null;
  let veil: Vec3 = [0, 0, 0];
  {
    const sIdx: number[] = [];
    for (let i = 0; i < N; i++) if (cls[i] === 2) sIdx.push(i);
    if (sIdx.length >= Math.max(20, 0.003 * N)) {
      // distance (4-neighbour steps) from the film, over the surround
      const dist = new Int32Array(N).fill(-1);
      const q: number[] = [];
      for (let i = 0; i < N; i++) if (cls[i] !== 2) { dist[i] = 0; q.push(i); }
      for (let qi = 0; qi < q.length; qi++) {
        const i = q[qi]!;
        const x = i % w, y = (i / w) | 0;
        const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
        for (const j of nb) if (j >= 0 && dist[j] === -1) { dist[j] = dist[i]! + 1; q.push(j); }
      }
      const d1 = Math.max(2, Math.round(0.015 * L));
      const d2 = Math.max(d1 + 3, Math.round(0.06 * L));
      let ring = sIdx.filter((i) => dist[i]! >= d1 && dist[i]! <= d2);
      if (ring.length < 20) ring = sIdx.filter((i) => dist[i]! >= d1);
      if (ring.length < 20) ring = sIdx;
      veil = medianOf(ring);
      surround = { L: veil, box: toInput(bbox(ring)), fraction: sIdx.length / N, pixels: ring.length };
    } else {
      for (const i of sIdx) cls[i] = 0;
      notes.push({ code: 'W_NO_SURROUND', message: 'No opaque holder in view: the scanner veil (flare) cannot be measured on this frame and is not corrected.', hint: 'Include some of the film holder around the film, or use the roll\'s veil.' });
    }
  }

  // ── veil-corrected log T of the film ──
  const logT = new Float64Array(3 * N);
  const mc = new Float64Array(N);
  const film: number[] = [];
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 3; k++) logT[3 * i + k] = lg(img[3 * i + k]! - veil[k]!);
    mc[i] = (logT[3 * i]! + logT[3 * i + 1]! + logT[3 * i + 2]!) / 3;
    if (!cls[i]) film.push(i);
  }
  const result = (crop: Box | null, rebate: RebateFound | null): FilmLayout => {
    const flare = openGate && surround ? (veil.map((v, k) => v / Math.max(LOW, openGate!.T[k]! - v)) as Vec3) : null;
    const veilOfBase = rebate && surround ? (veil.map((v, k) => v / Math.max(LOW, rebate.T[k]!)) as Vec3) : null;
    if (veilOfBase && veilOfBase.some((v) => v > 0.2))
      notes.push({ code: 'W_SURROUND_BRIGHT', message: `The holder reads ${(100 * Math.max(...veilOfBase)).toFixed(0)} % of the rebate: it is probably not opaque, or the flare is very high. Check the veil before using it.` });
    return { width, height, scale: s, surround, openGate, crop, rebate, flare, veilOfBase, notes };
  };
  if (film.length < 64) {
    notes.push({ code: 'W_NO_FILM', message: 'Too few film pixels to find the rebate.' });
    return result(null, null);
  }

  // ── texture: 5×5 spread of mc over film pixels ──
  const spread = new Float64Array(N).fill(Infinity);
  for (const i of film) {
    const x = i % w, y = (i / w) | 0;
    let a = 0, a2 = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (cls[j]) continue;
      a += mc[j]!; a2 += mc[j]! ** 2; n++;
    }
    if (n >= 9) spread[i] = Math.sqrt(Math.max(0, a2 / n - (a / n) ** 2));
  }
  const filmSpread = film.map((i) => spread[i]!).filter(Number.isFinite);
  const medSpread = quantile(filmSpread, 0.5);

  // ── 3. base, first pass: thinnest low-texture film ──
  const mcTop = quantile(film.map((i) => mc[i]!), 0.98);
  const thin = film.filter((i) => mc[i]! >= mcTop - 0.08 && spread[i]! <= 2 * medSpread + 1e-9);
  const base1Idx = ratioCluster(thin, logT);
  if (!base1Idx.length) {
    notes.push({ code: 'W_NO_REBATE', message: 'No uniform thin film found: the base is unknown.' });
    return result(null, null);
  }
  const lT1 = [0, 1, 2].map((k) => quantile(base1Idx.map((i) => logT[3 * i + k]!), 0.5)) as Vec3;

  // ── 4. crop: columns and rows where the film is exposed ──
  const exposed = new Uint8Array(N);
  for (const i of film) {
    let dmin = Infinity;
    for (let k = 0; k < 3; k++) dmin = Math.min(dmin, lT1[k]! - logT[3 * i + k]!);
    if (dmin > 0.12) exposed[i] = 1;
  }
  const profile = (along: 'x' | 'y', range: [number, number] | null): boolean[] => {
    const n = along === 'x' ? w : h;
    const across = along === 'x' ? h : w;
    const out: boolean[] = [];
    for (let a = 0; a < n; a++) {
      let nf = 0, ne = 0, tot = 0;
      const [b0, b1] = range ?? [0, across - 1];
      for (let b = b0; b <= b1; b++) {
        const i = along === 'x' ? b * w + a : a * w + b;
        tot++;
        if (cls[i]) continue;
        nf++;
        ne += exposed[i]!;
      }
      out.push(nf >= 0.3 * tot && ne >= 0.15 * nf);
    }
    return out;
  };
  let crop: Box | null = null;
  const cx = longestRun(profile('x', null), Math.max(1, Math.round(0.01 * w)));
  if (cx && cx[1] - cx[0] + 1 >= 0.25 * w) {
    const cy = longestRun(profile('y', cx), Math.max(1, Math.round(0.01 * h)));
    if (cy && cy[1] - cy[0] + 1 >= 0.25 * h) crop = { x: cx[0], y: cy[0], w: cx[1] - cx[0] + 1, h: cy[1] - cy[0] + 1 };
  }

  // ── 5. rebate: thin uniform film outside the crop ──
  const measure = (mask: Uint8Array, from: RebateFound['from'], conf: (r: Box) => number): RebateFound | null => {
    const r = largestRectangle(mask, w, h);
    if (!r || r.w * r.h < 4) return null;
    const sb: Box = { x: r.w > 2 ? r.x + 1 : r.x, y: r.h > 2 ? r.y + 1 : r.y, w: r.w > 2 ? r.w - 2 : r.w, h: r.h > 2 ? r.h - 2 : r.h };
    const box = toInput(sb);
    // shrink the input box to inside the working box (toInput rounds outwards)
    const inner: Box = { x: Math.ceil(sb.x / s), y: Math.ceil(sb.y / s), w: Math.max(1, Math.floor(sb.w / s)), h: Math.max(1, Math.floor(sb.h / s)) };
    const ib = s < 1 ? inner : box;
    const Traw = boxMeanInput(rgb, width, ib, stride);
    const T = Traw.map((t, k) => Math.max(LOW, t - veil[k]!)) as Vec3;
    const vertical = ib.h >= ib.w;
    const half = (first: boolean): Box => vertical
      ? { x: ib.x, y: first ? ib.y : ib.y + (ib.h >> 1), w: ib.w, h: Math.max(1, ib.h >> 1) }
      : { x: first ? ib.x : ib.x + (ib.w >> 1), y: ib.y, w: Math.max(1, ib.w >> 1), h: ib.h };
    const a = boxMeanInput(rgb, width, half(true), stride);
    const b = boxMeanInput(rgb, width, half(false), stride);
    const spreadD = Math.max(...[0, 1, 2].map((k) => Math.abs(lg(a[k]! - veil[k]!) - lg(b[k]! - veil[k]!))));
    return { T, Traw, box: ib, from, confidence: conf(sb), spreadD };
  };
  let rebate: RebateFound | null = null;
  if (crop) {
    const g = Math.max(1, Math.round(0.01 * L));
    const x0 = crop.x - g, y0 = crop.y - g, x1 = crop.x + crop.w + g, y1 = crop.y + crop.h + g;
    const cand = film.filter((i) => {
      const x = i % w, y = (i / w) | 0;
      return !(x >= x0 && x < x1 && y >= y0 && y < y1) && mc[i]! >= mcTop - 0.2;
    });
    const cs = cand.map((i) => spread[i]!).filter(Number.isFinite);
    if (cs.length >= 16) {
      const ms = quantile(cs, 0.5);
      const uni = cand.filter((i) => spread[i]! <= 2 * ms + 1e-9);
      const cl = ratioCluster(uni, logT);
      if (cl.length >= 8) {
        const mask = new Uint8Array(N);
        for (const i of cl) mask[i] = 1;
        rebate = measure(mask, 'edge', (sb) => {
          let ins = 0, n = 0;
          for (let y = sb.y; y < sb.y + sb.h; y++) for (let x = sb.x; x < sb.x + sb.w; x++) {
            const v = spread[y * w + x]!;
            if (Number.isFinite(v)) { ins += v; n++; }
          }
          const uniform = Math.min(1, (2 * ms + 1e-6) / (ins / Math.max(n, 1) + 1e-6) / 2);
          const area = Math.min(1, (sb.w * sb.h) / 200);
          return Math.max(0, Math.min(1, 0.5 * area + 0.5 * uniform));
        });
      }
    }
  }
  if (!rebate || rebate.confidence < (o.minConfidence ?? 0.5)) {
    const mask = new Uint8Array(N);
    for (const i of base1Idx) mask[i] = 1;
    const blank = measure(mask, 'blank', (sb) => Math.min(0.3, (sb.w * sb.h) / 2000));
    if (blank) {
      notes.push({
        code: 'W_REBATE_BLANK',
        message: rebate
          ? `The film edge outside the frame is a weak rebate candidate (confidence ${rebate.confidence.toFixed(2)}); the base was read on blank film inside the frame.`
          : 'No film edge outside the image frame: the base was read on blank (unexposed) film inside the frame. Densities near base may be off by fog; the roll base is safer.',
        hint: 'Pick a rebate box (scan.rebate) on the unexposed film edge, or use the roll base.',
      });
      rebate = blank;
    }
  }
  // A holder without film edge beside it is doubtful (a cropped scan whose border is dense image): drop it.
  if (surround && rebate?.from !== 'edge') {
    const again = filmLayout(rgb, width, height, { ...o, surround: false });
    again.notes = again.notes.filter((n) => n.code !== 'W_NO_SURROUND');
    again.notes.push({ code: 'W_NO_SURROUND', message: 'Dark border pixels were found but no film edge beside them, so they are not taken for the holder: the veil (flare) is not measured on this frame.', hint: 'Include the film edge and some of the holder in the capture, or use the roll\'s veil.' });
    return again;
  }
  return result(crop ? toInput(crop) : null, rebate);
}

/** Subtract a per-channel veil in place (interleaved, `stride` floats per pixel), floored at 1e-6. */
export function subtractVeil(rgb: Float32Array | Float64Array, L: ArrayLike<number>, stride = 3): void {
  const n = Math.floor(rgb.length / stride);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) rgb[i * stride + k] = Math.max(LOW, rgb[i * stride + k]! - L[k]!);
}
