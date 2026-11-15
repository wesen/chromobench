// Golden pictures of today's pipeline (CHB-037 P0; README.md beside this file).
//   node tools/goldens/render.ts                 re-render every case from cases.ts and rewrite packages/conformance/goldens/
//   node tools/goldens/render.ts --fixtures      also rewrite the two synthetic fixtures first (changes every golden)
//   node tools/goldens/render.ts --check         re-render the stored recipes, compare with the stored pictures
//        [--tol 1e-5] [--only id,id]            tolerance (max |Δ| per sample) and a case filter
import { existsSync, readFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertRecipe, sha256Hex, type FrameRecipe } from '@chromobench/contract';
import { CASES, makeCtx, type FixtureId } from './cases.ts';
import { CUT_OP, CUTS, makeGoldenEngine, type FixtureRef } from './engine.ts';
import { cameraData, cameraInfo, makeNegativeTiff } from './fixtures.ts';
import {
  checkAll, DATA, dataPath, f32le, FORMAT, missingOps, ROOT, stats, TOLERANCE, writeData,
  type CutHeader, type GoldenIndex, type IndexCase, type SkippedCase,
} from './golden.ts';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt('--only')?.split(',');
const filter = only ? (id: string): boolean => only.includes(id) : undefined;

const FIX = `${DATA}/fixtures`;
const FIXTURES: Record<FixtureId, Omit<FixtureRef, 'sha256'> & { title: string }> = {
  negative: { kind: 'negative', path: `${FIX}/negative-96x64.tif`, title: 'Synthetic colour negative, 16-bit TIFF 96 × 64: rebate, neutral ramp, seven patches, fine grating, highlight blob, three dust specks (tools/goldens/fixtures.ts)' },
  camera: { kind: 'camera', path: `${FIX}/camera-96x64.f32`, info: `${FIX}/camera-96x64.json`, title: 'Synthetic camera file, linear camera RGB float32 96 × 64 with its SourceInfo (camera matrix, as-shot neutral): the same scene, three sensor-dust specks' },
  m1: { kind: 'tiff', path: 'fixtures/synthetic/m1-negative-96x64.tif', title: 'The M1 walking-skeleton negative (tools/fixtures/make-m1.ts)' },
};

