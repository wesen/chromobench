// The studio-kit dev host: mounts a variant (?variant=classic|darkroom|simple|lab|tiny) on MockEngine with the M1
// fixture TIFF plus a few synthetic frames of the same roll, the Canvas2D presenter and a KV in localStorage
// (?fresh: in memory). window.chromobench is the test hook (CHB-009's surface: log, propose, … plus app, variant,
// explain, run). An unknown variant shows the Build Report page with a did-you-mean.
//
//   pnpm --filter @chromobench/studio-kit demo        → http://localhost:4187/demo/?variant=classic
//
// The real host is apps/studio (IndexedDB KV, WebGPU presenter, engine choice, ingest, first print, export).

import { closest } from '@chromobench/contract';
import { m1Codes, MockEngine, M1, writeTiff16 } from '@chromobench/engine-mock';
import type { Runtime } from '@chromobench/shell';
import '@chromobench/shell/shell.css';
import { buildVariant, createStudio, localStorageKV, memoryKV, type Studio } from '../src/index.ts';
import { mountStudio } from '../src/dom/index.ts';
import '../src/dom/studio-kit.css';
import { DEFAULT_VARIANT, VARIANTS, type VariantId } from '../variants/index.js';
import fixtureUrl from '../../../fixtures/synthetic/m1-negative-96x64.tif?url';

const q = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
const id = q.get('variant') ?? DEFAULT_VARIANT;

function report(title: string, lines: string[]): void {
  root.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'report';
  div.id = 'build-report';
  const h = document.createElement('h2');
  h.textContent = title;
  const pre = document.createElement('pre');
  pre.textContent = lines.join('\n');
  div.append(h, pre);
  root.append(div);
  document.body.dataset['ready'] = 'report';
}

/** more frames of the roll: the M1 negative exposed a little differently each time */
function rollFrames(): { name: string; bytes: Uint8Array }[] {
  const out: { name: string; bytes: Uint8Array }[] = [];
  const base = m1Codes();
  const shifts: [number, number, number][] = [
    [0.8, 0.8, 0.8],
    [1.25, 1.25, 1.25],
    [1, 0.85, 0.7],
    [0.75, 0.9, 1.1],
    [1.1, 1, 0.9],
  ];
  shifts.forEach(([r, g, b], i) => {
    const c = new Uint16Array(base.length);
    for (let j = 0; j < base.length; j += 3) {
      // the frame area only: the rebate (x < 8) stays, so the inversion sees a different exposure
      const x = (j / 3) % M1.width;
      if (x < M1.rebate.w) {
        c.set(base.subarray(j, j + 3), j);
        continue;
      }
      c[j] = Math.min(65535, Math.round(base[j]! * r));
      c[j + 1] = Math.min(65535, Math.round(base[j + 1]! * g));
      c[j + 2] = Math.min(65535, Math.round(base[j + 2]! * b));
    }
    out.push({ name: `roll-${String(i + 2).padStart(2, '0')}.tif`, bytes: writeTiff16(M1.width, M1.height, c) });
  });
  return out;
}

async function main(): Promise<void> {
  const load = VARIANTS[id as VariantId];
  if (!load) {
    const guess = closest(id, Object.keys(VARIANTS));
    report(`CB-K520 Unknown variant '${id}'`, [`?variant=${id} is not a registered variant.`, guess ? `Did you mean ?variant=${guess}?` : '', `Variants: ${Object.keys(VARIANTS).join(', ')}`]);
    return;
  }
  const def = (await load()).default;
  const built = buildVariant(def, { env: { dev: true } });
  const errors = built.app.diagnostics.list.filter(d => d.level === 'error');
  if (errors.length) {
    report(`Build Report: ${def.label}`, errors.map(d => `${d.code} ${d.message}${d.at ? `  ${d.at.file}:${d.at.line}` : ''}${d.fix ? `\n  fix: ${d.fix}` : ''}`));
    return;
  }
  const kv = q.has('fresh') ? memoryKV() : localStorageKV(`cb-kit-${id}`);
  const studio: Studio = createStudio({ engine: new MockEngine(), kv });
  const save = async (f: string) => {
    const r = (rt.store.peek(['recipes', f]) as never) ?? null;
    if (!r) return;
    const res = await studio.bridge.render({ $: 'cb.image', frame: f, recipe: r, what: 'print', args: {}, expr: 'frame.print()' }, { slot: 'save', epoch: 0, lane: 'bg', pass: 'screen', maxSide: 4096, signal: new AbortController().signal });
    const { width: w, height: hh, data, channels } = res.image;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = hh;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(w, hh);
    for (let i = 0; i < w * hh; i++) for (let k = 0; k < 4; k++) img.data[i * 4 + k] = k === 3 ? 255 : Math.round(Math.min(1, Math.max(0, Number(data[i * channels + Math.min(k, channels - 1)]))) * 255);
    ctx.putImageData(img, 0, 0);
    const a = document.createElement('a');
    a.download = `${f}.png`;
    a.href = cv.toDataURL('image/png');
    a.click();
  };
  const { rt } = await mountStudio(built.app, root, studio, { save });
  const fixture = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
  await studio.open(fixture, 'm1-negative-96x64.tif');
  for (const fr of rollFrames()) await studio.open(fr.bytes, fr.name);
  hook(rt, studio, def.id);
  for (const d of built.app.diagnostics.list) if (d.level === 'warning') console.warn(d.code, d.message);
  document.body.dataset['ready'] = '1';
  document.body.dataset['variant'] = def.id;
}

function hook(rt: Runtime, studio: Studio, variant: string): void {
  const log = (f?: string) => studio.frames.get(f ?? studio.current ?? '')?.log ?? null;
  (window as unknown as { chromobench: Record<string, unknown> }).chromobench = {
    app: rt.app,
    rt,
    studio,
    variant,
    explain: () => rt.explain({ live: true }),
    run: (cmd: string, ...a: unknown[]) => rt.runCommand(cmd, null, ...a),
    state: () => rt.store.peek([]),
    log,
    propose: (ms: never[], why?: string) => studio.propose(ms, why ? { why } : {}),
    idle: () => new Promise(r => setTimeout(r, 50)),
    chainRuns: () => Object.fromEntries(studio.bridge.runs),
  };
}

main().catch(e => {
  console.error(e);
  report('The studio failed to start', [String(e?.stack ?? e)]);
});
