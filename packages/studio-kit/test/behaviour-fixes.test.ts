// The two behaviour fixes P5b-1 decided (CHB-037 P5b-2): (1) ratings (flag, stars, colour label, keywords) are the
// document tier, keyed by frame id: a mis-rating is one undo step, and the library merges them into its frames;
// library membership stays the view tier (opening a file adds no step). (2) The History panel's jump says what
// it crosses: a jump back on this frame that also undoes later changes on other frames asks first.
import { describe, expect, it } from 'vitest';
import { jumpCrosses, sel } from '../src/index.ts';
import { otherTiff, setDoc, started } from './helpers.ts';

describe('ratings are the document tier', () => {
  it('a flag, stars, a colour label and keywords are one step each, undone by Mod+Z; the library shows them', async () => {
    const { rt, f } = await started();
    const s = () => rt.state as any;
    const before = rt.store.log.steps.length;
    expect(sel.entry(s(), f)).toMatchObject({ flag: null, stars: 0, label: null, keywords: [] });
    rt.runCommand('frame.pick', null);
    rt.runCommand('frame.rate', null, 3);
    rt.runCommand('frame.label', null, 'red');
    rt.runCommand('frame.keywords', null, ['harbour', 'dusk']);
    expect(rt.store.log.steps.length).toBe(before + 4);
    expect(sel.entry(s(), f)).toMatchObject({ flag: 'pick', stars: 3, label: 'red', keywords: ['harbour', 'dusk'] });
    expect(sel.library(s()).find(x => x.id === f)).toMatchObject({ flag: 'pick', stars: 3 });
    // the catalog itself holds no rating (membership only)
    expect(s().catalog.frames[f].flag).toBeUndefined();
    // a mis-rating: one undo
    rt.runCommand('frame.reject', null);
    expect(sel.entry(s(), f)!.flag).toBe('reject');
    rt.undo();
    expect(sel.entry(s(), f)!.flag).toBe('pick');
    // the merged entry is the same object while nothing changed (views key their cells on it)
    expect(sel.entry(s(), f)).toBe(sel.entry(s(), f));
  });
  it('opening a frame adds no step (the library is the view tier)', async () => {
    const { rt, studio } = await started();
    const n = rt.store.log.steps.length;
    await studio.open(otherTiff(), 'other.tif');
    await studio.flush();
    expect(rt.store.log.steps.length).toBe(n);
  });
});

describe('the History jump says what it crosses', () => {
  it('a jump back on frame A across a later change on frame B: one change on B; nothing to say within A', async () => {
    const { rt, studio, f } = await started();
    const b = (await studio.open(otherTiff(), 'b.tif')).id;
    await studio.flush();
    setDoc(rt, f, 'main.params.time_s', 12, 'Time');
    const afterA = rt.store.log.cursor;
    setDoc(rt, b, 'main.params.time_s', 14, 'Time');
    setDoc(rt, b, 'main.params.fstop', 11, 'Aperture');
    const name = (d: string) => sel.entry(rt.state as any, d)?.name ?? d;
    // to just after A's step: B's two later steps are undone too
    expect(jumpCrosses(rt.store.log, f, afterA, name)).toEqual({ count: 2, names: ['b.tif'], redo: false });
    // to before A's step: the same two, A's own step is not "other"
    expect(jumpCrosses(rt.store.log, f, afterA - 1, name).count).toBe(2);
    // on B: jumping to its own last step crosses nothing
    expect(jumpCrosses(rt.store.log, b, rt.store.log.cursor - 1, name).count).toBe(0);
    // a redo forward across B's steps says so
    studio.jump(afterA - 1);
    expect(jumpCrosses(rt.store.log, f, afterA + 2, name)).toMatchObject({ count: 2, redo: true });
  });
});
