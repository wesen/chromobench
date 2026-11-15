// The golden pictures' storage format and the check (CHB-037 P0, P2b; tools/goldens/README.md). Data lives in
// packages/conformance/goldens/: index.json lists the fixtures and the cases; each case has its document (format 3),
// the P0 recipe its pictures were first rendered from, and, per cut, a JSON header and the pixels as little-endian
// float32 (interleaved, row-major, top row first).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChromobenchError, sha256Hex, type Document } from '@chromobench/contract';
import { CUTS, makeGoldenEngine, type Cut, type FixtureRef, type GoldenEngine, type Rendered } from './engine.ts';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** The data directory, relative to the repository root. */
export const DATA = 'packages/conformance/goldens';
export const FORMAT = 'chromobench-goldens/2';
/**
 * The check's tolerance: the largest absolute difference allowed in any sample, per cut. The P0 renderer
 * reproduced the stored float32 exactly (0); contract 1.0's light law sums in another order (one log at the end,
 * after the filters), a float32-rounding difference; the margin also covers libm differences across Node versions.
 */
export const TOLERANCE = 1e-5;

export interface CutHeader {
  case: string;
  cut: Cut;
  /** The op whose result this is (view.adapt, output.frame). */
  op: string;
  domain: string;
  width: number;
  height: number;
  channels: number;
  dtype: 'float32';
  endian: 'little';
  layout: 'interleaved, row-major, top row first';
  /** The pixels, relative to the data directory; identical pictures share one file. */
  file: string;
  /** SHA-256 of the float32 bytes. */
  sha256: string;
  stats: { min: number[]; max: number[]; mean: number[] };
  /** Diagnostic codes the engine returned with the result. */
  warnings: string[];
}

export interface IndexCase {
  id: string;
  title: string;
  /** Features this case exercises (P0's recipe fields, exposure kinds, mask ops). */
  exercises: string[];
  fixture: string;
  /** The format-3 document the check compiles, relative to the data directory. */
  document: string;
  /** The P0 recipe (version 2) the document was translated from (translate.ts): provenance, read by nothing else. */
  recipe: string;
  /** Header per cut, relative to the data directory; null until the case is rendered (render.ts --only id). */
  cuts: Record<Cut, string> | null;
  /** The compiled chain's ops (graph closure of the display node, inputs first). */
  ops: string[];
}

export interface GoldenIndex {
  format: typeof FORMAT;
  about: string;
  engine: { id: string; adapter: string; conventions: string; mode: 'exact' };
  cuts: Record<Cut, string>;
  tolerance: { maxAbs: number; note: string };
  fixtures: Record<string, FixtureRef & { title: string }>;
  cases: IndexCase[];
}

export const dataPath = (rel: string): string => join(ROOT, DATA, rel);

export function readIndex(): GoldenIndex {
  return JSON.parse(readFileSync(dataPath('index.json'), 'utf8')) as GoldenIndex;
}

export function readJSON<T>(rel: string): T {
  return JSON.parse(readFileSync(dataPath(rel), 'utf8')) as T;
}

export function writeData(rel: string, data: string | Uint8Array): void {
  const p = dataPath(rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}

/** The stored pixels of a cut. */
export function readPixels(h: CutHeader): Float32Array {
  const b = readFileSync(dataPath(h.file));
  const out = new Float32Array(b.byteLength / 4);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

/** float64 → float32 little-endian bytes. */
export function f32le(data: ArrayLike<number>): Uint8Array {
  const b = new Uint8Array(data.length * 4);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < data.length; i++) dv.setFloat32(i * 4, data[i]!, true);
  return b;
}

export function stats(data: ArrayLike<number>, c: number): CutHeader['stats'] {
  const min = Array<number>(c).fill(Infinity), max = Array<number>(c).fill(-Infinity), sum = Array<number>(c).fill(0);
  const n = data.length / c;
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) {
    const v = data[i * c + k]!;
    if (v < min[k]!) min[k] = v;
    if (v > max[k]!) max[k] = v;
    sum[k]! += v;
  }
  const r = (v: number): number => Number(v.toPrecision(7));
  return { min: min.map(r), max: max.map(r), mean: sum.map((s) => r(s / n)) };
}

export interface CutError { cut: Cut; maxAbs: number; meanAbs: number; ok: boolean; why?: string }
export interface CaseCheck { id: string; ok: boolean; cuts: CutError[] }

/** Compares a fresh render (rounded to float32, as stored) with the stored picture. */
export function compareCut(h: CutHeader, r: Rendered, tol: number): CutError {
  const shape = (['width', 'height', 'channels', 'domain'] as const).filter((k) => h[k] !== r[k]);
  if (shape.length) return { cut: h.cut, maxAbs: Infinity, meanAbs: Infinity, ok: false, why: `${shape.map((k) => `${k} ${String(r[k])} ≠ ${String(h[k])}`).join(', ')}` };
  const want = readPixels(h);
  const got = Float32Array.from(r.data);
  let max = 0, sum = 0;
  for (let i = 0; i < want.length; i++) {
    const d = Math.abs(got[i]! - want[i]!);
    if (!(d <= max)) max = Number.isNaN(d) ? Infinity : d;
    sum += d;
  }
  const mean = sum / want.length;
  return { cut: h.cut, maxAbs: max, meanAbs: mean, ok: max <= tol };
}

/** Opens every fixture of the index in a fresh golden engine. */
export async function openAll(index: Pick<GoldenIndex, 'fixtures'>): Promise<GoldenEngine> {
  const ge = makeGoldenEngine(ROOT);
  for (const f of Object.values(index.fixtures)) await ge.open(f);
  return ge;
}

export interface CheckReport { cases: CaseCheck[]; ok: boolean; tol: number }

/** Re-renders every stored document and compares it with the stored pictures. */
export async function checkAll(o: { tol?: number; only?: (id: string) => boolean } = {}): Promise<CheckReport> {
  const tol = o.tol ?? TOLERANCE;
  const index = readIndex();
  const ge = await openAll(index);
  const cases: CaseCheck[] = [];
  for (const c of index.cases) {
    if (o.only && !o.only(c.id)) continue;
    const doc = readJSON<Document>(c.document);
    let cuts: CutError[];
    try {
      const stored = c.cuts ?? fail(`${c.id} has no pictures yet: render.ts --only ${c.id}`);
      const out = await ge.render(doc);
      cuts = CUTS.map((cut) => compareCut(readJSON<CutHeader>(stored[cut]), out.cuts.find((x) => x.cut === cut)!, tol));
    } catch (e) {
      const why = e instanceof ChromobenchError ? `${e.diag.code}: ${e.diag.message}` : String(e);
      cuts = CUTS.map((cut) => ({ cut, maxAbs: Infinity, meanAbs: Infinity, ok: false, why }));
    }
    cases.push({ id: c.id, ok: cuts.every((x) => x.ok), cuts });
  }
  return { cases, ok: cases.every((c) => c.ok), tol };
}

function fail(msg: string): never {
  throw new Error(msg);
}

export const fileExists = (rel: string): boolean => existsSync(dataPath(rel));
export const bytesSha = (b: Uint8Array): string => sha256Hex(b);
