import { describe, expect, it } from 'vitest';
import { isChromobenchError } from '@chromobench/contract';
import { halfToFloat, parseSafetensors } from '../src/index.ts';
import { disk, SF } from './helpers.ts';

function build(tensors: Record<string, { dtype: 'F64' | 'F32'; shape: number[]; values: number[] }>, pad = true): Uint8Array {
  const header: Record<string, unknown> = { __metadata__: { k: 'v' } };
  const blobs: Uint8Array[] = [];
  let off = 0;
  for (const [n, t] of Object.entries(tensors)) {
    const arr = t.dtype === 'F64' ? new Float64Array(t.values) : new Float32Array(t.values);
    const b = new Uint8Array(arr.buffer);
    header[n] = { dtype: t.dtype, shape: t.shape, data_offsets: [off, off + b.length] };
    blobs.push(b);
    off += b.length;
  }
  let h = new TextEncoder().encode(JSON.stringify(header));
  if (pad) {
    const extra = (8 - ((8 + h.length) % 8)) % 8;
    h = new TextEncoder().encode(JSON.stringify(header) + ' '.repeat(extra));
  }
  const out = new Uint8Array(8 + h.length + off);
  new DataView(out.buffer).setBigUint64(0, BigInt(h.length), true);
  out.set(h, 8);
  let p = 8 + h.length;
  for (const b of blobs) { out.set(b, p); p += b.length; }
  return out;
}

describe('safetensors reader', () => {
  it('reads F64 and F32 tensors, NaN included, aligned (view) or not (copy)', () => {
    for (const pad of [true, false]) {
      const st = parseSafetensors(build({ a: { dtype: 'F64', shape: [2, 2], values: [1, NaN, -0, 4] }, b: { dtype: 'F32', shape: [3], values: [0.5, 1.5, 2.5] } }, pad));
      expect(Array.from(st.tensors.get('a')!.data)).toEqual([1, NaN, -0, 4]);
      expect(Array.from(st.tensors.get('b')!.data)).toEqual([0.5, 1.5, 2.5]);
      expect(st.metadata).toEqual({ k: 'v' });
      if (pad) expect(st.dataStart % 8).toBe(0);
    }
  });

  it('packs written by the exporter start their data 8-byte aligned', () => {
    const st = parseSafetensors(disk().readSync!(`${SF}/stocks/kodak_portra_400.safetensors`));
    expect(st.dataStart % 8).toBe(0);
    expect(st.metadata['packId']).toBe(SF);
  });

  it('rejects truncated files and bad offsets with E_DATA_SCHEMA', () => {
    const good = build({ a: { dtype: 'F64', shape: [4], values: [1, 2, 3, 4] } });
    for (const bad of [good.slice(0, 4), good.slice(0, good.length - 8)]) {
      try {
        parseSafetensors(bad);
        expect.unreachable();
      } catch (e) {
        expect(isChromobenchError(e) && e.code).toBe('E_DATA_SCHEMA');
      }
    }
  });

  it('decodes half floats', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x3555)).toBeCloseTo(0.33325, 5);
    expect(halfToFloat(0x0001)).toBe(2 ** -24);
    expect(halfToFloat(0x7c00)).toBe(Infinity);
    expect(Number.isNaN(halfToFloat(0x7e00))).toBe(true);
  });
});
