// cb.arg (stage 2), frame handles and the render bridge (stage 3), headless.
import { Host, PRINT_OPTIONS as DSL_PRINT_OPTIONS } from '@chromobench/dsl';
import { createCk } from '@chromobench/shell';
import { describe, expect, it } from 'vitest';
import { ACCESSORS, argModel, argProblem, createCb, frameRef, parseEntry, PRINT_OPTIONS, stepValue, parseStep, type ImageHandle } from '../src/index.ts';
import { ACCESSORS as CONTRACT_ACCESSORS, PRINT_OPTIONS as CONTRACT_PRINT_OPTIONS } from '@chromobench/contract';
import { recipePath, started } from './helpers.ts';

const studioWith = (body: (ck: ReturnType<typeof createCk>, cb: ReturnType<typeof createCb>) => unknown) => {
  const ck = createCk();
  const cb = createCb(ck);
  return cb.studio('t').center(body(ck, cb) as any).build();
};

describe('cb.arg', () => {
  it('CB-A101: an unknown path is an error at the variant line, with a computed fix', () => {
    const app = studioWith((ck, cb) => ck.column({}, cb.arg('print.enlarger.time')));
    const d = app.diagnostics.list.find(x => x.code === 'CB-A101')!;
    expect(d.level).toBe('error');
    expect(d.fix).toBe("cb.arg('print.enlarger.time_s')");
    expect(d.at!.file).toMatch(/kit\.test\.ts$/);
    expect(argProblem('print.aim')!.code).toBe('CB-A102');
  });
  it('CB-A110 and CB-A120: a step or widget that does not fit the path', () => {
    const app = studioWith((ck, cb) => ck.column({}, cb.arg('print.grade', { step: '5 CC' }), cb.arg('print.grade', { widget: 'pad' }), cb.arg('print.enlarger.time_s', { step: '1/3 st' })));
    expect(app.codes()).toContain('CB-A110');
    expect(app.codes()).toContain('CB-A120');
    expect(app.diagnostics.list.filter(d => d.code === 'CB-A110').length).toBe(1);
  });
  it('.testStrip() on print.paper is refused (CK-X121); on time it adds the strip', () => {
    const app = studioWith((ck, cb) => ck.column({}, cb.arg('print.paper').testStrip(), cb.arg('print.enlarger.time_s').testStrip({ step: '1/3 st' })));
    expect(app.codes()).toContain('CK-X121');
    expect(app.explain()).toMatch(/cb\.arg {2}path "print\.enlarger\.time_s" {2}strip \{step\} {2}slider {2}s {2}log2 {2}step 1\/6 st {2}aside st {2}\+testStrip\(1\/3 st\)/);
  });
  it('controls("darkroom") explains as sections of generated controls (snapshot)', () => {
    const ck = createCk();
    const cb = createCb(ck);
    expect(ck.explain(cb.panel.controls('darkroom'))).toMatchSnapshot();
  });
  it('typed entry in darkroom units: +1/3 st on 10 s is 12.599 s; f/8; +4 pt; 62.5 CC; *2', () => {
    const time = argModel('print.enlarger.time_s')!;
    expect(parseEntry(time, '+1/3 st', 10)).toBeCloseTo(12.599, 3);
    expect(parseEntry(time, '15.12 s', 10)).toBe(15.12);
    expect(parseEntry(time, '*2', 10)).toBe(20);
    expect(parseEntry(time, '4 pt', 10)).toBe(null);
    expect(parseEntry(argModel('print.enlarger.fstop')!, 'f/11', 8)).toBe(11);
    const lightsR = argModel('print.lights.logH.r')!;
    expect(lightsR.component).toBe(0);
    expect(parseEntry(lightsR, '+4 pt', [0, 0, 0])).toEqual([0.1, 0, 0]);
    const y = argModel('print.enlarger.filtration.y')!;
    expect(parseEntry(y, '62.5 CC', { c: 0, m: 0, y: 0 })).toEqual({ c: 0, m: 0, y: 62.5 });
    expect(parseEntry(y, '−5 CC', { c: 0, m: 0, y: 0 })).toEqual({ c: 0, m: 0, y: -5 });
  });
  it('steps: 1/3 st on time, the signed filtration passes through its detent at 0, f-stops by thirds', () => {
    expect(stepValue(argModel('print.enlarger.time_s')!, 10, 1, parseStep('1/3 st'))).toBeCloseTo(12.599, 3);
    const y = argModel('print.enlarger.filtration.y')!;
    expect(stepValue(y, { c: 0, m: 0, y: 2 }, -1, parseStep('5 CC'))).toEqual({ c: 0, m: 0, y: -3 });
    expect(y.model.detents).toEqual([0]);
    expect(stepValue(argModel('print.enlarger.fstop')!, 8, 1, null)).toBe(9);
  });
});

