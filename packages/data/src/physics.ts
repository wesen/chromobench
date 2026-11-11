// Adapter: packs → the `PhysicsData` interface that @chromobench/core reads all its data through
// (packages/core/src/data/provider.ts). The types below mirror core's structurally, so this package
// does not depend on core; core/test/packs-parity.test.ts assigns the result to core's own type, so the
// compiler checks they stay compatible.
//
// Core resolves missing samples itself under its conventions (StockData arrays keep NaN), so the
// adapter hands out the raw tensors, not policy-resolved spectra.
import { fail } from '@chromobench/contract';
import type { Pack } from './pack.ts';
import { column } from './tensors.ts';

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

/** Mirror of core's StockData (packages/core/src/spectral/stock.ts). */
export interface CoreStockData {
  id: string;
  name?: string;
  role: 'film' | 'paper';
  type: 'negative' | 'positive' | string;
  logSensitivity: Float64Array[];
  dyes: Float64Array[];
  base: Float64Array;
  logExposure: Float64Array;
  curves: Float64Array[];
  curveModel?: { centres: Mat3; amps: Mat3; sigmas: Mat3 };
  meta: { refIlluminant: string; viewIlluminant: string; antihalation?: string; use?: string; targetPrint?: string | null; densitometer?: string };
  license?: string;
}

export type Cmy = { c: number; m: number; y: number };

/** Mirror of core's PhysicsData (packages/core/src/data/provider.ts). */
export interface CorePhysicsData {
  readonly id: string;
  stockIds(): string[];
  stock(id: string): CoreStockData;
  cmf(): [Float64Array, Float64Array, Float64Array];
  illuminant(name: string): Float64Array;
  illuminantNames(): string[];
  dichroic(): [Float64Array, Float64Array, Float64Array];
  neutralFilter(paper: string, film: string): Cmy | undefined;
  camera(id: string): [Float64Array, Float64Array, Float64Array];
  light(id: string): Float64Array;
}

const GRID_WL = Float64Array.from({ length: 81 }, (_, i) => 380 + 5 * i);

/** Planck's law normalised to 1 at 560 nm, exactly as core's `blackbody()` (spectral/spectrum.ts). */
export function blackbody560(T_K: number): Float64Array {
  const c1 = 3.741771852e-16;
  const c2 = 0.01438776877;
  const p = (w: number): number => {
    const l = w * 1e-9;
    return c1 / l ** 5 / (Math.exp(c2 / (l * T_K)) - 1);
  };
  const ref = p(560);
  return GRID_WL.map((w) => p(w) / ref);
}

const mat3 = (m: number[][]): Mat3 => [[m[0]![0]!, m[0]![1]!, m[0]![2]!], [m[1]![0]!, m[1]![1]!, m[1]![2]!], [m[2]![0]!, m[2]![1]!, m[2]![2]!]];

export interface PhysicsDataOptions {
  /** Enlarger lamp whose neutral filter table neutralFilter() reads (default TH-KG3, the only one upstream has). */
  lamp?: string;
  /** Dichroic set dichroic() returns (default 'custom', spektrafilm's color_enlarger default). */
  dichroics?: string;
}

/**
 * Serve core's PhysicsData from a stock pack (+ an optional camera/light pack such as illustrative@1).
 * Synchronous: the packs need a synchronous source (file system) or a prior `await pack.preload()`.
 */
export function physicsData(stocks: Pack, scanners?: Pack, o: PhysicsDataOptions = {}): CorePhysicsData {
  const lamp = o.lamp ?? 'TH-KG3';
  const set = o.dichroics ?? 'custom';
  const cache = new Map<string, CoreStockData>();
  const needScanners = (what: string): Pack => scanners ?? fail('E_DATA_SCHEMA', `no camera/light pack was given; cannot serve ${what}`, { hint: 'pass a scanner pack such as illustrative@1' });
  let cmf: [Float64Array, Float64Array, Float64Array] | undefined;
  let dich: [Float64Array, Float64Array, Float64Array] | undefined;
  return {
    id: scanners ? `${stocks.packId}|${scanners.packId}` : stocks.packId,
    stockIds: () => stocks.stockIds(),
    stock(id) {
      const hit = cache.get(id);
      if (hit) return hit;
      const s = stocks.stockSync(id);
      const r = s.raw;
      const cm = s.curveModel;
      const meta: CoreStockData['meta'] = {
        refIlluminant: s.referenceIlluminant ?? 'D55',
        viewIlluminant: s.viewingIlluminant ?? 'D50',
        use: s.use,
        targetPrint: s.targetPrint ?? null,
        ...(s.antihalation && !s.infoDefaulted.includes('antihalation') ? { antihalation: s.antihalation } : {}),
        ...(s.densitometer && !s.infoDefaulted.includes('densitometer') ? { densitometer: s.densitometer } : {}),
      };
      const d: CoreStockData = {
        id: s.id,
        name: s.name,
        role: s.role === 'print' ? 'paper' : 'film',
        type: s.type,
        logSensitivity: [0, 1, 2].map((k) => column(r['log10_sensitivity']!, k)),
        dyes: [0, 1, 2].map((k) => column(r['unit_dye_density_D']!, k)),
        base: Float64Array.from(r['base_density_D']!.data),
        logExposure: Float64Array.from(r['log_exposure_logH']!.data),
        curves: [0, 1, 2].map((k) => column(r['dye_amount_curves']!, k)),
        ...(cm ? { curveModel: { centres: mat3(cm.centers), amps: mat3(cm.amplitudes), sigmas: mat3(cm.sigmas) } } : {}),
        meta,
        license: s.attribution,
      };
      cache.set(id, d);
      return d;
    },
    cmf() {
      cmf ??= stocks.cmfSync().map((s) => s.values) as [Float64Array, Float64Array, Float64Array];
      return cmf;
    },
    illuminant(name) {
      const m = /^bb(\d+)$/.exec(name);
      if (m) return blackbody560(Number(m[1]));
      if (!stocks.illuminantIds().includes(name)) fail('E_DATA_SCHEMA', `unknown illuminant "${name}"`, { valid: [...stocks.illuminantIds(), 'bb<kelvin>'] });
      return stocks.illuminantSync(name).values;
    },
    illuminantNames: () => stocks.illuminantIds(),
    dichroic() {
      dich ??= stocks.dichroicsSync(set).map((s) => s.values) as [Float64Array, Float64Array, Float64Array];
      return dich;
    },
    neutralFilter(paper, film) {
      const v = stocks.neutralFiltersSync({ paper, lamp, film });
      return v ? { c: v.c_cc, m: v.m_cc, y: v.y_cc } : undefined;
    },
    camera(id) {
      const c = needScanners(`camera "${id}"`).cameraSync(id);
      return c.responsivity.map((s) => s.values) as [Float64Array, Float64Array, Float64Array];
    },
    light(id) {
      return needScanners(`light "${id}"`).lightSync(id).spd.values;
    },
  };
}
