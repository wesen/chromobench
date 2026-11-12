// CHB-012 stage 5: the RAW photo path end to end through the reference engine, and the graph-level
// composition laws (guide §5.6, §8.2). A synthetic RAW: scene XYZ of a chart × a known camera matrix.
import { compile, defaultRecipe, Graph, sha256Hex, type FrameRecipe, type SourceInfo } from '@chromobench/contract';
import { describe, expect, it } from 'vitest';
import { interimData, inv3, mulMV, PhysicsEnv, rawOfLinearSRGB, RefEngine, SPEKTRAFILM, SRGB_TO_XYZ, type FilmModel, type Mat3 } from './film-helpers.ts';

/** Linear sRGB (G = 0.184) whose raw is neutral through the film: 2-D Newton on log(R/G), log(B/G). */
function neutralRGB(film: FilmModel): number[] {
  let p = [0, 0];
  const res = (q: number[]): number[] => {
    const r = rawOfLinearSRGB(film, [0.184 * Math.exp(q[0]!), 0.184, 0.184 * Math.exp(q[1]!)]);
    return [Math.log(r[0]! / r[1]!), Math.log(r[2]! / r[1]!)];
  };
  for (let it = 0; it < 30; it++) {
    const r0 = res(p);
    if (Math.hypot(r0[0]!, r0[1]!) < 1e-12) break;
    const h = 1e-6;
    const a = res([p[0]! + h, p[1]!]), b = res([p[0]!, p[1]! + h]);
    const J = [[(a[0]! - r0[0]!) / h, (b[0]! - r0[0]!) / h], [(a[1]! - r0[1]!) / h, (b[1]! - r0[1]!) / h]];
    const det = J[0]![0]! * J[1]![1]! - J[0]![1]! * J[1]![0]!;
    p = [p[0]! - (J[1]![1]! * r0[0]! - J[0]![1]! * r0[1]!) / det, p[1]! - (-J[1]![0]! * r0[0]! + J[0]![0]! * r0[1]!) / det];
  }
  return [0.184 * Math.exp(p[0]!), 0.184, 0.184 * Math.exp(p[1]!)];
}

/** A camera-like matrix (camera RGB → XYZ), white (1, 1, 1) → D65-ish. */
const CAM_TO_XYZ: Mat3 = [[0.62, 0.22, 0.11], [0.27, 0.88, -0.15], [0.03, -0.12, 1.18]];
/** Patches in linear sRGB: a grey ramp, then colours. */
const PATCHES: number[][] = [
  [0.03, 0.03, 0.03], [0.09, 0.09, 0.09], [0.184, 0.184, 0.184], [0.36, 0.36, 0.36], [0.6, 0.6, 0.6], [0.9, 0.9, 0.9],
  [0.5606, 0.0807, 0.1143], [0.1, 0.4, 0.1], [0.08, 0.1, 0.5], [0.7, 0.6, 0.1], [0.4, 0.15, 0.35], [0.1, 0.45, 0.5],
];

function syntheticRaw(w = 48, h = 16): { info: SourceInfo; data: Float64Array } {
  const C = inv3(CAM_TO_XYZ);
  const data = new Float64Array(w * h * 3);
  const cols = 6, rows = 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = PATCHES[Math.floor((y * rows) / h) * cols + Math.floor((x * cols) / w)]!;
    const cam = mulMV(C, mulMV(SRGB_TO_XYZ, p));
    data.set(cam, (y * w + x) * 3);
  }
  const sha = sha256Hex(new Uint8Array(data.buffer.slice(0)));
  const neutral = mulMV(C, mulMV(SRGB_TO_XYZ, [1, 1, 1]));
  const info: SourceInfo = {
    sha256: sha, format: 'raw', width: w, height: h, channels: 3, bits: 16, sample: 'float',
    encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0, 0, 0], white: [1, 1, 1], from: 'default' }, cfa: 'none',
    camera: { make: 'Synthetic', model: 'CHB-012', camToXyz: CAM_TO_XYZ, asShotNeutral: [neutral[0], neutral[1], neutral[2]], from: 'dng' },
    clippedFraction: 0, notes: [],
  };
  return { info, data };
}

async function render(r: FrameRecipe, e: RefEngine): Promise<{ data: Float64Array; w: number; h: number }> {
  // the display node (output.frame, orientation and crop, is CHB-022's and not in the reference engine yet)
  const node = compile(r, e.graph);
  const res = await e.evaluate(node.op === 'output.frame' ? e.graph.get(node.inputs[0]!)! : node, { scale: 'full', precision: 'export' });
  return { data: await res.read() as Float64Array, w: res.width, h: res.height };
}

const patchMean = (img: { data: Float64Array; w: number; h: number }, i: number): number[] => {
  const cols = 6, rows = 2;
  const cx = Math.floor(((i % cols) + 0.5) * (img.w / cols)), cy = Math.floor((Math.floor(i / cols) + 0.5) * (img.h / rows));
  const acc = [0, 0, 0];
  let n = 0;
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) { for (let k = 0; k < 3; k++) acc[k]! += img.data[(y * img.w + x) * 3 + k]!; n++; }
  return acc.map((v) => v / n);
};