function writeFixtures(): void {
  writeData('fixtures/negative-96x64.tif', makeNegativeTiff());
  const d = cameraData();
  writeData('fixtures/camera-96x64.f32', new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
  writeData('fixtures/camera-96x64.json', `${JSON.stringify(cameraInfo(d), null, 2)}\n`);
}

function fixtureRefs(): Record<FixtureId, FixtureRef & { title: string }> {
  const out = {} as Record<FixtureId, FixtureRef & { title: string }>;
  for (const [id, f] of Object.entries(FIXTURES) as [FixtureId, (typeof FIXTURES)[FixtureId]][]) {
    out[id] = { ...f, sha256: sha256Hex(new Uint8Array(readFileSync(join(ROOT, f.path)))) };
  }
  return out;
}

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

async function regenerate(): Promise<void> {
  if (args.includes('--fixtures') || !existsSync(dataPath('fixtures/negative-96x64.tif'))) writeFixtures();
  const fixtures = fixtureRefs();
  const ge = makeGoldenEngine(ROOT);
  const sha = {} as Record<FixtureId, string>;
  for (const [id, f] of Object.entries(fixtures) as [FixtureId, FixtureRef][]) sha[id] = (await ge.open(f)).sha256;
  const ctx = await makeCtx(ge, sha);
  if (!filter) rmSync(dataPath('cases'), { recursive: true, force: true });
  const old: GoldenIndex | null = filter && existsSync(dataPath('index.json')) ? (JSON.parse(readFileSync(dataPath('index.json'), 'utf8')) as GoldenIndex) : null;
  const files = new Map<string, string>(); // pixels' sha256 → file (identical pictures share one file)
  const cases: IndexCase[] = [];
  const skipped: SkippedCase[] = [];
  const caps = ge.engine.capabilities();
  for (const def of CASES) {
    if (filter && !filter(def.id)) continue;
    const r: FrameRecipe = await def.build(ctx);
    assertRecipe(r);
    const dir = `cases/${def.id}`;
    writeData(`${dir}/recipe.json`, json(r));
    const base = { id: def.id, title: def.title, exercises: def.exercises, fixture: def.fixture, recipe: `${dir}/recipe.json` };
    if (def.skip) {
      const missing = missingOps(ge, r);
      if (!missing.length) throw new Error(`${def.id} is marked skipped but renders: remove its skip`);
      skipped.push({ ...base, reason: def.skip, missing });
      console.log(`${def.id.padEnd(30)} skipped (${missing.join(', ')} not implemented)`);
      continue;
    }
    const out = await ge.render(r);
    const cutFiles = {} as Record<(typeof CUTS)[number], string>;
    for (const c of out.cuts) {
      const bytes = f32le(c.data);
      const h = sha256Hex(bytes);
      let file = files.get(h);
      if (!file) {
        file = `${dir}/${c.cut}.f32`;
        writeData(file, bytes);
        files.set(h, file);
      }
      const header: CutHeader = {
        case: def.id, cut: c.cut, op: c.op, domain: c.domain, width: c.width, height: c.height, channels: c.channels,
        dtype: 'float32', endian: 'little', layout: 'interleaved, row-major, top row first', file, sha256: h,
        stats: stats(Float32Array.from(c.data), c.channels), warnings: c.warnings,
      };
      writeData(`${dir}/${c.cut}.json`, json(header));
      cutFiles[c.cut] = `${dir}/${c.cut}.json`;
    }
    cases.push({ ...base, cuts: cutFiles, ops: out.ops });
    const [p, d] = out.cuts;
    console.log(`${def.id.padEnd(30)} print ${p!.width}×${p!.height} mean ${stats(p!.data, 3).mean.map((v) => v.toFixed(3)).join(' ')}  display ${d!.width}×${d!.height} mean ${stats(d!.data, 3).mean.map((v) => v.toFixed(3)).join(' ')}`);
  }
  const keep = <T extends { id: string }>(a: T[] | undefined, b: T[]): T[] => [...(a ?? []).filter((x) => !b.some((y) => y.id === x.id)), ...b];
  const index: GoldenIndex = {
    format: FORMAT,
    about: "Golden pictures of the recipe-v2 pipeline (compile() in packages/contract/src/graph.ts) on core's f64 reference engine, made before the CHB-037 cut-off. See tools/goldens/README.md.",
    engine: { id: 'reference', adapter: caps.adapter?.name ?? 'unknown', conventions: caps.conventions ?? 'unknown', mode: 'exact', wrapper: 'StudioEngine (apps/studio/src/host/studio-engine.ts): output.frame' },
    cuts: { print: `the ${CUT_OP.print} node (print-xyz)`, display: `the ${CUT_OP.display} node (display-rgb, sRGB)` },
    tolerance: { maxAbs: TOLERANCE, note: 'largest |Δ| allowed per float32 sample; today the renderer reproduces the files exactly' },
    fixtures,
    cases: keep(old?.cases, cases),
    skipped: keep(old?.skipped, skipped),
  };
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
  console.log(`${index.cases.length} cases, ${index.skipped.length} skipped, ${files.size} picture files written; ${DATA}: ${(bytes / 1e6).toFixed(2)} MB`);
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
  for (const s of rep.skipped) console.log(`${s.id.padEnd(30)} ${s.stillMissing ? `skipped (${s.missing.join(', ')} not implemented)` : 'RENDERS NOW: make it a golden (remove its skip in cases.ts, re-render)'}`);
  const bad = rep.cases.filter((c) => !c.ok);
  console.log(`${rep.cases.length - bad.length}/${rep.cases.length} cases within max |Δ| ≤ ${tol}${bad.length ? `; failing: ${bad.map((c) => c.id).join(', ')}` : ''}`);
  if (!rep.ok) process.exit(1);
}

if (args.includes('--check')) await check();
else await regenerate();
