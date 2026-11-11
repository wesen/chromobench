// Every variant builds headless in Node with zero error diagnostics, and its explain text is a reviewed snapshot.
import { describe, expect, it } from 'vitest';
import { buildVariant } from '../src/index.ts';
import { VARIANTS, type VariantId } from '../variants/index.js';

const ids = Object.keys(VARIANTS) as VariantId[];

describe('variants build headless', () => {
  for (const id of ids) {
    it(`${id}: zero errors, explain snapshot`, async () => {
      const def = (await VARIANTS[id]()).default;
      const { app } = buildVariant(def);
      const errors = app.diagnostics.list.filter(d => d.level === 'error');
      expect(errors.map(d => `${d.code} ${d.message} ${d.fix ?? ''}`)).toEqual([]);
      const text = app.explain();
      expect(text).toBe(buildVariant(def).app.explain());
      expect(text).toMatchSnapshot();
    });
  }
  it('warnings are listed (reviewed, not zero)', async () => {
    const out: Record<string, string[]> = {};
    for (const id of ids) out[id] = buildVariant((await VARIANTS[id]()).default).app.diagnostics.list.filter(d => d.level === 'warning').map(d => `${d.code} ${d.message}`);
    expect(out).toMatchSnapshot();
  });
});
