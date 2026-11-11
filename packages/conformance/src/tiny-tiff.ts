// A tiny uncompressed 16-bit RGB TIFF for engine.open() in the conformance suite (a seeded gradient).
export function writeTiny16(width: number, height: number): Uint8Array {
  const nTags = 10;
  const ifdSize = 2 + nTags * 12 + 4;
  const bpsOff = 8 + ifdSize;
  const dataOff = bpsOff + 6;
  const n = width * height * 3;
  const out = new Uint8Array(dataOff + n * 2);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, nTags, true);
  const tags: [number, number, number, number][] = [[256, 3, 1, width], [257, 3, 1, height], [258, 3, 3, bpsOff], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, dataOff], [277, 3, 1, 3], [278, 3, 1, height], [279, 4, 1, n * 2], [284, 3, 1, 1]];
  tags.forEach(([tag, type, count, val], i) => {
    const e = 10 + i * 12;
    dv.setUint16(e, tag, true);
    dv.setUint16(e + 2, type, true);
    dv.setUint32(e + 4, count, true);
    if (type === 3 && count === 1) dv.setUint16(e + 8, val, true);
    else dv.setUint32(e + 8, val, true);
  });
  for (let i = 0; i < 3; i++) dv.setUint16(bpsOff + 2 * i, 16, true);
  for (let i = 0; i < n; i++) dv.setUint16(dataOff + 2 * i, 2000 + ((i * 7919) % 60000), true);
  return out;
}
