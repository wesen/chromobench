// The golden pictures' storage format and the check (CHB-037 P0; tools/goldens/README.md). Data lives in
// packages/conformance/goldens/: index.json lists the fixtures and the cases; each case has its recipe and, per
// cut, a JSON header and the pixels as little-endian float32 (interleaved, row-major, top row first).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChromobenchError, sha256Hex, type FrameRecipe } from '@chromobench/contract';
import { CUTS, makeGoldenEngine, type Cut, type FixtureRef, type GoldenEngine, type Rendered } from './engine.ts';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** The data directory, relative to the repository root. */
export const DATA = 'packages/conformance/goldens';
export const FORMAT = 'chromobench-goldens/1';
/**
 * The check's tolerance: the largest absolute difference allowed in any sample, per cut. Today's renderer
 * reproduces the stored float32 exactly (0); the margin covers libm differences across Node versions.
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
  /** Features this case exercises (recipe fields, exposure kinds, mask ops). */
  exercises: string[];
  fixture: string;
  /** Relative to the data directory. */
  recipe: string;
  /** Header per cut, relative to the data directory. */
  cuts: Record<Cut, string>;
  /** The compiled chain's ops (graph closure of the display node, inputs first). */
  ops: string[];
}

export interface SkippedCase {
  id: string;
  title: string;
  exercises: string[];
  fixture: string;
  recipe: string;
  reason: string;
  /** Ops of the compiled chain the reference engine does not implement. */
  missing: string[];
}

export interface GoldenIndex {
  format: typeof FORMAT;
  about: string;
  engine: { id: string; adapter: string; conventions: string; mode: 'exact'; wrapper: string };
  cuts: Record<Cut, string>;
  tolerance: { maxAbs: number; note: string };
  fixtures: Record<string, FixtureRef & { title: string }>;
  cases: IndexCase[];
  skipped: SkippedCase[];
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

/** Ops of a recipe's compiled chain the engine does not implement. */
export function missingOps(ge: GoldenEngine, r: FrameRecipe): string[] {
  const caps = new Set(ge.engine.capabilities().ops);
  const ops = ge.ops(r);
  return [...new Set(ops.filter((o) => !caps.has(o)))];
}

export interface CheckReport { cases: CaseCheck[]; skipped: { id: string; stillMissing: boolean; missing: string[] }[]; ok: boolean; tol: number }

/** Re-renders every stored recipe and compares it with the stored pictures. */
export async function checkAll(o: { tol?: number; only?: (id: string) => boolean } = {}): Promise<CheckReport> {
  const tol = o.tol ?? TOLERANCE;
  const index = readIndex();
  const ge = await openAll(index);
  const cases: CaseCheck[] = [];
  for (const c of index.cases) {
    if (o.only && !o.only(c.id)) continue;
    const r = readJSON<FrameRecipe>(c.recipe);
    let cuts: CutError[];
    try {
      const out = await ge.render(r);
      cuts = CUTS.map((cut) => compareCut(readJSON<CutHeader>(c.cuts[cut]), out.cuts.find((x) => x.cut === cut)!, tol));
    } catch (e) {
      const why = e instanceof ChromobenchError ? `${e.diag.code}: ${e.diag.message}` : String(e);
      cuts = CUTS.map((cut) => ({ cut, maxAbs: Infinity, meanAbs: Infinity, ok: false, why }));
    }
    cases.push({ id: c.id, ok: cuts.every((x) => x.ok), cuts });
  }
  // a skipped case that renders now should become a golden: report it (not a failure)
  const skipped = index.skipped.filter((s) => !o.only || o.only(s.id)).map((s) => {
    const missing = missingOps(ge, readJSON<FrameRecipe>(s.recipe));
    return { id: s.id, stillMissing: missing.length > 0, missing };
  });
  return { cases, skipped, ok: cases.every((c) => c.ok), tol };
}

export const fileExists = (rel: string): boolean => existsSync(dataPath(rel));
export const bytesSha = (b: Uint8Array): string => sha256Hex(b);
