// Boot: open storage, create the core, render <App/>, register the service worker, and expose the
// test/agent hook `window.chromobench` (CHB-007/008 replace `propose` with a real DSL eval).
import type { EditLog, LoggedMutation, Mutation } from '@chromobench/contract';
import { MockEngine } from '@chromobench/engine-mock';
import { createRoot } from 'react-dom/client';
import { Studio } from './core/studio.ts';
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

const engine = new MockEngine();
let kv: KV;
try {
  kv = await openIdb();
} catch {
  kv = memoryKV();
}
const studio = new Studio(engine, kv, await Opfs.open(kv));
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
