// Module worker: builds node ranges of a table with the f64 oracle and transfers the result.
// The same code as the main-thread build, so its tables are bitwise equal (accel.js Pool, 3620–3696).
// The oracle is core's (solveNode / spectralNode over the table arrays), so worker tables are core's tables.
import { coreOracle, tableNodes } from '../physics/oracle.ts';
import type { SolveInputs, SpectralInputs } from './inputs.ts';

export interface WorkerJob { id: number; inp: SolveInputs | SpectralInputs; q0: number; q1: number }
export interface WorkerReply { id: number; q0: number; data?: Float32Array; error?: string; ms: number }

const scope = self as unknown as { onmessage: ((e: MessageEvent<WorkerJob>) => void) | null; postMessage(m: WorkerReply, t: Transferable[]): void };
scope.onmessage = (e) => {
  const { id, inp, q0, q1 } = e.data;
  const t0 = performance.now();
  try {
    const data = tableNodes(coreOracle, inp, q0, q1);
    scope.postMessage({ id, q0, data, ms: performance.now() - t0 }, [data.buffer]);
  } catch (err) {
    scope.postMessage({ id, q0, error: err instanceof Error ? err.message : String(err), ms: performance.now() - t0 }, []);
  }
};
