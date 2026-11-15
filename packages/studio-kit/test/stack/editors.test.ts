// The stack kit's editors, headless (MockEngine, core's numbers through the editorMath service): new layers' lists
// are Colls named after the layer; a curve gesture (a preview of a new points Coll) is one step; levels' gamma
// handle; the editors mechanism; the histogram of the stage input and the eyedropper measure the cut a colour mask
// reads with core's encodeTransform, exactly as the compiler converts it.
import { describe, expect, it } from 'vitest';
import { Coll } from '@chromobench/values';
import { compile, cutNode, DEFAULT_HSL_BANDS, getOp, validateDocument, type Document } from '@chromobench/contract';
import { applyEncode, encodeTransform, evalCurve, toneCurve } from '@chromobench/core';
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { manualClock } from '@chromobench/shell/testing';
import { buildLayout, createStudio, memoryKV, storePath } from '../../src/index.ts';
import { LAYOUTS } from '../../layouts/index.js';
import {
  bandWord, EDITOR_FORMS, editorOf, eyedropper, freeItemId, gammaAt, gammaOf, histogramOf, pointsColl, pointsOf, sampleOklab, stageHistogram,
} from '../../kits/stack/src/index.ts';
import { editorMath } from '../../demo/editor-math.ts';

async function studio(o: { math?: boolean } = {}) {
  const st = createStudio({ engine: new MockEngine(), kv: memoryKV() });
  const { app } = buildLayout((await LAYOUTS.classic()).default);
  const rt = await app.boot(st.services({ clock: manualClock(1_000), ...(o.math === false ? {} : { editorMath: editorMath() }) }));
  st.attach(rt);
  const e = await st.open(makeM1Tiff(), 'm1.tif');
  await st.flush();
  return { rt, studio: st, f: e.id };
}
const docOf = (rt: any, f: string): Document => rt.store.log.doc(f);
const steps = (rt: any, f: string): number => rt.store.log.inEffect(f).length;
const layer = (d: Document, id: string): any => Coll.get(d.stages.print.stack, id);
const errorsOf = (d: unknown): string[] => validateDocument(d).filter((x) => x.code.startsWith('E_')).map((x) => `${x.code} ${x.message}`);

describe('new layers: list arguments are Colls named after the layer', () => {
  it('a curve has its two end points, an HSL layer the eight bands; the document is valid; duplicate renames them', async () => {
    const { rt, f } = await studio();
    expect(await rt.runCommand('layer.add', null, 'curve', 'print')).toBe('curve1');
    expect(await rt.runCommand('layer.add', null, 'hsl', 'print')).toBe('hsl1');
    const d = docOf(rt, f);
    expect(Coll.entries(layer(d, 'curve1').params.points)).toEqual([['curve1p1', { x: 0, y: 0 }], ['curve1p2', { x: 1, y: 1 }]]);
    const bands = layer(d, 'hsl1').params.bands;
    expect(Coll.ids(bands)).toEqual(['hsl1b1', 'hsl1b2', 'hsl1b3', 'hsl1b4', 'hsl1b5', 'hsl1b6', 'hsl1b7', 'hsl1b8']);
    expect(Coll.values(bands)).toEqual(DEFAULT_HSL_BANDS);
    expect(Coll.values(bands).map((b: any) => bandWord(b.centre_deg))).toEqual(['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta']);
    expect(errorsOf(d)).toEqual([]);
    // what + Layer stored before: a curve without points, refused by the catalogue (minItems 2)
    const bad = JSON.parse(JSON.stringify(d));
    bad.stages.print.stack.items.curve1.params.points = { order: [], items: {} };
    expect(errorsOf(bad).join(' ')).toMatch(/at least 2/);
    expect(await rt.runCommand('layer.duplicate', null, 'curve1')).toBe('curve2');
    expect(Coll.ids(layer(docOf(rt, f), 'curve2').params.points)).toEqual(['curve2p1', 'curve2p2']);
  });

  it('a curve gesture previews a new points Coll and commits one step; undo takes it back', async () => {
    const { rt, f } = await studio();
    await rt.runCommand('layer.add', null, 'curve', 'print');
    const d0 = docOf(rt, f);
    const pts = pointsOf(d0, 'curve1');
    const nid = freeItemId(d0, 'curve1', 'points', pts.map((p) => p.id));
    expect(nid).toBe('curve1p3');
    // a drag: three previews (a new point moved), one commit
    const path = storePath(f, d0, 'curve1.params.points');
    for (const y of [0.55, 0.6, 0.62]) rt.store.preview(path, pointsColl(d0, 'curve1', [...pts, { id: nid, x: 0.5, y }]));
    rt.store.commit('Curve: add point', {});
    const d1 = docOf(rt, f);
    expect(Coll.entries(layer(d1, 'curve1').params.points)).toEqual([['curve1p1', { x: 0, y: 0 }], ['curve1p3', { x: 0.5, y: 0.62 }], ['curve1p2', { x: 1, y: 1 }]]);
    expect(steps(rt, f)).toBe(2);
    expect(errorsOf(d1)).toEqual([]);
    rt.undo();
    expect(Coll.ids(layer(docOf(rt, f), 'curve1').params.points)).toEqual(['curve1p1', 'curve1p2']);
  });

  it('the curve the editor draws is core\'s (the service), not the shell\'s monotone', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.3, y: 0.45 }, { x: 0.7, y: 0.72 }, { x: 1, y: 1 }];
    const c = toneCurve(pts);
    const f = editorMath().curve(pts);
    for (const x of [0, 0.1, 0.25, 0.5, 0.8, 1, 1.2]) expect(f(x)).toBe(evalCurve(c, x));
  });
});

