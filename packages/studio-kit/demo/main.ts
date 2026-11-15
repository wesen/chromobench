// The studio-kit dev host: mounts a layout (?layout=classic|darkroom|simple|lab|tiny|roll|looks) on MockEngine with the M1
// fixture TIFF plus a few synthetic frames of the same roll, the Canvas2D presenter and a KV in localStorage
// (?fresh: in memory). window.chromobench is the test hook (CHB-009's surface: log, propose, … plus app, layout,
// explain, run). An unknown layout shows the Build Report page with a did-you-mean.
//
//   pnpm --filter @chromobench/studio-kit demo        → http://localhost:4187/demo/?layout=classic
//
// The real host is apps/studio (IndexedDB KV, WebGPU presenter, engine choice, ingest, first print, export).

import { closest } from '@chromobench/contract';
import { m1Codes, MockEngine, M1 } from '@chromobench/engine-mock';
import { writeTiff16 } from '@chromobench/ingest';
import type { Runtime } from '@chromobench/shell';
import '@chromobench/shell/shell.css';
import { buildLayout, createStudio, localStorageKV, memoryKV, type Studio } from '../src/index.ts';
import { mountStudio } from '../src/dom/index.ts';
import '../src/dom/studio-kit.css';
import { DEFAULT_LAYOUT, LAYOUTS, type LayoutId } from '../layouts/index.js';
import { ROLL_RENDERERS } from '../kits/roll/src/dom.ts';
import '../kits/roll/src/roll.css';
import { LOOKS_RENDERERS } from '../kits/looks/src/dom.ts';
import '../kits/looks/src/looks.css';
import { plantedStrip } from '@chromobench/ingest';
import { rollPhysics } from './roll-physics.ts';
import fixtureUrl from '../../../fixtures/synthetic/m1-negative-96x64.tif?url';

const q = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
const id = q.get('layout') ?? DEFAULT_LAYOUT;

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

/** ?layout=roll: planted 135 frames in a holder (sprocket holes, veil), differently exposed, one frame with a
 *  mixed base — what the roll kit's analysis is for (CHB-020) */
function plantedRoll(): { name: string; bytes: Uint8Array }[] {
  return [0, 0.004, 0.008, 0.002, 0.04, 0.006].map((off, i) => {
    const p = plantedStrip({ pxPerMm: 6, seed: 101 + i, scene: i, baseOffsetD: off, exposureD: 0.35 * Math.sin(1.7 * i), castD: [0.04 * Math.cos(i), 0, -0.03 * Math.sin(i)] });
    const c = new Uint16Array(p.rgb.length);
    for (let j = 0; j < c.length; j++) c[j] = Math.max(0, Math.min(65535, Math.round(p.rgb[j]! * 65535)));
    return { name: `roll-${String(i + 1).padStart(2, '0')}.tif`, bytes: writeTiff16(p.w, p.h, c) };
  });
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
  const load = LAYOUTS[id as LayoutId];
  if (!load) {
    const guess = closest(id, Object.keys(LAYOUTS));
    report(`CB-K520 Unknown layout '${id}'`, [`?layout=${id} is not a registered layout.`, guess ? `Did you mean ?layout=${guess}?` : '', `Layouts: ${Object.keys(LAYOUTS).join(', ')}`]);
    return;
  }
  const def = (await load()).default;
  const built = buildLayout(def, { env: { dev: true } });
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
  const { rt } = await mountStudio(built.app, root, studio, { save, rollPhysics: rollPhysics(), renderers: { ...ROLL_RENDERERS, ...LOOKS_RENDERERS } });
  if (def.id === 'roll') {
    for (const fr of plantedRoll()) await studio.open(fr.bytes, fr.name);
  } else {
    const fixture = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
    await studio.open(fixture, 'm1-negative-96x64.tif');
    for (const fr of rollFrames()) await studio.open(fr.bytes, fr.name);
  }
  hook(rt, studio, def.id);
  for (const d of built.app.diagnostics.list) if (d.level === 'warning') console.warn(d.code, d.message);
  document.body.dataset['ready'] = '1';
  document.body.dataset['layout'] = def.id;
}

function hook(rt: Runtime, studio: Studio, layout: string): void {
  const log = (f?: string) => studio.frames.get(f ?? studio.current ?? '')?.log ?? null;
  (window as unknown as { chromobench: Record<string, unknown> }).chromobench = {
    app: rt.app,
    rt,
    studio,
    layout,
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
