// CHB-048 (LOOK-6, D6): the medium presets of the data pack the studio loads: its negative films (a pushed profile as
// its base stock pushed), its papers and cinema print films, by the pack's names; slide films are not offered. Choosing
// a pushed profile prints like the pushed development of its base stock.
import { filmPresets, GRADE_PRESETS, newDocument, paperPresets, presetOf, presetSets, edit, type StockFacts } from '@chromobench/contract';
import { set } from '@chromobench/values';
import { describe, expect, it } from 'vitest';
import { nodePacksData } from './film-helpers.ts';

const data = nodePacksData();
const facts: StockFacts[] = data.stockIds().map((id) => {
  const s = data.stock(id);
  return { id, ...(s.name ? { name: s.name } : {}), role: s.role, type: s.type, ...(s.meta.use ? { use: s.meta.use } : {}), targetPrint: s.meta.targetPrint ?? null };
});

describe('medium presets from the data pack', () => {
  it('films: the pack\'s negative films by name, still before cinema, pushed profiles as push; no slide film', () => {
    const f = filmPresets(facts);
    expect(f.map((p) => p.label)).toEqual([
      'Fujifilm C200', 'Fujifilm Pro 400H', 'Fujifilm X-Tra 400', 'Kodak Ektar 100', 'Kodak Gold 200', 'Kodak Portra 160', 'Kodak Portra 400',
      'Kodak Portra 800', 'Kodak Portra 800 (Push 1)', 'Kodak Portra 800 (Push 2)', 'Kodak Ultramax 400',
      'Kodak Verita 200D', 'Kodak Vision3 200T', 'Kodak Vision3 250D', 'Kodak Vision3 500T', 'Kodak Vision3 50D',
    ]);
    expect(f.find((p) => p.id === 'kodak_portra_800_push2')!.set).toEqual({ stock: 'kodak_portra_800', push: 2 });
    expect(f.find((p) => p.id === 'kodak_gold_200')!.set).toEqual({ stock: 'kodak_gold_200', push: 0 });
    expect(f.find((p) => p.id === 'kodak_gold_200')!.note).toBe('The data pack prints it on Kodak Professional Portra Endura.');
    for (const slide of ['fujifilm_provia_100f', 'fujifilm_velvia_100', 'kodak_ektachrome_100', 'kodak_kodachrome_64']) expect(f.some((p) => p.id === slide)).toBe(false);
  });

  it('papers: the pack\'s papers, then its cinema print films; grades whole and half', () => {
    expect(paperPresets(facts).map((p) => `${p.group}: ${p.label}`)).toEqual([
      'Colour paper: Fujifilm Crystal Archive Type II', 'Colour paper: Kodak Ektacolor Edge', 'Colour paper: Kodak Professional Endura Premier',
      'Colour paper: Kodak Professional Portra Endura', 'Colour paper: Kodak Professional Supra Endura', 'Colour paper: Kodak Professional Ultra Endura',
      'Cinema print film: Kodak Vision 2383', 'Cinema print film: Kodak Vision Premier 2393',
    ]);
    expect(GRADE_PRESETS.map((p) => p.set['grade'])).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
    expect(GRADE_PRESETS[4]!.label).toBe('Grade 2 (normal: the paper as made)');
  });

  it('a preset sets the medium and is recognised in it; a new camera file is on Portra 400', () => {
    const d = newDocument('digital-raw', { sha256: 'a'.repeat(64), width: 30, height: 20 });
    const films = filmPresets(facts);
    expect(presetOf(d.stages.film!.medium as never, films)!.id).toBe('kodak_portra_400');
    const p = films.find((x) => x.id === 'kodak_portra_800_push1')!;
    const r = edit(d, presetSets(p).map((s) => set(s.path, s.value))).doc;
    expect(presetOf(r.stages.film!.medium as never, films)!.id).toBe('kodak_portra_800_push1');
    // a push the pack has no profile for is none of the presets ("Custom")
    expect(presetOf(edit(r, [set('stages.film.medium.push', 3)]).doc.stages.film!.medium as never, films)).toBeNull();
    // (the pushed preset's print is the golden cam-film-portra-800-push1)
  });
});
