// Golden pictures (CHB-037 P0, P2b; README.md beside this file).
//   node tools/goldens/render.ts --check         re-render the stored documents, compare with the stored pictures
//        [--tol 1e-5] [--only id,id]            tolerance (max |Δ| per sample) and a case filter
//   node tools/goldens/render.ts --only id,id    render these cases' documents and rewrite their pictures (a
//                                                deliberate change of the oracle: say why in the diary)
//   node tools/goldens/render.ts                 render every case and rewrite every picture
//   node tools/goldens/render.ts --fixtures      also rewrite the synthetic fixtures first (changes every golden)
// The cases are the documents in packages/conformance/goldens/cases/<id>/document.json, listed in index.json
// (translate.ts made them from P0's recipes).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex, type Document } from '@chromobench/contract';
import { CUTS } from './engine.ts';
import { cameraData, cameraInfo, makeNegativeTiff } from './fixtures.ts';
import {
  checkAll, DATA, dataPath, f32le, FORMAT, openAll, readIndex, readJSON, ROOT, stats, TOLERANCE, writeData,
  type CutHeader, type GoldenIndex,
} from './golden.ts';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt('--only')?.split(',');
const filter = only ? (id: string): boolean => only.includes(id) : undefined;

function writeFixtures(index: GoldenIndex): void {
  writeData('fixtures/negative-96x64.tif', makeNegativeTiff());
  const d = cameraData();
  writeData('fixtures/camera-96x64.f32', new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
  writeData('fixtures/camera-96x64.json', `${JSON.stringify(cameraInfo(d), null, 2)}\n`);
  for (const f of Object.values(index.fixtures)) f.sha256 = sha256Hex(new Uint8Array(readFileSync(join(ROOT, f.path))));
}

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

async function regenerate(): Promise<void> {
  const index = readIndex();
  if (only) for (const id of only) if (!index.cases.some((c) => c.id === id)) throw new Error(`no case ${id} in index.json`);
  if (args.includes('--fixtures')) writeFixtures(index);
  const ge = await openAll(index);
  const caps = ge.engine.capabilities();
  // pixels' sha256 → file: identical pictures share one file, also with the cases not rendered now
  const files = new Map<string, string>();
  const kept = new Set<string>();
  let written = 0;
  for (const c of index.cases) {
    if (!filter || filter(c.id) || !c.cuts) continue;
    for (const cut of CUTS) {
      const h = readJSON<CutHeader>(c.cuts[cut]);
      files.set(h.sha256, h.file);
      kept.add(h.file);
    }
  }
  for (const c of index.cases) {
    if (filter && !filter(c.id)) continue;
    const dir = `cases/${c.id}`;
    const out = await ge.render(readJSON<Document>(c.document));
    const cutFiles = {} as Record<(typeof CUTS)[number], string>;
    for (const r of out.cuts) {
      const bytes = f32le(r.data);
      const h = sha256Hex(bytes);
      let file = files.get(h);
      if (!file) {
        file = `${dir}/${r.cut}.f32`;
        if (kept.has(file)) throw new Error(`${file} is another case's picture too: render that case as well (--only)`);
        writeData(file, bytes);
        files.set(h, file);
        written++;
      }
      const header: CutHeader = {
        case: c.id, cut: r.cut, op: r.op, domain: r.domain, width: r.width, height: r.height, channels: r.channels,
        dtype: 'float32', endian: 'little', layout: 'interleaved, row-major, top row first', file, sha256: h,
        stats: stats(Float32Array.from(r.data), r.channels), warnings: r.warnings,
      };
      writeData(`${dir}/${r.cut}.json`, json(header));
      cutFiles[r.cut] = `${dir}/${r.cut}.json`;
    }
    c.cuts = cutFiles;
    c.ops = out.ops;
    const [p, d] = out.cuts;
    console.log(`${c.id.padEnd(30)} print ${p!.width}×${p!.height} mean ${stats(p!.data, 3).mean.map((v) => v.toFixed(3)).join(' ')}  display ${d!.width}×${d!.height} mean ${stats(d!.data, 3).mean.map((v) => v.toFixed(3)).join(' ')}`);
  }
  index.format = FORMAT;
  index.engine = { id: 'reference', adapter: caps.adapter?.name ?? 'unknown', conventions: caps.conventions ?? 'unknown', mode: 'exact' };
  writeData('index.json', json(index));
  let bytes = 0;
  const walk = (p: string): void => {
    for (const f of readdirSync(p)) {
      const q = join(p, f);
      if (statSync(q).isDirectory()) walk(q);
      else bytes += statSync(q).size;
    }
  };
  walk(dataPath(''));
  console.log(`${index.cases.length} cases, ${written} picture files written; ${DATA}: ${(bytes / 1e6).toFixed(2)} MB`);
}

async function check(): Promise<void> {
  const tol = Number(opt('--tol') ?? TOLERANCE);
  const rep = await checkAll({ tol, ...(filter ? { only: filter } : {}) });
  const e = (v: number): string => (v === 0 ? '0' : v.toExponential(2));
  console.log(`${'case'.padEnd(30)} ${'print max'.padStart(10)} ${'mean'.padStart(10)}  ${'display max'.padStart(11)} ${'mean'.padStart(10)}`);
  for (const c of rep.cases) {
    const [p, d] = c.cuts;
    const why = c.cuts.find((x) => x.why)?.why;
    console.log(`${c.id.padEnd(30)} ${e(p!.maxAbs).padStart(10)} ${e(p!.meanAbs).padStart(10)}  ${e(d!.maxAbs).padStart(11)} ${e(d!.meanAbs).padStart(10)}  ${c.ok ? 'ok' : 'FAIL'}${why ? `  ${why}` : ''}`);
  }
  const bad = rep.cases.filter((c) => !c.ok);
  console.log(`${rep.cases.length - bad.length}/${rep.cases.length} cases within max |Δ| ≤ ${tol}${bad.length ? `; failing: ${bad.map((c) => c.id).join(', ')}` : ''}`);
  if (!rep.ok) process.exit(1);
}

if (args.includes('--check')) await check();
else await regenerate();
