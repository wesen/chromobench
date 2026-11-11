// Messages between the UI thread and the LibRaw worker (guide §5.4). The caller transfers the file's
// ArrayBuffer; the worker hashes, decodes and transfers the planes back.
import type { Diagnostic, DecodeOptions } from '@chromobench/contract';
import type { RawImage } from '../decode/types.ts';

export type RawJob =
  | { id: number; kind: 'config'; wasmUrl: string; bytes?: undefined }
  | { id: number; kind: 'probe'; bytes: ArrayBuffer }
  | { id: number; kind: 'decode'; bytes: ArrayBuffer; options: Partial<DecodeOptions> };

export interface RawInfo {
  /** LibRaw.version() */
  libraw: string;
  rawSize: [number, number];
  visible: { x: number; y: number; w: number; h: number };
  cfa: { kind: 'bayer' | 'xtrans' | 'none'; period: 1 | 2 | 6; map: number[] };
  /** Per channel R, G, B (and the second G) in native units, black + cblack (pattern mean). */
  black: number[];
  /** The cblack pattern (rows × cols, values), when the file has one. */
  blackPattern?: { rows: number; cols: number; values: number[] };
  white: number;
  linearMax?: number[];
  camXyz?: number[][];
  camMul?: number[];
  preMul?: number[];
  flip: number;
  camera: { make: string; model: string; iso: number; exposure_s: number; fnumber: number };
}

/** A RawImage with its planes as transferable buffers. */
export interface WireRawImage extends Omit<RawImage, 'planes'> {
  planes: { type: 'u8' | 'u16' | 'u32' | 'f32'; buffer: ArrayBuffer }[];
}

export type RawReply =
  | { id: number; ok: true; sha256: string; info?: RawInfo; image?: WireRawImage }
  | { id: number; ok: false; sha256?: string; error: Diagnostic };

/** The part of Worker / MessagePort / worker_threads.parentPort the protocol needs. */
export interface Port {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  addEventListener?(type: 'message' | 'error', fn: (e: { data?: unknown; message?: string }) => void): void;
  on?(type: 'message', fn: (data: unknown) => void): void;
  start?(): void;
}

export function onMessage(port: Port, fn: (data: unknown) => void): void {
  if (port.addEventListener) {
    port.addEventListener('message', (e) => fn(e.data));
    port.start?.();
  } else if (port.on) port.on('message', fn);
  else throw new Error('port has neither addEventListener nor on');
}

export function toWire(img: RawImage): { wire: WireRawImage; transfer: ArrayBuffer[] } {
  const planes = img.planes.map((p) => ({
    type: (p instanceof Uint8Array ? 'u8' : p instanceof Uint16Array ? 'u16' : p instanceof Uint32Array ? 'u32' : 'f32') as 'u8' | 'u16' | 'u32' | 'f32',
    buffer: p.buffer.byteLength === p.byteLength ? (p.buffer as ArrayBuffer) : (p.slice().buffer as ArrayBuffer),
  }));
  const meta = { ...img.meta };
  const transfer = planes.map((p) => p.buffer);
  if (meta.clipped) transfer.push(meta.clipped.buffer as ArrayBuffer);
  return { wire: { ...img, meta, planes }, transfer };
}

export function fromWire(w: WireRawImage): RawImage {
  const planes = w.planes.map((p) => (p.type === 'u8' ? new Uint8Array(p.buffer) : p.type === 'u16' ? new Uint16Array(p.buffer) : p.type === 'u32' ? new Uint32Array(p.buffer) : new Float32Array(p.buffer)));
  return { ...w, planes };
}
