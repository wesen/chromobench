// Streaming baseline JPEG writer (CHB-047, OUT-2): 8-bit YCbCr 4:4:4, the IJG quality scale on the Annex K tables, the
// standard Huffman tables (Annex K.3), the colour space's ICC profile in APP2 (ICC.1 B.4, chunked), JFIF density as
// dots per inch, and the export's metadata as a comment. Rows arrive in bands of 16-bit RGB (as the PNG and TIFF
// writers take them); each complete band of 8 rows is encoded and written at once, so no export holds the picture or
// the file in memory. 8-bit values come from the 16-bit codes with the position-keyed dither of PNG 8-bit, so a
// tiled export and a one-pass export write the same file.
//
// The forward DCT is the AAN float algorithm (IJG jfdctflt.c); its scale factors are folded into the quantiser.
// 4:4:4 at every quality: prints and edges keep their colour (a 4:2:0 file is ≈ 30 % smaller and bleeds at edges).
import { ditherTo8 } from './quantise.ts';
import type { ByteSink } from './sinks.ts';

export interface JpegOptions {
  width: number;
  height: number;
  /** IJG quality 1–100 (default 90). */
  quality?: number;
  /** JFIF density in dots per inch (default 72). */
  dpi?: number;
  /** ICC profile embedded in APP2 segments. */
  icc?: Uint8Array;
  /** COM segments (UTF-8), one per string; a long string is split. */
  comments?: string[];
}

/** JPEG zig-zag order: position k of the coded sequence is natural index ZIGZAG[k]. */
export const ZIGZAG = Uint8Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

/** ITU-T T.81 Annex K.1 tables (natural order). */
const LUMA_Q = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMA_Q = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

/** The IJG quality scaling (jcparam.c jpeg_quality_scaling + jpeg_add_quant_table, baseline: 1…255), natural order. */
export function quantTable(base: readonly number[], quality: number): Uint8Array {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - 2 * q;
  return Uint8Array.from(base, (b) => Math.min(255, Math.max(1, Math.floor((b * scale + 50) / 100))));
}

/** Annex K.3 Huffman tables: code counts per length 1…16 and the symbols. */
const DC_LUMA = { bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const DC_CHROMA = { bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const AC_LUMA = {
  bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  vals: [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
    0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
    0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ],
};
const AC_CHROMA = {
  bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  vals: [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
    0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
    0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
    0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ],
};

interface Huff { code: Uint16Array; size: Uint8Array }

/** Code and length per symbol (Annex C: canonical codes from the counts). */
function huffman(t: { bits: number[]; vals: number[] }): Huff {
  const code = new Uint16Array(256), size = new Uint8Array(256);
  let c = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < t.bits[len - 1]!; i++) {
      const v = t.vals[k++]!;
      code[v] = c++;
      size[v] = len;
    }
    c <<= 1;
  }
  return { code, size };
}

/** AAN scale factors: cos(kπ/16)·√2 for k > 0, 1 for k = 0. */
const AAN = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.5411961, 0.275899379];

/** The quantiser of the AAN DCT's output: 1 / (q · aan_row · aan_col · 8), natural order. */
function divisors(q: Uint8Array): Float64Array {
  const d = new Float64Array(64);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) d[r * 8 + c] = 1 / (q[r * 8 + c]! * AAN[r]! * AAN[c]! * 8);
  return d;
}

/** In-place AAN forward DCT of an 8 × 8 block (natural order; output scaled by 8·aan_row·aan_col). */
export function fdct8x8(d: Float64Array): void {
  for (let p = 0; p < 64; p += 8) pass(d, p, 1);
  for (let p = 0; p < 8; p++) pass(d, p, 8);
}

