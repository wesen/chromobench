// A small LooksProvider for the DSL tests and the looks topic (contract only; the real one is studio-kit's
// cb.kits.looks.provider(), tested there against a DslSession). Three looks: 'warm print' (lights offset in points,
// scaled by Amount), 'grade 3' (an absolute grade, linear in Amount) and a film look that needs a digital RAW.
import { canonicalJSON, diag, fail, getPath, LOGH_PER_POINT, settablePaths, type FrameRecipe, type Mutation } from '@chromobench/contract';
import type { LooksProvider } from '../src/index.ts';

const LOOKS = [
  { id: 'warm-print', name: 'warm print', group: 'Print', requires: 'any', params: { warmth: { type: 'number', unit: 'point', min: 0, max: 10, default: 4 } } },
  { id: 'grade-3', name: 'grade 3', group: 'Contrast', requires: 'any', params: {} },
  { id: 'portra', name: 'Portra 400 on Endura', group: 'Film', requires: 'digital-raw', params: {} },
];

function diff(a: FrameRecipe, b: FrameRecipe): { path: string; shown: string }[] {
  return settablePaths()
    .filter((p) => !p.includes('*') && canonicalJSON(getPath(a, p) ?? null) !== canonicalJSON(getPath(b, p) ?? null))
    .map((p) => ({ path: p, shown: `${p} ${canonicalJSON(getPath(a, p))} → ${canonicalJSON(getPath(b, p))}` }));
}

export function testLooks(): LooksProvider {
  return {
    list: () => LOOKS.map((l) => ({ ...l })),
    resolve: (id, frame, params, opts) => {
      const l = LOOKS.find((x) => x.id === id || x.name === id);
      if (!l) return fail('E_UNKNOWN_OPTION', `no look "${id}"`, { valid: LOOKS.map((x) => x.name) });
      const k = opts.amount ?? 1;
      const label = `Look: ${l.name}${k === 1 ? '' : ` at ${Math.round(k * 100)} %`}`;
      if (l.requires === 'digital-raw' && frame.recipe.kind !== 'digital-raw') return { look: l, label, mutations: [], diff: [], skip: diag('E_KIND', `'${l.name}' needs a digital RAW`, { hint: 'This look needs a digital RAW' }) };
      const ms: Mutation[] = [];
      const r = frame.recipe;
      if (l.id === 'warm-print') {
        const w = Number(params['warmth'] ?? 4);
        if (w < 0 || w > 10) fail('E_ARG_RANGE', `warm print.warmth = ${w} is outside [0, 10]`);
        const d = [-w / 2, 0, w / 2].map((x) => x * LOGH_PER_POINT * k);
        ms.push({ op: 'set', path: 'print.lights.logH', value: r.print.lights.logH.map((x, i) => Number((x + d[i]!).toFixed(9))) });
      }
      if (l.id === 'grade-3') ms.push({ op: 'set', path: 'print.grade', value: r.print.grade + (3 - r.print.grade) * k });
      let after = r;
      for (const m of ms) after = { ...after, print: { ...after.print, ...(m.op === 'set' && m.path === 'print.grade' ? { grade: m.value as number } : {}), ...(m.op === 'set' && m.path === 'print.lights.logH' ? { lights: { ...after.print.lights, logH: m.value as [number, number, number] } } : {}) } };
      return { look: l, label, mutations: ms, diff: diff(r, after) };
    },
    diff,
  };
}
