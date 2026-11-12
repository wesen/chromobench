// The studio's host file (CHB-023; CHB-019 guide §7.1): the one module in apps/studio allowed to
// import @chromobench/core, gpu and ingest (tools/scripts/check-boundaries.ts names it). It builds the
// physics engine — GpuEngine when WebGPU works, else core's RefEngine on a small working image — on
// CHB-004's data packs, decodes scans through packages/ingest (TIFF, PNG, DNG, camera RAW via LibRaw
// in a worker), conditions them on open, and hands the UI a StudioEngine plus a few injected
// functions. Nothing else in the studio sees physics code.
import type { Box, Engine, FrameRecipe, Mutation, SourceInfo, Vec3 } from '@chromobench/contract';
import {
  bakeRecipe, CLASS_CODE, classify, DEFAULT_CONVENTIONS, DEFAULT_SIGMA_D, integrateToGrey, Lights, RefEngine, rebateBox, SCANNER_IDS, scannerForward, type PhysicsData,
} from '@chromobench/core';
import { GpuEngine, loadDefaultPhysicsData } from '@chromobench/gpu';
import {
  classifyImage, conditionScan, decodeAsync, detectSpecks, filmLayout, heal, linearise, rankStocks, RAW_EXTENSIONS, region, rollBase, sigmaD, sourceInfo, spotsMask, workerRawDecoder, type FrameBase, type RawDecoder,
} from '@chromobench/ingest';
import librawWasmUrl from '@colorhythm/libraw-wasm/libraw.wasm?url';
import type { IntegrateToGrey } from './first-print.ts';
import { StudioEngine, type Decoded, type HostServices } from './studio-engine.ts';

export type EngineChoice = 'auto' | 'gpu' | 'reference';

export interface HostOptions {
  want: EngineChoice;
  /** Working image long side for the GPU engine (default 4000; 0 = the file's own size). */
  long?: number;
  /** Working image long side for the reference engine (default 512: it computes every pixel in f64 on the CPU). */
  refLong?: number;
  /** Status callback while the engine starts. */
  onStatus?: (s: string) => void;
}

/** Settings the UI may change; they apply to files opened afterwards. */
export interface HostSettings {
  /** Detect dust specks in scanner density and heal them on open (ingest; off by default, slow on big scans). */
  dust: boolean;
}

/** What the roll kit's physics needs (studio-kit's RollPhysics, structurally): ingest's film layout and roll base, core's integrate-to-grey. */
export type HostRollPhysics = ReturnType<typeof buildRollPhysics>;

export interface HostEngine {
  engine: StudioEngine;
  /** The service `rollPhysics` of the roll kit (CHB-020). */
  rollPhysics: HostRollPhysics;
  /** valuesFrom lists from the data packs (film and paper stocks, scanners, lights). */
  catalog: Record<string, string[]>;
  integrate: IntegrateToGrey;
  /** CHB-010: a recipe's printer lights as filtration and time (core's bakeRecipe), for the first print's `bake` option. */
  bake: (r: FrameRecipe) => Mutation[];
  settings: HostSettings;
  /** File extensions the decoder accepts. */
  extensions: string[];
}

const DEFAULT_LONG = 4000;
const DEFAULT_REF_LONG = 512;

let rawDecoder: RawDecoder | null = null;
/** LibRaw in a module worker, started on the first camera RAW file. */
function libraw(): RawDecoder {
  if (!rawDecoder) {
    const w = new Worker(new URL('../../../../packages/ingest/src/libraw/worker-entry.ts', import.meta.url), { type: 'module' });
    rawDecoder = workerRawDecoder(w as never, { wasmUrl: librawWasmUrl });
  }
  return rawDecoder;
}

const LAZY_LIBRAW: RawDecoder = { name: 'libraw', decode: (b, o) => libraw().decode(b, o) };

const fmt3 = (v: ArrayLike<number>): string => Array.from(v, (x) => x.toFixed(2)).join(' ');

/** Dust in scanner density: detect (ingest detectSpecks), heal (patch), back to transmittance. */
function healDust(rgb: Float32Array, w: number, h: number, Treb: Vec3): number {
  const n = w * h;
  const D = [0, 1, 2].map((k) => {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = -Math.log10(Math.max(rgb[i * 3 + k]!, 1e-6) / Treb[k]!);
    return p;
  });
  const sigma = sigmaD(rgb, w, h, Treb) ?? DEFAULT_SIGMA_D;
  const found = detectSpecks(D, w, h, sigma).spots.filter((s) => s.score >= 0.5);
  if (!found.length) return 0;
  const healed = heal(D, w, h, spotsMask(found, w, h), { marginPx: 1, method: 'patch' }).planes;
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = Treb[k]! * 10 ** -healed[k]![i]!;
  return found.length;
}

