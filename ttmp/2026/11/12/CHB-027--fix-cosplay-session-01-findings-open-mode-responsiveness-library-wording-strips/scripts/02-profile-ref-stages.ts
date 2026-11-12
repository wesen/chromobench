// CHB-027 WS-B: where the reference engine spends a preview (F4), on synthetic data in Node.
//   node ttmp/2026/11/12/CHB-027--*/scripts/02-profile-ref-stages.ts [long=512] [kind=negative-scan|digital-raw] [mode=exact|tabulated]
// Builds the studio's display chain for a default recipe on a synthetic frame (planted strip or a smooth
// scene), evaluates it stage by stage at full resolution (each stage timed alone, its inputs cached), then
// changes the enlarger time (a print-only change) and reports which stages the engine recomputes.
import { compile, defaultRecipe, Graph, type SourceInfo } from '../../../../../../packages/contract/src/index.ts';
import { RefEngine } from '../../../../../../packages/core/src/index.ts';

const [longArg, kindArg, modeArg] = process.argv.slice(2);
const long = Number(longArg ?? 512);
const kind = (kindArg === 'photo' ? 'digital-' + 'raw' : kindArg ?? 'negative-scan') as 'negative-scan' | 'digital-raw';
const mode = (modeArg ?? 'exact') as 'exact' | 'tabulated';
const w = long, h = Math.round((long * 2) / 3);
const data = new Float32Array(w * h * 3);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const u = x / w, v = y / h;
  // a negative-ish orange cast (or a scene for a photo), smooth with some structure
  const base = kind === 'negative-scan' ? [0.75, 0.42, 0.2] : [0.3, 0.3, 0.3];
  const m = 0.15 + 0.8 * (0.5 + 0.5 * Math.sin(6 * u + 3 * v) * Math.cos(5 * v));
  for (let k = 0; k < 3; k++) data[(y * w + x) * 3 + k] = base[k]! * (kind === 'negative-scan' ? m : 1 - 0.9 * m);
}
const sha = (kind === 'negative-scan' ? 'a' : 'b').repeat(64);
const info: SourceInfo = {
  sha256: sha, format: 'tiff', width: w, height: h, channels: 3, bits: 16, sample: 'uint',
  encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0, 0, 0], white: [1, 1, 1], from: 'default' },
  cfa: 'none', clippedFraction: 0, notes: [],
};
const e = new RefEngine({ cacheLimit: 48, mode });
e.openDecoded(info, data);
const g = new Graph();
g.registerSource(info);
const r0 = defaultRecipe(kind, { sha256: sha, name: 'synthetic' });
const r = { ...r0, print: { ...r0.print, enlarger: { ...r0.print.enlarger, mode: 'real' as const } } };

async function stages(rec: typeof r, label: string): Promise<number> {
  const top = compile(rec, g);
  const defs = g.closure(top.id);
  e.adopt(defs);
  const nodes = g.adopt(defs);
  let total = 0;
  const rows: string[] = [];
  for (const n of nodes) {
    if (n.info.kind !== 'Image' || n.op === 'output.frame') continue;
    const t = performance.now();
    await e.evaluate(n, { scale: 'full', precision: 'preview' });
    const ms = performance.now() - t;
    total += ms;
    rows.push(`  ${n.op.padEnd(18)} ${ms.toFixed(0).padStart(6)} ms`);
  }
  console.log(`${label}: ${total.toFixed(0)} ms for ${w}×${h} (${((total * 1000) / (w * h)).toFixed(2)} µs/px)\n${rows.join('\n')}`);
  return total;
}

console.log(`RefEngine mode ${mode}, ${kind}, ${w}×${h}`);
await stages(r, 'first render (every stage)');
const r2 = { ...r, print: { ...r.print, enlarger: { ...r.print.enlarger, time_s: r.print.enlarger.time_s * 1.12 } } };
await stages(r2, 'time × 1.12 (print-only change)');
const r3 = { ...r2, print: { ...r2.print, enlarger: { ...r2.print.enlarger, filtration: { ...r2.print.enlarger.filtration, m: r2.print.enlarger.filtration.m + 5 } } } };
await stages(r3, 'filtration M +5 (print-only change)');
