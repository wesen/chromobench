// Baseline little-endian TIFF writer for 16-bit RGB, ported from Chromogen export.js tiff16
// (05-inline.js 3284–3309) and fixed (guide §4 bug 4, §5.6): XResolution, YResolution and
// ResolutionUnit (TIFF 6.0 baseline), strips instead of one, Adobe Deflate (8) with the horizontal
// predictor (317 = 2), the ICC profile in tag 34675, and explicit little-endian writes via DataView.
//
// Layout. Uncompressed: header, IFD and its values first, then the strips as rows arrive (sizes are
// known). Deflate: a header with a placeholder IFD offset, the strips as they are compressed, then the
// IFD at the end, and the IFD offset patched at bytes 4–7 (needs sink.writeAt).
import { deflateAll } from './deflate.ts';
import type { ByteSink } from './sinks.ts';

export interface TiffOptions {
  width: number;
  height: number;
  compression: 'none' | 'deflate';
  /** Rows per strip (default 64). */
  rowsPerStrip?: number;
  /** XResolution/YResolution in pixels per inch (default 300). */
  dpi?: number;
  /** ICC profile embedded as tag 34675 (InterColorProfile). */
  icc?: Uint8Array;
  software?: string;
  /** DateTime (306); default now. */
  dateTime?: Date;
  /** ImageDescription (270), e.g. the recipe JSON. */
  description?: string;
}

const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const ASCII = 2;
const UNDEFINED = 7;
const TYPE_SIZE: Record<number, number> = { [ASCII]: 1, [SHORT]: 2, [LONG]: 4, [RATIONAL]: 8, [UNDEFINED]: 1 };

interface Tag { tag: number; type: number; values: number[] | Uint8Array }

const ascii = (s: string): Uint8Array => {
  const b = new TextEncoder().encode(s);
  const out = new Uint8Array(b.length + 1); // NUL-terminated
  out.set(b);
  return out;
};

