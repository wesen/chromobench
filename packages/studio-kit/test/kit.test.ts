// cb.arg (stage 2) on document paths, frame handles naming the compiler's cuts and the render bridge (stage 3),
// headless.
import { createCk } from '@chromobench/shell';
import { compile, cutNode, type Document } from '@chromobench/contract';
import { describe, expect, it } from 'vitest';
import { ACCESSORS, argModel, argProblem, createCb, frameRef, parseEntry, stepValue, parseStep, type ImageHandle } from '../src/index.ts';
import { at, docOf, setDoc, started } from './helpers.ts';

const studioWith = (body: (ck: ReturnType<typeof createCk>, cb: ReturnType<typeof createCb>) => unknown) => {
  const ck = createCk();
  const cb = createCb(ck);
  return cb.studio('t').module(ck.module('main').center(body(ck, cb) as any)).build();
};

describe('cb.arg', () => {
  it('CB-A101: an unknown path is an error at the layout line, with a computed fix', () => {
    const app = studioWith((ck, cb) => ck.column({}, cb.arg('main.params.time')));
    const d = app.diagnostics.list.find(x => x.code === 'CB-A101')!;
    expect(d.level).toBe('error');
    expect(d.fix).toBe("cb.arg('main.params.time_s')");
    expect(d.at!.file).toMatch(/kit\.test\.ts$/);
    expect(argProblem('dodge1.params.through')!.code).toBe('CB-A102');
  });
  it('CB-A110 and CB-A120: a step or widget that does not fit the path', () => {
    const app = studioWith((ck, cb) => ck.column({}, cb.arg('stages.darkroom.medium.grade', { step: '5 CC' }), cb.arg('stages.darkroom.medium.grade', { widget: 'pad' }), cb.arg('main.params.time_s', { step: '1/3 st' })));
    expect(app.codes()).toContain('CB-A110');
    expect(app.codes()).toContain('CB-A120');
    expect(app.diagnostics.list.filter(d => d.code === 'CB-A110').length).toBe(1);
  });
  it('.testStrip() on the paper is refused (CK-X121); on time it adds the strip', () => {
    expect(() => studioWith((ck, cb) => cb.arg('stages.darkroom.medium.paper').testStrip())).toThrow(/CK-X121/);
    const app = studioWith((ck, cb) => ck.column({}, cb.arg('main.params.time_s').testStrip({ step: '1/3 st' })));
    expect(app.errors).toEqual([]);
    expect(app.explain()).toMatch(/cb\.arg {2}path "main\.params\.time_s" {2}strip \{step\} {2}slider {2}s {2}log2 {2}step 1\/6 st {2}aside st/);
  });
  it('controls("darkroom") explains as sections of generated controls (snapshot)', () => {
    const ck = createCk();
    const cb = createCb(ck);
    expect(ck.explain(cb.panels.controls('darkroom'))).toMatchSnapshot();
  });
  it('typed entry in darkroom units: +1/3 st on 10 s is 12.599 s; f/8; +4 pt; 62.5 CC; *2', () => {
    const time = argModel('main.params.time_s')!;
    expect(parseEntry(time, '+1/3 st', 10)).toBeCloseTo(12.599, 3);
    expect(parseEntry(time, '15.12 s', 10)).toBe(15.12);
    expect(parseEntry(time, '*2', 10)).toBe(20);
    expect(parseEntry(time, '4 pt', 10)).toBe(null);
    expect(parseEntry(argModel('main.params.fstop')!, 'f/11', 8)).toBe(11);
    const lightsR = argModel('lights.params.logH.r')!;
    expect(lightsR.component).toBe(0);
    expect(parseEntry(lightsR, '+4 pt', [0, 0, 0])).toEqual([0.1, 0, 0]);
    const y = argModel('main.params.filtration.y')!;
    expect(parseEntry(y, '62.5 CC', { c: 0, m: 0, y: 0 })).toEqual({ c: 0, m: 0, y: 62.5 });
    expect(parseEntry(y, '−5 CC', { c: 0, m: 0, y: 0 })).toEqual({ c: 0, m: 0, y: -5 });
  });
  it('steps: 1/3 st on time, the signed filtration passes through its detent at 0, f-stops by thirds', () => {
    expect(stepValue(argModel('main.params.time_s')!, 10, 1, parseStep('1/3 st'))).toBeCloseTo(12.599, 3);
    const y = argModel('main.params.filtration.y')!;
    expect(stepValue(y, { c: 0, m: 0, y: 2 }, -1, parseStep('5 CC'))).toEqual({ c: 0, m: 0, y: -3 });
    expect(y.model.detents).toEqual([0]);
    expect(stepValue(argModel('main.params.fstop')!, 8, 1, null)).toBe(9);
  });
});

