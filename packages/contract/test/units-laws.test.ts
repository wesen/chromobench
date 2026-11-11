import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  check, ChromobenchError, convert, fromLogH, GRID, law, LOG10_2, mulberry32, productKind, Quantity, quantity, stopsFromFstop,
  stopsFromTime, sumKind, toDensity, toLogH, toTransmittance, type Law,
} from '@chromobench/contract';

const golden = JSON.parse(readFileSync(new URL('../../../fixtures/golden/contract.json', import.meta.url), 'utf8'));
const close = (a: number, b: number, tol = 1e-4): boolean => Math.abs(a - b) <= tol;

function codeOf(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    return e instanceof ChromobenchError ? e.diag.code : 'foreign';
  }
  return undefined;
}

describe('units', () => {
  it('golden conversions', () => {
    const u = golden.units;
    expect(close(toLogH(1, 'stop'), u.stopToLogH, 1e-5)).toBe(true);
    expect(close(fromLogH(toLogH(1, 'stop'), 'point'), u.pointsPerStop, 0.005)).toBe(true);
    expect(close(toLogH(4, 'point'), u.plus4ptLogH, 1e-12)).toBe(true);
    const s = stopsFromTime(10, 12.6);
    expect(close(s, u.time10to12_6.stops)).toBe(true);
    expect(close(toLogH(s, 'stop'), u.time10to12_6.logH)).toBe(true);
    expect(close(fromLogH(toLogH(s, 'stop'), 'point'), u.time10to12_6.points, 0.005)).toBe(true);
    expect(close(stopsFromFstop(8, 11.3137), u.fstop8to11_3137)).toBe(true);
    const d = convert(50, 'CC', 'D');
    expect(close(d, u.cc50.D, 1e-12)).toBe(true);
    expect(close(toTransmittance(d), u.cc50.T)).toBe(true);
    expect(convert(5000, 'K', 'mired')).toBe(200);
    expect(convert(0.5, 'um', 'nm')).toBe(500);
    expect(convert(50, 'percent', 'fraction')).toBe(0.5);
  });

  it('refuses D + logH with the Hunt 14.17 message', () => {
    try {
      Quantity.of(0.3, 'D').add(Quantity.of(0.1, 'logH'));
      expect.unreachable();
    } catch (e) {
      expect((e as ChromobenchError).diag.code).toBe('E_UNIT');
      expect((e as ChromobenchError).diag.message).toContain('Hunt 14.17');
    }
    expect(codeOf(() => convert(1, 'D', 'logH'))).toBe('E_UNIT');
    expect(codeOf(() => convert(1, 'px', 'um'))).toBe('E_UNIT');
    expect(codeOf(() => convert(1, 's', 'stop'))).toBe('E_UNIT');
  });

  it('parses quantities', () => {
    expect(quantity('4 pt', 'logH').value).toBeCloseTo(0.1, 12);
    expect(quantity('0.3 stop').unit).toBe('stop');
    expect(quantity('50 CC', 'D').value).toBeCloseTo(0.5, 12);
    expect(quantity('3%', 'fraction').value).toBeCloseTo(0.03, 12);
    expect(Quantity.of(0.1, 'logH').add(quantity('1 stop')).value).toBeCloseTo(0.1 + LOG10_2, 12);
    expect(codeOf(() => quantity('4 furlongs'))).toBe('E_UNIT');
  });
});

describe('spectrum kinds', () => {
  it('grid is 380–780/5, 81 samples', () => {
    expect(GRID.n).toBe(81);
    expect(GRID.key()).toBe('380:780:5');
    expect(GRID.wavelengths()[80]).toBe(780);
  });
  it('kind algebra', () => {
    expect(productKind('transmittance', 'transmittance')).toBe('transmittance');
    expect(productKind('power', 'reflectance')).toBe('power');
    expect(sumKind('density', 'density')).toBe('density');
    expect(codeOf(() => productKind('density', 'transmittance'))).toBe('E_KIND');
    expect(codeOf(() => sumKind('transmittance', 'transmittance'))).toBe('E_KIND');
  });
  it('Beer–Lambert grey card at 550 nm', () => {
    const b = golden.units.beerLambert550;
    const prod = (b.T as number[]).reduce((a, x) => a * x, 1);
    expect(close(prod, b.product, 2e-5)).toBe(true);
    expect(close(toDensity(prod), b.density)).toBe(true);
    expect(toDensity(0)).toBe(golden.units.zeroTransmittanceDensity);
  });
});

// Laws (§9), checked with the seeded harness; each has a deliberately wrong twin that must fail.
const unitLaws: Law<any>[] = [
  law('units.dimension', (r) => r.range(-2, 2), (v) => {
    try {
      Quantity.of(v, 'D').add(Quantity.of(v, 'logH'));
      return 'D + logH was accepted';
    } catch (e) {
      return (e as ChromobenchError).diag.message.includes('Hunt 14.17') || 'wrong message';
    }
  }, { justifies: 'densities and log exposures never add (Hunt 14.17)', source: 'textbook §1.1, §2.8' }),
  law('units.stop', (r) => r.range(-10, 10), (s) => Math.abs(toLogH(s, 'stop') - LOG10_2 * s) < 1e-12 || 'stop ≠ 0.30103 logH', { justifies: '1 stop = log10 2 log H', source: 'textbook §1.1' }),
  law('units.point', (r) => r.range(-60, 60), (p) => Math.abs(toLogH(p, 'point') - 0.025 * p) < 1e-12 || 'point ≠ 0.025 logH', { justifies: '1 printer point = 0.025 log H', source: 'textbook §2.6, §3.6' }),
  law('units.roundtrip', (r) => [r.range(-5, 5), r.int(0, 2)] as const, ([v, k]) => {
    const u = (['stop', 'point', 'logH'] as const)[k]!;
    return Math.abs(fromLogH(toLogH(v, u), u) - v) < 1e-9 || 'roundtrip drift';
  }, { justifies: 'exposure units convert losslessly through log H', source: 'guide §5.2' }),
  law('spectrum.beerLambert', (r) => Array.from({ length: r.int(1, 5) }, () => r.range(0.001, 1)), (ts: number[]) => {
    const d = ts.reduce((a, t) => a + toDensity(t), 0);
    return Math.abs(toDensity(ts.reduce((a, t) => a * t, 1)) - d) < 1e-9 || 'density of product ≠ sum of densities';
  }, { justifies: 'transmittances multiply exactly when densities add', source: 'textbook §1.2' }),
];

describe('laws harness', () => {
  it('unit and spectrum laws hold (n = 200, seed 1)', () => {
    const rep = check(unitLaws, { n: 200, seed: 1 });
    for (const r of rep) expect(r, `${r.name}: ${r.message} ${JSON.stringify(r.shrunk)}`).toMatchObject({ ok: true });
  });

  it('a wrong toLogH (0.3 per stop) is caught and shrunk', () => {
    const wrong = law('units.stop.wrong', (r) => r.range(-10, 10), (s: number) => Math.abs(0.3 * s - LOG10_2 * s) < 1e-12 || 'mismatch', { justifies: 'mutant', source: 'test' });
    const [r] = check([wrong], { n: 50, seed: 1 });
    expect(r!.ok).toBe(false);
    expect(Math.abs(r!.shrunk as number)).toBeLessThanOrEqual(Math.abs(r!.counterexample as number));
  });

  it('law() refuses to build without justifies', () => {
    expect(() => law('x', () => 1, () => true, { justifies: '', source: '' })).toThrow(/justifies/);
  });

  it('mulberry32 is deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });
});
