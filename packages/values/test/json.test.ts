import { describe, expect, it } from 'vitest';
import { assertJson, canonicalJSON, deepFreeze, equal, isDeepFrozen, isJson, ValueError } from '../src/index.ts';
import { rng, type Rng } from './rng.ts';

// The contract's canonicalJSON as it was before it moved here (packages/contract/src/graph.ts at b3445d3), with its
// errors reduced to plain throws: the oracle for "node hashes stay byte-identical".
function oracle(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('E_ARG_RANGE');
      return JSON.stringify(Object.is(v, -0) ? 0 : v);
    }
    if (v === undefined) return 'null';
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(oracle).join(',')}]`;
  if (ArrayBuffer.isView(v)) throw new Error('E_INTERNAL');
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${oracle(o[k])}`).join(',')}}`;
}

const KEYS = ['a', 'B', 'z', 'é', '10', '2', '', 'key with space', '"q"', 'ü', ' ', 'aa'];
function randomValue(r: Rng, depth: number): unknown {
  const k = r.int(depth > 3 ? 5 : 8);
  switch (k) {
    case 0: return null;
    case 1: return r.chance(0.5);
    case 2: return r.pick([0, -0, 1, -1.5, 1e21, 1e-7, 0.1 + 0.2, Number.MAX_SAFE_INTEGER, 5e-324]);
    case 3: return r.pick(['', 'x', 'é', '\n', '\u0000', '"', '\\', '😀', ' ']);
    case 4: return r() * 1000 - 500;
    case 5: return Array.from({ length: r.int(4) }, () => randomValue(r, depth + 1));
    default: {
      const o: Record<string, unknown> = {};
      for (let i = r.int(5); i > 0; i--) o[r.pick(KEYS)] = r.chance(0.1) ? undefined : randomValue(r, depth + 1);
      return o;
    }
  }
}

describe('canonicalJSON', () => {
  it('matches the contract implementation it replaced on 2000 random values', () => {
    const r = rng(0xc0ffee);
    for (let i = 0; i < 2000; i++) {
      const v = randomValue(r, 0);
      expect(canonicalJSON(v)).toBe(oracle(v));
    }
  });
  it('sorts keys, drops undefined, writes −0 as 0', () => {
    expect(canonicalJSON({ b: 1, a: [undefined, -0, { d: undefined, c: 'x' }] })).toBe('{"a":[null,0,{"c":"x"}],"b":1}');
    expect(canonicalJSON(undefined)).toBe('null');
  });
  it('refuses non-finite numbers (E_ARG_RANGE) and typed arrays (E_INTERNAL)', () => {
    const code = (f: () => unknown) => {
      try { f(); } catch (e) { return e instanceof ValueError ? e.code : 'other'; }
      return 'none';
    };
    expect(code(() => canonicalJSON({ a: NaN }))).toBe('E_ARG_RANGE');
    expect(code(() => canonicalJSON([Infinity]))).toBe('E_ARG_RANGE');
    expect(code(() => canonicalJSON({ a: new Float32Array(2) }))).toBe('E_INTERNAL');
  });
});

describe('equal', () => {
  it('holds exactly when canonical JSON is the same', () => {
    const r = rng(7);
    for (let i = 0; i < 1000; i++) {
      const a = randomValue(r, 0);
      const b = r.chance(0.3) ? JSON.parse(JSON.stringify(a ?? null)) : randomValue(r, 0);
      expect(equal(a, b)).toBe(canonicalJSON(a) === canonicalJSON(b));
    }
  });
  it('ignores key order and undefined keys; 0 equals −0; arrays are not objects', () => {
    expect(equal({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(equal({ a: 1, x: undefined }, { a: 1 })).toBe(true);
    expect(equal(0, -0)).toBe(true);
    expect(equal([], {})).toBe(false);
    expect(equal({ a: [1] }, { a: [1, 2] })).toBe(false);
  });
});

describe('JSON checks and freezing', () => {
  it('accepts JSON and refuses the rest with a path', () => {
    expect(isJson({ a: [1, 'x', null, { b: true }] })).toBe(true);
    expect(isJson({ a: () => 1 })).toBe(false);
    expect(isJson([1, undefined])).toBe(false);
    expect(isJson(new Map())).toBe(false);
    expect(() => assertJson({ a: { b: [0, NaN] } }, 'item')).toThrow(/item\.a\.b\.1: non-finite/);
    try {
      assertJson({ f: Math.max });
    } catch (e) {
      expect((e as ValueError).diag).toMatchObject({ code: 'E_ARG_TYPE', path: 'value.f' });
    }
  });
  it('deepFreeze freezes plain data all the way down and leaves typed arrays alone', () => {
    const ta = new Float32Array(3);
    const v = deepFreeze({ a: { b: [1, { c: 2 }] }, ta });
    expect(isDeepFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.a.b[1])).toBe(true);
    expect(Object.isFrozen(ta)).toBe(false);
    expect(() => {
      (v.a as { b: unknown }).b = 1;
    }).toThrow(TypeError);
    expect(isDeepFrozen({ a: Object.freeze({}) })).toBe(false);
  });
});