describe('levels: the gamma handle sits where the output is one half', () => {
  it('gammaAt and gammaOf are inverse; held to the catalogue range', () => {
    for (const [b, w, g] of [[0, 1, 1], [0.1, 0.9, 2], [0.05, 0.6, 0.5]] as const) {
      expect(gammaOf(b, w, gammaAt(b, w, g))).toBeCloseTo(g, 3);
      expect(editorMath().levels({ black: b, white: w, gamma: g, outBlack: 0, outWhite: 1 })(gammaAt(b, w, g))).toBeCloseTo(0.5, 9);
    }
    expect(gammaOf(0.2, 0.8, 0.1)).toBe(10);
    expect(gammaOf(0.2, 0.8, 0.95)).toBe(0.1);
  });
});

describe('the editors mechanism', () => {
  it('stack.editors has the five built-in editors, as data; each covers its op\'s arguments; the params panels get them', async () => {
    const { rt } = await studio();
    expect(Object.keys(EDITOR_FORMS)).toEqual(['curve', 'levels', 'hsl', 'grade', 'mixer']);
    expect(EDITOR_FORMS['curve']).toEqual({ form: 'stack.curve', covers: ['channel', 'points'] });
    expect(editorOf('my.form', ['a'])).toEqual({ form: 'my.form', covers: ['a'] });
    expect(JSON.parse(JSON.stringify(EDITOR_FORMS))).toEqual(EDITOR_FORMS);
    for (const [op, e] of Object.entries(EDITOR_FORMS)) for (const a of e.covers) expect(Object.keys(getOp(op).args)).toContain(a);
    // every built-in editor's form is registered by the kit; the layouts' params panels carry the editors
    for (const e of Object.values(EDITOR_FORMS)) expect(rt.app.ir.forms.has(e.form)).toBe(true);
    expect(rt.explain()).toMatch(/stack\.params {2}editors \{curve, levels, hsl, grade, mixer\}/);
  });
});

describe('measuring the stage: core\'s encodings through the service', () => {
  it('the histogram of the print stage\'s input in L counts every pixel of the evaluated image', async () => {
    const { rt, studio: st, f } = await studio();
    const d = docOf(rt, f);
    const bins = await stageHistogram(st, editorMath(), f, d, 'print', 'L');
    expect(bins).toHaveLength(128);
    const n = cutNode(compile(d, st.frames.get(f)!.graph, { links: st.links() }), 'print');
    const info = n.info as { width: number; height: number };
    expect(bins.reduce((a, b) => a + b, 0)).toBe(info.width * info.height);
    expect(histogramOf(new Float64Array([0.5, 0.5, 0.5, 2, 2, 2]), 3, (px) => px[0]!, 4)).toEqual([0, 0, 1, 1]);
  });

  it('the eyedropper writes the OkLab of the print cut under the click, converted with core\'s encodeTransform; one step', async () => {
    const { rt, studio: st, f } = await studio();
    await rt.runCommand('layer.add', null, 'vibrance', 'print');
    const d = docOf(rt, f);
    const n = cutNode(compile(d, st.frames.get(f)!.graph, { links: st.links() }), 'print');
    st.engine.adopt(st.frames.get(f)!.graph.closure(n.id));
    const r = await st.engine.evaluate(n, { scale: 'full', region: { x: 38, y: 28, w: 5, h: 5 }, precision: 'preview' });
    const px = await r.read();
    const mean = [0, 1, 2].map((k) => { let s = 0; for (let i = k; i < px.length; i += r.info.channels) s += px[i]!; return s / 25; });
    const want = applyEncode(encodeTransform('stage', 'oklab', d.output.white), mean).map((v) => Number(v.toFixed(4)));
    expect(await sampleOklab(st, editorMath(), f, d, 'print', undefined, 40, 30)).toEqual(want);
    expect(await eyedropper(rt.ctx(), 40, 30)).toBe(true);
    const d1 = docOf(rt, f);
    const mid = layer(d1, 'vibrance1').mask;
    const comp = Coll.values(Coll.get(d1.masks, mid)!.components)[0]!;
    expect(comp.kind).toBe('colour');
    expect(comp.params['colour']).toEqual(want);
    expect(steps(rt, f)).toBe(2);
    // armed: Sample writes into that component (one step), the arming is cleared
    const cid = Coll.ids(Coll.get(d1.masks, mid)!.components)[0]!;
    rt.ctx().set({ stack: { mask: { sample: cid } } });
    expect(await eyedropper(rt.ctx(), 10, 10)).toBe(true);
    expect(Coll.size(Coll.get(docOf(rt, f).masks, mid)!.components)).toBe(1);
    expect(Coll.get(Coll.get(docOf(rt, f).masks, mid)!.components, cid)!.params['colour']).toEqual(await sampleOklab(st, editorMath(), f, d, 'print', undefined, 10, 10));
    expect((rt.state as any).stack.mask.sample).toBe(null);
    expect(steps(rt, f)).toBe(3);
  });

  it('without the service, or without a print layer selected, the eyedropper says why and changes nothing', async () => {
    const { rt, f } = await studio({ math: false });
    const toasts: string[] = [];
    (rt.chrome as any).toast = (m: string) => void toasts.push(m);
    await rt.runCommand('layer.add', null, 'vibrance', 'print');
    expect(await eyedropper(rt.ctx(), 4, 4)).toBe(false);
    expect(toasts.at(-1)).toMatch(/editorMath/);
    const w = await studio();
    (w.rt.chrome as any).toast = (m: string) => void toasts.push(m);
    await w.rt.runCommand('layer.add', null, 'burn', 'darkroom');
    expect(await eyedropper(w.rt.ctx(), 4, 4)).toBe(false);
    expect(toasts.at(-1)).toMatch(/Select a layer of the print/);
    expect(steps(rt, f)).toBe(1);
  });
});
