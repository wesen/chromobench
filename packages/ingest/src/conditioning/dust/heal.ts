// Healing in scanner density (guide §5.11): a port of goja-cv's Heal (kernels/heal.go 22–343) over the
// three density planes together. 'patch' copies the best-matching nearby patch (ring SSD over all
// channels) and corrects the seam with a harmonic density offset (a multiplicative transmittance gain);
// 'diffuse' fills harmonically. 'neutral' (v1, guide) is not implemented and falls back to 'patch'.
import { components, distanceToSet } from './kernels.ts';
import type { DustSpot } from './specks.ts';

export interface HealOptions { marginPx: number; method: 'patch' | 'diffuse' | 'neutral' }

interface Win { x0: number; y0: number; x1: number; y1: number }

function pullPush(vals: Float64Array, unknown: Uint8Array, w: number, h: number): void {
  type L = { v: Float64Array; wt: Float64Array; w: number; h: number };
  const l0: L = { v: new Float64Array(w * h), wt: new Float64Array(w * h), w, h };
  let has = false;
  for (let i = 0; i < w * h; i++) if (!unknown[i]) { l0.v[i] = vals[i]!; l0.wt[i] = 1; has = true; }
  if (!has) return;
  const levels: L[] = [l0];
  for (;;) {
    const cur = levels[levels.length - 1]!;
    if (cur.wt.every((x) => x > 0) || (cur.w === 1 && cur.h === 1)) break;
    const nw = (cur.w + 1) >> 1, nh = (cur.h + 1) >> 1;
    const nx: L = { v: new Float64Array(nw * nh), wt: new Float64Array(nw * nh), w: nw, h: nh };
    for (let y = 0; y < cur.h; y++) for (let x = 0; x < cur.w; x++) {
      const i = y * cur.w + x, j = (y >> 1) * nw + (x >> 1);
      nx.v[j]! += cur.v[i]! * cur.wt[i]!;
      nx.wt[j]! += cur.wt[i]!;
    }
    for (let j = 0; j < nw * nh; j++) if (nx.wt[j]! > 0) { nx.v[j]! /= nx.wt[j]!; nx.wt[j] = Math.min(1, nx.wt[j]!); }
    levels.push(nx);
  }
  for (let k = levels.length - 2; k >= 0; k--) {
    const cur = levels[k]!, up = levels[k + 1]!;
    for (let y = 0; y < cur.h; y++) for (let x = 0; x < cur.w; x++) {
      const i = y * cur.w + x;
      if (cur.wt[i]! >= 1) continue;
      const u = up.v[(y >> 1) * up.w + (x >> 1)]!;
      cur.v[i] = cur.v[i]! * cur.wt[i]! + u * (1 - cur.wt[i]!);
      cur.wt[i] = 1;
    }
  }
  for (let i = 0; i < w * h; i++) if (unknown[i]) vals[i] = l0.v[i]!;
}

/** Laplace fill of the unknown entries (pull-push start, SOR ω = 1.85, Neumann borders). */
export function harmonic(vals: Float64Array, unknown: Uint8Array, w: number, h: number): void {
  pullPush(vals, unknown, w, h);
  const idx: number[] = [];
  for (let i = 0; i < w * h; i++) if (unknown[i]) idx.push(i);
  if (!idx.length) return;
  const iters = Math.min(3000, 40 + 8 * Math.max(w, h));
  for (let it = 0; it < iters; it++) {
    let maxd = 0;
    for (const i of idx) {
      const x = i % w, y = (i / w) | 0;
      let s = 0, n = 0;
      if (x > 0) { s += vals[i - 1]!; n++; }
      if (x < w - 1) { s += vals[i + 1]!; n++; }
      if (y > 0) { s += vals[i - w]!; n++; }
      if (y < h - 1) { s += vals[i + w]!; n++; }
      if (!n) continue;
      const d = s / n - vals[i]!;
      vals[i]! += 1.85 * d;
      maxd = Math.max(maxd, Math.abs(d));
    }
    if (maxd < 1e-7) break;
  }
}

function ringOf(local: Uint8Array, w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (local[y * w + x]) continue;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && local[yy * w + xx]) { near = true; break; }
    }
    if (near) out.push(y * w + x);
  }
  return out;
}

