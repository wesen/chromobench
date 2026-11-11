// Table-driven CRC-32 (polynomial 0xEDB88320), ported from Chromogen export.js (05-inline.js 3231–3244).
// One lookup per byte: 15 ms for 6.6 MB against 248 ms bit by bit (textbook §4.1).

export const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Running CRC register (start with 0xFFFFFFFF, finish with crcFinish). */
export function crcUpdate(u8: Uint8Array, crc = 0xffffffff): number {
  let c = crc;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]!) & 255]! ^ (c >>> 8);
  return c >>> 0;
}

export const crcFinish = (crc: number): number => (crc ^ 0xffffffff) >>> 0;

/** CRC-32 of a byte array: crc32('123456789') = 0xCBF43926. */
export const crc32 = (u8: Uint8Array): number => crcFinish(crcUpdate(u8));
