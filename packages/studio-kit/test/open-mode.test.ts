// CHB-027 WS-A: a file is opened as a photo or as a negative (F1), a saved edit is resumed only in its own mode
// (F3), opening an open file says so (F2), a frame can be re-opened the other way or removed (F6), and the library
// keeps frames that are not open in this session (F5).
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { sha256Hex, type Document } from '@chromobench/contract';
import { set, transaction } from '@chromobench/values';
import { manualClock } from '@chromobench/shell/testing';
import { describe, expect, it } from 'vitest';
import { buildLayout, createStudio, defaultDocument, FRAME_SAVE_FORMAT, logKey, memoryKV, sel, type FrameSave, type KV, type OpenAs } from '../src/index.ts';
import { LAYOUTS } from '../layouts/index.js';
import { at, docOf, otherTiff, started, timeOf } from './helpers.ts';

const TIME = 'main.params.time_s';

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
  const { app } = buildLayout((await LAYOUTS.tiny()).default);
  const rt = await app.boot(studio.services({ clock: manualClock(1_000) }));
  studio.attach(rt);
  return { studio, calls, kv, rt, engine };
}

/** a saved edit of a file: its document as opened and one Time set */
async function savedTime(kv: KV, bytes: Uint8Array, kind: 'negative-scan' | 'digital-raw', time: number): Promise<void> {
  const info = await new MockEngine().open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
  const initial = defaultDocument(kind, { sha256: info.sha256, name: 'raw010.dng', width: info.width, height: info.height });
  const rec: FrameSave = { format: FRAME_SAVE_FORMAT, version: 3, initial, applied: [transaction({ id: 't1', label: 'Time', by: 'user', mutations: [set(TIME, time)] })], pending: [] };
  await kv.put('logs', logKey(info.sha256, kind), rec);
}

