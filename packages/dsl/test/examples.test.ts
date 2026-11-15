// Guide §6 (E1–E6) and §7 (the grey-card balance in ask mode) against engine-mock, on contract 1.0, plus the
// result-format golden `test/representative.result` (§8 stage 3). Coordinates are the M1 fixture's grey patch
// [48, 32]; its transmittance equals the guide's grey card, so the numbers match §7 to the 16-bit quantisation of
// the fixture (third significant digit). Regenerate the golden with UPDATE_GOLDEN=1 and review the diff.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { set } from '@chromobench/values';
import { setup, FRAME } from './helpers.ts';

const close = (a: number[], b: number[], tol: number): void => a.forEach((v, i) => expect(Math.abs(v - b[i]!), `component ${i}: ${v} vs ${b[i]}`).toBeLessThanOrEqual(tol));

const E1 = `// what is this frame, and how does it print now?
const print = frame.print()
const grey = await print.measure.densitometer({ at: [48, 32], aperture_px: 15 })
const s = await print.measure.stats()
print.show('current print')
return { stock: frame.get('stages.scan.medium.stock'), paper: frame.get('stages.darkroom.medium.paper'),
         time_s: frame.get('main.params.time_s'), lights_pt: units.toPt(frame.get('lights.params.logH')),
         grey: grey.D, clipHigh: s.clipHigh }`;

const E2 = `// seven exposures a third of a stop apart around the current time
const strip = cb.testStrip(frame, { vary: 'time', steps: 7, step: 1 / 3 })
strip.show('time test strip')
return (await strip.measure.patches({ cols: 7 })).cells`;

const E3 = `const ring = cb.ringAround(frame, { step_pt: 4 })
ring.show('ring-around, 4 points')
return (await ring.measure.patches({ cols: 3, rows: 3 })).cells`;

const E4 = `mem.greyD = async (h, at = [48, 32]) => { // print densities at a point, 15 px aperture
  return (await h.measure.densitometer({ at, aperture_px: 15 })).D
}
return { now: await mem.greyD(frame.print()),
         cooler: await mem.greyD(frame.with(set('main.params.filtration', { c: 0, m: 0, y: 10 })).print()) }`;

const E6 = `// hold the sky back by half a stop with a feathered gradient
const sky = mask('Sky').add('g', 'linear', { from: [48, 0], to: [48, 40] }).feather(0.4)
const e = frame.propose([insert('masks', 'sky', sky),
                         insert('stages.darkroom.stack', 'd1', layer('dodge', { stops: 0.5 }).mask('sky'))],
                        { why: 'the sky prints 0.4 D denser than the foreground' })
e.preview.print().show('proposed dodge')
return e`;

const SEVEN = `const at = [48, 32]
const lights0 = frame.get('lights.params.logH')
const now = await frame.print().measure.densitometer({ at, aperture_px: 15 })
const probe = await frame.with(set('lights.params.logH', lights0.map((v) => v + 0.05))).print().measure.densitometer({ at, aperture_px: 15 })
const slope = now.D.map((d, k) => (probe.D[k] - d) / 0.05)        // print density per log H, per layer
const mean = (now.D[0] + now.D[1] + now.D[2]) / 3
const dx = now.D.map((d, k) => (mean - d) / slope[k])             // log H that brings each layer to the mean
const pts = units.toPt(dx).map(p => Math.round(p * 2) / 2)        // half points, as a printer would set them
const lights = units.pt(pts).map((v, k) => v + lights0[k])
const e = frame.propose(set('lights.params.logH', lights), { why: \`neutral grey card: \${pts.join(' / ')} pt\` })
e.preview.print().show('proposed balance')
const after = await e.preview.print().measure.densitometer({ at, aperture_px: 15 })
return { before: now.D, slope, points: pts, after: after.D }`;

