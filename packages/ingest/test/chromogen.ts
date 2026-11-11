// Loads Chromogen's decode.js and source.js (05-inline.js 2195–2677) from the CHB-001 extraction, so
// tests can compare against the prototype in Node (guide §8.1 "Chromogen parity").
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const C1 = `${ROOT}ttmp/2026/11/11/${readdirSync(`${ROOT}ttmp/2026/11/11`).find((d) => d.startsWith('CHB-001--'))!}`;
export const GOLD200 = `${C1}/sources/chromogen-studio-1.2/samples/gold200.png`;

export interface ChromogenImg { w: number; h: number; data: Float32Array; bits?: number; encodedHint?: string; kind?: string }
export interface ChromogenSource {
  region(s: object, box: number[], tw: number, th: number): Float32Array;
  rebate(s: object): number[];
  noise(s: object, Treb: number[], scale: number, img: { data: Float32Array; w: number; h: number }): { sig: number[]; from: string };
  crop(s: object): number[];
}
export interface Chromogen {
  decodeTIFF(buf: ArrayBuffer): Promise<ChromogenImg>;
  decodePNG(buf: ArrayBuffer): Promise<ChromogenImg>;
  sigmaD(data: Float32Array, w: number, h: number, Treb: number[], keep?: ((i: number) => boolean) | null, R?: number): number[] | null;
  flatGrid(flat: ChromogenImg, transfer: (v: number) => number, long?: number): { gw: number; gh: number; data: Float32Array; falloff: number[] };
  Source: new (img: ChromogenImg, meta?: object) => ChromogenSource;
  FLATS: Map<string, ChromogenImg>;
}

let cached: Chromogen | null = null;
export function loadChromogen(): Chromogen {
  if (cached) return cached;
  const lines = readFileSync(`${C1}/various/extracted/chromogen-studio/05-inline.js`, 'utf8').split('\n');
  const body = lines.slice(2194, 2678).join('\n');
  const helpers = 'var __publicField = (o, k, v) => (Object.defineProperty(o, k, { value: v, writable: true, configurable: true, enumerable: true }), v);\n';
  cached = new Function(`${helpers}${body}\nreturn { decodeTIFF, decodePNG, sigmaD, flatGrid, Source, FLATS };`)() as Chromogen;
  return cached;
}

/** Chromogen's loadSample on the PNG: T = max(0.05, u/16 − 2)/4000, as Float32. */
export async function chromogenGold200(): Promise<ChromogenImg> {
  const C = loadChromogen();
  const buf = readFileSync(GOLD200);
  const img = await C.decodePNG(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const data = new Float32Array(img.data.length);
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0.05, Math.round(img.data[i]! * 65535) / 16 - 2) / 4e3;
  return { w: img.w, h: img.h, data, bits: 16, encodedHint: 'linear', kind: 'sample' };
}

/** The Studio's settings for the sample (05-inline.js 3916). */
export const GOLD_SETTINGS = { encoding: 'linear', flipH: true, flipV: false, rotate: 0, crop: [126, 60, 1090, 754], rebate: { box: [98, 100, 20, 680] }, format: '135' };
