// Stage 3 acceptance (guide §14–15): the golden numbers, the grey-card law and the neutral-pack
// balance law hold on the exporter pack and on interim-chromogen under the opaque reading, and fail
// under zero-density (which is how the tests show they can fail).
import { describe, expect, it } from 'vitest';
import type { MissingPolicy, Pack } from '../src/index.ts';
import { balanceLaw, filterPack, golden, greyDyes, midgrayPaperLogH, open, SF } from './helpers.ts';

const close = (got: number[], id: string): void => {
  const g = golden(id);
  const x = [g.expect].flat();
  expect(got.length, id).toBe(x.length);
  got.forEach((v, i) => expect(Math.abs(v - x[i]!), `${id}[${i}] got ${v} expected ${x[i]}`).toBeLessThanOrEqual(g.tol + 1e-12));
};

function greyCard(stocks: Pack, enlarger: Pack, policy: MissingPolicy): [number, number, number] {
  const film = stocks.stockSync('kodak_portra_400', { missing: policy });
  const paper = stocks.stockSync('kodak_portra_endura', { missing: policy });
  const nf = enlarger.neutralFiltersSync({ paper: 'kodak_portra_endura', film: 'kodak_portra_400' })!;
  const F = enlarger.dichroicsSync('custom').map((s) => s.values) as [Float64Array, Float64Array, Float64Array];
  return midgrayPaperLogH(film, paper, enlarger.illuminantSync('TH-KG3').values, filterPack(F, [nf.c_cc, nf.m_cc, nf.y_cc]));
}

describe('golden numbers (fixtures/golden/data/CHB-004.json)', () => {
  const p = open(SF);
  const film = p.stockSync('kodak_portra_400');

  it('Portra 400 grey card dye amounts', () => close(greyDyes(film), 'portra400-greycard-dyes'));

  it('grey card spectral density at 550 nm and its parts (textbook §1.2 uses the rounded dyes)', () => {
    const c = golden('portra400-greycard-dyes').expect as number[];
    const i = (550 - 380) / 5;
    const parts = [0, 1, 2].map((k) => c[k]! * film.unitDyes_D[k as 0]!.values[i]!);
    const base = film.base_D.values[i]!;
    close([parts[0]! + parts[1]! + parts[2]! + base, ...parts, base], 'portra400-greycard-D550');
  });

  it('neutral pack Portra 400 on Portra Endura', () => {
    const nf = p.neutralFiltersSync({ paper: 'kodak_portra_endura', lamp: 'TH-KG3', film: 'kodak_portra_400' })!;
    close([nf.c_cc, nf.m_cc, nf.y_cc], 'neutral-pack-portra400-endura');
  });

  it('share of lamp x Endura red sensitivity at >= 705 nm', () => {
    const paper = p.stockSync('kodak_portra_endura');
    const lamp = p.illuminantSync('TH-KG3').values;
    let all = 0;
    let red = 0;
    for (let i = 0; i < 81; i++) {
      const w = lamp[i]! * paper.sensitivity[0].values[i]!;
      all += w;
      if (380 + 5 * i >= 705) red += w;
    }
    close([red / all], 'endura-red-share-705');
  });

  it('CIE 1931 at 555 nm', () => {
    const c = p.cmfSync();
    close([c[0].values[35]!, c[1].values[35]!, c[2].values[35]!], 'cie1931-555');
  });

  it('Portra 400 erf4 window', () => {
    const w = film.hanatosWindow!;
    close([w.c_uv_nm, w.sigma_uv_nm, w.c_ir_nm, w.sigma_ir_nm], 'portra400-erf4-window');
  });

  it('DIR presets: applied (negative "0.42 alpha") vs schema default', () => {
    expect(p.dirPresetSync('kodak_portra_400').matrix).toEqual([[0.336, 0.353, 0.302], [0.154, 0.319, 0.353], [0.168, 0.226, 0.273]]);
    expect(p.dirPresetSync('kodak_portra_400', 'schema-default').matrix).toEqual([[0.341, 0.355, 0.305], [0.154, 0.324, 0.358], [0.171, 0.225, 0.273]]);
    expect(p.dirPresetSync('fujifilm_velvia_100').source).toBe('stock-override');
    expect(p.dirPresetSync('kodak_portra_400').diffusionSize_um).toBe(20);
  });

  it('halation presets keyed by (use, antihalation)', () => {
    expect(p.halationPresetSync('still', 'strong').sigmaH_um).toEqual([65, 65, 65]);
    expect(p.halationPresetSync('cine', 'no').strength).toEqual([0.3, 0.1, 0.015]);
    expect(p.halationPresetSync('still', 'weak').strength).toEqual([0.08, 0.02, 0]);
  });
});

describe('grey-card law (guide §6.1)', () => {
  const sf = open(SF);
  const cg = open('interim-chromogen@1');

  it('spektrafilm pack, opaque: (0.004, 0.005, -0.009)', () => close(greyCard(sf, sf, 'opaque'), 'greycard-paper-logH-opaque'));
  it('spektrafilm pack, zero-density: the red layer 0.18 log H above green', () => close(greyCard(sf, sf, 'zero-density'), 'greycard-paper-logH-zero'));
  it('interim-chromogen stocks (enlarger data from the spektrafilm pack), opaque', () => close(greyCard(cg, sf, 'opaque'), 'greycard-paper-logH-opaque'));
  it('interim-chromogen, zero-density', () => close(greyCard(cg, sf, 'zero-density'), 'greycard-paper-logH-zero'));
  it('interim-filmbench, opaque (its only policy)', () => close(greyCard(open('interim-filmbench@1'), open('interim-filmbench@1'), 'opaque'), 'greycard-paper-logH-opaque'));

  it('the law can fail: the zero-density grey card is not neutral', () => {
    const x = greyCard(sf, sf, 'zero-density');
    expect(Math.max(...x) - Math.min(...x)).toBeGreaterThan(0.15);
  });
});

describe('neutral-pack balance law (128 pairs)', () => {
  const sf = open(SF);

  it('opaque: median spread <= 0.06 log H (measured 0.032)', () => {
    const r = balanceLaw(sf, sf, 'opaque');
    expect(r.pairs).toBe(128);
    expect(r.median).toBeLessThanOrEqual(0.06);
    close([r.median], 'balance-law-opaque');
  });

  it('zero-density: the law fails (median well above 0.06)', () => {
    const r = balanceLaw(sf, sf, 'zero-density');
    expect(r.pairs).toBe(128);
    expect(r.median).toBeGreaterThan(0.06);
    close([r.median], 'balance-law-zero-upstream');
  });

  it('interim-chromogen (24 pairs with the spektrafilm table): passes opaque, fails zero-density', () => {
    const cg = open('interim-chromogen@1');
    const op = balanceLaw(cg, sf, 'opaque');
    const zd = balanceLaw(cg, sf, 'zero-density');
    expect(op.pairs).toBe(24);
    expect(op.median).toBeLessThanOrEqual(0.06);
    expect(zd.median).toBeGreaterThan(0.06);
  });

  it('interim-filmbench: passes under opaque', () => {
    const fb = open('interim-filmbench@1');
    const r = balanceLaw(fb, fb, 'opaque');
    expect(r.pairs).toBe(128);
    expect(r.median).toBeLessThanOrEqual(0.06);
  });
});
