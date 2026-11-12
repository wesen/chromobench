// GpuEngine's result cache policy (split from engine-gpu.ts, CHB-032): least recently used first, bounded by an
// entry count (GpuEngineOptions.cacheLimit) and by RESULT_CACHE_BYTES.
import { RESULT_CACHE_BYTES, type Cached } from './defs.ts';

/** Adds a result, then drops the least recently used ones over RESULT_CACHE_BYTES or the entry limit (the new one stays). */
export function addResult(results: Map<string, Cached>, key: string, res: Cached, cacheLimit?: number): void {
  results.set(key, res);
  // an entry-count limit (CHB-023: an interactive host makes a new result per slider step)
  const limit = Math.max(4, cacheLimit ?? Infinity);
  while (results.size > limit) results.delete(results.keys().next().value!);
  let bytes = 0;
  for (const r of results.values()) bytes += r.data.byteLength;
  for (const [k, r] of results) {
    if (bytes <= RESULT_CACHE_BYTES || k === key) break;
    results.delete(k);
    bytes -= r.data.byteLength;
  }
}
