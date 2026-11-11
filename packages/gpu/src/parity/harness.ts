// Parity harness (guide §5.1, §8): compares a fast result with the slow f64 reference and returns
// numbers, so failures print numbers rather than screenshots.

export interface ParityReport {
  name: string;
  n: number;
  maxDiff: number;
  meanDiff: number;
  rms: number;
  /** Nodes whose residual changes side of the threshold. */
  flips: number;
  tolerance: number;
  pass: boolean;
  extra?: Record<string, unknown>;
}

export interface CompareOptions {
  tolerance: number;
  /** Channels to compare per element (default 0..stride-1). */
  channels?: number[];
  stride?: number;
  /** Compare only elements where `include(i)` is true (e.g. nodes the reference reaches). */
  include?: (i: number) => boolean;
  /** Residual channel and threshold for flip counting (e.g. 3 and 0.01). */
  flip?: { channel: number; threshold: number };
  /** Additional acceptance besides maxDiff ≤ tolerance. */
  maxFlips?: number;
}

export function compare(name: string, fast: ArrayLike<number>, slow: ArrayLike<number>, o: CompareOptions): ParityReport {
  const stride = o.stride ?? 4;
  const chans = o.channels ?? Array.from({ length: stride }, (_, i) => i);
  const count = Math.floor(slow.length / stride);
  let maxDiff = 0;
  let sum = 0;
  let sq = 0;
  let n = 0;
  let flips = 0;
  for (let i = 0; i < count; i++) {
    if (o.flip) {
      const a = fast[i * stride + o.flip.channel]! < o.flip.threshold;
      const b = slow[i * stride + o.flip.channel]! < o.flip.threshold;
      if (a !== b) flips++;
    }
    if (o.include && !o.include(i)) continue;
    for (const c of chans) {
      const d = Math.abs(fast[i * stride + c]! - slow[i * stride + c]!);
      if (!(d <= maxDiff)) maxDiff = Number.isNaN(d) ? Infinity : d;
      sum += d;
      sq += d * d;
      n++;
    }
  }
  const pass = maxDiff <= o.tolerance && flips <= (o.maxFlips ?? Infinity);
  return { name, n, maxDiff, meanDiff: n ? sum / n : 0, rms: n ? Math.sqrt(sq / n) : 0, flips, tolerance: o.tolerance, pass };
}
