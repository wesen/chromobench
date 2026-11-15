// Stored (uncompressed) zip for "file plus recipe" bundles, ported unchanged in behaviour from
// Chromogen export.js zip (05-inline.js 3310–3343). No ZIP64: a bundle must stay under 4 GiB.
import { crc32 } from './crc32.ts';

export function zip(entries: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const cen: Uint8Array[] = [];
  let off = 0;
  for (const [name, data] of entries) {
    if (off + data.length > 0xffffffff) throw new RangeError('zip: bundle exceeds 4 GiB (no ZIP64)');
    const nm = enc.encode(name);
    const crc = crc32(data);
    const h = new Uint8Array(30 + nm.length);
    const dv = new DataView(h.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true); // UTF-8 names
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nm.length, true);
    h.set(nm, 30);
    const c = new Uint8Array(46 + nm.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nm.length, true);
    cv.setUint32(42, off, true);
    c.set(nm, 46);
    parts.push(h, data);
    cen.push(c);
    off += h.length + data.length;
  }
  const size = cen.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, off, true);
  const all = [...parts, ...cen, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * Reads a stored (uncompressed) zip such as `zip` writes (CHB-038: problem reports), through its central directory.
 * Entries are views into `bytes`. A compressed entry, a bad CRC or a truncated file throws a RangeError.
 */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new RangeError('unzip: not a zip file (no end of central directory)');
  const count = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) throw new RangeError('unzip: damaged central directory');
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extra = dv.getUint16(p + 30, true);
    const comment = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new RangeError(`unzip: ${name} is compressed (only stored entries are read)`);
    if (dv.getUint32(local, true) !== 0x04034b50) throw new RangeError(`unzip: ${name}: damaged local header`);
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    if (start + size > bytes.length) throw new RangeError(`unzip: ${name} is cut short`);
    const data = bytes.subarray(start, start + size);
    if (crc32(data) !== crc) throw new RangeError(`unzip: ${name}: CRC mismatch`);
    out.set(name, data);
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
