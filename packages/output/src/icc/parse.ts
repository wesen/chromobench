// ICC profile parser (ICC.1 v4.4, and the v2 types the compact v2 profiles use): header, tag table,
// XYZ, s15Fixed16 arrays (chad), parametric and sampled curves, mluc/desc/text. Enough to derive a
// matrix/TRC RGB space and to validate a user's printer profile before lcms ever sees it (guide §5.3,
// §5.7). Everything is bounds-checked; a malformed file raises E_ICC_INVALID.
import { ChromobenchError, sha256Hex } from '@chromobench/contract';
import { decodeCurve, encodeCurve, inv3, mulMM, mulMV, type Mat3, type ParametricCurve, type Vec3 } from '@chromobench/core';

export type ProfileClass = 'scnr' | 'mntr' | 'prtr' | 'link' | 'spac' | 'abst' | 'nmcl';

export interface IccHeader {
  size: number;
  cmm: string;
  version: string; // e.g. '4.2', '2.1'
  major: number;
  class: ProfileClass | string;
  colourSpace: string; // 'RGB ', 'CMYK', 'GRAY', …
  pcs: string; // 'XYZ ' or 'Lab '
  intent: number;
  illuminant: Vec3;
}

export type Curve = { kind: 'para'; curve: ParametricCurve } | { kind: 'curv'; gamma: number } | { kind: 'sampled'; table: Float64Array };

export interface IccProfile {
  bytes: Uint8Array;
  sha256: string;
  header: IccHeader;
  /** Tag signatures in table order. */
  tags: string[];
  description: string;
  copyright: string;
  xyz(sig: string): Vec3 | undefined;
  /** chad (sf32 3×3), row-major. */
  chad?: Mat3;
  curve(sig: string): Curve | undefined;
}

const invalid = (message: string): never => { throw new ChromobenchError({ code: 'E_ICC_INVALID', message }); };

