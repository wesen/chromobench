// The cross-check of guide §5.3 / §9.4 in CI: the spektrafilm pack against the CHB-001 Chromogen JSON
// and against the interim packs, with the tolerances fixed in advance from each source's precision.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { column, type Pack } from '../src/index.ts';
import { C1, open, readC1Json, SF } from './helpers.ts';

const CG = 'various/extracted/chromogen-studio/st-data/cg/stocks/';
const TOL_CG = 5e-6 + 1e-12;
const TOL_FB4 = 5e-5 + 1e-12;

function maxdiff(a: ArrayLike<number>, b: ArrayLike<number>): { d: number; nanEqual: boolean } {
  let d = 0;
  let nanEqual = a.length === b.length;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (Number.isNaN(x) !== Number.isNaN(y)) nanEqual = false;
    else if (!Number.isNaN(x)) d = Math.max(d, Math.abs(x - y));
  }
  return { d, nanEqual };
}

const flat = (rows: (number | null)[][] | (number | null)[]): Float64Array =>
  Float64Array.from((rows as unknown[]).flat() as (number | null)[], (v) => (v === null ? NaN : v));

const rawFlat = (p: Pack, id: string, t: string): Float64Array => Float64Array.from(p.stockSync(id).raw[t]!.data);

describe('cross-check against the CHB-001 prototype data', () => {
  const sf = open(SF);
  const cgFiles = readdirSync(new URL(CG, C1)).filter((f) => f.endsWith('.json'));

  it('Chromogen (11 stocks): within 5e-6, identical null pattern', () => {
    expect(cgFiles).toHaveLength(11);
    const pairs: [string, string][] = [['log_sensitivity', 'log10_sensitivity'], ['channel_density', 'unit_dye_density_D'], ['base_density', 'base_density_D'], ['density_curves', 'dye_amount_curves'], ['log_exposure', 'log_exposure_logH']];
    let worst = 0;
    for (const f of cgFiles) {
      const j = readC1Json(CG + f);
      for (const [cg, pk] of pairs) {
        const r = maxdiff(flat(j.data[cg]), rawFlat(sf, j.info.stock, pk));
        expect(r.nanEqual, `${j.info.stock}:${pk} null pattern`).toBe(true);
        expect(r.d, `${j.info.stock}:${pk}`).toBeLessThanOrEqual(TOL_CG);
        worst = Math.max(worst, r.d);
      }
    }
    expect(worst).toBeGreaterThan(0); // rounding is visible: the comparison is not vacuous
  });

  it('interim-chromogen reproduces the Chromogen JSON exactly', () => {
    const cg = open('interim-chromogen@1');
    for (const f of cgFiles) {
      const j = readC1Json(CG + f);
      const r = maxdiff(flat(j.data.channel_density), rawFlat(cg, j.info.stock, 'unit_dye_density_D'));
      expect(r.d).toBe(0);
      expect(r.nanEqual).toBe(true);
    }
  });

  it('interim-filmbench vs spektrafilm (28 stocks): 4-decimal arrays within 5e-5, spectra within 5e-6, NaN rows = union of missing base and dye rows', () => {
    const fb = open('interim-filmbench@1');
    expect(fb.stockIds().sort()).toEqual(sf.stockIds().sort());
    for (const id of sf.stockIds()) {
      for (const t of ['log10_sensitivity', 'dye_amount_curves']) expect(maxdiff(rawFlat(fb, id, t), rawFlat(sf, id, t)).d, `${id}:${t}`).toBeLessThanOrEqual(TOL_FB4);
      for (const t of ['unit_dye_density_D', 'base_density_D']) expect(maxdiff(rawFlat(fb, id, t), rawFlat(sf, id, t)).d, `${id}:${t}`).toBeLessThanOrEqual(TOL_CG);
      const base = sf.stockSync(id).raw['base_density_D']!;
      const dyes = sf.stockSync(id).raw['unit_dye_density_D']!;
      const union = Array.from({ length: 81 }, (_, i) => Number.isNaN(base.data[i]!) || [0, 1, 2].some((k) => Number.isNaN(column(dyes, k)[i]!)));
      const fbNan = Array.from(fb.stockSync(id).raw['base_density_D']!.data, (v) => Number.isNaN(v));
      expect(fbNan, id).toEqual(union);
      const a = sf.stockSync(id).curveModel;
      const b = fb.stockSync(id).curveModel;
      expect(!!a, id).toBe(!!b);
      if (a && b) for (const k of ['centers', 'amplitudes', 'sigmas'] as const) expect(maxdiff(a[k].flat(), b[k].flat()).d).toBeLessThanOrEqual(1e-6);
    }
  });

  it('interim-filmbench enlarger and light data: neutral table identical, dichroics/illuminants/CMF within 1e-6', () => {
    const fb = open('interim-filmbench@1');
    for (const paper of sf.stockIds({ role: 'print' })) {
      for (const film of sf.stockIds({ role: 'film' })) expect(fb.neutralFiltersSync({ paper, film })).toEqual(sf.neutralFiltersSync({ paper, film }));
    }
    for (let k = 0; k < 3; k++) expect(maxdiff(fb.dichroicsSync()[k]!.values, sf.dichroicsSync()[k]!.values).d).toBeLessThanOrEqual(1e-6);
    for (const id of fb.illuminantIds()) expect(maxdiff(fb.illuminantSync(id).values, sf.illuminantSync(id).values).d, id).toBeLessThanOrEqual(1e-6);
    for (let k = 0; k < 3; k++) expect(maxdiff(fb.cmfSync()[k]!.values, sf.cmfSync()[k]!.values).d).toBeLessThanOrEqual(1e-6);
  });

  it('illustrative@1 reproduces Chromogen\'s camera and white LED to their rounding', () => {
    const il = open('illustrative@1');
    const cam = readC1Json('various/extracted/chromogen-studio/st-data/cg/cameras/generic-bayer.json');
    const led = readC1Json('various/extracted/chromogen-studio/st-data/cg/lights/white-led.json');
    const r = il.cameraSync('generic-bayer').responsivity;
    ['R', 'G', 'B'].forEach((ch, k) => expect(maxdiff(cam[ch], r[k as 0].values).d).toBeLessThanOrEqual(6e-6));
    expect(maxdiff(led.values, il.lightSync('white-led').spd.values).d).toBeLessThanOrEqual(6e-6);
  });

  it('known issues report upstream\'s shared arrays (reproduced, not repaired)', () => {
    const ids = sf.manifest.knownIssues.map((k) => k.id);
    expect(ids).toContain('shared-log_sensitivity-kodak_portra_endura-kodak_supra_endura');
    expect(ids).toContain('shared-base_density-fujifilm_crystal_archive_typeii-kodak_supra_endura');
    expect(ids).toContain('upstream-comment-kodak_ultra_endura');
    expect(rawFlat(sf, 'kodak_supra_endura', 'log10_sensitivity')).toEqual(rawFlat(sf, 'kodak_portra_endura', 'log10_sensitivity'));
  });
});