function pass(d: Float64Array, o: number, s: number): void {
  const d0 = d[o]!, d1 = d[o + s]!, d2 = d[o + 2 * s]!, d3 = d[o + 3 * s]!, d4 = d[o + 4 * s]!, d5 = d[o + 5 * s]!, d6 = d[o + 6 * s]!, d7 = d[o + 7 * s]!;
  const t0 = d0 + d7, t7 = d0 - d7, t1 = d1 + d6, t6 = d1 - d6, t2 = d2 + d5, t5 = d2 - d5, t3 = d3 + d4, t4 = d3 - d4;
  let t10 = t0 + t3;
  const t13 = t0 - t3;
  let t11 = t1 + t2;
  let t12 = t1 - t2;
  d[o] = t10 + t11;
  d[o + 4 * s] = t10 - t11;
  const z1 = (t12 + t13) * 0.707106781;
  d[o + 2 * s] = t13 + z1;
  d[o + 6 * s] = t13 - z1;
  t10 = t4 + t5;
  t11 = t5 + t6;
  t12 = t6 + t7;
  const z5 = (t10 - t12) * 0.382683433;
  const z2 = 0.5411961 * t10 + z5;
  const z4 = 1.306562965 * t12 + z5;
  const z3 = t11 * 0.707106781;
  const z11 = t7 + z3, z13 = t7 - z3;
  d[o + 5 * s] = z13 + z2;
  d[o + 3 * s] = z13 - z2;
  d[o + s] = z11 + z4;
  d[o + 7 * s] = z11 - z4;
}

/** Bits into bytes with 0xFF stuffing, handed to the sink in chunks. */
class BitWriter {
  private buf = new Uint8Array(1 << 16);
  private n = 0;
  private acc = 0;
  private bits = 0;
  private readonly sink: ByteSink;
  constructor(sink: ByteSink) {
    this.sink = sink;
  }
  put(code: number, size: number): void {
    // acc holds at most 7 pending bits between calls; a code is at most 16 bits
    this.acc = (this.acc << size) | (code & ((1 << size) - 1));
    this.bits += size;
    while (this.bits >= 8) {
      const b = (this.acc >>> (this.bits - 8)) & 255;
      this.byte(b);
      if (b === 255) this.byte(0);
      this.bits -= 8;
    }
    this.acc &= (1 << this.bits) - 1;
  }
  private byte(b: number): void {
    if (this.n === this.buf.length) {
      const nb = new Uint8Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.n++] = b;
  }
  /** Pads the last byte with ones (T.81 F.1.2.3). */
  pad(): void {
    if (this.bits > 0) this.put((1 << (8 - this.bits)) - 1, 8 - this.bits);
  }
  async flush(): Promise<void> {
    if (!this.n) return;
    const out = this.buf.slice(0, this.n);
    this.n = 0;
    await this.sink.write(out);
  }
}

const u16be = (v: number): number[] => [(v >>> 8) & 255, v & 255];

function segment(marker: number, body: ArrayLike<number>): Uint8Array {
  if (body.length + 2 > 65535) throw new RangeError(`JPEG: segment 0x${marker.toString(16)} of ${body.length} bytes is too long`);
  const out = new Uint8Array(4 + body.length);
  out[0] = 0xff;
  out[1] = marker;
  out.set(u16be(body.length + 2), 2);
  out.set(body as Uint8Array, 4);
  return out;
}

const ICC_SIG = [...'ICC_PROFILE'].map((c) => c.charCodeAt(0)).concat(0);
/** Profile bytes per APP2 chunk: 65535 − 2 (length) − 14 (signature, sequence, count). */
export const ICC_CHUNK = 65519;

/** The APP2 segments that carry an ICC profile (ICC.1:2010 Annex B.4): sequence numbers from 1, the count in each. */
export function iccSegments(icc: Uint8Array): Uint8Array[] {
  const count = Math.ceil(icc.length / ICC_CHUNK);
  if (count > 255) throw new RangeError('JPEG: ICC profile too large for 255 APP2 chunks');
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const part = icc.subarray(i * ICC_CHUNK, Math.min(icc.length, (i + 1) * ICC_CHUNK));
    out.push(segment(0xe2, [...ICC_SIG, i + 1, count, ...part]));
  }
  return out;
}

/** Bit length of |v| (the magnitude category, T.81 F.1.2.1). */
function category(v: number): number {
  let a = v < 0 ? -v : v;
  let n = 0;
  while (a) {
    n++;
    a >>= 1;
  }
  return n;
}