const sig4 = (b: Uint8Array, o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

export function parseIcc(bytes: Uint8Array): IccProfile {
  if (bytes.length < 132) invalid(`ICC profile too short (${bytes.length} bytes)`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = dv.getUint32(0);
  if (size !== bytes.length) invalid(`ICC header size ${size} differs from the file length ${bytes.length}`);
  if (sig4(bytes, 36) !== 'acsp') invalid('ICC profile without the acsp signature');
  const s15 = (o: number): number => dv.getInt32(o) / 65536;
  const major = bytes[8]!;
  const header: IccHeader = {
    size, cmm: sig4(bytes, 4), version: `${major}.${bytes[9]! >> 4}`, major, class: sig4(bytes, 12),
    colourSpace: sig4(bytes, 16), pcs: sig4(bytes, 20), intent: dv.getUint32(64), illuminant: [s15(68), s15(72), s15(76)],
  };
  const n = dv.getUint32(128);
  if (n > 1000 || 132 + 12 * n > bytes.length) invalid(`ICC tag count ${n} does not fit the file`);
  const table = new Map<string, { off: number; len: number }>();
  const tags: string[] = [];
  for (let i = 0; i < n; i++) {
    const e = 132 + 12 * i;
    const s = sig4(bytes, e);
    const off = dv.getUint32(e + 4);
    const len = dv.getUint32(e + 8);
    if (off + len > bytes.length || len < 8) invalid(`ICC tag ${s} (offset ${off}, ${len} bytes) lies outside the file`);
    table.set(s, { off, len });
    tags.push(s);
  }
  const at = (s: string) => table.get(s);
  const type = (s: string): string | undefined => { const t = at(s); return t ? sig4(bytes, t.off) : undefined; };

  const xyz = (s: string): Vec3 | undefined => {
    const t = at(s);
    if (!t || type(s) !== 'XYZ ') return undefined;
    if (t.len < 20) invalid(`ICC tag ${s}: XYZ too short`);
    return [s15(t.off + 8), s15(t.off + 12), s15(t.off + 16)];
  };
  let chad: Mat3 | undefined;
  const ct = at('chad');
  if (ct) {
    if (type('chad') !== 'sf32' || ct.len < 44) invalid('ICC chad is not a 3×3 s15Fixed16 array');
    const v = Array.from({ length: 9 }, (_, k) => s15(ct.off + 8 + 4 * k));
    chad = [[v[0]!, v[1]!, v[2]!], [v[3]!, v[4]!, v[5]!], [v[6]!, v[7]!, v[8]!]];
  }
  const curve = (s: string): Curve | undefined => {
    const t = at(s);
    if (!t) return undefined;
    const ty = type(s);
    if (ty === 'para') {
      const ft = dv.getUint16(t.off + 8);
      const np = [1, 3, 4, 5, 7][ft];
      if (np === undefined) invalid(`ICC ${s}: unknown parametric curve type ${ft}`);
      if (t.len < 12 + 4 * np!) invalid(`ICC ${s}: parametric curve too short`);
      const p = Array.from({ length: np! }, (_, k) => s15(t.off + 12 + 4 * k));
      const [g, a, b, c, d, e, f] = p as [number, number?, number?, number?, number?, number?, number?];
      const cv: ParametricCurve = { type: ft as ParametricCurve['type'], g };
      if (a !== undefined) cv.a = a;
      if (b !== undefined) cv.b = b;
      if (c !== undefined) cv.c = c;
      if (d !== undefined) cv.d = d;
      if (e !== undefined) cv.e = e;
      if (f !== undefined) cv.f = f;
      return { kind: 'para', curve: cv };
    }
    if (ty === 'curv') {
      const cnt = dv.getUint32(t.off + 8);
      if (t.len < 12 + 2 * cnt) invalid(`ICC ${s}: curve table too short`);
      if (cnt === 0) return { kind: 'curv', gamma: 1 };
      if (cnt === 1) return { kind: 'curv', gamma: dv.getUint16(t.off + 12) / 256 };
      const table = new Float64Array(cnt);
      for (let k = 0; k < cnt; k++) table[k] = dv.getUint16(t.off + 12 + 2 * k) / 65535;
      return { kind: 'sampled', table };
    }
    return undefined;
  };
  const text = (s: string): string => {
    const t = at(s);
    if (!t) return '';
    const ty = type(s);
    if (ty === 'mluc') {
      const nrec = dv.getUint32(t.off + 8);
      if (nrec < 1) return '';
      const len = dv.getUint32(t.off + 20);
      const o = dv.getUint32(t.off + 24);
      if (o + len > t.len) invalid(`ICC ${s}: mluc record outside the tag`);
      let out = '';
      for (let k = 0; k + 1 < len; k += 2) out += String.fromCharCode(dv.getUint16(t.off + o + k));
      return out;
    }
    if (ty === 'desc') {
      const len = dv.getUint32(t.off + 8);
      if (12 + len > t.len) invalid(`ICC ${s}: desc text outside the tag`);
      return String.fromCharCode(...bytes.subarray(t.off + 12, t.off + 12 + len)).replace(/\0+$/, '');
    }
    if (ty === 'text') return String.fromCharCode(...bytes.subarray(t.off + 8, t.off + t.len)).replace(/\0+$/, '');
    return '';
  };
  return {
    bytes, sha256: sha256Hex(bytes), header, tags, description: text('desc'), copyright: text('cprt'),
    xyz, ...(chad ? { chad } : {}), curve,
  };
}

const BRADFORD: Mat3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];

/** Bradford adaptation matrix from `from` to `to` (v2 profiles have no chad; ICC.1 Annex E). */
function bradford(from: Vec3, to: Vec3): Mat3 {
  const s = mulMV(BRADFORD, from);
  const d = mulMV(BRADFORD, to);
  return mulMM(inv3(BRADFORD), mulMM([[d[0] / s[0], 0, 0], [0, d[1] / s[1], 0], [0, 0, d[2] / s[2]]], BRADFORD));
}

export interface MatrixTrc {
  /** Linear RGB → XYZ relative to the space's own white (colorants un-adapted with chad⁻¹). */
  toXYZ: Mat3;
  fromXYZ: Mat3;
  white: Vec3;
  /** The red TRC (the bundled spaces use one curve for all three). */
  trc: Curve;
  /** Encoded → linear and back, by the profile's curve. */
  decode(v: number): number;
  encode(v: number): number;
}

/** Linear value of an encoded one through any of the curve kinds. */
export function curveDecode(c: Curve, v: number): number {
  if (c.kind === 'para') return decodeCurve(c.curve, v);
  if (c.kind === 'curv') return v > 0 ? v ** c.gamma : 0;
  const t = c.table;
  const x = Math.min(Math.max(v, 0), 1) * (t.length - 1);
  const i = Math.min(Math.floor(x), t.length - 2);
  return t[i]! + (t[i + 1]! - t[i]!) * (x - i);
}

/** Encoded value of a linear one (exact inverse for para/curv; inverse interpolation for sampled curves). */
export function curveEncode(c: Curve, y: number): number {
  if (c.kind === 'para') return encodeCurve(c.curve, y);
  if (c.kind === 'curv') return y > 0 ? y ** (1 / c.gamma) : 0;
  const t = c.table;
  if (y <= t[0]!) return 0;
  if (y >= t[t.length - 1]!) return 1;
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m]! <= y) lo = m; else hi = m; }
  return (lo + (y - t[lo]!) / (t[hi]! - t[lo]!)) / (t.length - 1);
}

/** The matrix/TRC model of an RGB display-class profile (E_ICC_INVALID if it has none). */
export function matrixTrc(p: IccProfile): MatrixTrc {
  const r = p.xyz('rXYZ');
  const g = p.xyz('gXYZ');
  const b = p.xyz('bXYZ');
  const trc = p.curve('rTRC');
  if (p.header.colourSpace !== 'RGB ' || !r || !g || !b || !trc) return invalid('not a matrix/TRC RGB profile (needs rXYZ, gXYZ, bXYZ and rTRC)');
  const Mpcs: Mat3 = [[r[0], g[0], b[0]], [r[1], g[1], b[1]], [r[2], g[2], b[2]]];
  // v4: chad maps the space's white to the PCS white; v2: Bradford from the media white (wtpt) to D50
  const chad = p.chad ?? bradford(p.xyz('wtpt') ?? p.header.illuminant, p.header.illuminant);
  const toXYZ = mulMM(inv3(chad), Mpcs);
  return {
    toXYZ, fromXYZ: inv3(toXYZ), white: mulMV(toXYZ, [1, 1, 1]), trc,
    decode: (v) => curveDecode(trc, v), encode: (v) => curveEncode(trc, v),
  };
}
