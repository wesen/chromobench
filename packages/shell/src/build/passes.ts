// The pass manager: passes over named IRs, ordered by a topological sort of after/before (ties keep installation
// order). A cycle is CK-X140, an unknown name in after/before CK-X141. The shell runs `ui` passes at .build();
// other IRs (studio-kit's recipe, op-dag, mutation-batch) run on demand with ck.run(on, ir).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { diag, Diagnostics, site, type Diag } from '../core/diag.ts';
import type { PassCtx, PassDef } from './types.ts';

export function pass<I = any>(name: string, o: { on?: string; after?: string | string[]; before?: string | string[]; options?: Record<string, unknown> } | string, run: (ir: I, p: PassCtx) => I | void): PassDef<I> {
  const opts = typeof o === 'string' ? { on: o } : o;
  const list = (v: string | string[] | undefined): string[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const def: PassDef<I> = { kind: 'pass', name, on: opts.on || 'ui', after: list(opts.after), before: list(opts.before), run, at: site() };
  if (opts.options) def.options = opts.options;
  return def;
}
export const isPass = (v: unknown): v is PassDef => !!v && typeof v === 'object' && (v as PassDef).kind === 'pass';

/** Order passes: after/before edges, installation order for ties. Reports X140/X141 into D. */
export function orderPasses(passes: PassDef[], D: Diagnostics): PassDef[] {
  const byName = new Map<string, PassDef>();
  for (const p of passes) if (!byName.has(p.name)) byName.set(p.name, p);
  const list = [...byName.values()];
  const idx = new Map(list.map((p, i) => [p.name, i]));
  const edges = new Map<string, Set<string>>(list.map(p => [p.name, new Set<string>()])); // a → b: a before b
  for (const p of list) {
    for (const a of p.after) {
      if (!byName.has(a)) {
        D.warn('CK-X141', `Pass '${p.name}' runs after '${a}', which is not installed`, { at: p.at, source: p.source ?? 'shell', facts: [`passes: ${list.map(x => x.name).join(', ')}`] });
        continue;
      }
      edges.get(a)!.add(p.name);
    }
    for (const b of p.before) {
      if (!byName.has(b)) {
        D.warn('CK-X141', `Pass '${p.name}' runs before '${b}', which is not installed`, { at: p.at, source: p.source ?? 'shell' });
        continue;
      }
      edges.get(p.name)!.add(b);
    }
  }
  const indeg = new Map(list.map(p => [p.name, 0]));
  for (const [, outs] of edges) for (const b of outs) indeg.set(b, indeg.get(b)! + 1);
  const ready = list.filter(p => indeg.get(p.name) === 0).map(p => p.name);
  const out: PassDef[] = [];
  while (ready.length) {
    ready.sort((a, b) => idx.get(a)! - idx.get(b)!);
    const n = ready.shift()!;
    out.push(byName.get(n)!);
    for (const b of edges.get(n)!) {
      indeg.set(b, indeg.get(b)! - 1);
      if (indeg.get(b) === 0) ready.push(b);
    }
  }
  if (out.length < list.length) {
    const stuck = list.filter(p => !out.includes(p));
    D.error('CK-X140', 'Passes depend on each other in a cycle', {
      at: stuck[0]!.at,
      facts: stuck.map(p => `${p.name}: after ${p.after.join(', ') || '—'} · before ${p.before.join(', ') || '—'}${p.at ? `   ${p.at.file}:${p.at.line}` : ''}`),
      fix: 'Drop one of the after/before constraints between these passes.',
    });
    // run them anyway, in installation order, so the rest of the build still reports
    out.push(...stuck);
  }
  return out;
}

export interface RunResult<I> {
  ir: I;
  diagnostics: Diagnostics;
  order: string[];
  facts: Map<string, unknown>;
}

/** Run every pass on one IR kind, in order; a pass may return a new IR (rewrite or lowering). */
export function runPasses<I>(on: string, ir: I, passes: PassDef[], opts: { D?: Diagnostics; options?: Record<string, unknown>; extra?: Record<string, unknown>; explain?: (x: unknown) => string; facts?: Map<string, unknown> } = {}): RunResult<I> {
  const D = opts.D || new Diagnostics();
  const ordered = orderPasses(
    passes.filter(p => p.on === on),
    D,
  );
  const facts = opts.facts || new Map<string, unknown>();
  let cur = ir;
  for (const p of ordered) {
    const add = (level: Diag['level']) => (code: string, message: string, extra: Partial<Diag> = {}) => D.add(diag(code, message, { source: p.source ?? p.name, ...extra, level: extra.level ?? level }));
    const ctx: PassCtx = {
      ...(opts.extra || {}),
      diag: (code, message, extra = {}) => D.add(diag(code, message, { source: p.source ?? p.name, ...extra })),
      error: add('error'),
      warn: add('warning'),
      info: add('info'),
      options: { ...(opts.options || {}), ...(p.options || {}) },
      facts,
      explain: opts.explain || (x => String(x)),
      pass: p.name,
    };
    try {
      const r = p.run(cur, ctx);
      if (r !== undefined) cur = r;
    } catch (e) {
      D.error('CK-X150', `Pass '${p.name}' threw`, { at: p.at, source: p.source ?? p.name, facts: [String((e as Error)?.stack?.split('\n').slice(0, 3).join(' | ') || e)], fix: 'Passes are pure checks; guard reads that can be missing.' });
    }
  }
  return { ir: cur, diagnostics: D, order: ordered.map(p => p.name), facts };
}