/** Decode → linear → area-averaged working image → conditioning. */
async function decodeScan(bytes: Uint8Array, sha256: string, name: string, long: number, settings: HostSettings, roll: Map<string, FrameBase>): Promise<Decoded> {
  // Camera RAW (and CFA DNG) go to LibRaw in scan mode: linear camera RGB, no white balance, CFA-binned.
  const raw = await decodeAsync(bytes, { fileName: name, options: { mode: 'scan', bin: 'cfa' }, raw: LAZY_LIBRAW });
  const lin = linearise(raw, { sha256, ir: false });
  const W = lin.width, H = lin.height;
  const s = long > 0 ? Math.min(1, long / Math.max(W, H)) : 1;
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const data = region(lin, { x: 0, y: 0, w: W, h: H }, w, h, { channels: 3 });
  const cam = raw.meta.camera ? ` (${raw.meta.camera.make} ${raw.meta.camera.model})` : '';
  const notes: string[] = [raw.meta.format === 'raw'
    ? `camera RAW${cam} via LibRaw, scan mode, CFA-binned to ${W}×${H}`
    : `${raw.meta.format.toUpperCase()} ${W}×${H}, ${raw.bits}-bit`];
  if (s < 1) notes.push(`working image ${w}×${h}`);
  // Film layout (CHB-020, contract 0.3): the pixels stay as scanned. The holder's veil goes into the recipe as
  // scan.flare (per channel, percent) and the measured base as scan.baseT, so the engine removes the flare and
  // the preview, the export and the roll analysis all see the same chain; the rebate box (film outside the image
  // frame, never a sprocket hole or the holder) goes into scan.rebate. A frame with no holder gets the veil of
  // the roll opened so far.
  const rollVeil = rollBase([...roll.values()].filter((f) => f.id !== sha256)).veil;
  const c = conditionScan(data, w, h, { id: sha256, rollVeil, subtract: false });
  roll.set(sha256, c.frame);
  const rb: Box = c.rebate ?? rebateBox(w, h, 3, data);
  // the base as scanned (veil still in): the dust healer measures density against it
  const Treb: Vec3 = c.layout.rebate?.Traw ?? ([0, 1, 2].map((k) => {
    let t = 0, m = 0;
    for (let y = rb.y; y < rb.y + rb.h; y++) for (let x = rb.x; x < rb.x + rb.w; x++) { t += data[(y * w + x) * 3 + k]!; m++; }
    return Math.max(t / Math.max(m, 1), 1e-6);
  }) as Vec3);
  if (c.rebate) notes.push(`base ${fmt3((c.baseT ?? Treb).map((t) => -Math.log10(t)))} D (rebate ${rb.w}×${rb.h} at ${rb.x},${rb.y}, ${c.layout.rebate?.from})`);
  else notes.push('no rebate found: the base is the brightest 5 % of columns (scan.density default)');
  if (c.flare) notes.push(`scan.flare ${fmt3(c.flare)} % from the veil ${c.veil!.map((v) => v.toExponential(1)).join(' ')} (${c.veilFrom}), removed by the engine`);
  else notes.push('no veil measured: scan.flare 0');
  for (const n of c.notes) notes.push(`${n.code}: ${n.message}`);
  if (settings.dust) notes.push(`dust: ${healDust(data, w, h, Treb)} specks healed`);
  const info0 = sourceInfo(sha256, raw, lin);
  const info: SourceInfo = {
    ...info0, width: w, height: h, channels: 3,
    notes: [...info0.notes, { code: 'W_DECODE_NOTE', message: notes.join('; ') }],
  };
  return { info, data, full: { width: W, height: H }, notes, rebate: c.rebate, flare: c.flare, baseT: c.scanBaseT };
}

function subBox(rgb: Float32Array, w: number, b: Box): Float32Array {
  const out = new Float32Array(b.w * b.h * 3);
  for (let y = 0; y < b.h; y++) out.set(rgb.subarray(((b.y + y) * w + b.x) * 3, ((b.y + y) * w + b.x + b.w) * 3), y * b.w * 3);
  return out;
}

