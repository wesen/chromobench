// The studio's host file (CHB-023; CHB-019 guide §7.1): the one module in apps/studio allowed to
// import @chromobench/core, gpu and ingest (tools/scripts/check-boundaries.ts names it, with its helpers
// host/decode.ts and the engine worker host/engine-worker.ts). It builds the physics engine — GpuEngine when
// WebGPU works, else core's RefEngine on a working image — on CHB-004's data packs, decodes files through
// packages/ingest, conditions them on open, and hands the UI a StudioEngine plus a few injected functions.
// Nothing else in the studio sees physics code.
//
// CHB-027 (F4): decoding, linearising, the working-image resample and conditioning run in the engine worker for
// both engines, and so does the reference engine (WorkerEngine proxies it); GpuEngine stays on this thread and gets
// the decoded pixels back as a transferable. ?worker=0 (HostOptions.worker false) runs everything on this thread.
import type { Engine, FrameRecipe, Mutation, Vec3, Box } from '@chromobench/contract';
import {
  bakeRecipe, CLASS_CODE, classify, DEFAULT_CONVENTIONS, DEFAULT_SIGMA_D, integrateToGrey, Lights, SCANNER_IDS, scannerForward, type PhysicsData,
} from '@chromobench/core';
import { GpuEngine, loadDefaultPhysicsData } from '@chromobench/gpu';
import {
  classifyImage, filmLayout, openPrior, rankStocks, RAW_EXTENSIONS, rollBase, sigmaD, workerRawDecoder, type FrameBase, type RawDecoder,
} from '@chromobench/ingest';
import librawWasmUrl from '@colorhythm/libraw-wasm/libraw.wasm?url';
import { decodeFile } from './decode.ts';
import { referenceEngine, type RefLike } from './engine-serve.ts';
import type { IntegrateToGrey } from './first-print.ts';
import { StudioEngine, type HostServices } from './studio-engine.ts';
import { WorkerClient, WorkerEngine } from './worker-engine.ts';

export type EngineChoice = 'auto' | 'gpu' | 'reference';

export interface HostOptions {
  want: EngineChoice;
  /** Working image long side for the GPU engine (default 4000; 0 = the file's own size). */
  long?: number;
  /**
   * Working image long side for the reference engine (default 640 since CHB-031: its previews through tables are
   * ≈ 2× faster, so 640 px answers about as fast as 512 px did exactly; ?refLong=1024 is sharper and ≈ 3× slower to
   * the final render, CHB-027 F10). It computes in f64 on the CPU, in the engine worker, and only the pixels a preview
   * shows (sampled previews).
   */
  refLong?: number;
  /**
   * The reference engine's physics (CHB-031 F10): 'tabulated' (default) computes previews through core's tables, as
   * the GPU engine's previews (2–5× faster on the CPU), and exports exact; 'exact' runs every pixel through the
   * physics, previews too.
   */
  refMode?: 'exact' | 'tabulated';
  /** Decode and run the reference engine in the engine worker (default true); false: on this thread (CHB-023's way). */
  worker?: boolean;
  /** Status callback while the engine starts. */
  onStatus?: (s: string) => void;
}

/**
 * Settings the UI may change; they apply to files opened afterwards. Photo or negative is no setting here any more
 * (CHB-027): it is chosen per file (HostServices.decode's mode), guessed by ingest's guessOpenMode on 'auto'.
 */
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
  /** True when decoding (and the reference engine) run in the engine worker. */
  worker: boolean;
}

const DEFAULT_LONG = 4000;
const DEFAULT_REF_LONG = 640;
const DEFAULT_REF_MODE: 'exact' | 'tabulated' = 'tabulated';
/** The reference engine's cache: node images at 1024 × 683 (?refLong=1024) are ≈ 22 MB each (4 channels, f64). */
const REF_CACHE = { cacheLimit: 48, cacheBytes: 768 * 2 ** 20 };

let rawDecoder: RawDecoder | null = null;
/** LibRaw in a module worker, started on the first camera RAW file (?worker=0: decoding on this thread). */
function libraw(): RawDecoder {
  if (!rawDecoder) {
    const w = new Worker(new URL('../../../../packages/ingest/src/libraw/worker-entry.ts', import.meta.url), { type: 'module' });
    rawDecoder = workerRawDecoder(w as never, { wasmUrl: librawWasmUrl });
  }
  return rawDecoder;
}

const LAZY_LIBRAW: RawDecoder = { name: 'libraw', decode: (b, o) => libraw().decode(b, o) };

/** The engine worker, or null when it cannot start (the caller falls back to this thread). */
function startWorker(): WorkerClient | null {
  try {
    return new WorkerClient(new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' }) as never);
  } catch (e) {
    console.warn('engine worker unavailable; decoding on the main thread', e);
    return null;
  }
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
  const refMode = o.refMode ?? DEFAULT_REF_MODE;
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
  // the engine worker: decoding for both engines, and the reference engine when there is no GPU
  let client = o.worker === false ? null : startWorker();
  if (client) {
    say('starting the engine worker…');
    try {
      const init = await client.init({ engine: primary ? 'none' : 'reference', librawWasmUrl, packsBase: new URL('/packs/', location.href).href, sampled: true, mode: refMode, ...REF_CACHE });
      if (!primary) primary = new WorkerEngine(client, init.caps!);
    } catch (e) {
      console.warn('engine worker failed to start; running on the main thread', e);
      client.terminate();
      client = null;
    }
  }
  const inWorker = client !== null;
  if (!primary) primary = referenceEngine({ data, sampled: true, mode: refMode, ...REF_CACHE });
  if (primary.id === 'reference') {
    long = o.refLong ?? DEFAULT_REF_LONG;
    label = `reference · CPU f64${refMode === 'tabulated' ? ' (tabulated previews, exact export)' : ''}${inWorker ? ' (worker)' : ''}${why ? ` (no WebGPU: ${why})` : ''}`;
  }
  // the reference engine in the worker keeps the decoded pixels there ('register': none come back, the register
  // hook below makes the last decode the engine's); the GPU engine gets them back as a transferable ('return')
  const inEngine = primary instanceof WorkerEngine ? primary : null;
  const host: HostServices = {
    decode: (bytes, sha, name, mode) => {
      if (client) return client.decode(bytes, sha, name, mode, { long, dust: settings.dust, keep: inEngine ? 'register' : 'return' });
      return decodeFile(bytes, sha, name, mode, { long, dust: settings.dust, roll, raw: LAZY_LIBRAW });
    },
    prior: (name) => openPrior({ name }),
    forget: (e, sha) => (e as { forgetSource?: (s: string) => void }).forgetSource?.(sha),
    register: (e, info, px) => {
      if (e === inEngine) inEngine.register(info.sha256);
      else if (px) (e as GpuEngine | RefLike).openDecoded(info, px);
      else throw new Error(`register ${info.sha256.slice(0, 12)}…: no pixels`);
    },
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
    worker: inWorker,
  };
}
