// Interim PhysicsData from packages/core/data/interim (written by tools/interim-data/convert.ts from the
// CHB-001 extracts). Stock data: spektrafilm, Andrea Volpato, CC BY-SA 4.0.
//
// Two ways in, one provider:
//   interimFromJson(src): pure, browser-safe; the caller hands over the parsed JSON (packages/gpu bundles
//     it with Vite, see its physics/data.ts);
//   interimData(): Node; reads the files. It reaches node:fs through process.getBuiltinModule rather than a
//     static import, so this module (and the package index) also loads in a browser.
// SWITCH POINT (CHB-004): the data packs implement PhysicsData; callers pass them instead of these.
import { fail } from '@chromobench/contract';
import { blackbody } from '../spectral/spectrum.ts';
import type { StockData } from '../spectral/stock.ts';
import type { Cmy, PhysicsData } from './provider.ts';

type Num = number | null;
const f64 = (a: readonly Num[]): Float64Array => Float64Array.from(a, (v) => (v === null ? NaN : v));

/** The interim data set as parsed JSON: reference.json, index.json and one stocks/<id>.json per stock. */
export interface InterimJson {
  reference: any;
  index: { stocks: string[] };
  /** Parsed stocks/<id>.json, or undefined when the source does not hold that stock. */
  stock(id: string): any;
}

/** The interim PhysicsData over already-parsed JSON (no I/O). */
export function interimFromJson(src: InterimJson, id = 'interim-chb001'): PhysicsData {
  const ref = src.reference;
  const index = src.index;
  const stocks = new Map<string, StockData>();
  const cmf = ref.cmf.map((c: number[]) => f64(c)) as [Float64Array, Float64Array, Float64Array];
  const dich = ref.dichroic.map((c: number[]) => f64(c)) as [Float64Array, Float64Array, Float64Array];
  return {
    id,
    stockIds: () => index.stocks.slice(),
    stock(sid) {
      const hit = stocks.get(sid);
      if (hit) return hit;
      if (!index.stocks.includes(sid)) fail('E_STOCK_UNKNOWN', `unknown stock "${sid}"`, { valid: index.stocks });
      const j = src.stock(sid) ?? fail('E_STOCK_UNKNOWN', `stock "${sid}" is listed but its data is not available`, { valid: index.stocks });
      const d: StockData = {
        id: j.id, name: j.name, role: j.role, type: j.type,
        logSensitivity: j.logSensitivity.map(f64), dyes: j.dyes.map(f64), base: f64(j.base),
        logExposure: f64(j.logExposure), curves: j.curves.map(f64),
        ...(j.curveModel ? { curveModel: j.curveModel } : {}),
        meta: j.meta, license: j.license,
      };
      stocks.set(sid, d);
      return d;
    },
    cmf: () => cmf,
    illuminant(name) {
      const m = /^bb(\d+)$/.exec(name);
      if (m) return blackbody(Number(m[1])).values;
      const v = ref.illuminants[name];
      if (!v) fail('E_DATA_SCHEMA', `unknown illuminant "${name}"`, { valid: [...Object.keys(ref.illuminants), 'bb<kelvin>'] });
      return f64(v);
    },
    illuminantNames: () => Object.keys(ref.illuminants),
    dichroic: () => dich,
    neutralFilter(paper, film): Cmy | undefined {
      const v = ref.neutralFilters[paper]?.[film];
      return v ? { c: v[0], m: v[1], y: v[2] } : undefined;
    },
    camera(cid) {
      const c = ref.cameras[cid] ?? fail('E_DATA_SCHEMA', `unknown camera "${cid}"`, { valid: Object.keys(ref.cameras) });
      return [f64(c.R), f64(c.G), f64(c.B)];
    },
    light(lid) {
      const l = ref.lights[lid] ?? fail('E_DATA_SCHEMA', `unknown light "${lid}"`, { valid: Object.keys(ref.lights) });
      return f64(l.values);
    },
  };
}

let cached: PhysicsData | undefined;

/** The interim PhysicsData read from packages/core/data/interim (Node only). */
export function interimData(): PhysicsData {
  if (cached) return cached;
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const fs = proc?.getBuiltinModule?.('node:fs') as typeof import('node:fs') | undefined;
  if (!fs) return fail('E_DATA_SCHEMA', 'interimData() reads files and needs Node', { hint: 'in a browser, pass a PhysicsData (interimFromJson over bundled JSON, or a CHB-004 pack)' });
  const dir = new URL('../../data/interim/', import.meta.url);
  const readJSON = (p: string): any => JSON.parse(fs.readFileSync(new URL(p, dir), 'utf8'));
  cached = interimFromJson({ reference: readJSON('reference.json'), index: readJSON('index.json'), stock: (id) => readJSON(`stocks/${id}.json`) });
  return cached;
}