/** The roll kit's physics (RollPhysics) on this host's data packs; the stock ranking reads the scanner's forward model. */
function buildRollPhysics(data: PhysicsData, stocks: string[]) {
  const fwd = scannerForward(data, 'xt5-rgb-led');
  return {
    layout: (rgb: Float32Array, w: number, h: number) => filmLayout(rgb, w, h),
    rollBase: (frames: FrameBase[]) => rollBase(frames),
    integrateToGrey: (latd: Vec3, aim: { latd: Vec3; lights: Vec3 }, alpha: number): Vec3 =>
      [...integrateToGrey(latd, { latd: aim.latd, lights: Lights.fromLogH(aim.lights) }, alpha).logH] as Vec3,
    // sigma on the rebate box at this size, else on thin film
    noise: (rgb: Float32Array, w: number, h: number, T: Vec3, box: Box | null): Vec3 | null => {
      if (box && box.w >= 2 && box.h >= 2) {
        const s = sigmaD(subBox(rgb, w, box), box.w, box.h, T);
        if (s) return s;
      }
      const thin = (i: number): boolean => [0, 1, 2].every((k) => -Math.log10(Math.max(rgb[3 * i + k]!, 1e-6) / T[k]!) <= 0.08);
      return sigmaD(rgb, w, h, T, thin);
    },
    classes: (rgb: Float32Array, w: number, h: number, T: Vec3, sigma: Vec3) => {
      const s = classifyImage(rgb, w, h, T, sigma).stats;
      return { blank: s.blank, below: s.below, above: s.above };
    },
    // absolute base density needs an open gate; without one no stock is named
    rank: (base: { absD: Vec3 | null }, ids?: string[]) => (base.absD ? rankStocks(base.absD, ids ?? stocks, fwd) : null),
  };
}

function catalogOf(data: PhysicsData): Record<string, string[]> {
  const films: string[] = [];
  const papers: string[] = [];
  for (const id of data.stockIds()) {
    try {
      const s = data.stock(id);
      if (s.role === 'film' && s.type !== 'positive') films.push(id);
      else if (s.role === 'paper') papers.push(id);
    } catch {
      // a stock the pack lists but cannot serve stays out of the menus
    }
  }
  const lights = data.illuminantNames();
  return {
    'stocks:film': films.sort(), 'stocks:print': papers.sort(), scanners: [...SCANNER_IDS],
    illuminants: lights.filter((n) => /^(D\d\d|A|F\d+)$/.test(n)), lamps: lights.filter((n) => /^TH|LED/i.test(n)),
  };
}

/** Builds the studio's physics engine. Throws only when no engine at all can start. */
export async function createHostEngine(o: HostOptions): Promise<HostEngine> {
  const say = o.onStatus ?? (() => undefined);
  say('loading data packs…');
  const data = await loadDefaultPhysicsData();
  const settings: HostSettings = { dust: false };
  const roll = new Map<string, FrameBase>();
  let primary: Engine | null = null;
  let label = '';
  let long = o.long ?? DEFAULT_LONG;
  let why = '';
  if (o.want !== 'reference') {
    say('starting WebGPU…');
    try {
      const g = await GpuEngine.create({ data, cacheLimit: 24 });
      const caps = g.capabilities();
      if (caps.available) {
        primary = g;
        label = `GPU · ${caps.adapter?.name ?? 'WebGPU'}${caps.adapter?.fallback ? ' (software)' : ''}`;
      } else {
        why = caps.why ?? 'WebGPU unavailable';
        g.dispose();
      }
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
    if (!primary && o.want === 'gpu') throw new Error(`WebGPU engine requested but unavailable: ${why}`);
  }
  if (!primary) {
    primary = new RefEngine({ data, cacheLimit: 48 });
    long = o.refLong ?? DEFAULT_REF_LONG;
    label = `reference · CPU f64${why ? ` (no WebGPU: ${why})` : ''}`;
  }
  const host: HostServices = {
    decode: (bytes, sha, name) => decodeScan(bytes, sha, name, long, settings, roll),
    register: (e, info, px) => (e as GpuEngine | RefEngine).openDecoded(info, px),
    classify: (D, sigma, res) => CLASS_CODE[classify(D, sigma, res).cls],
    defaultSigma: DEFAULT_SIGMA_D,
    // Since CHB-011 GpuEngine encodes every output space itself (nativeSpaces stays unset).
  };
  const engine = new StudioEngine(primary, host, `${label} · ${long > 0 ? `${long} px` : 'full size'}`);
  return {
    engine, catalog: catalogOf(data), settings, rollPhysics: buildRollPhysics(data, catalogOf(data)['stocks:film'] ?? []),
    bake: (r) => bakeRecipe(r, data, DEFAULT_CONVENTIONS).mutations,
    integrate: (latd, alpha) => [...integrateToGrey(latd, { latd: [0, 0, 0], lights: Lights.zero() }, alpha).logH] as Vec3,
    extensions: ['tif', 'tiff', 'dng', 'png', 'jpg', 'jpeg', ...RAW_EXTENSIONS],
  };
}
