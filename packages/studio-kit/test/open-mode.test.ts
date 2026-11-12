// CHB-027 WS-A: a file is opened as a photo or as a negative (F1), a saved recipe is resumed only in its own mode
// (F3), opening an open file says so (F2), a frame can be re-opened the other way or removed (F6), and the library
// keeps frames that are not open in this session (F5).
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { EditLog, sha256Hex, type EditLogData } from '@chromobench/contract';
import { describe, expect, it } from 'vitest';
import { createStudio, defaultFor, libraryFrames, logKey, memoryKV, visibleFrames, type KV, type OpenAs } from '../src/index.ts';
import { recipePath, started } from './helpers.ts';

const TIME = 'print.enlarger.time_s';

/** the M1 fixture with one sample changed: another file */
function otherTiff(): Uint8Array {
  const b = makeM1Tiff();
  b[b.length - 2] = (b[b.length - 2]! + 1) & 0xff;
  return b;
}

/** a studio whose opener decides like the host: 'auto' guesses negative for this fixture */
async function studioWith(o: { kv?: KV; guess?: 'photo' | 'negative' } = {}) {
  const engine = new MockEngine();
  const calls: OpenAs[] = [];
  const kv = o.kv ?? memoryKV();
  const opener = async (src: Parameters<MockEngine['open']>[0], as: OpenAs) => {
    calls.push(as);
    const kind = as === 'photo' || (as === 'auto' && o.guess === 'photo') ? ('digital-raw' as const) : ('negative-scan' as const);
    return { info: await engine.open(src), kind };
  };
  const studio = createStudio({ engine, kv, opener });
  return { studio, calls, kv };
}

describe('open modes and saved logs (F1, F3)', () => {
  it('opens as the opener says, and saves the log under (hash, mode)', async () => {
    const { studio, kv } = await studioWith({ guess: 'photo' });
    const bytes = makeM1Tiff();
    const r = await studio.openFile(bytes, 'DSC_8559.NEF');
    expect(r.outcome).toBe('opened');
    expect(r.entry.kind).toBe('digital-raw');
    expect(r.entry.log.committed.kind).toBe('digital-raw');
    expect(r.entry.log.committed.source.decode.mode).toBe('photo');
    await studio.flush();
    const sha = sha256Hex(bytes);
    expect(await kv.get('logs', logKey(sha, 'digital-raw'))).toBeTruthy();
    expect(await kv.get('logs', logKey(sha, 'negative-scan'))).toBeUndefined();
  });

  it('never resumes a photo recipe on a negative decode (the F3 trap), but resumes an old log of the same kind', async () => {
    const kv = memoryKV();
    const bytes = makeM1Tiff();
    const sha = sha256Hex(bytes);
    // an old (pre-CHB-027) log saved by hash alone, as a photo, with an edit
    const old = EditLog.create(defaultFor(sha, 'raw010.dng', 'digital-raw'), { by: 'auto' });
    old.apply([{ op: 'set', path: TIME, value: 20 }], 'user', 'Time');
    await kv.put('logs', sha, old.toJSON());
    const neg = await (await studioWith({ kv })).studio.openFile(bytes, 'raw010.dng', { as: 'negative' });
    expect(neg.outcome).toBe('opened');
    expect(neg.entry.log.committed.kind).toBe('negative-scan');
    expect(neg.entry.log.committed.print.enlarger.time_s).toBe(10);
    // the same old log is taken when the file opens as a photo again
    const photo = await (await studioWith({ kv })).studio.openFile(bytes, 'raw010.dng', { as: 'photo' });
    expect(photo.outcome).toBe('resumed');
    expect(photo.entry.log.committed.print.enlarger.time_s).toBe(20);
  });

  it('opening an open file says "already" (F2), or "conflict" when asked for the other mode', async () => {
    const { studio } = await studioWith();
    const bytes = makeM1Tiff();
    const a = await studio.openFile(bytes, 'm1.tif');
    expect(a.outcome).toBe('opened');
    const again = await studio.openFile(bytes, 'm1.tif');
    expect(again).toMatchObject({ outcome: 'already', entry: a.entry });
    expect((await studio.openFile(bytes, 'm1.tif', { as: 'negative' })).outcome).toBe('already');
    const other = await studio.openFile(bytes, 'm1.tif', { as: 'photo' });
    expect(other.outcome).toBe('conflict');
    expect(studio.frames.all().length).toBe(1);
  });

  it('two opens of one file at once make one frame', async () => {
    const { studio } = await studioWith();
    const bytes = makeM1Tiff();
    const [a, b] = await Promise.all([studio.openFile(bytes, 'm1.tif'), studio.openFile(bytes, 'm1.tif')]);
    expect(a.entry).toBe(b.entry);
    expect([a.outcome, b.outcome].sort()).toEqual(['already', 'opened']);
  });
});

