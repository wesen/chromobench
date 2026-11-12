// The render queue (replaces CraftKit's engine.test.mjs, which tested the dropped compile-once graph).
import { describe, expect, it } from 'vitest';
import { RenderQueue, chooseTarget } from '../../src/app/render/queue.ts';
import { fakeBridge, fakeImage } from '../../src/testing/index.ts';

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

describe('render queue', () => {
  it('latest wins: waiting requests are replaced; superseded work is aborted', async () => {
    const b = fakeBridge({ manual: true });
    const q = new RenderQueue([b]);
    const shown: string[] = [];
    const present = (r: any) => void shown.push(`${r.image.width}`);
    q.request('vp:main:after', fakeImage('a', { w: 1000, h: 500 }), { maxSide: 100, present });
    q.request('vp:main:after', fakeImage('b', { w: 1000, h: 500 }), { maxSide: 200, present });
    q.request('vp:main:after', fakeImage('c', { w: 1000, h: 500 }), { maxSide: 300, present });
    expect(q.stats.aborted).toBe(2); // a was in flight with another key: aborted once per newer request
    await flush();
    expect(b.calls.map(c => c.r.name)).toEqual(['a', 'c']); // b never ran: c replaced it while waiting
    b.resolve();
    await flush();
    expect(shown).toEqual(['300']);
    expect(q.stats.presented).toBe(1);
  });
  it('progressMs (CHB-027): a slot that has shown nothing for that long lets its in-flight render finish', async () => {
    const b = fakeBridge({ manual: true });
    const q = new RenderQueue([b]);
    let t = 0;
    q.now = () => t;
    q.progressMs = 250;
    const shown: string[] = [];
    const present = (r: any) => void shown.push(`${r.image.width}`);
    q.request('vp:main:after', fakeImage('a', { w: 1000, h: 500 }), { maxSide: 100, present });
    t = 100;
    q.request('vp:main:after', fakeImage('b', { w: 1000, h: 500 }), { maxSide: 200, present });
    expect(q.stats.aborted).toBe(1); // shown recently (the slot is new): superseded work is aborted
    await flush();
    t = 400;
    q.request('vp:main:after', fakeImage('c', { w: 1000, h: 500 }), { maxSide: 300, present });
    expect(q.stats.aborted).toBe(1); // nothing shown for 400 ms: b finishes and is shown, then c runs
    b.resolve();
    await flush();
    expect(shown).toEqual(['200']);
    t = 450;
    q.request('vp:main:after', fakeImage('d', { w: 1000, h: 500 }), { maxSide: 400, present });
    expect(q.stats.aborted).toBe(2); // shown 50 ms ago: c is aborted for d again
    await flush();
    b.resolve();
    await flush();
    expect(shown).toEqual(['200', '400']);
  });
  it('same key in flight is not aborted; results are presented in increasing generation', async () => {
    const b = fakeBridge({ manual: true });
    const q = new RenderQueue([b]);
    const gens: number[] = [];
    const img = fakeImage('a');
    q.request('s', img, { maxSide: 100, present: (_r, i) => void gens.push(i.gen) });
    q.request('s', img, { maxSide: 100, present: (_r, i) => void gens.push(i.gen) });
    expect(q.stats.aborted).toBe(0);
    b.resolve();
    await flush();
    b.resolve();
    await flush();
    expect(gens).toEqual([1, 2]);
  });
  it('the mutant bridge (answers out of order, ignores aborts): stale answers are released, never presented', async () => {
    const b = fakeBridge({ reverse: true });
    const q = new RenderQueue([b]);
    const shown: string[] = [];
    q.request('s', fakeImage('old'), { maxSide: 100, present: r => void shown.push('old ' + r.image.width) });
    q.request('s', fakeImage('new'), { maxSide: 200, present: r => void shown.push('new ' + r.image.width) });
    b.resolve(); // old resolves (aborted, but the mutant ignores it)
    await flush();
    b.resolve();
    await flush();
    expect(shown).toEqual(['new 200']);
    expect(q.stats.dropped).toBe(1);
    expect(b.released.length).toBe(1);
  });
  it('live preempts bg', async () => {
    const b = fakeBridge({ manual: true });
    const idle: (() => void)[] = [];
    const q = new RenderQueue([b], { idle: f => void idle.push(f) });
    q.request('vp', fakeImage('live'), { maxSide: 100, present: () => {} });
    q.request('thumb:x', fakeImage('bg'), { maxSide: 50, lane: 'bg', present: () => {} });
    expect(b.calls.map(c => c.r.name)).toEqual(['live']);
    b.resolve();
    await flush();
    expect(b.calls.map(c => c.r.name)).toEqual(['live', 'bg']);
    expect(b.calls[1]!.t.lane).toBe('bg');
  });
  it('thumbnails: hits draw at once; LRU eviction releases', async () => {
    const b = fakeBridge();
    const q = new RenderQueue([b], { thumbLimit: 2 });
    const got: string[] = [];
    for (const n of ['a', 'b', 'c']) q.thumb(fakeImage(n), 64, r => void got.push(n + r.image.width));
    await flush(10);
    expect(got).toEqual(['a64', 'b64', 'c64']);
    expect(q.stats.evicted).toBe(1);
    expect(b.released.length).toBe(1);
    expect(q.thumb(fakeImage('c'), 64, () => void got.push('hit'))).toBe(true);
    expect(got.at(-1)).toBe('hit');
    expect(q.stats.thumbHits).toBe(1);
  });
  it('idle() resolves when nothing is in flight', async () => {
    const b = fakeBridge();
    const q = new RenderQueue([b]);
    q.request('s', fakeImage('a'), { maxSide: 10, present: () => {} });
    await q.idle();
    expect(q.busy()).toBe(false);
  });
});

describe('draft, screen, refine (guide §6)', () => {
  it('a 1200×800 CSS px viewer at dpr 2 on a 6000×4000 scan', () => {
    expect(chooseTarget({ previewing: true, shownW: 1176, shownH: 784, dpr: 2, srcW: 6000, srcH: 4000 })).toEqual({ pass: 'draft', maxSide: 866 });
    expect(chooseTarget({ previewing: false, shownW: 1176, shownH: 784, dpr: 2, srcW: 6000, srcH: 4000 })).toEqual({ pass: 'screen', maxSide: 2432 });
    expect(chooseTarget({ previewing: false, shownW: 1176, shownH: 784, dpr: 2, srcW: 6000, srcH: 4000, zoom: 1 }).pass).toBe('refine');
    expect(chooseTarget({ previewing: false, shownW: 3000, shownH: 2000, dpr: 2, srcW: 600, srcH: 400 }).maxSide).toBe(600); // capped by the source
  });
});
