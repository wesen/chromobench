// Test helpers: the committed packs, corruption helpers, and the guide §6.1 printing computation,
// written here against the loader's policy-resolved spectra (independent of @chromobench/core).
import { readFileSync } from 'node:fs';
import { andValid, memorySource, Pack, transmittance, type MissingPolicy, type StockData } from '../src/index.ts';
import { fsSource, PACKS_DIR } from '../src/node.ts';

export const SF = 'spektrafilm@0.3.2+3bb2c2d';
export const C1 = new URL('../../../ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/', import.meta.url);
export const GOLDEN = JSON.parse(readFileSync(new URL('../../../fixtures/golden/data/CHB-004.json', import.meta.url), 'utf8')) as {
  entries: { id: string; expect: number | number[]; tol: number; checkedBy?: string }[];
};
export const golden = (id: string) => GOLDEN.entries.find((e) => e.id === id)!;

export const disk = () => fsSource(PACKS_DIR);
export const open = (id: string): Pack => Pack.openSync(disk(), id);

/** All files of a pack in memory (committed ones), so tests can corrupt them. */
export function packFiles(id: string): Map<string, Uint8Array> {
  const src = disk();
  const m = new Map<string, Uint8Array>();
  m.set(`${id}/manifest.json`, src.readSync!(`${id}/manifest.json`));
  const man = JSON.parse(new TextDecoder().decode(m.get(`${id}/manifest.json`)!));
  for (const f of man.files) if (!f.onDemand) m.set(`${id}/${f.path}`, src.readSync!(`${id}/${f.path}`));
  return m;
}

export function withManifest(files: Map<string, Uint8Array>, id: string, edit: (m: any) => void): Map<string, Uint8Array> {
  const out = new Map(files);
  const m = JSON.parse(new TextDecoder().decode(out.get(`${id}/manifest.json`)!));
  edit(m);
  out.set(`${id}/manifest.json`, new TextEncoder().encode(JSON.stringify(m)));
  return out;
}

export const memPack = (files: Map<string, Uint8Array>, id: string): Pack => Pack.openSync(memorySource(files), id);

export const greyDyes = (s: StockData): [number, number, number] => {
  const le = s.logExposure_logH;
  const at = (c: Float64Array): number => {
    let i = 0;
    while (le[i + 1]! < 0) i++;
    const t = (0 - le[i]!) / (le[i + 1]! - le[i]!);
    return c[i]! + t * (c[i + 1]! - c[i]!);
  };
  return [at(s.dyeCurves[0]), at(s.dyeCurves[1]), at(s.dyeCurves[2])];
};

/** Enlarger filter pack: Π_k [1 − (1 − F_k)(1 − 10^(−v_k/100))] (spektrafilm DichroicFilters.apply_cc). */
export function filterPack(F: [Float64Array, Float64Array, Float64Array], cc: [number, number, number]): Float64Array {
  const out = new Float64Array(81).fill(1);
  for (let k = 0; k < 3; k++) {
    const v = 10 ** (-cc[k]! / 100);
    for (let i = 0; i < 81; i++) out[i] = out[i]! * (1 - (1 - F[k]![i]!) * (1 - v));
  }
  return out;
}

/** Normalised paper log H of the film's mid-grey (curves at log H 0) printed with the neutral pack (guide §6.1). */
export function midgrayPaperLogH(film: StockData, paper: StockData, lamp: Float64Array, filt: Float64Array): [number, number, number] {
  const c = greyDyes(film);
  const D = new Float64Array(81);
  for (let i = 0; i < 81; i++) D[i] = film.base_D.values[i]! + c[0] * film.unitDyes_D[0].values[i]! + c[1] * film.unitDyes_D[1].values[i]! + c[2] * film.unitDyes_D[2].values[i]!;
  const T = transmittance(D, andValid(film.base_D, ...film.unitDyes_D));
  const x = [0, 1, 2].map((k) => {
    let s = 0;
    for (let i = 0; i < 81; i++) s += lamp[i]! * filt[i]! * T[i]! * paper.sensitivity[k]!.values[i]!;
    return Math.log10(s);
  });
  const mean = (x[0]! + x[1]! + x[2]!) / 3;
  return [x[0]! - mean, x[1]! - mean, x[2]! - mean];
}

export interface BalanceResult { pairs: number; median: number; max: number; worst: string }

/** The neutral-pack balance law over every (negative film, print) pair with a table entry. */
export function balanceLaw(stocks: Pack, enlarger: Pack, policy: MissingPolicy): BalanceResult {
  const lamp = enlarger.illuminantSync('TH-KG3').values;
  const F = enlarger.dichroicsSync('custom').map((s) => s.values) as [Float64Array, Float64Array, Float64Array];
  const films = stocks.stockIds({ role: 'film', type: 'negative' });
  const prints = stocks.stockIds({ role: 'print' });
  const spreads: [string, number][] = [];
  for (const p of prints) {
    for (const f of films) {
      const nf = enlarger.neutralFiltersSync({ paper: p, film: f });
      if (!nf) continue;
      const x = midgrayPaperLogH(stocks.stockSync(f, { missing: policy }), stocks.stockSync(p, { missing: policy }), lamp, filterPack(F, [nf.c_cc, nf.m_cc, nf.y_cc]));
      spreads.push([`${p}/${f}`, Math.max(...x) - Math.min(...x)]);
    }
  }
  const v = spreads.map((s) => s[1]).sort((a, b) => a - b);
  const mid = v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2;
  const worst = spreads.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { pairs: v.length, median: mid, max: v[v.length - 1]!, worst: worst[0] };
}

export function readC1Json(rel: string): any {
  return JSON.parse(readFileSync(new URL(rel, C1), 'utf8'));
}