describe('stage 5: a synthetic RAW renders end to end to a print', () => {
  it('digital-raw recipe → display: finite, in range, a monotone and nearly neutral grey ramp', async () => {
    const e = new RefEngine();
    const { info, data } = syntheticRaw();
    e.openDecoded(info, data);
    const r = defaultRecipe('digital-raw', { sha256: info.sha256, name: 'synthetic.dng' });
    r.capture!.whiteBalance.mode = 'as-shot';
    const img = await render(r, e);
    for (const v of img.data) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    const greys = [0, 1, 2, 3, 4, 5].map((i) => patchMean(img, i));
    for (let i = 1; i < greys.length; i++) expect(greys[i]![1]!).toBeGreaterThan(greys[i - 1]![1]!);
    // the print's grey card lands near middle grey and near neutral (grain and the film's own balance aside)
    const g = greys[2]!;
    expect(Math.max(...g) - Math.min(...g)).toBeLessThan(0.08);
    // moderate red stays red
    const red = patchMean(img, 6);
    expect(red[0]!).toBeGreaterThan(red[1]! + 0.15);
  });
  it('the film stages are visible as nodes and each changes the image', async () => {
    const e = new RefEngine();
    const { info, data } = syntheticRaw();
    e.openDecoded(info, data);
    const r = defaultRecipe('digital-raw', { sha256: info.sha256 });
    const g = e.graph;
    compile(r, g);
    const ops = [...new Set(g.closure(compile(r, g).id).map((d) => d.op))];
    for (const op of ['source.xyz', 'capture.expose', 'film.couple', 'film.halation', 'film.develop', 'film.grain']) expect(ops).toContain(op);
    // exposure +1 EV brightens the print
    const a = await render(r, e);
    const r2 = structuredClone(r);
    r2.capture!.exposureEV = 1;
    const b = await render(r2, e);
    expect(patchMean(b, 2)[1]!).toBeGreaterThan(patchMean(a, 2)[1]! + 0.02);
  });
});

describe('stage 5: graph-level composition laws', () => {
  /** A ramp of log exposures as scene XYZ of a neutral: build source → xyz → expose and the film ops by hand. */
  function chain(g: Graph, sha: string, opts: { couple?: boolean; curves?: 'datasheet' | 'precorrected'; amount?: number }) {
    let n = g.intern('source.open', [], { source: sha, encoding: 'linear' }).node.id;
    n = g.intern('source.xyz', [n], { mode: 'daylight', temperature_K: 5500, tint: 0 }).node.id;
    n = g.intern('capture.expose', [n], { stock: 'kodak_portra_400', exposureEV: 0 }).node.id;
    if (opts.couple) n = g.intern('film.couple', [n], { amount: opts.amount ?? 1, diffusion_um: 0 }).node.id;
    return g.intern('film.develop', [n], { push: 0, curves: opts.curves ?? 'datasheet' }).node.id;
  }
  it('neutral reproduction through the engine: couple → develop(precorrected) = develop(datasheet) on greys; the mismatched pair fails', async () => {
    const e = new RefEngine();
    const w = 32, h = 1;
    // linear sRGB whose film exposure is neutral (equal raw in the three layers), scaled along a ramp
    const film = new PhysicsEnv(interimData(), SPEKTRAFILM).film('kodak_portra_400');
    const base = neutralRGB(film);
    const data = new Float64Array(w * 3);
    for (let x = 0; x < w; x++) { const v = 2 ** ((x - 16) / 3); data.set(base.map((c) => c * v), x * 3); }
    const sha = sha256Hex(new Uint8Array(data.buffer.slice(0)));
    e.openDecoded({
      sha256: sha, format: 'tiff', width: w, height: h, channels: 3, bits: 16, sample: 'float', encoding: { value: 'linear', evidence: 'format' },
      levels: { black: [0, 0, 0], white: [1, 1, 1], from: 'default' }, cfa: 'none', clippedFraction: 0, notes: [],
    }, data);
    const read = async (id: string): Promise<Float64Array> => (await (await e.evaluate(e.graph.get(id)!, { scale: 'full', precision: 'export' })).read()) as Float64Array;
    const plain = await read(chain(e.graph, sha, {}));
    const coupled = await read(chain(e.graph, sha, { couple: true, curves: 'precorrected' }));
    const mismatched = await read(chain(e.graph, sha, { couple: true, curves: 'datasheet' }));
    let worst = 0, worstMut = 0;
    for (let i = 0; i < plain.length; i++) { worst = Math.max(worst, Math.abs(coupled[i]! - plain[i]!)); worstMut = Math.max(worstMut, Math.abs(mismatched[i]! - plain[i]!)); }
    expect(worst).toBeLessThan(0.0015);
    expect(worstMut).toBeGreaterThan(0.1);
  });
});