function findPatch(D: Float32Array[], W: number, H: number, hole: Uint8Array, local: Uint8Array, win: Win): [number, number] | null {
  const w = win.x1 - win.x0, h = win.y1 - win.y0;
  const rg = ringOf(local, w, h);
  if (rg.length < 4) return null;
  const all: number[] = [];
  for (let i = 0; i < w * h; i++) if (local[i]) all.push(i);
  all.push(...rg);
  const size = Math.max(w, h);
  const S = Math.max(10, 2 * size);
  const step = size > 12 ? 2 : 1;
  let best = Infinity, bdx = 0, bdy = 0;
  for (let dy = -S; dy <= S; dy += step) for (let dx = -S; dx <= S; dx += step) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < (size >> 1) + 2) continue;
    let ok = true;
    for (const i of all) {
      const x = (i % w) + win.x0 + dx, y = ((i / w) | 0) + win.y0 + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || hole[y * W + x]) { ok = false; break; }
    }
    if (!ok) continue;
    let cost = 0;
    for (let c = 0; c < D.length && cost < best; c++) {
      const pl = D[c]!;
      for (const i of rg) {
        const x = (i % w) + win.x0, y = ((i / w) | 0) + win.y0;
        const d = pl[(y + dy) * W + x + dx]! - pl[y * W + x]!;
        cost += d * d;
      }
    }
    cost *= 1 + 0.002 * Math.hypot(dx, dy);
    if (cost < best) { best = cost; bdx = dx; bdy = dy; }
  }
  return Number.isFinite(best) ? [bdx, bdy] : null;
}

/** Rasterises spots (detected specks by their pixels; heal spots by x, y, r in px, pixel centres at i + 0.5) into a target mask of the plane at origin/scale. */
export function spotsMask(spots: readonly (DustSpot | { x: number; y: number; r: number })[], w: number, h: number, o: { x0?: number; y0?: number; scale?: number } = {}): Uint8Array {
  const m = new Uint8Array(w * h);
  const s = o.scale ?? 1;
  for (const sp of spots) {
    if ('pix' in sp) { for (const p of sp.pix) m[p] = 1; continue; }
    const cx = (sp.x - (o.x0 ?? 0)) * s - 0.5, cy = (sp.y - (o.y0 ?? 0)) * s - 0.5, r = sp.r * s;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * w + x] = 1;
    }
  }
  return m;
}

/** Heals the target pixels (grown by marginPx) in all density planes. The input is not modified. */
export function heal(D: Float32Array[], W: number, H: number, target: Uint8Array, o: HealOptions): { planes: Float32Array[]; grown: Uint8Array } {
  let hole = target;
  if (o.marginPx > 0) {
    const d = distanceToSet(target, W, H);
    hole = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) hole[i] = d[i]! <= o.marginPx ? 1 : 0;
  }
  const out = D.map((p) => p.slice());
  for (const pix of components(hole, W, H)) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (const p of pix) {
      const x = p % W, y = (p / W) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const win: Win = { x0: Math.max(0, x0 - 2), y0: Math.max(0, y0 - 2), x1: Math.min(W, x1 + 3), y1: Math.min(H, y1 + 3) };
    const w = win.x1 - win.x0, h = win.y1 - win.y0;
    const local = new Uint8Array(w * h);
    for (const p of pix) local[(((p / W) | 0) - win.y0) * w + (p % W) - win.x0] = 1;
    const off = o.method !== 'diffuse' ? findPatch(D, W, H, hole, local, win) : null;
    for (let c = 0; c < D.length; c++) {
      const src = D[c]!, dst = out[c]!;
      const vals = new Float64Array(w * h);
      if (off) {
        const [dx, dy] = off;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const gx = x + win.x0, gy = y + win.y0, sx = gx + dx, sy = gy + dy;
          vals[y * w + x] = src[gy * W + gx]! - (sx >= 0 && sy >= 0 && sx < W && sy < H ? src[sy * W + sx]! : 0);
        }
        harmonic(vals, local, w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (local[y * w + x]) {
          const gx = x + win.x0, gy = y + win.y0;
          dst[gy * W + gx] = src[(gy + dy) * W + gx + dx]! + vals[y * w + x]!;
        }
      } else {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) vals[y * w + x] = src[(y + win.y0) * W + x + win.x0]!;
        harmonic(vals, local, w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (local[y * w + x]) dst[(y + win.y0) * W + x + win.x0] = vals[y * w + x]!;
      }
    }
  }
  return { planes: out, grown: hole };
}
