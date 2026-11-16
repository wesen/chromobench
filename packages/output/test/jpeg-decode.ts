// A small baseline JPEG decoder for the tests (CHB-047): sequential DCT, Huffman, 8-bit, components sampled 1 × 1
// (what JpegWriter writes), restart markers not supported. Written from T.81 independently of the encoder: it reads
// the tables from the file and inverts with a plain separable IDCT, so a round trip checks the encoder's file and not
// its own arithmetic. Also returns the segments a reader sees (APP0, the ICC profile reassembled, comments).

export interface DecodedJpeg {
  width: number;
  height: number;
  /** Interleaved 8-bit RGB. */
  rgb: Uint8Array;
  /** JFIF density (units 1: dots per inch). */
  jfif: { units: number; x: number; y: number } | null;
  icc: Uint8Array | null;
  comments: string[];
  /** Quantisation tables as stored (zig-zag order), by id. */
  dqt: Record<number, number[]>;
  /** SOF0 component sampling factors (h << 4 | v), in order. */
  sampling: number[];
}

const ZZ = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

interface Table { lookup: Map<string, number> }

function table(bits: number[], vals: number[]): Table {
  const lookup = new Map<string, number>();
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]!; i++) lookup.set(`${len}:${code++}`, vals[k++]!);
    code <<= 1;
  }
  return { lookup };
}

export function decodeJpeg(b: Uint8Array): DecodedJpeg {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('not a JPEG (no SOI)');
  let p = 2;
  const dqt: Record<number, number[]> = {};
  const dc: Record<number, Table> = {}, ac: Record<number, Table> = {};
  const iccParts: Uint8Array[] = [];
  const comments: string[] = [];
  let jfif: DecodedJpeg['jfif'] = null;
  let W = 0, H = 0;
  let comps: { id: number; samp: number; tq: number; td: number; ta: number }[] = [];
  for (;;) {
    if (b[p] !== 0xff) throw new Error(`marker expected at ${p}`);
    const m = b[p + 1]!;
    const len = (b[p + 2]! << 8) | b[p + 3]!;
    const body = b.subarray(p + 4, p + 2 + len);
    p += 2 + len;
    if (m === 0xe0 && String.fromCharCode(...body.subarray(0, 4)) === 'JFIF') jfif = { units: body[7]!, x: (body[8]! << 8) | body[9]!, y: (body[10]! << 8) | body[11]! };
    else if (m === 0xe2 && String.fromCharCode(...body.subarray(0, 11)) === 'ICC_PROFILE') iccParts[body[12]! - 1] = body.subarray(14);
    else if (m === 0xfe) comments.push(new TextDecoder().decode(body));
    else if (m === 0xdb) {
      for (let i = 0; i < body.length; i += 65) dqt[body[i]! & 15] = Array.from(body.subarray(i + 1, i + 65));
    } else if (m === 0xc0) {
      H = (body[1]! << 8) | body[2]!;
      W = (body[3]! << 8) | body[4]!;
      comps = [];
      for (let i = 0; i < body[5]!; i++) comps.push({ id: body[6 + 3 * i]!, samp: body[7 + 3 * i]!, tq: body[8 + 3 * i]!, td: 0, ta: 0 });
    } else if (m === 0xc4) {
      let i = 0;
      while (i < body.length) {
        const tc = body[i]! >> 4, th = body[i]! & 15;
        const bits = Array.from(body.subarray(i + 1, i + 17));
        const n = bits.reduce((a, x) => a + x, 0);
        const t = table(bits, Array.from(body.subarray(i + 17, i + 17 + n)));
        (tc === 0 ? dc : ac)[th] = t;
        i += 17 + n;
      }
    } else if (m === 0xda) {
      for (let i = 0; i < body[0]!; i++) {
        const c = comps.find((x) => x.id === body[1 + 2 * i])!;
        c.td = body[2 + 2 * i]! >> 4;
        c.ta = body[2 + 2 * i]! & 15;
      }
      break;
    } else if (m >= 0xc1 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) throw new Error(`unsupported SOF 0x${m.toString(16)}`);
  }
  // entropy-coded data
  let bit = 0, cur = 0;
  const next = (): number => {
    if (bit === 0) {
      cur = b[p++]!;
      if (cur === 0xff) {
        const s = b[p++]!;
        if (s !== 0) throw new Error(`marker 0xff${s.toString(16)} in the scan`);
      }
      bit = 8;
    }
    bit--;
    return (cur >> bit) & 1;
  };
  const receive = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | next();
    return v;
  };
  const extend = (v: number, n: number): number => (n === 0 ? 0 : v < 1 << (n - 1) ? v - (1 << n) + 1 : v);
  const huff = (t: Table): number => {
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | next();
      const v = t.lookup.get(`${len}:${code}`);
      if (v !== undefined) return v;
    }
    throw new Error('bad Huffman code');
  };
  const cos = Array.from({ length: 64 }, (_, i) => {
    const x = i >> 3, u = i & 7;
    return (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  });
  const planes = comps.map(() => new Float64Array(Math.ceil(W / 8) * 8 * Math.ceil(H / 8) * 8));
  const PW = Math.ceil(W / 8) * 8;
  const prev = comps.map(() => 0);
  const coef = new Float64Array(64), tmp = new Float64Array(64);
  for (let by = 0; by < Math.ceil(H / 8); by++) {
    for (let bx = 0; bx < Math.ceil(W / 8); bx++) {
      comps.forEach((c, ci) => {
        coef.fill(0);
        const q = dqt[c.tq]!;
        const s = huff(dc[c.td]!);
        prev[ci] = prev[ci]! + extend(receive(s), s);
        coef[0] = prev[ci]! * q[0]!;
        for (let k = 1; k < 64;) {
          const rs = huff(ac[c.ta]!);
          const r = rs >> 4, sz = rs & 15;
          if (sz === 0) {
            if (r === 15) { k += 16; continue; }
            break;
          }
          k += r;
          coef[ZZ[k]!] = extend(receive(sz), sz) * q[k]!;
          k++;
        }
        // IDCT: f(x, y) = ¼ Σ C(u) C(v) F(u, v) cos … cos …
        for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) {
          let a = 0;
          for (let v = 0; v < 8; v++) a += cos[y * 8 + v]! * coef[v * 8 + u]!;
          tmp[y * 8 + u] = a;
        }
        const pl = planes[ci]!;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          let a = 0;
          for (let u = 0; u < 8; u++) a += cos[x * 8 + u]! * tmp[y * 8 + u]!;
          pl[(by * 8 + y) * PW + bx * 8 + x] = a / 4;
        }
      });
    }
  }
  const rgb = new Uint8Array(W * H * 3);
  const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * PW + x;
    const Y = planes[0]![i]! + 128, Cb = planes[1]![i]!, Cr = planes[2]![i]!;
    const o = (y * W + x) * 3;
    rgb[o] = clamp(Y + 1.402 * Cr);
    rgb[o + 1] = clamp(Y - 0.344136286 * Cb - 0.714136286 * Cr);
    rgb[o + 2] = clamp(Y + 1.772 * Cb);
  }
  let icc: Uint8Array | null = null;
  if (iccParts.length) {
    const n = iccParts.reduce((a, x) => a + x.length, 0);
    icc = new Uint8Array(n);
    let o = 0;
    for (const x of iccParts) {
      icc.set(x, o);
      o += x.length;
    }
  }
  if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) throw new Error('no EOI at the end');
  return { width: W, height: H, rgb, jfif, icc, comments, dqt, sampling: comps.map((c) => c.samp) };
}
