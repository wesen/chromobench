// The looks shipped with the app (guide §7.1): host-side JS, registered at install. Offsets on the paths the roll
// balance owns (lights, time), absolute values for paper and grade. Which sign of light is "warm" follows
// studio-kit's nudge: more blue light makes more yellow dye, less red light less cyan.
//
// The film look uses the capture paths of CHB-012 and the mock stock ids until its data pack lands.

import { add, look, mul, pt, slider, type Look } from './look.ts';

const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;

export const neutral: Look = look('neutral colour')
  .id('neutral')
  .group('Print')
  .notes('Removes the colour offset of the printer lights; keeps their density')
  .edits((f) => {
    const l = f.recipe.print.lights.logH;
    const m = mean(l);
    return { 'print.lights.logH': add(l.map((x) => m - x)) };
  });

export const warmPrint: Look = look('warm print')
  .id('warm-print')
  .group('Print')
  .param('warmth', slider(0, 10, { unit: 'pt', default: 4, step: 0.5, label: 'Warmth' }))
  .param('density', slider(-1, 1, { unit: 'stop', default: 0, step: 1 / 6, label: 'Density' }))
  .edits((f, p) => ({
    'print.lights.logH': add(pt([-p.warmth / 2, 0, p.warmth / 2])),
    ...(p.density ? { 'print.enlarger.time_s': add(p.density) } : {}),
  }));

export const coolShadows: Look = look('cool shadows')
  .id('cool-shadows')
  .group('Print')
  .param('coolness', slider(0, 10, { unit: 'pt', default: 4, step: 0.5, label: 'Coolness' }))
  .edits((f, p) => ({ 'print.lights.logH': add(pt([p.coolness / 2, 0, -p.coolness / 2])), 'print.grade': add(-0.25) }));

export const flatGrade2: Look = look('flat grade 2')
  .id('flat-grade-2')
  .group('Contrast')
  .edits(() => ({ 'print.grade': 2, 'print.preflash': 0.02 }));

export const strongGrade4: Look = look('strong grade 4')
  .id('strong-grade-4')
  .group('Contrast')
  .edits(() => ({ 'print.grade': 4 }));

export const printDensity: Look = look('print density')
  .id('print-density')
  .group('Print')
  .param('stops', slider(-2, 2, { unit: 'stop', default: 1 / 3, step: 1 / 6, label: 'Darker by' }))
  .edits((f, p) => ({ 'print.enlarger.time_s': add(p.stops) }));

/** a film look over the capture paths (CHB-012); stock and paper are discrete, halation and grain scale */
export const portraEndura: Look = look('Portra 400 on Endura')
  .id('portra-400-endura')
  .group('Film')
  .requires({ source: 'digital-raw' })
  .param('push', slider(-2, 3, { unit: 'stop', step: 1 / 3, default: 0, label: 'Push' }))
  .param('halation', slider(0, 2, { default: 1, step: 0.1, label: 'Halation' }))
  .param('grain', slider(0, 2, { default: 1, step: 0.1, label: 'Grain' }))
  .edits((f, p) => ({
    'capture.stock': 'kodak_portra_400',
    'print.paper': 'kodak_portra_endura',
    'capture.development.push': p.push,
    'capture.development.halation.strength': mul(p.halation),
    'capture.development.grain.amount': mul(p.grain),
  }));

export const gold200: Look = look('Gold 200, warm')
  .id('gold-200-warm')
  .group('Film')
  .requires({ source: 'digital-raw' })
  .param('grain', slider(0, 2, { default: 1.2, step: 0.1, label: 'Grain' }))
  .edits((f, p) => ({ 'capture.stock': 'kodak_gold_200', 'capture.development.grain.amount': mul(p.grain), 'print.lights.logH': add(pt([-1, 0, 1])) }));

export const BUILTIN_LOOKS: readonly Look[] = Object.freeze([neutral, warmPrint, coolShadows, flatGrade2, strongGrade4, printDensity, portraEndura, gold200]);
