// safetensors reader (github.com/huggingface/safetensors): 8-byte little-endian header length, a JSON
// header {name: {dtype, shape, data_offsets}, __metadata__: {string: string}}, then raw little-endian
// bytes. Typed arrays are views when the data is aligned, copies otherwise (guide §7.2).
import { fail } from '@chromobench/contract';

export type DType = 'F64' | 'F32' | 'F16';
export interface Tensor {
  dtype: DType;
  shape: number[];
  /** F64 → Float64Array, F32 → Float32Array, F16 → Uint16Array of raw half-float bits. */
  data: Float64Array | Float32Array | Uint16Array;
}
export interface SafeTensors {
  metadata: Record<string, string>;
  tensors: Map<string, Tensor>;
  /** Byte offset of the data section (8 + header length); 8-byte aligned in packs we write. */
  dataStart: number;
}

const SIZE: Record<DType, number> = { F64: 8, F32: 4, F16: 2 };

export function parseSafetensors(bytes: Uint8Array, where = 'safetensors'): SafeTensors {
  if (bytes.length < 8) fail('E_DATA_SCHEMA', `${where}: shorter than a safetensors header`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = Number(dv.getBigUint64(0, true));
  if (n > bytes.length - 8) fail('E_DATA_SCHEMA', `${where}: header length ${n} exceeds file`);
  let header: Record<string, any>;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + n)));
  } catch (e) {
    return fail('E_DATA_SCHEMA', `${where}: header is not JSON (${(e as Error).message})`);
  }
  const dataStart = 8 + n;
  const tensors = new Map<string, Tensor>();
  for (const [name, h] of Object.entries(header)) {
    if (name === '__metadata__') continue;
    const dtype = h?.dtype as DType;
    if (!(dtype in SIZE)) fail('E_DATA_SCHEMA', `${where}: tensor ${name} has unsupported dtype ${String(h?.dtype)}`);
    const shape = h.shape as number[];
    const [a, b] = h.data_offsets as [number, number];
    const count = shape.reduce((p, s) => p * s, 1);
    if (b - a !== count * SIZE[dtype] || dataStart + b > bytes.length) fail('E_DATA_SCHEMA', `${where}: tensor ${name} offsets do not match its shape`);
    const off = bytes.byteOffset + dataStart + a;
    let data: Tensor['data'];
    const Ctor = dtype === 'F64' ? Float64Array : dtype === 'F32' ? Float32Array : Uint16Array;
    if (off % SIZE[dtype] === 0) data = new Ctor(bytes.buffer as ArrayBuffer, off, count);
    else data = new Ctor(bytes.slice(dataStart + a, dataStart + b).buffer);
    tensors.set(name, { dtype, shape, data });
  }
  return { metadata: (header['__metadata__'] ?? {}) as Record<string, string>, tensors, dataStart };
}

/** Column k of a row-major [rows, cols] F64 tensor, copied. */
export function column(t: Tensor, k: number): Float64Array {
  const [rows, cols] = t.shape as [number, number];
  const out = new Float64Array(rows);
  for (let i = 0; i < rows; i++) out[i] = t.data[i * cols + k]!;
  return out;
}

/** IEEE half-float bits → number (for the F16 hanatos table). */
export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}
