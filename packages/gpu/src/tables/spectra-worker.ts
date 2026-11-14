// Module worker (CHB-034): fits core's fallback spectra table (sigmoidSpectraTable, 64²) off the main thread. The
// same code as the main-thread fit, so the table is bitwise the one core would build; GpuEngine seeds core's cache
// with it at creation (seedFallbackSpectra). The fit takes ~110 ms on an M1 Max.
import { sigmoidSpectraTable } from '@chromobench/core';

export interface SpectraJob { cmf: [Float64Array, Float64Array, Float64Array] }
export interface SpectraReply { n?: number; data?: Float64Array; source?: string; error?: string; ms: number }

const scope = self as unknown as { onmessage: ((e: MessageEvent<SpectraJob>) => void) | null; postMessage(m: SpectraReply, t: Transferable[]): void };
scope.onmessage = (e) => {
  const t0 = performance.now();
  try {
    const t = sigmoidSpectraTable(e.data.cmf, 64);
    scope.postMessage({ n: t.n, data: t.data, source: t.source, ms: performance.now() - t0 }, [t.data.buffer]);
  } catch (err) {
    scope.postMessage({ error: err instanceof Error ? err.message : String(err), ms: performance.now() - t0 }, []);
  }
};
