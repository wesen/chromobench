// Medium presets (contract 3.0, CHB-048 LOOK-6, decision D6): film stocks and papers from the data pack, and the
// paper grades, as presets of the film and darkroom media. A preset is a set of medium fields: choosing it sets the
// medium (one undo step); nothing is linked, so it is not a look (looks are versioned link functions for edits; a
// stock is the medium itself). The data pack names the stocks; the contract only says how a pack's stocks become
// presets, so every host (the studio, a test, an agent's tool) builds the same list from the same pack.
//
//   film     a negative film of the pack: { stock, push }. A pushed development profile (`<stock>_push<n>`, as
//            "Kodak Portra 800 (Push 1)") is the base stock developed n stops pushed: { stock: base, push: n }, which
//            reads the measured profile (core developmentAt). Slide films (positive) are not offered: chromobench prints
//            negatives on paper. Grouped by the pack's use: still or cinema.
//   paper    a paper (or a cinema print film) of the pack: { paper }.
//   grade    the paper's contrast grades 0, ½, 1 … 5 (print.develop grade: a gamma about the aim grey): { grade }.
// The camera file's other film fields (exposure, format, halation, DIR, grain) are relative to the stock and stay.
import type { JsonObject } from '@chromobench/values';

/** What a preset list needs to know of a pack's stock (core StockData: id, name, role, type, meta.use, meta.targetPrint). */
export interface StockFacts {
  readonly id: string;
  /** The pack's name ("Kodak Portra 400"); absent: the id. */
  readonly name?: string;
  readonly role: 'film' | 'paper';
  readonly type: 'negative' | 'positive' | string;
  /** 'still' or 'cine'. */
  readonly use?: string;
  /** The pack's print stock for a film. */
  readonly targetPrint?: string | null;
}

export type PresetKind = 'film' | 'paper' | 'grade';
export const PRESET_KINDS: readonly PresetKind[] = ['film', 'paper', 'grade'];
/** The stage each kind sets the medium of. */
export const PRESET_STAGE: Readonly<Record<PresetKind, 'film' | 'darkroom'>> = Object.freeze({ film: 'film', paper: 'darkroom', grade: 'darkroom' });

export interface MediumPreset {
  readonly kind: PresetKind;
  /** The preset's id: the pack's stock id (a pushed profile's own id), or `grade-<n>`. */
  readonly id: string;
  /** In his words: the pack's name, or the grade's. */
  readonly label: string;
  readonly group: string;
  /** The medium fields it sets (paths relative to the stage's medium). */
  readonly set: JsonObject;
  /** A line about it (the pack's print stock for a film). */
  readonly note?: string;
}

const PUSHED = /^(.*)_push(\d+)$/;

/** The film presets of a pack: its negative films, a pushed profile as its base stock pushed. */
export function filmPresets(stocks: readonly StockFacts[]): MediumPreset[] {
  const ids = new Set(stocks.map((s) => s.id));
  const name = (id: string): string => stocks.find((s) => s.id === id)?.name ?? id;
  const out: MediumPreset[] = [];
  for (const s of stocks) {
    if (s.role !== 'film' || s.type === 'positive') continue;
    const p = PUSHED.exec(s.id);
    const base = p && ids.has(p[1]!) ? p[1]! : null;
    out.push({
      kind: 'film', id: s.id, label: s.name ?? s.id,
      group: s.use === 'cine' ? 'Cinema negative film' : 'Colour negative film',
      set: { stock: base ?? s.id, push: base ? Number(p![2]) : 0 },
      ...(s.targetPrint ? { note: `The data pack prints it on ${name(s.targetPrint)}.` } : {}),
    });
  }
  return out.sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === 'Colour negative film' ? -1 : 1));
}

/** The paper presets of a pack: its papers, then its cinema print films. */
export function paperPresets(stocks: readonly StockFacts[]): MediumPreset[] {
  return stocks
    .filter((s) => s.role === 'paper')
    .map((s): MediumPreset => ({ kind: 'paper', id: s.id, label: s.name ?? s.id, group: s.use === 'cine' ? 'Cinema print film' : 'Colour paper', set: { paper: s.id } }))
    .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === 'Colour paper' ? -1 : 1));
}

/** The paper grades, whole and half (as multigrade filters come): print.develop's grade, a gamma about the aim grey. */
const GRADE_WORDS: Readonly<Record<number, string>> = { 0: 'very soft', 1: 'soft', 2: 'normal: the paper as made', 3: 'hard', 4: 'very hard', 5: 'extra hard' };
export const GRADE_PRESETS: readonly MediumPreset[] = Object.freeze(
  Array.from({ length: 11 }, (_, i) => i / 2).map((g): MediumPreset => ({
    kind: 'grade', id: `grade-${g}`, label: `Grade ${g === 0.5 ? '½' : `${Math.floor(g)}${g % 1 ? '½' : ''}`}${GRADE_WORDS[g] ? ` (${GRADE_WORDS[g]})` : ''}`, group: 'Grade', set: { grade: g },
  })),
);

/** Every preset of a kind for a pack. */
export function mediumPresets(kind: PresetKind, stocks: readonly StockFacts[]): MediumPreset[] {
  return kind === 'film' ? filmPresets(stocks) : kind === 'paper' ? paperPresets(stocks) : [...GRADE_PRESETS];
}

/** The document paths and values a preset sets. */
export function presetSets(p: MediumPreset): { path: string; value: JsonObject[string] }[] {
  return Object.entries(p.set).map(([k, value]) => ({ path: `stages.${PRESET_STAGE[p.kind]}.medium.${k}`, value }));
}

/** The preset a medium is now (every field it sets equal), or null: none of them. */
export function presetOf(medium: Readonly<Record<string, unknown>> | undefined, presets: readonly MediumPreset[]): MediumPreset | null {
  if (!medium) return null;
  return presets.find((p) => Object.entries(p.set).every(([k, v]) => medium[k] === v)) ?? null;
}
