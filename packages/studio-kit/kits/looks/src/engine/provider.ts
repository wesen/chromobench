// The agent counterpart (guide §8.5): packages/dsl's LooksProvider over this kit's registry, so cb.looks.apply /
// whatIf / diff / list in an eval resolve the same looks with the same Amount and diff passes as the UI. The DSL
// does not import studio-kit; the host injects this (DslSession.create({ looks: cb.kits.looks.provider(() => state) })).
// The shape matches @chromobench/dsl's LooksProvider structurally.

import { closest, fail, type Diagnostic, type FrameRecipe, type Mutation } from '@chromobench/contract';
import { diffRecipes } from './diff.ts';
import type { Look } from './look.ts';
import { planFrame, planLabel } from './plan.ts';

export interface LooksProviderShape {
  list(): { id: string; name: string; group: string; requires: string; params: Record<string, { type: string; unit?: string; min?: number; max?: number; default?: unknown }> }[];
  resolve(
    id: string,
    frame: { id: string; recipe: FrameRecipe },
    params: Record<string, unknown>,
    opts: { amount?: number; from?: 'current' | 'defaults' },
  ): { look: { id: string; name: string }; label: string; mutations: Mutation[]; diff: { path: string; shown: string }[]; skip?: Diagnostic };
  diff(a: FrameRecipe, b: FrameRecipe): { path: string; shown: string }[];
}

export function looksProvider(all: () => readonly Look[]): LooksProviderShape {
  const find = (id: string): Look => {
    const ls = all();
    const l = ls.find((x) => x.id === id || x.name === id);
    if (l) return l;
    const names = ls.map((x) => x.name);
    const guess = closest(id, names) ?? closest(id, ls.map((x) => x.id));
    return fail('E_UNKNOWN_OPTION', `no look "${id}"`, { ...(guess ? { hint: `did you mean '${guess}'?`, fix: `cb.looks.apply('${guess}', …)` } : {}), valid: names });
  };
  return {
    list: () =>
      all().map((l) => ({
        id: l.id, name: l.name, group: l.group, requires: l.requires,
        params: Object.fromEntries(Object.entries(l.params).map(([k, s]) => [k, { type: s.type, ...(s.unit ? { unit: s.unit } : {}), ...(s.min !== undefined ? { min: s.min } : {}), ...(s.max !== undefined ? { max: s.max } : {}), default: s.default }])),
      })),
    resolve: (id, frame, params, opts) => {
      const l = find(id);
      const k = opts.amount ?? 1;
      const pf = planFrame(l, params, frame.id, frame.recipe, { amount: k, ...(opts.from ? { from: opts.from } : {}) });
      // a bad parameter is the agent's error, not a skipped frame
      if (pf.skipped && ['E_ARG_RANGE', 'E_ARG_TYPE', 'E_UNKNOWN_OPTION'].includes(pf.skipped.code)) fail(pf.skipped.code as 'E_ARG_RANGE', pf.skipped.message, pf.skipped);
      return { look: { id: l.id, name: l.name }, label: planLabel(l.name, k), mutations: pf.mutations, diff: pf.diff.map((d) => ({ path: d.path, shown: d.shown })), ...(pf.skipped ? { skip: pf.skipped } : {}) };
    },
    diff: (a, b) => diffRecipes(a, b).map((d) => ({ path: d.path, shown: d.shown })),
  };
}
