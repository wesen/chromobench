// The looks shipped with the app (guide §7.1): host-side JS, registered at install. Offsets on the paths the roll
// balance owns (lights, time), absolute values for paper and grade. Which sign of light is "warm" follows
// studio-kit's nudge: more blue light makes more yellow dye, less red light less cyan.
//
// The film looks use the film stage's medium (camera files) and the mock stock ids until its data pack lands; the
// preflash of 'flat grade 2' is a darkroom layer (CHB-037: the preflash is light on the paper, not a paper setting).

import { lightsOf } from '../../../../src/model/doc.ts';
import { add, look, mul, pt, slider, type Look } from './look.ts';

const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;

export const neutral: Look = look('neutral colour')
  .id('neutral')
  .group('Print')
  .notes('Removes the colour offset of the printer lights; keeps their density')
  .edits((f) => {
    const l = lightsOf(f.doc);
    const m = mean(l);
    return { 'lights.params.logH': add(l.map((x) => m - x)) };
  });

export const warmPrint: Look = look('warm print')
  .id('warm-print')
  .group('Print')
  .param('warmth', slider(0, 10, { unit: 'pt', default: 4, step: 0.5, label: 'Warmth' }))
  .param('density', slider(-1, 1, { unit: 'stop', default: 0, step: 1 / 6, label: 'Density' }))
  .edits((f, p) => ({
    'lights.params.logH': add(pt([-p.warmth / 2, 0, p.warmth / 2])),
    ...(p.density ? { 'main.params.time_s': add(p.density) } : {}),
  }));

export const coolShadows: Look = look('cool shadows')
  .id('cool-shadows')
  .group('Print')
  .param('coolness', slider(0, 10, { unit: 'pt', default: 4, step: 0.5, label: 'Coolness' }))
  .edits((f, p) => ({ 'lights.params.logH': add(pt([p.coolness / 2, 0, -p.coolness / 2])), 'stages.darkroom.medium.grade': add(-0.25) }));

export const flatGrade2: Look = look('flat grade 2')
  .id('flat-grade-2')
  .group('Contrast')
  .layers(() => [{ id: 'preflash', op: 'preflash', params: { fraction: 0.02 }, name: 'Preflash' }])
  .edits(() => ({ 'stages.darkroom.medium.grade': 2 }));

export const strongGrade4: Look = look('strong grade 4')
  .id('strong-grade-4')
  .group('Contrast')
  .edits(() => ({ 'stages.darkroom.medium.grade': 4 }));

export const printDensity: Look = look('print density')
  .id('print-density')
  .group('Print')
  .param('stops', slider(-2, 2, { unit: 'stop', default: 1 / 3, step: 1 / 6, label: 'Darker by' }))
  .edits((f, p) => ({ 'main.params.time_s': add(p.stops) }));

/** a film look over the film stage's medium (camera files); stock and paper are discrete, halation and grain scale */
export const portraEndura: Look = look('Portra 400 on Endura')
  .id('portra-400-endura')
  .group('Film')
  .requires({ source: 'digital-raw' })
  .param('push', slider(-2, 3, { unit: 'stop', step: 1 / 3, default: 0, label: 'Push' }))
  .param('halation', slider(0, 2, { default: 1, step: 0.1, label: 'Halation' }))
  .param('grain', slider(0, 2, { default: 1, step: 0.1, label: 'Grain' }))
  .edits((f, p) => ({
    'stages.film.medium.stock': 'kodak_portra_400',
    'stages.darkroom.medium.paper': 'kodak_portra_endura',
    'stages.film.medium.push': p.push,
    'stages.film.medium.halation.strength': mul(p.halation),
    'stages.film.medium.grain.amount': mul(p.grain),
  }));

export const gold200: Look = look('Gold 200, warm')
  .id('gold-200-warm')
  .group('Film')
  .requires({ source: 'digital-raw' })
  .param('grain', slider(0, 2, { default: 1.2, step: 0.1, label: 'Grain' }))
  .edits((f, p) => ({ 'stages.film.medium.stock': 'kodak_gold_200', 'stages.film.medium.grain.amount': mul(p.grain), 'lights.params.logH': add(pt([-1, 0, 1])) }));

export const BUILTIN_LOOKS: readonly Look[] = Object.freeze([neutral, warmPrint, coolShadows, flatGrade2, strongGrade4, printDensity, portraEndura, gold200]);