describe('frame handles and the render bridge', () => {
  it('the accessor table and print() options are the contract\'s shared vocabulary (one module, CHB-024)', () => {
    expect(PRINT_OPTIONS).toBe(CONTRACT_PRINT_OPTIONS);
    expect(DSL_PRINT_OPTIONS).toBe(CONTRACT_PRINT_OPTIONS);
    expect(ACCESSORS).toBe(CONTRACT_ACCESSORS);
  });
  it('vocabulary parity: cb.frame(s).print() names the node the DSL frame.print() names', async () => {
    const { rt, studio, f } = await started();
    const e = studio.frames.get(f)!;
    const host = new Host(e.graph, new Map());
    const r = (rt.store.peek(['recipes', f]) as any);
    const h = frameRef(f, r).print();
    expect(studio.bridge.lower(h).named.id).toBe(host.printOf(r).id);
    expect(studio.bridge.lower(h).named.op).toBe('view.adapt');
  });
  it('content addressing: equal recipes give equal keys; a print change keeps the scan and inversion nodes', async () => {
    const { rt, studio, f } = await started();
    const r0 = rt.store.peek(['recipes', f]) as any;
    const k0 = studio.bridge.key(frameRef(f, r0).print());
    rt.store.preview(recipePath(f, 'print.enlarger.time_s'), 12);
    const r1 = rt.store.peek(['recipes', f]) as any;
    const h1 = frameRef(f, r1).print();
    expect(studio.bridge.key(h1)).not.toBe(k0);
    expect(studio.bridge.lower(frameRef(f, r1).negative()).named.id).toBe(studio.bridge.lower(frameRef(f, r0).negative()).named.id);
    rt.store.cancel();
    expect(studio.bridge.key(frameRef(f, rt.store.peek(['recipes', f]) as any).print())).toBe(k0);
    // the ring-around centre tile is the main view's node by hash-consing
    expect(studio.bridge.key(frameRef(f, r0).ringTile([0, 0, 0]))).toBe(k0);
    expect(studio.bridge.key(frameRef(f, r0).print({ time_s: 10 }))).toBe(k0);
    expect(studio.bridge.key(frameRef(f, 'initial').print())).toBe(k0);
  });
  it('renders the fixture through MockEngine at the size asked, and the inspection views', async () => {
    const { rt, studio, f } = await started();
    const r = rt.store.peek(['recipes', f]) as any;
    const sig = new AbortController().signal;
    const t = { slot: 'x', epoch: 1, lane: 'live' as const, pass: 'screen' as const, maxSide: 48, signal: sig };
    const out = await studio.bridge.render(frameRef(f, r).print(), t);
    expect([out.image.width, out.image.height]).toEqual([48, 32]);
    expect([out.srcW, out.srcH]).toEqual([96, 64]);
    expect(out.image.channels).toBe(3);
    for (const v of ['negative', 'dyes', 'classes'] as const) {
      const h: ImageHandle = frameRef(f, r).view(v);
      expect((await studio.bridge.render(h, t)).image.width).toBe(48);
    }
    const strip = await studio.bridge.render(frameRef(f, r).testStrip({ vary: 'time', step: 1 / 3, count: 5 }), { ...t, maxSide: 96 });
    expect(strip.image.width).toBe(96);
  });
});
