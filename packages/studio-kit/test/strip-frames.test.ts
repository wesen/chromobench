// CHB-027 WS-D (F16): a scan of a strip of film opens as one frame per frame on the strip — same file and source,
// identity (sha, mode, index), each cropped to its box, its own document in the log and catalog entry; a file with one
// frame keeps its id and save key; removing one frame keeps the others; re-opening a strip frame the other way
// re-opens the file.
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { sha256Hex, type Box } from '@chromobench/contract';
import { manualClock } from '@chromobench/shell/testing';
import { describe, expect, it } from 'vitest';
import { buildLayout, createStudio, logKey, memoryKV, stripFrameId, type KV, type OpenAs } from '../src/index.ts';
import { LAYOUTS } from '../layouts/index.js';
import { at, docOf, timeOf } from './helpers.ts';

const TIME = 'main.params.time_s';

/** a studio whose opener reports the file as a strip of three frames when it opens as a negative (as the host does) */
async function stripStudio(o: { kv?: KV; frames?: number } = {}) {
  const engine = new MockEngine();
  const kv = o.kv ?? memoryKV();
  const clock = manualClock(1_000);
  const n = o.frames ?? 3;
  const opener = async (src: Parameters<MockEngine['open']>[0], as: OpenAs) => {
    const info = await engine.open(src);
    const kind = as === 'photo' ? ('digital-raw' as const) : ('negative-scan' as const);
    const w = Math.floor(info.width / n);
    const frames: Box[] | null = kind === 'negative-scan' && n > 1 ? Array.from({ length: n }, (_, i) => ({ x: i * w + 1, y: 1, w: w - 2, h: info.height - 2 })) : null;
    return { info, kind, frames };
  };
  const studio = createStudio({ engine, kv, opener });
  const { app } = buildLayout((await LAYOUTS.tiny()).default);
  const rt = await app.boot(studio.services({ clock }));
  studio.attach(rt);
  return { studio, rt, kv };
}

