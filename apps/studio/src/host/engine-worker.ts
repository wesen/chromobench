// Module-worker entry of the engine worker (CHB-027 WS-B, F4); the job loop is host/engine-serve.ts.
//   new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' })
import { serveEngine, type EngineScope } from './engine-serve.ts';

serveEngine(globalThis as unknown as EngineScope);
