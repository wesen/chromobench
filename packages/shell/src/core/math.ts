// Pure helpers the forms share: typed values with units and arithmetic (CraftKit's parseValue, without Function(),
// which a strict Content-Security-Policy forbids), snapping, number formatting, monotone curves.

import { clamp } from './util.ts';

export const MIXED: unique symbol = Symbol.for('ck.mixed');

/** units in points (the base for lengths); '%' is relative */
export const UNITS: Record<string, number | null> = { px: 1, pt: 1, p: 12, pc: 12, in: 72, mm: 72 / 25.4, cm: 72 / 2.54, '%': null, ev: 1, k: 1, '°': 1 };

/** A tiny arithmetic evaluator: numbers, + - * /, unary minus, parentheses. Returns NaN when it cannot read it. */
export function evalArith(src: string): number {
  let i = 0;
  const s = src.replace(/\s+/g, '');
  const peek = (): string => s[i] ?? '';
  const num = (): number => {
    const m = /^(\d*\.?\d+(?:e[+-]?\d+)?)/i.exec(s.slice(i));
    if (!m) return NaN;
    i += m[1]!.length;
    return parseFloat(m[1]!);
  };
  const factor = (): number => {
    const c = peek();
    if (c === '-') {
      i++;
      return -factor();
    }
    if (c === '+') {
      i++;
      return factor();
    }
    if (c === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') return NaN;
      i++;
      return v;
    }
    return num();
  };
  const term = (): number => {
    let v = factor();
    for (;;) {
      const c = peek();
      if (c === '*') {
        i++;
        v *= factor();
      } else if (c === '/') {
        i++;
        v /= factor();
      } else return v;
    }
  };
  const expr = (): number => {
    let v = term();
    for (;;) {
      const c = peek();
      if (c === '+') {
        i++;
        v += term();
      } else if (c === '-') {
        i++;
        v -= term();
      } else return v;
    }
  };
  const v = expr();
  return i === s.length ? v : NaN;
}

export interface ParseOpts {
  unit?: string;
  current?: number;
  units?: Record<string, number | null> | null;
  min?: number;
  max?: number;
}
export type Parsed = { ok: true; value: number; clamped?: boolean } | { ok: false; error: string };

/** '12mm', '3p6', '1in + 6pt', '*2', '50%' */
export function parseValue(text: string, { unit = '', current = 0, units = null, min = -Infinity, max = Infinity }: ParseOpts = {}): Parsed {
  let s = String(text).trim().replace(/−/g, '-').replace(/,/g, '.');
  if (!s) return { ok: false, error: 'empty' };
  // relative: *2, /3 applied to the current value when the field starts with an operator
  const rel = s.match(/^([*/])\s*(-?\d*\.?\d+)$/);
  if (rel) {
    const k = +rel[2]!;
    return { ok: true, value: clamp(rel[1] === '*' ? current * k : current / k, min, max) };
  }
  // percent of the current value
  const pct = s.match(/^(-?\d*\.?\d+)\s*%$/);
  if (pct && unit !== '%') return { ok: true, value: clamp(current * (+pct[1]! / 100), min, max) };
  // picas: 3p6 = 3 picas 6 points
  s = s.replace(/(\d+)p(\d+(?:\.\d+)?)/g, (_m, a: string, b: string) => `${+a * 12 + +b}pt`);
  // terms with units → base units when the field has a length unit; otherwise strip
  const toBase = !!units && units[unit] != null;
  let bad = false;
  const expr = s.replace(/(\d*\.?\d+)\s*(mm|cm|in|pt|px|pc|p|ev|k|°)?/gi, (_m, num: string, u: string | undefined) => {
    if (!u || !toBase) return num;
    const f = units![u.toLowerCase()];
    if (f == null) {
      bad = true;
      return num;
    }
    return `(${num}*${f}/${units![unit]})`;
  });
  if (bad || /[^0-9+\-*/().\se]/i.test(expr)) return { ok: false, error: `Can't read '${text}'` };
  const v = evalArith(expr);
  if (Number.isNaN(v)) return { ok: false, error: `Can't read '${text}'` };
  if (!Number.isFinite(v)) return { ok: false, error: `'${text}' is not a number` };
  return { ok: true, value: clamp(v, min, max), clamped: v < min || v > max };
}

export const snap = (v: number, step: number): number => (step ? Math.round(v / step) * step : v);

/** a number for display: fixed decimals, a real minus sign, + when signed */
export const fmtNum = (v: unknown, decimals = 0, signed = false): string => {
  if (v == null || Number.isNaN(v)) return '—';
  const s = (+(v as number)).toFixed(decimals);
  const z = +s === 0 ? (0).toFixed(decimals) : s;
  return (signed && +z > 0 ? '+' : '') + z.replace('-', '−');
};

/** multiplier from modifiers: Shift ×10, Alt ×0.1 (Lightroom and Photoshop agree) */
export const modStep = (e: { shiftKey?: boolean; altKey?: boolean } | null | undefined): number => (e && e.shiftKey ? 10 : 1) * (e && e.altKey ? 0.1 : 1);

/** monotone cubic interpolation (Fritsch–Carlson): what curve tools draw through their points */
export function monotone(pts: { x: number; y: number }[]): (x: number) => number {
  const P = pts.slice().sort((a, b) => a.x - b.x);
  const n = P.length;
  if (n < 2) return x => x;
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(P[i + 1]!.x - P[i]!.x || 1e-6);
    dy.push(P[i + 1]!.y - P[i]!.y);
    m.push(dy[i]! / dx[i]!);
  }
  const t = [m[0]!];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2);
  t.push(m[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i]! / m[i]!;
    const b = t[i + 1]! / m[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i]!;
      t[i + 1] = k * b * m[i]!;
    }
  }
  return x => {
    if (x <= P[0]!.x) return P[0]!.y;
    if (x >= P[n - 1]!.x) return P[n - 1]!.y;
    let i = 0;
    while (i < n - 2 && x > P[i + 1]!.x) i++;
    const hh = dx[i]!;
    const u = (x - P[i]!.x) / hh;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * P[i]!.y + (u3 - 2 * u2 + u) * hh * t[i]! + (-2 * u3 + 3 * u2) * P[i + 1]!.y + (u3 - u2) * hh * t[i + 1]!;
  };
}
