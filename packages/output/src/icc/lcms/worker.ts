// Dedicated module worker running lcms (guide §5.7): new Worker(new URL('./worker.ts', import.meta.url),
// { type: 'module' }), then lcmsInWorker(worker). Each message is one Lcms call; errors come back as
// { ok: false, code, message } so the page sees the same ChromobenchError codes as in-thread use.
import { toDiagnostic } from '@chromobench/contract';
import wasmUrl from 'lcms-wasm/dist/lcms.wasm?url';
import { createLcms, type Lcms, type LcmsCall, type LcmsReply } from './api.ts';

const scope = self as unknown as { onmessage: ((e: MessageEvent<LcmsCall>) => void) | null; postMessage(m: LcmsReply): void };
const lcmsP = createLcms({ locateFile: () => wasmUrl });

void lcmsP.then((l) => scope.postMessage({ id: 0, ready: true, version: l.version }));

scope.onmessage = async (e) => {
  const { id, method, args } = e.data;
  try {
    const l = (await lcmsP) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const value = await l[method]!(...args);
    scope.postMessage({ id, ok: true, value });
  } catch (err) {
    const d = toDiagnostic(err);
    scope.postMessage({ id, ok: false, code: d.code, message: d.message });
  }
};

export type { Lcms };
