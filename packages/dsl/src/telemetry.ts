// Guide §5.13, measure then delete: aggregate EvalTraces into a usage report — vocabulary and
// ops never used (deletion candidates), the most frequent error codes, how often results were cut.
import type { EvalTrace } from './session.ts';
import { dslOps } from './host.ts';
import { VOCABULARY } from './docs/vocabulary.ts';

export interface UsageReport {
  evals: number;
  cutRate: number;
  errors: [string, number][];
  warnings: [string, number][];
  vocabulary: [string, number][];
  unusedVocabulary: string[];
  ops: [string, number][];
  unusedOps: string[];
}

/** Vocabulary counter keys used by the host → VOCABULARY names. */
const VOCAB_KEYS: Record<string, string> = {
  source: 'frame.source', scan: 'frame.scan', negative: 'frame.negative', print: 'frame.print', display: 'frame.display',
  'neg.print': 'neg.print', 'frame.edit': 'frame.edit', testStrip: 'cb.testStrip', ringAround: 'cb.ringAround',
};

const sorted = (m: Map<string, number>): [string, number][] => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

export function usageReport(traces: readonly EvalTrace[]): UsageReport {
  const count = (pick: (t: EvalTrace) => Record<string, number> | string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const t of traces) {
      const v = pick(t);
      if (Array.isArray(v)) for (const k of v) m.set(k, (m.get(k) ?? 0) + 1);
      else for (const [k, n] of Object.entries(v)) m.set(k, (m.get(k) ?? 0) + n);
    }
    return m;
  };
  const vocab = new Map<string, number>();
  for (const [k, n] of count((t) => t.vocabulary)) vocab.set(VOCAB_KEYS[k] ?? k, (vocab.get(VOCAB_KEYS[k] ?? k) ?? 0) + n);
  const ops = count((t) => t.ops);
  return {
    evals: traces.length,
    cutRate: traces.length ? traces.filter((t) => t.cut).length / traces.length : 0,
    errors: sorted(count((t) => t.errors)),
    warnings: sorted(count((t) => t.warnings)),
    vocabulary: sorted(vocab),
    unusedVocabulary: VOCABULARY.map((v) => v.name).filter((n) => !vocab.has(n) && Object.values(VOCAB_KEYS).includes(n)),
    ops: sorted(ops),
    unusedOps: dslOps().map((o) => o.name).filter((n) => !ops.has(n)),
  };
}

export function formatUsage(r: UsageReport): string {
  const top = (xs: [string, number][], n = 10): string => xs.slice(0, n).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  return [
    `evals: ${r.evals}; cut: ${(100 * r.cutRate).toFixed(1)}%`,
    `errors: ${top(r.errors)}`,
    `warnings: ${top(r.warnings)}`,
    `vocabulary: ${top(r.vocabulary, 20)}`,
    `unused vocabulary (deletion candidates): ${r.unusedVocabulary.join(', ') || 'none'}`,
    `ops: ${top(r.ops, 20)}`,
    `unused ops: ${r.unusedOps.length}`,
  ].join('\n');
}
