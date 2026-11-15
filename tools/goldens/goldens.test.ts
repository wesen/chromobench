// The golden pictures (CHB-037 P0, P2b): every stored document re-renders to its stored pictures within the tolerance
// (render.ts --check, in-process; about 3 s on the reference engine), and each document is what translate.ts makes of
// the case's P0 recipe.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkAll, dataPath, readIndex, readJSON, TOLERANCE } from './golden.ts';
import { stackDocument, STACKS } from './stacks.ts';
import { translate } from './translate.ts';

describe('golden pictures', () => {
  it('cover the 60 translated cases and the stacks, both source kinds, every case rendered', () => {
    const idx = readIndex();
    expect(idx.cases.filter((c) => c.recipe).length).toBe(60);
    expect(idx.cases.filter((c) => !c.recipe).map((c) => c.id)).toEqual(STACKS.map((s) => s.id));
    expect(new Set(idx.cases.map((c) => c.fixture))).toEqual(new Set(['negative', 'camera', 'm1']));
    expect(idx.cases.filter((c) => !c.cuts).map((c) => c.id)).toEqual([]);
  });

  it('documents are the translation of the P0 recipes (translate.ts), or the stacks of stacks.ts', () => {
    for (const c of readIndex().cases) {
      if (!c.recipe) continue;
      const recipe = JSON.parse(readFileSync(dataPath(c.recipe), 'utf8')) as Record<string, unknown>;
      expect(translate(recipe), c.id).toEqual(readJSON(c.document));
    }
    for (const s of STACKS) expect(JSON.parse(JSON.stringify(stackDocument(s))), s.id).toEqual(readJSON(`cases/${s.id}/document.json`));
  });

  it(`re-render every stored document within max |Δ| ≤ ${TOLERANCE} at the cuts print and display`, async () => {
    const rep = await checkAll();
    const bad = rep.cases.filter((c) => !c.ok).map((c) => `${c.id}: ${c.cuts.map((x) => `${x.cut} ${x.maxAbs}${x.why ? ` (${x.why})` : ''}`).join(', ')}`);
    expect(bad).toEqual([]);
  }, 60_000);
});