describe('open modes and saved edits (F1, F3)', () => {
  it('opens as the opener says, and saves the edit under (hash, mode)', async () => {
    const { studio, kv, rt } = await studioWith({ guess: 'photo' });
    const bytes = makeM1Tiff();
    const r = await studio.openFile(bytes, 'DSC_8559.NEF');
    expect(r.outcome).toBe('opened');
    expect(r.entry.kind).toBe('digital-raw');
    const d = docOf(rt, r.entry.id) as Document;
    expect(d.stages.scene).toBeDefined();
    expect(d.stages.scan).toBeUndefined();
    expect(d.source.decode.mode).toBe('photo');
    await studio.flush();
    const sha = sha256Hex(bytes);
    expect(await kv.get('logs', logKey(sha, 'digital-raw'))).toBeTruthy();
    expect(await kv.get('logs', logKey(sha, 'negative-scan'))).toBeUndefined();
  });

  it('never resumes a photo edit on a negative decode (the F3 trap), but resumes it when the file opens as a photo', async () => {
    const kv = memoryKV();
    const bytes = makeM1Tiff();
    await savedTime(kv, bytes, 'digital-raw', 20);
    const a = await studioWith({ kv });
    const neg = await a.studio.openFile(bytes, 'raw010.dng', { as: 'negative' });
    expect(neg.outcome).toBe('opened');
    expect(docOf(a.rt, neg.entry.id).stages.scan).toBeDefined();
    expect(timeOf(a.rt, neg.entry.id)).toBe(10);
    const b = await studioWith({ kv });
    const photo = await b.studio.openFile(bytes, 'raw010.dng', { as: 'photo' });
    expect(photo.outcome).toBe('resumed');
    expect(timeOf(b.rt, photo.entry.id)).toBe(20);
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
  it('re-opens a frame the other way: same id, the other kind, its own document; switching back resumes the first', async () => {
    const { rt, studio, f } = await started();
    const e0 = studio.frames.get(f)!;
    expect(e0.kind).toBe('negative-scan');
    rt.store.preview(at(rt, f, TIME), 14);
    rt.store.commit('Time');
    expect(timeOf(rt, f)).toBe(14);
    await studio.flush();
    const r = await studio.reopen(f, 'photo');
    expect(r.entry.id).toBe(f);
    expect(r.entry.kind).toBe('digital-raw');
    expect(sel.kind(rt.state as any, f)).toBe('photo');
    expect((rt.state as any).catalog.frames[f].kind).toBe('photo');
    // the negative's document left the log with its steps: nothing to undo on the photo
    expect(rt.store.log.canUndo).toBe(false);
    rt.run('edit.undo');
    expect(sel.kind(rt.state as any, f)).toBe('photo');
    // back to the negative: its saved edit, with the Time change
    await studio.flush();
    const back = await studio.reopen(f, 'negative');
    expect(back.outcome).toBe('resumed');
    expect(timeOf(rt, f)).toBe(14);
  });

  it('removes frames from the library: out of the store, the catalog and the selection; the edit stays saved', async () => {
    const { rt, studio, f, kv } = await started();
    const sha = studio.frames.get(f)!.sha;
    const g = (await studio.open(otherTiff(), 'm2.tif')).id;
    expect(g).not.toBe(f);
    rt.run('frame.select', f);
    rt.run('frame.remove');
    const s = rt.state as any;
    expect(studio.frames.get(f)).toBeUndefined();
    expect(s.docs[f]).toBeUndefined();
    expect(rt.store.log.has(f)).toBe(false);
    expect(s.catalog.frames[f]).toBeUndefined();
    expect(s.catalog.order).toEqual([g]);
    expect(s.ui.selection.primary).toBe(g);
    await studio.flush();
    expect(await kv.get('logs', logKey(sha, 'negative-scan'))).toBeTruthy();
    // opening it again resumes it
    const again = await studio.openFile(makeM1Tiff(), 'm1.tif');
    expect(again.outcome).toBe('resumed');
  });
});

describe('the library survives a reload (F5)', () => {
  it('lists catalog frames that are not open, with their saved thumbnail; visibleFrames keeps only open ones', async () => {
    const { rt, f } = await started();
    rt.store.writeView([{ path: ['catalog', 'frames', 'frame_offline'], value: { id: 'frame_offline', sha256: 'ab'.repeat(32), name: 'DSC_1.NEF', flag: null, stars: 0, label: null, keywords: [], kind: 'photo', thumb: 'data:image/jpeg;base64,AA' } }, { path: ['catalog', 'order'], value: [f, 'frame_offline'] }]);
    const s = rt.state as any;
    expect(sel.library(s).map((x) => x.id)).toEqual([f, 'frame_offline']);
    expect(sel.visible(s).map((x) => x.id)).toEqual([f]);
    // removing a frame that is not open takes it out of the catalog
    rt.run('frame.select', 'frame_offline');
    rt.run('frame.remove');
    expect(sel.library(rt.state).map((x) => x.id)).toEqual([f]);
  });

  it('host commands are hidden until a host offers them; then they run the host', async () => {
    const { rt, studio } = await started();
    const hidden = (id: string) => rt.commands.hidden(id, rt.state);
    expect(hidden('file.open')).toBe(true);
    const calls: string[] = [];
    studio.setHost({ openFiles: () => calls.push('open'), saveDocument: () => calls.push('document'), folder: 'Scans 2026', reopenFolder: () => calls.push('folder') });
    expect(hidden('file.open')).toBe(false);
    expect(hidden('file.reopenFolder')).toBe(false);
    expect(rt.commands.label('file.reopenFolder', rt.state)).toBe('Reopen Scans 2026');
    expect(hidden('file.openFolder')).toBe(true);
    rt.run('file.open');
    rt.run('file.saveDocument');
    expect(calls).toEqual(['open', 'document']);
    rt.run('file.openAs.photo');
    expect((rt.state as any).prefs.openAs).toBe('photo');
  });
});