describe('re-open as photo / negative, remove (F3, F6)', () => {
  it('re-opens a frame the other way: same id, the other kind, its own log; switching back resumes the first', async () => {
    const { rt, studio, f } = await started();
    const e0 = studio.frames.get(f)!;
    expect(e0.kind).toBe('negative-scan');
    rt.store.preview(recipePath(f, TIME), 14);
    rt.store.commit('Time');
    expect(e0.log.committed.print.enlarger.time_s).toBe(14);
    const r = await studio.reopen(f, 'photo');
    expect(r.entry.id).toBe(f);
    expect(r.entry.kind).toBe('digital-raw');
    expect((rt.state as any).recipes[f].kind).toBe('digital-raw');
    expect((rt.state as any).catalog.frames[f].kind).toBe('photo');
    // the undo of the negative's Time skips: that log is out of the studio now
    rt.run('edit.undo');
    expect((rt.state as any).recipes[f].kind).toBe('digital-raw');
    expect(e0.log.cursor).toBe(1);
    // back to the negative: its saved log, with the Time change
    const back = await studio.reopen(f, 'negative');
    expect(back.outcome).toBe('resumed');
    expect(back.entry.log.committed.print.enlarger.time_s).toBe(14);
    expect((rt.state as any).recipes[f].print.enlarger.time_s).toBe(14);
  });

  it('removes frames from the library: out of the store, the catalog and the selection; the log stays saved', async () => {
    const { rt, studio, f, kv } = await started();
    const sha = studio.frames.get(f)!.sha;
    const g = (await studio.open(otherTiff(), 'm2.tif')).id;
    expect(g).not.toBe(f);
    rt.run('frame.select', f);
    rt.run('frame.remove');
    const s = rt.state as any;
    expect(studio.frames.get(f)).toBeUndefined();
    expect(s.recipes[f]).toBeUndefined();
    expect(s.catalog.frames[f]).toBeUndefined();
    expect(s.catalog.order).toEqual([g]);
    expect(s.ui.selection.primary).toBe(g);
    await studio.flush();
    expect(await kv.get<EditLogData>('logs', logKey(sha, 'negative-scan'))).toBeTruthy();
    // opening it again resumes it
    const again = await studio.openFile(makeM1Tiff(), 'm1.tif');
    expect(again.outcome).toBe('resumed');
  });
});

describe('the library survives a reload (F5)', () => {
  it('lists catalog frames that are not open, with their saved thumbnail; visibleFrames keeps only open ones', async () => {
    const { rt, f } = await started();
    rt.store.writeDoc([{ path: ['catalog', 'frames', 'frame_offline'], value: { id: 'frame_offline', sha256: 'ab'.repeat(32), name: 'DSC_1.NEF', flag: null, stars: 0, label: null, keywords: [], kind: 'photo', thumb: 'data:image/jpeg;base64,AA' } }, { path: ['catalog', 'order'], value: [f, 'frame_offline'] }], { tier: 'document' });
    const s = rt.state as any;
    expect(libraryFrames(s).map((x) => x.id)).toEqual([f, 'frame_offline']);
    expect(visibleFrames(s).map((x) => x.id)).toEqual([f]);
    // removing a frame that is not open takes it out of the catalog
    rt.run('frame.select', 'frame_offline');
    rt.run('frame.remove');
    expect(libraryFrames(rt.state).map((x) => x.id)).toEqual([f]);
  });

  it('host commands are hidden until a host offers them; then they run the host', async () => {
    const { rt, studio } = await started();
    const hidden = (id: string) => rt.commands.hidden(id, rt.state);
    expect(hidden('file.open')).toBe(true);
    const calls: string[] = [];
    studio.setHost({ openFiles: () => calls.push('open'), saveRecipe: () => calls.push('recipe'), folder: 'Scans 2026', reopenFolder: () => calls.push('folder') });
    expect(hidden('file.open')).toBe(false);
    expect(hidden('file.reopenFolder')).toBe(false);
    expect(rt.commands.label('file.reopenFolder', rt.state)).toBe('Reopen Scans 2026');
    expect(hidden('file.openFolder')).toBe(true);
    rt.run('file.open');
    rt.run('file.saveRecipe');
    expect(calls).toEqual(['open', 'recipe']);
    rt.run('file.openAs.photo');
    expect((rt.state as any).prefs.openAs).toBe('photo');
  });
});