export class JpegWriter {
  private y = 0;
  private done = false;
  /** The 16-bit rows not yet encoded (fewer than 8). */
  private carry: Uint16Array;
  private carryRows = 0;
  private readonly qY: Float64Array;
  private readonly qC: Float64Array;
  private readonly dcY: Huff = huffman(DC_LUMA);
  private readonly dcC: Huff = huffman(DC_CHROMA);
  private readonly acY: Huff = huffman(AC_LUMA);
  private readonly acC: Huff = huffman(AC_CHROMA);
  private readonly bw: BitWriter;
  private prev = [0, 0, 0];
  private readonly blk = new Float64Array(64);
  private readonly coef = new Int32Array(64);
  private readonly sink: ByteSink;
  private readonly o: JpegOptions;

  private constructor(sink: ByteSink, o: JpegOptions, qY: Uint8Array, qC: Uint8Array) {
    this.sink = sink;
    this.o = o;
    this.qY = divisors(qY);
    this.qC = divisors(qC);
    this.bw = new BitWriter(sink);
    this.carry = new Uint16Array(o.width * 3 * 8);
  }

  /** Writes the headers (SOI … SOS) and returns a writer for the rows. */
  static async open(sink: ByteSink, o: JpegOptions): Promise<JpegWriter> {
    const { width: W, height: H } = o;
    if (!(W >= 1 && H >= 1 && W <= 65535 && H <= 65535)) throw new RangeError(`JPEG: ${W}×${H} is outside 1…65535 per side`);
    const quality = o.quality ?? 90;
    const qY = quantTable(LUMA_Q, quality), qC = quantTable(CHROMA_Q, quality);
    const w = new JpegWriter(sink, o, qY, qC);
    const dpi = Math.max(1, Math.min(65535, Math.round(o.dpi ?? 72)));
    const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
    // JFIF 1.01, density in dots per inch, no thumbnail
    parts.push(segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, ...u16be(dpi), ...u16be(dpi), 0, 0]));
    if (o.icc) parts.push(...iccSegments(o.icc));
    for (const c of o.comments ?? []) {
      const b = new TextEncoder().encode(c);
      for (let i = 0; i < b.length; i += 65533) parts.push(segment(0xfe, b.subarray(i, i + 65533)));
    }
    // DQT: two 8-bit tables in zig-zag order
    const dqt = [0, ...Array.from(ZIGZAG, (z) => qY[z]!), 1, ...Array.from(ZIGZAG, (z) => qC[z]!)];
    parts.push(segment(0xdb, dqt));
    // SOF0: 8-bit, three components 1×1 (4:4:4): Y on table 0, Cb and Cr on table 1
    parts.push(segment(0xc0, [8, ...u16be(H), ...u16be(W), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]));
    const dht = (cls: number, id: number, t: { bits: number[]; vals: number[] }): number[] => [(cls << 4) | id, ...t.bits, ...t.vals];
    parts.push(segment(0xc4, [...dht(0, 0, DC_LUMA), ...dht(1, 0, AC_LUMA), ...dht(0, 1, DC_CHROMA), ...dht(1, 1, AC_CHROMA)]));
    parts.push(segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]));
    let n = 0;
    for (const p of parts) n += p.length;
    const head = new Uint8Array(n);
    n = 0;
    for (const p of parts) {
      head.set(p, n);
      n += p.length;
    }
    await sink.write(head);
    return w;
  }

  /** Rows written so far. */
  get rowsWritten(): number { return this.y + this.carryRows; }

  /** Appends `rows` rows of interleaved RGB 16-bit values; every complete band of 8 rows is encoded now. */
  async writeRows(rgb16: Uint16Array, rows: number): Promise<void> {
    const W = this.o.width;
    if (this.done) throw new Error('JPEG: writeRows after finish');
    if (rgb16.length < rows * W * 3) throw new RangeError(`JPEG: ${rows} rows need ${rows * W * 3} samples, got ${rgb16.length}`);
    if (this.rowsWritten + rows > this.o.height) throw new RangeError(`JPEG: ${this.rowsWritten + rows} rows exceed the height ${this.o.height}`);
    let r = 0;
    while (r < rows) {
      const take = Math.min(8 - this.carryRows, rows - r);
      this.carry.set(rgb16.subarray(r * W * 3, (r + take) * W * 3), this.carryRows * W * 3);
      this.carryRows += take;
      r += take;
      if (this.carryRows === 8) this.band(8);
    }
    await this.bw.flush();
  }

  /** Encodes the last partial band (rows repeated down to 8), pads, writes EOI. */
  async finish(): Promise<void> {
    if (this.rowsWritten !== this.o.height) throw new Error(`JPEG: ${this.rowsWritten} of ${this.o.height} rows written`);
    this.done = true;
    if (this.carryRows) this.band(this.carryRows);
    this.bw.pad();
    await this.bw.flush();
    await this.sink.write(new Uint8Array([0xff, 0xd9]));
  }

  /** Encodes the carried band of `rows` rows (≤ 8; the last row repeats below), block by block across. */
  private band(rows: number): void {
    const W = this.o.width;
    const y0 = this.y;
    // 8-bit YCbCr of the band, 8 rows × W, with the dither keyed on the frame position
    const n = W * 8;
    const Y = new Float64Array(n), Cb = new Float64Array(n), Cr = new Float64Array(n);
    for (let r = 0; r < 8; r++) {
      const sr = Math.min(r, rows - 1);
      for (let x = 0; x < W; x++) {
        const s = (sr * W + x) * 3, yy = y0 + sr;
        const R = ditherTo8(this.carry[s]!, x, yy, 0), G = ditherTo8(this.carry[s + 1]!, x, yy, 1), B = ditherTo8(this.carry[s + 2]!, x, yy, 2);
        const i = r * W + x;
        Y[i] = 0.299 * R + 0.587 * G + 0.114 * B - 128;
        Cb[i] = -0.168735892 * R - 0.331264108 * G + 0.5 * B;
        Cr[i] = 0.5 * R - 0.418687589 * G - 0.081312411 * B;
      }
    }
    for (let bx = 0; bx < W; bx += 8) {
      this.block(Y, bx, 0, this.qY, this.dcY, this.acY);
      this.block(Cb, bx, 1, this.qC, this.dcC, this.acC);
      this.block(Cr, bx, 2, this.qC, this.dcC, this.acC);
    }
    this.y += rows;
    this.carryRows = 0;
  }

  /** One 8 × 8 block of plane p at column bx (the last column repeats to the right): DCT, quantise, Huffman. */
  private block(plane: Float64Array, bx: number, comp: number, q: Float64Array, dc: Huff, ac: Huff): void {
    const W = this.o.width;
    const d = this.blk;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) d[r * 8 + c] = plane[r * W + Math.min(bx + c, W - 1)]!;
    fdct8x8(d);
    const z = this.coef;
    for (let k = 0; k < 64; k++) {
      const i = ZIGZAG[k]!;
      z[k] = Math.round(d[i]! * q[i]!);
    }
    const bw = this.bw;
    // DC: the difference to the previous block's of this component
    const diff = z[0]! - this.prev[comp]!;
    this.prev[comp] = z[0]!;
    const sd = category(diff);
    bw.put(dc.code[sd]!, dc.size[sd]!);
    if (sd) bw.put(diff < 0 ? diff - 1 : diff, sd);
    // AC: runs of zeros, ZRL for 16, EOB after the last non-zero coefficient
    let last = 63;
    while (last > 0 && z[last] === 0) last--;
    let run = 0;
    for (let k = 1; k <= last; k++) {
      const v = z[k]!;
      if (v === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        bw.put(ac.code[0xf0]!, ac.size[0xf0]!);
        run -= 16;
      }
      const s = category(v);
      const sym = (run << 4) | s;
      bw.put(ac.code[sym]!, ac.size[sym]!);
      bw.put(v < 0 ? v - 1 : v, s);
      run = 0;
    }
    if (last < 63) bw.put(ac.code[0]!, ac.size[0]!);
  }
}
