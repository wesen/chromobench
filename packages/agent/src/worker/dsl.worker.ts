// The DSL Web Worker entry: one DslSession per worker (protocol.ts). Started by createDslWorker().
import { serveDsl } from './server.ts';
import type { Endpoint } from './protocol.ts';

serveDsl(self as unknown as Endpoint);
