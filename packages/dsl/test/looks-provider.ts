// A small LooksProvider for the DSL tests and the looks topic (contract only; the real one is studio-kit's looks
// kit, tested there against a DslSession). Three looks: 'warm print' (printer lights offset in points, scaled by
// Amount), 'grade 3' (the darkroom medium's grade, linear in Amount) and a film look that needs a camera file.
import { canonicalJSON, diag, documentKind, fail, LOGH_PER_POINT, type Document } from '@chromobench/contract';
import { getPath, set, type Mutation } from '@chromobench/values';
import type { LooksProvider } from '../src/index.ts';

const LOOKS = [
  { id: 'warm-print', name: 'warm print', group: 'Print', requires: 'any', params: { warmth: { type: 'number', unit: 'point', min: 0, max: 10, default: 4 } } },
  { id: 'grade-3', name: 'grade 3', group: 'Contrast', requires: 'any', params: {} },
  { id: 'portra', name: 'Portra 400 on Endura', group: 'Film', requires: 'digital-raw', params: {} },
];

const PATHS = ['lights.params.logH', 'stages.darkroom.medium.grade'];

function diff(a: Document, b: Document): { path: string; shown: string }[] {
  return PATHS
    .filter((p) => canonicalJSON(getPath(a, p) ?? null) !== canonicalJSON(getPath(b, p) ?? null))
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
      const d = frame.doc;
      if (l.requires === 'digital-raw' && documentKind(d) !== 'digital-raw') return { look: l, label, mutations: [], diff: [], skip: diag('E_KIND', `'${l.name}' needs a camera file`, { hint: 'This look needs a camera file' }) };
      const ms: Mutation[] = [];
      if (l.id === 'warm-print') {
        const w = Number(params['warmth'] ?? 4);
        if (w < 0 || w > 10) fail('E_ARG_RANGE', `warm print.warmth = ${w} is outside [0, 10]`);
        const now = getPath(d, 'lights.params.logH') as number[];
        const dx = [-w / 2, 0, w / 2].map((x) => x * LOGH_PER_POINT * k);
        ms.push(set('lights.params.logH', now.map((x, i) => Number((x + dx[i]!).toFixed(9)))));
      }
      if (l.id === 'grade-3') {
        const g = getPath(d, 'stages.darkroom.medium.grade') as number;
        ms.push(set('stages.darkroom.medium.grade', g + (3 - g) * k));
      }
      let after: Document = d;
      for (const m of ms) if (m.op === 'set') after = setIn(after, m.path, m.value);
      return { look: l, label, mutations: ms, diff: diff(d, after) };
    },
    diff,
  };
}

/** A copy of the document with one value replaced (for the diff of the test looks only). */
function setIn(d: Document, path: string, v: unknown): Document {
  const c = structuredClone(d) as unknown as Record<string, unknown>;
  const segs = path === 'lights.params.logH' ? ['stages', 'darkroom', 'stack', 'items', 'lights', 'params', 'logH'] : path.split('.');
  let cur = c;
  for (const s of segs.slice(0, -1)) cur = cur[s] as Record<string, unknown>;
  cur[segs.at(-1)!] = v;
  return c as unknown as Document;
}
