// CHB-046 (CHB-037 P9-6, CHB-028 F37): how the darkroom's sliders answer the hand. The persona session measured 60 px
// of Time = 2 stops and 40 px of Filtration Y = −43 CC (an absolute track ~180 px wide over 2…60 s and −50…100 CC);
// the first filtration step was 20 CC. A drag now moves by a feel per pixel, Alt ten times finer, and the arrow keys
// step in his units.
import { describe, expect, it } from 'vitest';
import { argModel, dragTo, feelOf, FINE_DRAG, keyStepOf, stepValue } from '../src/kit/args.ts';
import { printerSeconds } from '../src/model/units.ts';

const time = argModel('main.params.time_s')!;
const y = argModel('main.params.filtration.y')!;
const lights = argModel('lights.params.logH.r')!;
const free = { min: -Infinity, max: Infinity };

describe('the feel of a control (drag per pixel, keys in his units)', () => {
  it('time: 60 px of drag is half a stop (it was 2), Alt makes it a twentieth; it lands on a printer’s seconds', () => {
    const f = feelOf(time.model, Math.log2(60) - Math.log2(2));
    expect(f.unit).toBe('st');
    const x0 = Math.log2(10);
    expect(dragTo(f, x0, 60, { step: time.model.step, hard: free }) - x0).toBeCloseTo(0.5, 9);
    expect(dragTo(f, x0, 60, { step: time.model.step, hard: free, fine: true }) - x0).toBeCloseTo(0.05, 9);
    expect(printerSeconds(2 ** dragTo(f, x0, 60, { step: time.model.step, hard: free }))).toBe(14);
    // the hard range holds: 0.1 … 600 s
    expect(2 ** dragTo(f, x0, 100_000, { step: time.model.step, hard: { min: Math.log2(0.1), max: Math.log2(600) } })).toBeCloseTo(600, 6);
  });

  it('filtration: 40 px is 10 CC (it was 43), Alt 1 CC; the drag lands on whole CC', () => {
    const f = feelOf(y.model, 150);
    expect(f.unit).toBe('CC');
    expect(dragTo(f, 0, -40, { step: y.model.step, hard: free })).toBe(-10);
    expect(dragTo(f, 0, -40, { step: y.model.step, hard: free, fine: true })).toBe(-1);
    expect(dragTo(f, 12, 3, { step: y.model.step, hard: free })).toBe(13);
    expect(FINE_DRAG).toBe(0.1);
  });

  it('printer lights: 40 px is 4 points', () => {
    const f = feelOf(lights.model, 40);
    expect(f.unit).toBe('pt');
    expect(dragTo(f, 0, 40, { step: lights.model.step, hard: free })).toBeCloseTo(4, 9);
  });

  it('keys: ⅓ stop of time (Shift 1 stop, Alt ⅙), 5 CC of filtration (Shift 20, Alt 1), 1 printer point', () => {
    const ft = feelOf(time.model, 5);
    const at = (a: typeof time, v: unknown, mods: { shiftKey?: boolean; altKey?: boolean }, dir = 1) => stepValue(a, v, dir, { value: keyStepOf(feelOf(a.model, 5), mods), unit: null });
    expect(keyStepOf(ft, {})).toBeCloseTo(1 / 3, 12);
    expect(at(time, 10, {})).toBeCloseTo(10 * 2 ** (1 / 3), 6);
    expect(at(time, 10, { shiftKey: true })).toBeCloseTo(20, 6);
    expect(at(time, 10, { altKey: true })).toBeCloseTo(10 * 2 ** (1 / 6), 6);
    const c0 = { c: 0, m: 0, y: 0 };
    expect(at(y, c0, {})).toEqual({ c: 0, m: 0, y: 5 });
    expect(at(y, c0, {}, -1)).toEqual({ c: 0, m: 0, y: -5 });
    expect(at(y, c0, { shiftKey: true })).toEqual({ c: 0, m: 0, y: 20 });
    expect(at(y, c0, { altKey: true })).toEqual({ c: 0, m: 0, y: 1 });
    const l = at(lights, [0, 0, 0], {}) as number[];
    expect(l[0]).toBeCloseTo(0.025, 9);
  });

  it('another control: its usual range over 300 px, the keys its own step', () => {
    const gamma = argModel('stages.darkroom.medium.grade')!;
    expect(gamma.model.type).toBe('number');
    const f = feelOf(gamma.model, 3);
    expect(f.perPx).toBeCloseTo(0.01, 12);
    expect(f.key).toBe(gamma.model.step);
  });
});
