// Boot: open storage, build the engine, create the core, render <App/>, register the service worker,
// and expose the test/agent hook `window.chromobench` (CHB-007/008 replace `propose` with a real DSL eval).
// Engine (CHB-023): ?engine=auto (default: GPU when WebGPU works, else the reference engine) | gpu |
// reference | mock. ?long=N sets the GPU working image's long side (0 = the file's own size).
import type { EditLog, Engine, LoggedMutation, Mutation } from '@chromobench/contract';
import { MockEngine } from '@chromobench/engine-mock';
import { createRoot } from 'react-dom/client';
import { setKnownValues } from './core/controls.ts';
import { Studio, type StudioHost } from './core/studio.ts';
import { firstPrint } from './host/first-print.ts';
import type { StudioEngine } from './host/studio-engine.ts';
import { addScanExtensions } from './storage/fsa.ts';
import { memoryKV, openIdb, type KV } from './storage/db.ts';
import { Opfs } from './storage/opfs.ts';
import { App } from './ui/App.tsx';
import { StudioContext } from './ui/hooks.ts';
import './studio.css';
import './studio-app.css';

try {
  const t = localStorage.getItem('chromobench-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset['theme'] = t;
} catch {
  // no stored preference
}

const params = new URLSearchParams(location.search);
const want = params.get('engine') ?? 'auto';
const rootEl = document.getElementById('root')!;
let engine: Engine;
let host: StudioHost;
if (want === 'mock') {
  engine = new MockEngine();
  host = { label: 'mock engine (no physics)' };
} else {
  rootEl.innerHTML = '<p class="boot">Starting the engine…</p>';
  const say = (s: string): void => { rootEl.innerHTML = `<p class="boot">${s}</p>`; };
  try {
    const { createHostEngine } = await import('./host/engines.ts');
    const long = params.get('long');
    const h = await createHostEngine({ want: want === 'gpu' || want === 'reference' ? want : 'auto', ...(long !== null ? { long: Number(long) } : {}), onStatus: say });
    setKnownValues(h.catalog);
    addScanExtensions(h.extensions);
    engine = h.engine;
    const se: StudioEngine = h.engine;
    host = {
      label: se.label,
      firstPrint: (e, g, d) => firstPrint(e, g, d, { integrate: h.integrate }),
      notes: (sha) => se.notes.get(sha)?.notes ?? null,
      settings: h.settings,
    };
  } catch (e) {
    rootEl.innerHTML = `<p class="boot">The engine did not start: ${e instanceof Error ? e.message : String(e)}.<br/>Try <a href="?engine=reference">the reference engine</a> or <a href="?engine=mock">the mock engine</a>.</p>`;
    throw e;
  }
}
let kv: KV;
try {
  kv = await openIdb();
} catch {
  kv = memoryKV();
}
const studio = new Studio(engine, kv, await Opfs.open(kv), host);
await studio.init();

createRoot(document.getElementById('root')!).render(
  <StudioContext.Provider value={studio}>
    <App />
  </StudioContext.Provider>,
);

// PWA: a hand-written service worker (public/sw.js), network-first with a cache fallback.
if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
  void navigator.serviceWorker.register('/sw.js').then((reg) => {
    const ready = (): void => studio.update({ offline: 'ready' });
    if (navigator.serviceWorker.controller) ready();
    else studio.update({ offline: 'installing' });
    navigator.serviceWorker.addEventListener('controllerchange', ready);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) studio.update({ updateReady: true });
      });
    });
  }).catch(() => undefined);
}

/** Test and agent hook. Stands in for CHB-007's DSL eval until it lands: proposals enter by 'agent'. */
const hook = {
  studio,
  get log(): EditLog | null { return studio.session?.log ?? null; },
  get engine() { return engine; },
  /** Engine label as the status line shows it. */
  get engineLabel(): string { return studio.s.engineLabel; },
  /** Exports the current print (sRGB or Display P3, 8-bit PNG); returns its size, not the bytes. */
  async exportPng(space: 'srgb' | 'display-p3' = 'srgb') {
    const x = await studio.exportPng(space);
    return x ? { width: x.width, height: x.height, bytes: x.blob.size, type: x.blob.type, fileName: x.fileName } : null;
  },
  /** Waits for renders, probes and measurements in flight. */
  idle: (): Promise<void> => studio.idle(),
  /** Display-encoded value of a document pixel in the last presented result. */
  pixel: (x: number, y: number): number[] | null => studio.pixel(x, y),
  /** 8-bit value the presenter shows for a document pixel, read back from the canvas pipeline. */
  canvasPixel: (x: number, y: number): Promise<number[] | null> => studio.canvasPixel(x, y),
  chainRuns: () => studio.chainRuns(),
  /** frame.edit({path: value}) from an eval: one tx, by 'agent'. */
  propose(edits: Record<string, unknown>, why?: string): LoggedMutation[] {
    const ms: Mutation[] = Object.entries(edits).map(([path, value]) => ({ op: 'set', path, value }));
    return studio.propose(ms, why);
  },
};
declare global {
  interface Window { chromobench: typeof hook }
}
window.chromobench = hook;
