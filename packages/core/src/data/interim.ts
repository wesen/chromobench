// Interim PhysicsData from packages/core/data/interim (written by tools/interim-data/convert.ts from the
// CHB-001 extracts). Node only (reads files). Stock data: spektrafilm, Andrea Volpato, CC BY-SA 4.0.
import { readFileSync } from 'node:fs';
import { fail } from '@chromobench/contract';
import { blackbody } from '../spectral/spectrum.ts';
import type { StockData } from '../spectral/stock.ts';
import type { Cmy, PhysicsData } from './provider.ts';

type Num = number | null;
const f64 = (a: readonly Num[]): Float64Array => Float64Array.from(a, (v) => (v === null ? NaN : v));
const dir = new URL('../../data/interim/', import.meta.url);
const readJSON = (p: string): any => JSON.parse(readFileSync(new URL(p, dir), 'utf8'));

let cached: PhysicsData | undefined;

export function interimData(): PhysicsData {
  if (cached) return cached;
  const ref = readJSON('reference.json');
  const index = readJSON('index.json') as { stocks: string[] };
  const stocks = new Map<string, StockData>();
  const cmf = ref.cmf.map((c: number[]) => f64(c)) as [Float64Array, Float64Array, Float64Array];
  const dich = ref.dichroic.map((c: number[]) => f64(c)) as [Float64Array, Float64Array, Float64Array];
  cached = {
    id: 'interim-chb001',
    stockIds: () => index.stocks.slice(),
    stock(id) {
      const hit = stocks.get(id);
      if (hit) return hit;
      if (!index.stocks.includes(id)) fail('E_STOCK_UNKNOWN', `unknown stock "${id}"`, { valid: index.stocks });
      const j = readJSON(`stocks/${id}.json`);
      const d: StockData = {
        id: j.id, name: j.name, role: j.role, type: j.type,
        logSensitivity: j.logSensitivity.map(f64), dyes: j.dyes.map(f64), base: f64(j.base),
        logExposure: f64(j.logExposure), curves: j.curves.map(f64),
        ...(j.curveModel ? { curveModel: j.curveModel } : {}),
        meta: j.meta, license: j.license,
      };
      stocks.set(id, d);
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
    camera(id) {
      const c = ref.cameras[id] ?? fail('E_DATA_SCHEMA', `unknown camera "${id}"`, { valid: Object.keys(ref.cameras) });
      return [f64(c.R), f64(c.G), f64(c.B)];
    },
    light(id) {
      const l = ref.lights[id] ?? fail('E_DATA_SCHEMA', `unknown light "${id}"`, { valid: Object.keys(ref.lights) });
      return f64(l.values);
    },
  };
  return cached;
}