describe('a strip opens as one frame per box (F16)', () => {
  it('three frames: same file and source, ids and log keys with the index, each cropped to its box, in the catalog', async () => {
    const { studio, rt, kv } = await stripStudio();
    const bytes = makeM1Tiff();
    const sha = sha256Hex(bytes);
    const r = await studio.openFile(bytes, 'raw010.dng');
    expect(r.outcome).toBe('opened');
    expect(r.entries.map((e) => e.id)).toEqual([1, 2, 3].map((i) => stripFrameId(sha, i)));
    expect(r.entry).toBe(r.entries[0]);
    for (const [i, e] of r.entries.entries()) {
      expect(e.sha).toBe(sha);
      expect(e.name).toBe('raw010.dng');
      expect(e.strip).toMatchObject({ index: i + 1, of: 3 });
      expect(docOf(rt, e.id).frame).toBe(e.id);
      expect(docOf(rt, e.id).source.sha256).toBe(sha);
      expect(docOf(rt, e.id).geometry.crop).toEqual(e.strip!.box);
    }
    const s = rt.state as any;
    expect(s.catalog.order).toEqual(r.entries.map((e) => e.id));
    expect(s.catalog.frames[r.entries[1]!.id]).toMatchObject({ name: 'raw010.dng · 2/3', file: 'raw010.dng', sha256: sha, kind: 'negative' });
    expect(s.docs[r.entries[2]!.id].geometry.crop).toEqual(r.entries[2]!.strip!.box);
    await studio.flush();
    for (const i of [1, 2, 3]) expect(await kv.get('logs', logKey(sha, 'negative-scan', i))).toBeTruthy();
    expect(await kv.get('logs', logKey(sha, 'negative-scan'))).toBeUndefined();
  });

  it('each frame has its own document; opening the file again in a new session resumes all three', async () => {
    const kv = memoryKV();
    const a = await stripStudio({ kv });
    const r = await a.studio.openFile(makeM1Tiff(), 'raw010.dng');
    const f2 = r.entries[1]!.id;
    a.rt.run('frame.select', f2);
    a.rt.store.preview(at(a.rt, f2, TIME), 17);
    a.rt.store.commit('Time');
    expect(timeOf(a.rt, f2)).toBe(17);
    expect(timeOf(a.rt, r.entries[0]!.id)).toBe(10);
    await a.studio.flush();
    const b = await stripStudio({ kv });
    const again = await b.studio.openFile(makeM1Tiff(), 'raw010.dng');
    expect(again.outcome).toBe('resumed');
    expect(again.entries.map((e) => timeOf(b.rt, e.id))).toEqual([10, 17, 10]);
  });

  it('a file with one frame keeps the plain id and save key', async () => {
    const { studio, kv, rt } = await stripStudio({ frames: 1 });
    const bytes = makeM1Tiff();
    const sha = sha256Hex(bytes);
    const r = await studio.openFile(bytes, 'one.tif');
    expect(r.entries).toHaveLength(1);
    expect(r.entry.id).toBe(`frame_${sha.slice(0, 8)}`);
    expect(r.entry.strip).toBeUndefined();
    expect(docOf(rt, r.entry.id).geometry.crop).toBeNull();
    await studio.flush();
    expect(await kv.get('logs', logKey(sha, 'negative-scan'))).toBeTruthy();
  });

  it('opening the strip again says "already"; removing one frame keeps the others, opening the file brings it back', async () => {
    const { studio, rt, kv } = await stripStudio();
    const bytes = makeM1Tiff();
    const sha = sha256Hex(bytes);
    const r = await studio.openFile(bytes, 'raw010.dng');
    expect((await studio.openFile(bytes, 'raw010.dng')).outcome).toBe('already');
    const [f1, f2, f3] = r.entries.map((e) => e.id) as [string, string, string];
    rt.run('frame.select', f2);
    rt.run('frame.remove');
    expect(studio.frames.ids()).toEqual([f1, f3]);
    const s = rt.state as any;
    expect(s.catalog.order).toEqual([f1, f3]);
    expect(s.docs[f2]).toBeUndefined();
    expect(rt.store.log.has(f2)).toBe(false);
    // the others still re-open (their file is at hand)
    expect(studio.frames.canReread(f1)).toBe(true);
    await studio.flush();
    expect(await kv.get('logs', logKey(sha, 'negative-scan', 2))).toBeTruthy();
    const again = await studio.openFile(bytes, 'raw010.dng');
    expect(again.outcome).toBe('resumed');
    expect(again.entries.map((e) => e.id)).toEqual([f1, f2, f3]);
    expect(studio.frames.all()).toHaveLength(3);
    expect((rt.state as any).catalog.frames[f2].name).toBe('raw010.dng · 2/3');
  });

  it('re-opening a strip frame as a photo re-opens the file as one photo; back as a negative brings the three frames and their edits', async () => {
    const { studio, rt } = await stripStudio();
    const bytes = makeM1Tiff();
    const sha = sha256Hex(bytes);
    const r = await studio.openFile(bytes, 'raw010.dng');
    const f2 = r.entries[1]!.id;
    rt.run('frame.select', f2);
    rt.store.preview(at(rt, f2, TIME), 14);
    rt.store.commit('Time');
    await studio.flush();
    const photo = await studio.reopen(f2, 'photo');
    expect(photo.entries).toHaveLength(1);
    expect(photo.entry.kind).toBe('digital-raw');
    expect(photo.entry.id).toBe(`frame_${sha.slice(0, 8)}`);
    expect(studio.frames.ids()).toEqual([photo.entry.id]);
    const s = rt.state as any;
    expect(s.catalog.order).toEqual([photo.entry.id]);
    expect(s.ui.selection.primary).toBe(photo.entry.id);
    const back = await studio.reopen(photo.entry.id, 'negative');
    expect(back.outcome).toBe('resumed');
    expect(back.entries.map((e) => e.id)).toEqual(r.entries.map((e) => e.id));
    expect(timeOf(rt, back.entries[1]!.id)).toBe(14);
    expect(studio.frames.all()).toHaveLength(3);
    expect((rt.state as any).ui.selection.primary).toBe(r.entries[0]!.id);
  });
});
