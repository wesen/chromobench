// Interim data converter (CHB-003 stage 1). Turns the two decoded sources in CHB-001 into the
// StockData shape CHB-004 will ship, so switching to real packs is a path change:
//   - Chromogen Studio st-data (stocks with real nulls, illustrative camera and white LED);
//   - Filmbench's embedded film-data blob (CIE 1931 CMFs, illuminants, dichroics, neutral filter
//     database, every profile's fitted 3-CDF curve model).
// All stock data is spektrafilm's: Copyright (c) 2026 Andrea Volpato, CC BY-SA 4.0.
//
// Usage: node tools/interim-data/convert.ts            (writes packages/core/data/interim/)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = fileURLToPath(new URL('../..', import.meta.url));
const C1 = join(root, 'ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted');
const CG = join(C1, 'chromogen-studio/st-data/cg');
const FB_BLOB = join(C1, 'filmbench-ide/00-film-data.bin.txt');
const OUT = join(root, 'packages/core/data/interim');
const LICENSE = 'Copyright (c) 2026 Andrea Volpato (spektrafilm). Licensed under CC BY-SA 4.0. Converted for chromobench by tools/interim-data/convert.ts.';

type Num = number | null;
const r6 = (v: Num): Num => (v === null || !Number.isFinite(v) ? null : Number(v.toPrecision(7)));
const col = (rows: Num[][], k: number): Num[] => rows.map((r) => r6(r[k] ?? null));

interface FbProfile {
  stock: string; name: string; type: string; support: string; use: string; antihalation: string; ref: string; view: string;
  target_print: string | null; role: string; logSens: Num[][]; nanRows: number[]; chan: number[][]; base: number[];
  curves: number[][]; model?: { centers: number[][]; amps: number[][]; sigmas: number[][] };
}

const fb = JSON.parse(inflateSync(Buffer.from(readFileSync(FB_BLOB, 'ascii').trim(), 'base64')).toString('utf8')) as {
  wl: number[]; cmf: number[][]; illuminant: Record<string, number[]>; dichroic: number[][];
  neutral_filters: Record<string, Record<string, number[]>>; profiles: Record<string, FbProfile>;
};

mkdirSync(join(OUT, 'stocks'), { recursive: true });

const logExposure = Array.from({ length: 256 }, (_, i) => r6(-3 + (7 * i) / 255));
const cgStocks = new Set(readdirSync(join(CG, 'stocks')).map((f) => f.replace(/\.json$/, '')));
const written: string[] = [];
for (const [id, p] of Object.entries(fb.profiles)) {
  let logSensitivity: Num[][];
  let dyes: Num[][];
  let base: Num[];
  let curves: Num[][];
  let le: Num[] = logExposure;
  let densitometer: string | undefined;
  let source: string;
  if (cgStocks.has(id)) {
    // Chromogen's copy has 5 decimals and the real nulls.
    const j = JSON.parse(readFileSync(join(CG, 'stocks', `${id}.json`), 'utf8'));
    const d = j.data;
    logSensitivity = [0, 1, 2].map((k) => col(d.log_sensitivity, k));
    dyes = [0, 1, 2].map((k) => col(d.channel_density, k));
    base = d.base_density.map((v: Num) => r6(v));
    curves = [0, 1, 2].map((k) => col(d.density_curves, k));
    le = d.log_exposure.map((v: number) => r6(v));
    densitometer = j.info.densitometer;
    source = 'chromogen-studio st-data (arrays) + filmbench blob (curve model, meta)';
  } else {
    // Filmbench stores missing samples as base 99 and dye 0 on nanRows; restore them as nulls on the base.
    const nan = new Set(p.nanRows);
    logSensitivity = [0, 1, 2].map((k) => col(p.logSens, k));
    dyes = [0, 1, 2].map((k) => p.chan.map((r, i) => (nan.has(i) ? null : r6(r[k]!))));
    base = p.base.map((v, i) => (nan.has(i) ? null : r6(v)));
    curves = [0, 1, 2].map((k) => col(p.curves, k));
    source = 'filmbench blob';
  }
  const out = {
    id, name: p.name, role: p.role === 'print' ? 'paper' : 'film', type: p.type, support: p.support,
    logSensitivity, dyes, base, logExposure: le, curves,
    ...(p.model ? { curveModel: { centres: p.model.centers, amps: p.model.amps, sigmas: p.model.sigmas } } : {}),
    meta: { refIlluminant: p.ref, viewIlluminant: p.view, antihalation: p.antihalation, use: p.use, targetPrint: p.target_print, ...(densitometer ? { densitometer } : {}) },
    source, license: LICENSE,
  };
  writeFileSync(join(OUT, 'stocks', `${id}.json`), JSON.stringify(out) + '\n');
  written.push(id);
}

const cam = JSON.parse(readFileSync(join(CG, 'cameras/generic-bayer.json'), 'utf8'));
const led = JSON.parse(readFileSync(join(CG, 'lights/white-led.json'), 'utf8'));
const onGrid = (wl: number[], v: number[]): number[] => {
  if (wl.length !== 81 || wl[0] !== 380) throw new Error('not on the 380–780/5 grid');
  return v.map((x) => r6(x)!);
};
const reference = {
  wl: fb.wl,
  cmf: [0, 1, 2].map((k) => fb.cmf.map((r) => r[k]!)),
  illuminants: fb.illuminant,
  dichroic: [0, 1, 2].map((k) => fb.dichroic.map((r) => r6(r[k]!))),
  neutralFilters: fb.neutral_filters,
  cameras: { 'generic-bayer': { about: cam.about, R: onGrid(cam.wl, cam.R), G: onGrid(cam.wl, cam.G), B: onGrid(cam.wl, cam.B) } },
  lights: { 'white-led': { about: led.about, values: onGrid(led.wl, led.values) } },
  license: LICENSE + ' Camera and LED are illustrative (Chromogen facts.py). CMFs: CIE 1931 2° tables from the Filmbench blob.',
};
writeFileSync(join(OUT, 'reference.json'), JSON.stringify(reference) + '\n');
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ stocks: written.sort(), license: LICENSE }, null, 1) + '\n');
console.log(`wrote ${written.length} stocks and reference.json to ${OUT}`);