describe('guide §6 examples on engine-mock', () => {
  it('E1 orientation', async () => {
    const s = await setup();
    const r = await s.run(E1);
    expect(r.error, r.yaml).toBeUndefined();
    expect(r.looks).toHaveLength(1);
    expect(r.looks[0]!.image.mime).toBe('image/png');
    expect(r.looks[0]!.numbers).toHaveProperty('mean');
    expect(r.yaml).toMatch(/^stock: kodak_portra_400\npaper: kodak_portra_endura\ntime_s: 10\nlights_pt: \[0, 0, 0\]\ngrey: \[0.94691, 0.80158, 0.58241\]/);
    s.session.dispose();
  });

  it('E2 time test strip: a compact table, an image with one reading per band', async () => {
    const s = await setup();
    const r = await s.run(E2);
    expect(r.error, r.yaml).toBeUndefined();
    expect(r.yaml.split('\n').slice(0, 2)).toEqual(['|', '  cell  D                               visual']);
    expect((r.looks[0]!.numbers['cells'] as unknown[]).length).toBe(7);
    s.session.dispose();
  });

  it('E3 ring-around: 9 cells', async () => {
    const s = await setup();
    const r = await s.run(E3);
    expect(r.error, r.yaml).toBeUndefined();
    expect((r.looks[0]!.numbers['cells'] as unknown[]).length).toBe(9);
    s.session.dispose();
  });

  it('E4 a mem helper: listed with its doc line; yellow filtration makes the print cooler', async () => {
    const s = await setup();
    const r = await s.run(E4);
    expect(r.error, r.yaml).toBeUndefined();
    expect(r.context.newFunctions).toEqual(['mem.greyD(h, at = [48, 32]): print densities at a point, 15 px aperture']);
    const v = /now: \[(.*)\]\ncooler: \[(.*)\]/.exec(r.yaml)!;
    const now = v[1]!.split(', ').map(Number);
    const cooler = v[2]!.split(', ').map(Number);
    expect(cooler[2]!).toBeLessThan(now[2]!); // less yellow dye: blue density drops
    const again = await s.run('return await mem.greyD(frame.print())');
    expect(again.context.newFunctions).toEqual([]);
    expect(again.context.functions).toEqual(['mem.greyD(h, at = [48, 32])']);
    s.session.dispose();
  });

  it('E6 a dodge: a mask and a layer in one transaction, a preview image', async () => {
    const s = await setup();
    const r = await s.run(E6);
    expect(r.error, r.yaml).toBeUndefined();
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]!.tx.mutations.map((m) => (m.op === 'insert' ? m.coll : m.op))).toEqual(['masks', 'stages.darkroom.stack']);
    expect(r.looks).toHaveLength(1);
    s.session.dispose();
  });
});

describe('guide §7: a neutral grey card in ask mode', () => {
  it('reproduces the trace and pins the representative result text', async () => {
    const s = await setup({ mode: 'ask' });
    const d0 = s.history.log().doc(FRAME);
    const r = await s.run(SEVEN);
    expect(r.error, r.yaml).toBeUndefined();
    const num = (k: string): number[] => new RegExp(`${k}: \\[(.*)\\]`).exec(r.yaml)![1]!.split(', ').map(Number);
    close(num('before'), [0.94691, 0.80154, 0.58235], 2e-4);
    expect(num('slope')).toEqual([1.5, 1.5, 1.5]);
    expect(num('points')).toEqual([-4.5, -0.5, 5]);
    close(num('after'), [0.77816, 0.78279, 0.76985], 2e-4);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]).toMatchObject({ why: 'neutral grey card: -4.5 / -0.5 / 5 pt', tx: { by: 'agent', status: 'pending', id: 'eval-1' } });
    expect(r.transactions[0]!.tx.mutations).toEqual([set('lights.params.logH', [-0.1125, -0.0125, 0.125])]);
    expect(r.transactions[0]!.tx.inverses).toEqual([set('lights.params.logH', [0, 0, 0])]);
    expect(s.history.log().doc(FRAME)).toBe(d0);
    s.history.change((l) => l.approve(r.transactions[0]!.seq));
    const next = await s.run('return 1');
    expect(next.context.proposals).toEqual(['eval-1 approved']);

    // three error cases for the golden
    const e1 = await s.run('const p = frame.print()\nconst g = p.measure.densitometer({ at: [48, 32] })\nreturn g.D');
    const e2 = await s.run("frame.propose(set('lights.params.logH', [4, 0, 0]))");
    const e3 = await s.run("frame.propose(set('main.param.time_s', 12))");
    const text = [r, e1, e2, e3].map((x, i) => `### ${['§7 grey-card balance', 'E_NOT_AWAITED', 'E_ARG_RANGE (points)', 'E_PATH'][i]}\n${x.yaml}\n`).join('\n');
    const file = new URL('./representative.result', import.meta.url);
    if (process.env['UPDATE_GOLDEN'] || !existsSync(file)) writeFileSync(file, text);
    expect(text).toBe(readFileSync(file, 'utf8'));
    s.session.dispose();
  });
});
