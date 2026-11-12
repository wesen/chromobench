// Ways to start the DSL session's worker: a real module Web Worker in the browser (Vite bundles dsl.worker.ts
// through the new URL(…, import.meta.url) pattern), or the same server on a MessageChannel in this thread
// (Node tests, environments without workers). The in-thread variant cannot stop a VM by force: terminate()
// closes the channel and disposes the session after it returns.
import type { Endpoint, WorkerLike } from './protocol.ts';
import { serveDsl } from './server.ts';

export function createDslWorker(): WorkerLike {
  return new Worker(new URL('./dsl.worker.ts', import.meta.url), { type: 'module', name: 'chromobench-dsl' });
}

export function inThreadWorker(): WorkerLike {
  const ch = new MessageChannel();
  const stop = serveDsl(ch.port2 as unknown as Endpoint);
  const p = ch.port1;
  return {
    postMessage: (m: unknown, transfer?: Transferable[]) => p.postMessage(m, transfer ?? []),
    addEventListener: (t: 'message', fn: (e: MessageEvent) => void) => p.addEventListener(t, fn),
    removeEventListener: (t: 'message', fn: (e: MessageEvent) => void) => p.removeEventListener(t, fn),
    start: () => p.start(),
    terminate: () => {
      p.close();
      ch.port2.close();
      stop();
    },
  };
}
