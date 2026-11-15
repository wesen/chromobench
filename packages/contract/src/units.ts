// Units and the conversions the system allows. Ported from Chromogen units.js
// (C1/various/extracted/chromogen-studio/05-inline.js 142–216) onto the architecture doc's Unit set.
import { fail } from './errors.ts';

export type Unit =
  | 'D' | 'logH' | 'stop' | 'point' | 'CC' | 'mired' | 'K'
  | 'mm' | 'um' | 'nm' | 'px' | 's' | 'fstop' | 'fraction' | 'percent' | 'none'
  | 'deg' | 'degC';

export const UNITS: readonly Unit[] = [
  'D', 'logH', 'stop', 'point', 'CC', 'mired', 'K', 'mm', 'um', 'nm', 'px', 's', 'fstop',
  'fraction', 'percent', 'none', 'deg', 'degC',
];

export const LOG10_2 = Math.log10(2); // 0.30102999566…
export const LOGH_PER_POINT = 0.025;
export const D_PER_CC = 0.01;

export const HUNT_MESSAGE = 'a density offset is not a log-exposure shift (Hunt 14.17)';

/** Unit families: values in one family convert into each other (some edges are nonlinear). */
const FAMILY: Record<Unit, string> = {
  logH: 'exposure', stop: 'exposure', point: 'exposure',
  D: 'density', CC: 'density',
  fraction: 'ratio', percent: 'ratio',
  K: 'colour-temperature', mired: 'colour-temperature',
  mm: 'length', um: 'length', nm: 'length',
  px: 'pixels', s: 'time', fstop: 'aperture', none: 'none', deg: 'angle', degC: 'temperature',
};

export function unitFamily(u: Unit): string {
  return FAMILY[u];
}

/** Linear factor from `u` to the family's base unit (logH, D, fraction, um). */
const TO_BASE: Partial<Record<Unit, number>> = {
  logH: 1, stop: LOG10_2, point: LOGH_PER_POINT,
  D: 1, CC: D_PER_CC,
  fraction: 1, percent: 0.01,
  mm: 1000, um: 1, nm: 0.001,
};

function refuse(from: Unit, to: Unit): never {
  if ((FAMILY[from] === 'density' && FAMILY[to] === 'exposure') || (FAMILY[from] === 'exposure' && FAMILY[to] === 'density')) {
    fail('E_UNIT', `cannot convert ${from} to ${to}: ${HUNT_MESSAGE}`, { hint: 'Only a characteristic curve maps density to log exposure.' });
  }
  if (from === 'px' || to === 'px') {
    fail('E_UNIT', `cannot convert ${from} to ${to} without ImageInfo.umPerPx`, { hint: 'Pixel sizes need the image scale (film or paper µm per document pixel).' });
  }
  if ((from === 's' || from === 'fstop') && to === 'stop') {
    fail('E_UNIT', `${from} → stop needs a reference value`, { hint: from === 's' ? 'Use stopsFromTime(t1_s, t2_s).' : 'Use stopsFromFstop(n1, n2).' });
  }
  return fail('E_UNIT', `cannot convert ${from} to ${to}`);
}

/** Converts a number between units; throws E_UNIT on a refused edge. */
export function convert(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  if (FAMILY[from] !== FAMILY[to]) refuse(from, to);
  if (FAMILY[from] === 'colour-temperature') return 1e6 / value; // K ↔ mired, its own inverse
  const a = TO_BASE[from];
  const b = TO_BASE[to];
  if (a === undefined || b === undefined) refuse(from, to);
  return (value * a) / b;
}

export class Quantity {
  readonly value: number;
  readonly unit: Unit;
  private constructor(value: number, unit: Unit) {
    this.value = value;
    this.unit = unit;
    Object.freeze(this);
  }
  static of(value: number, unit: Unit): Quantity {
    if (!Number.isFinite(value)) fail('E_ARG_RANGE', `quantity value must be finite, got ${value}`);
    return new Quantity(value, unit);
  }
  to(unit: Unit): Quantity {
    return Quantity.of(convert(this.value, this.unit, unit), unit);
  }
  /** Same family only; the result is in this quantity's unit. D + logH throws E_UNIT (Hunt 14.17). */
  add(q: Quantity): Quantity {
    const fa = FAMILY[this.unit];
    const fb = FAMILY[q.unit];
    if (fa !== fb) {
      if ((fa === 'density' && fb === 'exposure') || (fa === 'exposure' && fb === 'density')) {
        fail('E_UNIT', `cannot add ${q.unit} to ${this.unit}: ${HUNT_MESSAGE}`, { hint: 'Use printer lights (print.lights, log H) to shift exposure.' });
      }
      fail('E_UNIT', `cannot add ${q.unit} to ${this.unit}`);
    }
    if (fa === 'colour-temperature' && this.unit !== q.unit) fail('E_UNIT', 'K and mired add only in the same unit');
    return Quantity.of(this.value + q.to(this.unit).value, this.unit);
  }
  scale(k: number): Quantity {
    return Quantity.of(this.value * k, this.unit);
  }
  toString(): string {
    return `${this.value} ${this.unit}`;
  }
}

const ALIASES: Record<string, Unit> = {
  d: 'D', D: 'D', logh: 'logH', logH: 'logH', stop: 'stop', stops: 'stop', ev: 'stop', EV: 'stop',
  pt: 'point', pts: 'point', point: 'point', points: 'point', cc: 'CC', CC: 'CC', mired: 'mired', k: 'K', K: 'K',
  mm: 'mm', um: 'um', 'µm': 'um', nm: 'nm', px: 'px', s: 's', sec: 's', f: 'fstop', fstop: 'fstop',
  '%': 'percent', percent: 'percent', fraction: 'fraction', deg: 'deg', '°': 'deg', degC: 'degC', '°C': 'degC',
};

/** Parses "4 pt", "0.3 stop", "12.6 s", "50 CC", "3%"; with `expect`, converts to that unit. */
export function quantity(x: number | string | Quantity, expect?: Unit): Quantity {
  let q: Quantity;
  if (x instanceof Quantity) q = x;
  else if (typeof x === 'number') q = Quantity.of(x, expect ?? 'none');
  else {
    const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([^\s\d].*?)?\s*$/i.exec(x);
    if (!m) fail('E_ARG_TYPE', `cannot parse quantity "${x}"`, { hint: 'Write a number and a unit, e.g. "4 pt" or "0.3 stop".' });
    const unitText = m[2] ?? '';
    const unit = unitText === '' ? (expect ?? 'none') : ALIASES[unitText];
    if (!unit) fail('E_UNIT', `unknown unit "${unitText}"`, { valid: [...UNITS] });
    q = Quantity.of(Number(m[1]), unit);
  }
  return expect ? q.to(expect) : q;
}

export type ExposureUnit = 'logH' | 'stop' | 'point';
export const toLogH = (v: number, from: ExposureUnit): number => convert(v, from, 'logH');
export const fromLogH = (v: number, to: ExposureUnit): number => convert(v, 'logH', to);
/** Stops between two exposure times: log2(t2/t1). */
export const stopsFromTime = (t1_s: number, t2_s: number): number => Math.log2(t2_s / t1_s);
/** Stops of exposure from changing the f-number n1 → n2 (exposure ∝ 1/N²). */
export const stopsFromFstop = (n1: number, n2: number): number => 2 * Math.log2(n1 / n2);
