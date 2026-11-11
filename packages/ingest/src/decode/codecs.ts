// Byte codecs for TIFF and PNG: zlib/deflate (fflate, synchronous in Node, browsers and workers),
// TIFF LZW with early change (typed prefix/suffix tables, guide §4.1), PackBits, IEEE half floats,
// and the matching encoders the fixture writers use.
import { unzlibSync, inflateSync, zlibSync } from 'fflate';
import { formatError } from './errors.ts';

/** zlib-wrapped deflate (TIFF 8/32946, PNG IDAT). Falls back to raw deflate for writers that omit the header. */
export function inflate(input: Uint8Array): Uint8Array {
  try {
    return unzlibSync(input);
  } catch {
    try {
      return inflateSync(input);
    } catch (e) {
      return formatError(`corrupt deflate stream (${e instanceof Error ? e.message : String(e)})`);
    }
  }
}

export function deflate(input: Uint8Array): Uint8Array {
  return zlibSync(input, { level: 6 });
}

/** TIFF LZW (MSB-first codes, 9–12 bits, early change). Returns exactly `expected` bytes or fails. */
export function lzwDecode(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    first[i] = i;
    length[i] = 1;
  }
  let op = 0;
  let bitPos = 0;
  let width = 9;
  let next = 258;
  let old = -1;
  const totalBits = input.length * 8;
  const emit = (code: number): void => {
    const n = length[code]!;
    let p = op + n - 1;
    let c = code;
    while (c >= 0) {
      if (p < expected) out[p] = suffix[c]!;
      p--;
      c = prefix[c]!;
    }
    op += n;
  };
  while (bitPos + width <= totalBits && op < expected) {
    let code = 0;
    for (let i = 0; i < width; i++) {
      const b = bitPos + i;
      code = (code << 1) | ((input[b >> 3]! >> (7 - (b & 7))) & 1);
    }
    bitPos += width;
    if (code === 256) {
      next = 258;
      width = 9;
      old = -1;
      continue;
    }
    if (code === 257) break;
    if (old === -1) {
      if (code > 255) formatError(`LZW: first code after clear is ${code}`);
      emit(code);
      old = code;
      continue;
    }
    if (code < next) {
      emit(code);
      if (next < 4096) {
        prefix[next] = old;
        suffix[next] = first[code]!;
        first[next] = first[old]!;
        length[next] = length[old]! + 1;
        next++;
      }
    } else if (code === next && next < 4096) {
      prefix[next] = old;
      suffix[next] = first[old]!;
      first[next] = first[old]!;
      length[next] = length[old]! + 1;
      next++;
      emit(code);
    } else {
      formatError(`LZW: code ${code} beyond table (${next})`);
    }
    old = code;
    if (next >= 2047) width = 12;
    else if (next >= 1023) width = 11;
    else if (next >= 511) width = 10;
  }
  if (op < expected) formatError(`LZW: stream ended after ${op} of ${expected} bytes`);
  return out;
}

/** TIFF LZW encoder (fixtures only). */
export function lzwEncode(input: Uint8Array): Uint8Array {
  const bytes: number[] = [];
  let acc = 0;
  let nacc = 0;
  let width = 9;
  const put = (code: number): void => {
    acc = (acc << width) | code;
    nacc += width;
    while (nacc >= 8) {
      bytes.push((acc >> (nacc - 8)) & 255);
      nacc -= 8;
    }
    acc &= (1 << nacc) - 1;
  };
  let table = new Map<number, number>();
  let next = 258;
  const bump = (): void => {
    next++;
    if (next > (1 << width) - 1 && width < 12) width++;
  };
  put(256);
  if (input.length === 0) {
    put(257);
  } else {
    let w = input[0]!;
    for (let i = 1; i < input.length; i++) {
      const c = input[i]!;
      const key = w * 256 + c;
      const hit = table.get(key);
      if (hit !== undefined) {
        w = hit;
        continue;
      }
      put(w);
      table.set(key, next);
      bump();
      if (next >= 4093) {
        put(256);
        table = new Map();
        next = 258;
        width = 9;
      }
      w = c;
    }
    put(w);
    bump();
    put(257);
  }
  if (nacc > 0) bytes.push((acc << (8 - nacc)) & 255);
  return Uint8Array.from(bytes);
}

export function packbitsDecode(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let ip = 0;
  let op = 0;
  while (ip < input.length && op < expected) {
    const n = (input[ip++]! << 24) >> 24;
    if (n >= 0) {
      for (let i = 0; i <= n && op < expected; i++) out[op++] = input[ip++]!;
    } else if (n !== -128) {
      const b = input[ip++]!;
      for (let i = 0; i < 1 - n && op < expected; i++) out[op++] = b;
    }
  }
  if (op < expected) formatError(`PackBits: stream ended after ${op} of ${expected} bytes`);
  return out;
}

export function packbitsEncode(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    let run = 1;
    while (i + run < input.length && run < 128 && input[i + run] === input[i]) run++;
    if (run >= 3) {
      out.push(257 - run, input[i]!);
      i += run;
      continue;
    }
    const start = i;
    let n = 0;
    while (i < input.length && n < 128) {
      if (i + 2 < input.length && input[i] === input[i + 1] && input[i] === input[i + 2]) break;
      i++;
      n++;
    }
    out.push(n - 1);
    for (let k = start; k < start + n; k++) out.push(input[k]!);
  }
  return Uint8Array.from(out);
}

/** IEEE 754 binary16 → number. */
export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

/** number → IEEE 754 binary16 (round to nearest; fixtures only). */
export function floatToHalf(v: number): number {
  const f32 = new Float32Array([v]);
  const u = new Uint32Array(f32.buffer)[0]!;
  const sign = (u >> 16) & 0x8000;
  const exp = ((u >> 23) & 0xff) - 127 + 15;
  const mant = u & 0x7fffff;
  if (exp <= 0) return sign; // fixtures never need subnormals: flush to zero
  if (exp >= 31) return sign | 0x7c00;
  let h = sign | (exp << 10) | (mant >> 13);
  if (mant & 0x1000) h++;
  return h;
}