const pad2 = (n: number): string => String(n).padStart(2, '0');
export const tiffDateTime = (d: Date): string =>
  `${d.getFullYear()}:${pad2(d.getMonth() + 1)}:${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

function tagBytes(t: Tag): number {
  const n = t.values instanceof Uint8Array ? t.values.length : t.values.length;
  return TYPE_SIZE[t.type]! * (t.type === RATIONAL ? n / 2 : n);
}

/** Serialises an IFD at `at` with out-of-line values after it (word aligned). */
function buildIfd(tags: Tag[], at: number): Uint8Array {
  tags.sort((a, b) => a.tag - b.tag); // TIFF requires ascending tag order
  const head = 2 + tags.length * 12 + 4;
  let extra = 0;
  for (const t of tags) {
    const b = tagBytes(t);
    if (b > 4) extra += b + (b & 1);
  }
  const out = new Uint8Array(head + extra);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, tags.length, true);
  let ext = head; // relative offset of the next out-of-line value
  tags.forEach((t, i) => {
    const e = 2 + 12 * i;
    const count = t.type === RATIONAL ? (t.values as number[]).length / 2 : t.values.length;
    dv.setUint16(e, t.tag, true);
    dv.setUint16(e + 2, t.type, true);
    dv.setUint32(e + 4, count, true);
    const b = tagBytes(t);
    const write = (o: number) => {
      if (t.values instanceof Uint8Array) out.set(t.values, o);
      else t.values.forEach((v, k) => {
        if (t.type === SHORT) dv.setUint16(o + 2 * k, v, true);
        else dv.setUint32(o + 4 * k, v, true); // LONG, and RATIONAL as LONG pairs
      });
    };
    if (b <= 4) write(e + 8);
    else {
      dv.setUint32(e + 8, at + ext, true);
      write(ext);
      ext += b + (b & 1);
    }
  });
  dv.setUint32(2 + tags.length * 12, 0, true); // no next IFD
  return out;
}

export class Tiff16Writer {
  private y = 0;
  private readonly rps: number;
  private readonly nStrips: number;
  private readonly offsets: number[] = [];
  private readonly counts: number[] = [];
  private strip: Uint8Array;
  private stripRows = 0;
  private done = false;

  private readonly sink: ByteSink;
  private readonly o: TiffOptions;
  private readonly tagsOf: (offsets: number[], counts: number[]) => Tag[];

  private constructor(sink: ByteSink, o: TiffOptions, tagsOf: (offsets: number[], counts: number[]) => Tag[]) {
    this.sink = sink;
    this.o = o;
    this.tagsOf = tagsOf;
    this.rps = Math.max(1, Math.min(o.rowsPerStrip ?? 64, o.height));
    this.nStrips = Math.ceil(o.height / this.rps);
    this.strip = new Uint8Array(o.compression === 'deflate' ? this.rps * o.width * 6 : 0);
  }

  static async open(sink: ByteSink, o: TiffOptions): Promise<Tiff16Writer> {
    if (!(o.width > 0 && o.height > 0 && Number.isInteger(o.width) && Number.isInteger(o.height))) throw new RangeError(`bad TIFF size ${o.width}×${o.height}`);
    const bytes = o.width * o.height * 6;
    if (bytes > 0xfffffff0) throw new RangeError('TIFF: image exceeds the 4 GiB classic TIFF limit (BigTIFF is not implemented)');
    const deflate = o.compression === 'deflate';
    if (deflate && !sink.writeAt) throw new Error('TIFF with Deflate needs a sink with writeAt (the IFD offset is patched)');
    const dpi = o.dpi ?? 300;
    const rps = Math.max(1, Math.min(o.rowsPerStrip ?? 64, o.height));
    const date = tiffDateTime(o.dateTime ?? new Date());
    const tagsOf = (offsets: number[], counts: number[]): Tag[] => {
      const tags: Tag[] = [
        { tag: 256, type: LONG, values: [o.width] },
        { tag: 257, type: LONG, values: [o.height] },
        { tag: 258, type: SHORT, values: [16, 16, 16] },
        { tag: 259, type: SHORT, values: [deflate ? 8 : 1] },
        { tag: 262, type: SHORT, values: [2] }, // RGB
        { tag: 273, type: LONG, values: offsets },
        { tag: 277, type: SHORT, values: [3] },
        { tag: 278, type: LONG, values: [rps] },
        { tag: 279, type: LONG, values: counts },
        { tag: 282, type: RATIONAL, values: [Math.round(dpi * 1000), 1000] },
        { tag: 283, type: RATIONAL, values: [Math.round(dpi * 1000), 1000] },
        { tag: 284, type: SHORT, values: [1] }, // chunky
        { tag: 296, type: SHORT, values: [2] }, // inch
        { tag: 305, type: ASCII, values: ascii(o.software ?? 'chromobench') },
        { tag: 306, type: ASCII, values: ascii(date) },
        { tag: 339, type: SHORT, values: [1, 1, 1] }, // unsigned integer samples
      ];
      if (o.description) tags.push({ tag: 270, type: ASCII, values: ascii(o.description) });
      if (deflate) tags.push({ tag: 317, type: SHORT, values: [2] }); // horizontal differencing
      if (o.icc) tags.push({ tag: 34675, type: UNDEFINED, values: o.icc });
      return tags;
    };
    const w = new Tiff16Writer(sink, o, tagsOf);
    const header = new Uint8Array(8);
    const hv = new DataView(header.buffer);
    header[0] = 0x49; header[1] = 0x49; // 'II': little-endian
    hv.setUint16(2, 42, true);
    if (deflate) {
      hv.setUint32(4, 0, true); // patched in finish()
      await sink.write(header);
    } else {
      // strip sizes are known: IFD at 8, then values, then the pixel data
      const n = w.nStrips;
      const counts = Array.from({ length: n }, (_, i) => Math.min(rps, o.height - i * rps) * o.width * 6);
      const probe = buildIfd(tagsOf(new Array<number>(n).fill(0), counts), 8);
      let at = 8 + probe.length;
      at += at & 1;
      const offsets = counts.map((c) => { const v = at; at += c; return v; });
      const ifd = buildIfd(tagsOf(offsets, counts), 8);
      hv.setUint32(4, 8, true);
      await sink.write(header);
      await sink.write(ifd);
      if ((8 + ifd.length) & 1) await sink.write(new Uint8Array(1));
      w.offsets.push(...offsets);
      w.counts.push(...counts);
    }
    return w;
  }

  get rowsWritten(): number { return this.y; }

  /** Appends `rows` rows of interleaved RGB 16-bit values. */
  async writeRows(rgb16: Uint16Array, rows: number): Promise<void> {
    const W = this.o.width;
    if (this.done) throw new Error('TIFF: writeRows after finish');
    if (rgb16.length < rows * W * 3) throw new RangeError(`TIFF: ${rows} rows need ${rows * W * 3} samples, got ${rgb16.length}`);
    if (this.y + rows > this.o.height) throw new RangeError(`TIFF: ${this.y + rows} rows exceed the height ${this.o.height}`);
    if (this.o.compression === 'none') {
      // little-endian through DataView, in pieces of ≤ 64 rows
      for (let r0 = 0; r0 < rows; r0 += 64) {
        const n = Math.min(64, rows - r0);
        const out = new Uint8Array(n * W * 6);
        const dv = new DataView(out.buffer);
        const base = r0 * W * 3;
        for (let i = 0; i < n * W * 3; i++) dv.setUint16(2 * i, rgb16[base + i]!, true);
        await this.sink.write(out);
      }
      this.y += rows;
      return;
    }
    const dv = new DataView(this.strip.buffer);
    for (let r = 0; r < rows; r++) {
      const src = r * W * 3;
      const o = this.stripRows * W * 6;
      // horizontal predictor (317 = 2) on 16-bit samples: each sample minus its left neighbour, mod 2^16
      for (let k = 0; k < 3; k++) dv.setUint16(o + 2 * k, rgb16[src + k]!, true);
      for (let i = 3; i < W * 3; i++) dv.setUint16(o + 2 * i, (rgb16[src + i]! - rgb16[src + i - 3]!) & 0xffff, true);
      this.stripRows++;
      this.y++;
      if (this.stripRows === this.rps || this.y === this.o.height) await this.flushStrip();
    }
  }

  private async flushStrip(): Promise<void> {
    const z = await deflateAll(this.strip.subarray(0, this.stripRows * this.o.width * 6));
    this.offsets.push(this.sink.size);
    this.counts.push(z.length);
    await this.sink.write(z);
    this.stripRows = 0;
  }

  /** Writes the IFD (Deflate) and checks the row count. */
  async finish(): Promise<void> {
    if (this.y !== this.o.height) throw new Error(`TIFF: ${this.y} of ${this.o.height} rows written`);
    this.done = true;
    if (this.o.compression === 'none') return;
    if (this.sink.size & 1) await this.sink.write(new Uint8Array(1)); // IFD on a word boundary
    const at = this.sink.size;
    await this.sink.write(buildIfd(this.tagsOf(this.offsets, this.counts), at));
    const p = new Uint8Array(4);
    new DataView(p.buffer).setUint32(0, at, true);
    await this.sink.writeAt!(4, p);
  }
}

/** Minimal TIFF directory reader (checks and tests): tags of the first IFD, in file order. */
export function tiffTags(bytes: Uint8Array): { tag: number; type: number; count: number; value: Uint8Array }[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const le = bytes[0] === 0x49;
  if (dv.getUint16(2, le) !== 42) throw new Error('not a TIFF');
  const ifd = dv.getUint32(4, le);
  const n = dv.getUint16(ifd, le);
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + 12 * i;
    const tag = dv.getUint16(e, le);
    const type = dv.getUint16(e + 2, le);
    const count = dv.getUint32(e + 4, le);
    const size = (TYPE_SIZE[type] ?? 1) * count;
    const off = size <= 4 ? e + 8 : dv.getUint32(e + 8, le);
    out.push({ tag, type, count, value: bytes.subarray(off, off + size) });
  }
  return out;
}
