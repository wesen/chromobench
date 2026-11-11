// Module-worker entry for the browser:
//   const w = new Worker(new URL('./worker-entry.ts', import.meta.url), { type: 'module' });
//   const raw = workerRawDecoder(w, { wasmUrl });   // wasmUrl: libraw.wasm as the host serves it (Vite: `?url`)
import type { Port } from './protocol.ts';
import { serveRawJobs } from './worker.ts';

serveRawJobs(globalThis as unknown as Port);