describe('frame handles and the render bridge', () => {
  it('handles name the compiler\'s cuts: print → print, finished, display, negative, source; scan is the scene of a photo', async () => {
    expect([...ACCESSORS]).toEqual(['source', 'scan', 'negative', 'print', 'finished', 'display']);
    const { rt, studio, f } = await started();
    const e = studio.frames.get(f)!;
    const d = docOf(rt, f);
    const c = compile(d, e.graph);
    const ref = frameRef(f, d);
    expect(studio.bridge.lower(ref.print()).named.id).toBe(cutNode(c, 'print').id);
    expect(studio.bridge.lower(ref.print()).named.op).toBe('view.adapt');
    expect(studio.bridge.lower(ref.print()).shown.id).toBe(c.display.id);
    expect(studio.bridge.lower(ref.finished()).named.id).toBe(cutNode(c, 'finished').id);
    expect(studio.bridge.lower(ref.display()).named.id).toBe(c.display.id);
    expect(studio.bridge.lower(ref.display()).shown.op).toBe('output.frame');
    expect(studio.bridge.lower(ref.negative()).named.id).toBe(cutNode(c, 'negative').id);
    expect(studio.bridge.lower(ref.negative()).shown.op).toBe('view.inspect');
    expect(studio.bridge.lower(ref.scan()).named.id).toBe(cutNode(c, 'scan').id);
    expect(studio.bridge.lower(ref.source()).named.id).toBe(cutNode(c, 'source').id);
    expect(ref.print().expr).toBe('frame.print()');
  });
  it('content addressing: equal documents give equal keys; a print change keeps the scan and inversion nodes', async () => {
    const { rt, studio, f } = await started();
    const d0 = rt.store.peek(['docs', f]) as Document;
    const k0 = studio.bridge.key(frameRef(f, d0).print());
    rt.store.preview(at(rt, f, 'main.params.time_s'), 12);
    const d1 = rt.store.peek(['docs', f]) as Document;
    const h1 = frameRef(f, d1).print();
    expect(studio.bridge.key(h1)).not.toBe(k0);
    expect(studio.bridge.lower(frameRef(f, d1).negative()).named.id).toBe(studio.bridge.lower(frameRef(f, d0).negative()).named.id);
    rt.store.cancel();
    expect(studio.bridge.key(frameRef(f, rt.store.peek(['docs', f]) as Document).print())).toBe(k0);
    // the ring-around centre tile is the main view's node by hash-consing; 'initial' is the log's initial document
    expect(studio.bridge.key(frameRef(f, d0).ringTile([0, 0, 0]))).toBe(k0);
    expect(studio.bridge.key(frameRef(f, 'initial').print())).toBe(k0);
    setDoc(rt, f, 'main.params.time_s', 14, 'Time');
    expect(studio.bridge.key(frameRef(f, 'initial').print())).toBe(k0);
    expect(studio.bridge.key(frameRef(f, docOf(rt, f)).print())).not.toBe(k0);
    // a ring tile is the print with its lights moved
    const tile = studio.bridge.lower(frameRef(f, d0).ringTile([0.1, 0, 0]));
    const moved = compile({ ...d0, stages: { ...d0.stages, darkroom: { ...d0.stages.darkroom, stack: { ...d0.stages.darkroom.stack, items: { ...d0.stages.darkroom.stack.items, lights: { ...(d0.stages.darkroom.stack.items['lights'] as any), params: { logH: [0.1, 0, 0] } } } } } } } as Document, studio.frames.get(f)!.graph);
    expect(tile.shown.id).toBe(moved.display.id);
  });
  it('renders the fixture through MockEngine at the size asked, the inspection views, and a test strip of bands', async () => {
    const { rt, studio, f } = await started();
    const d = rt.store.peek(['docs', f]) as Document;
    const sig = new AbortController().signal;
    const t = { slot: 'x', epoch: 1, lane: 'live' as const, pass: 'screen' as const, maxSide: 48, signal: sig };
    const out = await studio.bridge.render(frameRef(f, d).print(), t);
    expect([out.image.width, out.image.height]).toEqual([48, 32]);
    expect([out.srcW, out.srcH]).toEqual([96, 64]);
    expect(out.image.channels).toBe(3);
    for (const v of ['negative', 'dyes', 'classes'] as const) {
      const h: ImageHandle = frameRef(f, d).view(v);
      expect((await studio.bridge.render(h, t)).image.width).toBe(48);
    }
    const sh = frameRef(f, d).testStrip({ vary: 'time', step: 1 / 3, count: 5 });
    const bands = studio.bridge.bands(sh)!;
    bands.forEach((b, i) => expect(b.value).toBeCloseTo(10 * 2 ** ((i - 2) / 3), 9));
    expect(new Set(bands.map(b => b.node.id)).size).toBe(5);
    // the middle band is the print itself
    expect(bands[2]!.node.id).toBe(studio.bridge.lower(frameRef(f, d).print()).shown.id);
    const strip = await studio.bridge.render(sh, { ...t, maxSide: 96 });
    expect(strip.image.width).toBe(96);
  });
});
