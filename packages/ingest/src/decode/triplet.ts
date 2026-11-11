// LED triplets (guide §5.3): three exposures, one per narrowband LED, merged into one camera-linear
// image. Roles come from the data (the dominant channel of each exposure), not from file names.
import type { Diagnostic } from '@chromobench/contract';
import { formatError } from './errors.ts';
import { tripletSha256 } from './identity.ts';
import type { CameraLinear } from './linear.ts';

export type Role = 'R' | 'G' | 'B';
const ROLES: Role[] = ['R', 'G', 'B'];

/** Mean of each channel over a sparse grid of rows. */
export function channelMeans(src: CameraLinear, step = 8): [number, number, number] {
  const row = new Float32Array(src.width);
  const s = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < src.height; y += step) {
    for (let c = 0; c < 3; c++) {
      src.row(c, y, row);
      for (let x = 0; x < src.width; x += step) s[c]! += row[x]!;
    }
    n += Math.ceil(src.width / step);
  }
  return [s[0]! / n, s[1]! / n, s[2]! / n];
}

/** The channel with the largest share of the exposure's summed signal. */
export function detectRole(src: CameraLinear): Role {
  const m = channelMeans(src);
  return ROLES[m.indexOf(Math.max(...m))]!;
}

/** Gradient magnitude of the channel sum, area-reduced so the long side is ≤ long. */
function gradientImage(src: CameraLinear, long = 256): { g: Float64Array; w: number; h: number; f: number } {
  const f = Math.max(1, Math.ceil(Math.max(src.width, src.height) / long));
  const w = Math.floor(src.width / f);
  const h = Math.floor(src.height / f);
  const img = new Float64Array(w * h);
  const row = new Float32Array(src.width);
  for (let y = 0; y < h * f; y++) for (let c = 0; c < 3; c++) {
    src.row(c, y, row);
    for (let x = 0; x < w * f; x++) img[Math.floor(y / f) * w + Math.floor(x / f)]! += row[x]!;
  }
  const g = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    // log first: the exposures differ by a gain per LED, edges should not
    const lx = Math.log(Math.max(img[i + 1]!, 1e-9)) - Math.log(Math.max(img[i - 1]!, 1e-9));
    const ly = Math.log(Math.max(img[i + w]!, 1e-9)) - Math.log(Math.max(img[i - w]!, 1e-9));
    g[i] = Math.hypot(lx, ly);
  }
  return { g, w, h, f };
}

/**
 * Shift of b against a in source pixels, by normalised cross-correlation of log-gradient images over
 * ±range reduced pixels with a parabolic sub-pixel refinement. (The guide names phase correlation;
 * this is the same estimate for the small shifts that matter, without an FFT.)
 */
export function estimateShift(a: CameraLinear, b: CameraLinear, range = 6): { dx: number; dy: number } {
  const A = gradientImage(a);
  const B = gradientImage(b);
  const { w, h } = A;
  const score = (dx: number, dy: number): number => {
    let sab = 0, saa = 0, sbb = 0;
    for (let y = range + 1; y < h - range - 1; y++) for (let x = range + 1; x < w - range - 1; x++) {
      const va = A.g[y * w + x]!;
      const vb = B.g[(y + dy) * w + x + dx]!;
      sab += va * vb; saa += va * va; sbb += vb * vb;
    }
    return sab / Math.sqrt(saa * sbb || 1);
  };
  let best = { dx: 0, dy: 0, s: -Infinity };
  const S = new Map<string, number>();
  for (let dy = -range; dy <= range; dy++) for (let dx = -range; dx <= range; dx++) {
    const s = score(dx, dy);
    S.set(`${dx},${dy}`, s);
    if (s > best.s) best = { dx, dy, s };
  }
  const sub = (m: number, c: number, p: number): number => {
    const d = m - 2 * c + p;
    return d < 0 ? (0.5 * (m - p)) / d : 0;
  };
  const at = (dx: number, dy: number): number => S.get(`${dx},${dy}`) ?? best.s;
  const fx = best.dx + sub(at(best.dx - 1, best.dy), best.s, at(best.dx + 1, best.dy));
  const fy = best.dy + sub(at(best.dx, best.dy - 1), best.s, at(best.dx, best.dy + 1));
  return { dx: fx * A.f, dy: fy * A.f };
}

export interface TripletResult {
  linear: CameraLinear;
  sha256: string;
  roles: Role[];
  notes: Diagnostic[];
  shifts: { dx: number; dy: number }[];
}

/**
 * Merges three exposures. `own`: channel k from the k-th role's own channel k (Chromogen mergeTriplet).
 * `all-photosites`: channel k is the mean of all channels of the k-th role's exposure (every photosite
 * saw the same narrowband spectrum up to a gain, so all of them carry signal).
 */
export function mergeTriplet(parts: CameraLinear[], o: { mode?: 'own' | 'all-photosites'; checkShift?: boolean } = {}): TripletResult {
  if (parts.length !== 3) throw new Error('mergeTriplet needs three exposures');
  const [a] = parts as [CameraLinear, CameraLinear, CameraLinear];
  const notes: Diagnostic[] = [];
  for (const p of parts) if (p.width !== a.width || p.height !== a.height) {
    return formatError(`the three exposures differ in size (${parts.map((q) => `${q.width}×${q.height}`).join(', ')})`);
  }
  const detected = parts.map(detectRole);
  let order = [0, 1, 2];
  if (new Set(detected).size === 3) {
    order = ROLES.map((r) => detected.indexOf(r));
    if (order.some((v, i) => v !== i)) notes.push({ code: 'W_TRIPLET_SHIFT', message: `Exposure roles from the data (${detected.join(', ')}) disagree with the file order; the data wins.` });
  } else notes.push({ code: 'W_TRIPLET_SHIFT', message: `Could not assign LED roles from the data (${detected.join(', ')}); file order R, G, B is used.` });
  const byRole = order.map((i) => parts[i]!);
  const shifts: { dx: number; dy: number }[] = [];
  if (o.checkShift !== false) {
    for (const k of [1, 2]) {
      const s = estimateShift(byRole[0]!, byRole[k]!);
      shifts.push(s);
      if (Math.hypot(s.dx, s.dy) > 0.5) notes.push({ code: 'W_TRIPLET_SHIFT', message: `Exposure ${ROLES[k]} is shifted by (${s.dx.toFixed(2)}, ${s.dy.toFixed(2)}) px against ${ROLES[0]}; registration is not applied in v0.` });
    }
  }
  const mode = o.mode ?? 'own';
  const tmp = new Float32Array(a.width);
  const linear: CameraLinear = {
    width: a.width, height: a.height, channels: 3,
    sha256: tripletSha256(byRole[0]!.sha256, byRole[1]!.sha256, byRole[2]!.sha256),
    clipped: null, clippedFraction: Math.max(...byRole.map((p) => p.clippedFraction)),
    row: (c, y, out) => {
      const src = byRole[c]!;
      if (mode === 'own') return src.row(c, y, out);
      for (let x = 0; x < a.width; x++) out[x] = 0;
      for (let k = 0; k < 3; k++) {
        src.row(k, y, tmp);
        for (let x = 0; x < a.width; x++) out[x]! += tmp[x]! / 3;
      }
    },
  };
  return { linear, sha256: linear.sha256, roles: order.map((i) => detected[i]!), notes, shifts };
}
