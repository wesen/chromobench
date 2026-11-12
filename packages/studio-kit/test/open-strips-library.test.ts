// CHB-031 WS-B: the selection never moves onto a library frame that is not open (F21: that asks for its file); a
// file the library knows opens the way it had it, not as File ▸ Open As or a new guess says (F18); frames cut from a
// vertical strip are turned upright by default and can be turned and mirrored per frame (F20).
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { sha256Hex, type Box } from '@chromobench/contract';
import { manualClock } from '@chromobench/shell/testing';
import { describe, expect, it } from 'vitest';
import { buildVariant, createStudio, memoryKV, type OpenAs } from '../src/index.ts';
import { stripOrientation } from '../src/model/orient.ts';
import { VARIANTS } from '../variants/index.js';

/** the M1 fixture with one sample changed: another file */
function otherTiff(k = 1): Uint8Array {
  const b = makeM1Tiff();
  b[b.length - 2] = (b[b.length - 2]! + k) & 0xff;
  return b;
}

const offline = (id: string, kind: 'photo' | 'negative' = 'photo', sha = 'ab'.repeat(32)) => ({ id, sha256: sha, name: `${id}.NEF`, flag: null, stars: 0, label: null, keywords: [], kind });

/** a studio on the classic layout whose opener records how it was asked; `strip`: boxes for a negative */
async function studioWith(o: { guess?: 'photo' | 'negative'; strip?: (w: number, h: number) => Box[] } = {}) {
  const engine = new MockEngine();
  const clock = manualClock(1_000);
  const calls: OpenAs[] = [];
  const opener = async (src: Parameters<MockEngine['open']>[0], as: OpenAs) => {
    calls.push(as);
    const info = await engine.open(src);
    const kind = as === 'photo' || (as === 'auto' && o.guess === 'photo') ? ('digital-raw' as const) : ('negative-scan' as const);
    return { info, kind, frames: kind === 'negative-scan' && o.strip ? o.strip(info.width, info.height) : null };
  };
  const studio = createStudio({ engine, kv: memoryKV(), opener, now: () => clock.now() });
  const { app } = buildVariant((await VARIANTS.classic()).default);
  const rt = await app.boot(studio.services({ clock }));
  studio.attach(rt);
  return { studio, rt, calls };
}

/** three frames down a vertical strip, each wider than tall (the photographer's raw010.dng, F20) */
const vertical = (w: number, h: number): Box[] => {
  const fh = Math.floor(h / 3);
  const bw = w - 2, bh = Math.min(fh - 2, Math.floor((w - 2) / 1.4));
  return [0, 1, 2].map((i) => ({ x: 1, y: i * fh + 1, w: bw, h: bh }));
};

describe('the selection never lands on a frame that is not open (F21)', () => {
  it('Remove from Library selects the next open frame, skipping library frames whose file is not open', async () => {
    const { studio, rt } = await studioWith();
    const a = (await studio.open(makeM1Tiff(), 'a.tif')).id;
    const b = (await studio.open(otherTiff(), 'b.tif')).id;
    // the library: a, then two frames not open in this session, then b
    rt.store.writeDoc([
      { path: ['catalog', 'frames', 'frame_off1'], value: offline('frame_off1') },
      { path: ['catalog', 'frames', 'frame_off2'], value: offline('frame_off2', 'negative', 'cd'.repeat(32)) },
      { path: ['catalog', 'order'], value: [a, 'frame_off1', 'frame_off2', b] },
    ], { tier: 'document' });
    rt.run('frame.select', a);
    rt.run('frame.remove');
    expect((rt.state as any).ui.selection.primary).toBe(b);
    // the last open frame: nothing is selected rather than a frame not open
    rt.run('frame.remove');
    expect((rt.state as any).ui.selection.primary).toBe(null);
    expect((rt.state as any).catalog.order).toEqual(['frame_off1', 'frame_off2']);
  });

  it('removing a library frame that is not open (the "Where is …?" dialog\'s Remove) selects an open frame or none', async () => {
    const { studio, rt } = await studioWith();
    const a = (await studio.open(makeM1Tiff(), 'a.tif')).id;
    rt.store.writeDoc([
      { path: ['catalog', 'frames', 'frame_off1'], value: offline('frame_off1') },
      { path: ['catalog', 'frames', 'frame_off2'], value: offline('frame_off2', 'photo', 'cd'.repeat(32)) },
      { path: ['catalog', 'order'], value: ['frame_off1', 'frame_off2', a] },
    ], { tier: 'document' });
    rt.run('frame.select', 'frame_off1');
    studio.remove(['frame_off1']);
    expect((rt.state as any).ui.selection.primary).toBe(a);
  });

  it('a photo re-opened as a strip shows the strip\'s first frame, not the library frame after it', async () => {
    const { studio, rt } = await studioWith({ strip: vertical });
    const bytes = makeM1Tiff();
    const p = await studio.openFile(bytes, 'raw010.dng', { as: 'photo' });
    rt.store.writeDoc([
      { path: ['catalog', 'frames', 'frame_off1'], value: offline('frame_off1') },
      { path: ['catalog', 'order'], value: [p.entry.id, 'frame_off1'] },
    ], { tier: 'document' });
    rt.run('frame.select', p.entry.id);
    const r = await studio.reopen(p.entry.id, 'negative');
    expect(r.entries).toHaveLength(3);
    expect((rt.state as any).ui.selection.primary).toBe(r.entries[0]!.id);
  });
});

describe('a file the library knows opens the way it had it (F18)', () => {
  it('"auto" on a library photo opens it as a photo, without a new guess', async () => {
    const { studio, rt, calls } = await studioWith({ guess: 'negative' });
    const bytes = makeM1Tiff();
    const sha = sha256Hex(bytes);
    rt.store.writeDoc([
      { path: ['catalog', 'frames', `frame_${sha.slice(0, 8)}`], value: offline(`frame_${sha.slice(0, 8)}`, 'photo', sha) },
      { path: ['catalog', 'order'], value: [`frame_${sha.slice(0, 8)}`] },
    ], { tier: 'document' });
    const r = await studio.openFile(bytes, 'DSC_8559.NEF');
    expect(calls).toEqual(['photo']);
    expect(r.entry.kind).toBe('digital-raw');
    // a file the library does not know is guessed
    const g = await studio.openFile(otherTiff(), 'scan.tif');
    expect(calls.at(-1)).toBe('auto');
    expect(g.entry.kind).toBe('negative-scan');
  });

  it('an explicit Open As still wins (this session\'s choice), and File ▸ Open As ▸ Keep toggles keeping it', async () => {
    const { studio, rt, calls } = await studioWith();
    const bytes = makeM1Tiff();
    const sha = sha256Hex(bytes);
    rt.store.writeDoc([{ path: ['catalog', 'frames', 'frame_x'], value: offline('frame_x', 'photo', sha) }], { tier: 'document' });
    const r = await studio.openFile(bytes, 'DSC_8559.NEF', { as: 'negative' });
    expect(calls).toEqual(['negative']);
    expect(r.entry.kind).toBe('negative-scan');
    studio.setHost({ openFiles: () => undefined });
    expect(rt.commands.hidden('file.openAs.keep', rt.state)).toBe(false);
    rt.run('file.openAs.keep');
    expect((rt.state as any).prefs.openAsKeep).toBe(true);
    rt.run('file.openAs.keep');
    expect((rt.state as any).prefs.openAsKeep).toBe(false);
  });
});

describe('strip frames: orientation (F20)', () => {
  it('stripOrientation: wide frames down a vertical strip are turned and mirrored; other strips stay', () => {
    expect(stripOrientation(vertical(232, 512))).toBe('transpose');
    // a horizontal strip of wide frames, and tall frames down a vertical strip
    expect(stripOrientation([0, 1, 2].map((i) => ({ x: i * 170, y: 0, w: 160, h: 110 })))).toBe('none');
    expect(stripOrientation([0, 1, 2].map((i) => ({ x: 0, y: i * 170, w: 110, h: 160 })))).toBe('none');
    expect(stripOrientation([{ x: 0, y: 0, w: 200, h: 100 }])).toBe('none');
  });

  it('frames cut from a vertical strip open turned upright; Frame ▸ Rotate and Flip change one frame, and undo', async () => {
    const { studio, rt } = await studioWith({ strip: vertical });
    const r = await studio.openFile(makeM1Tiff(), 'raw010.dng');
    expect(r.entries).toHaveLength(3);
    for (const e of r.entries) expect(e.log.committed.view.frame.orientation).toBe('transpose');
    const [f1, f2] = r.entries.map((e) => e.id) as [string, string];
    rt.run('frame.select', f2);
    rt.run('frame.rotateRight');
    const o = (id: string): string => (rt.state as any).recipes[id].view.frame.orientation;
    // transpose, then a quarter turn clockwise as shown = the scan mirrored left to right
    expect(o(f2)).toBe('flipH');
    expect(o(f1)).toBe('transpose');
    expect((rt.state as any).recipes[f2].view.frame.crop).toEqual(r.entries[1]!.strip!.box);
    rt.run('frame.rotateLeft');
    expect(o(f2)).toBe('transpose');
    rt.run('frame.flip');
    expect(o(f2)).toBe('cw90');
    rt.run('edit.undo');
    expect(o(f2)).toBe('transpose');
    expect(rt.commands.label('frame.rotateRight', rt.state)).toBe('Rotate Right');
  });

  it('a plain photo has orientation none and the rotate commands need an open frame', async () => {
    const { studio, rt } = await studioWith({ guess: 'photo' });
    expect(rt.commands.status('frame.rotateRight', rt.state).ok).toBe(false);
    const p = await studio.openFile(makeM1Tiff(), 'DSC_1.NEF');
    expect(p.entry.log.committed.view.frame.orientation).toBe('none');
    rt.run('frame.select', p.entry.id);
    expect(rt.commands.status('frame.rotateRight', rt.state).ok).toBe(true);
    rt.run('frame.rotateRight');
    expect((rt.state as any).recipes[p.entry.id].view.frame.orientation).toBe('cw90');
  });
});

describe('strip frames: a saved recipe from another working size (F20)', () => {
  /** a strip of three frames whose boxes are at working scale k (as decodes at different sizes report them) */
  async function scaled(kv: ReturnType<typeof memoryKV>, k: number) {
    const engine = new MockEngine();
    const clock = manualClock(1_000);
    const opener = async (src: Parameters<MockEngine['open']>[0]) => ({
      info: await engine.open(src), kind: 'negative-scan' as const,
      frames: [0, 1, 2].map((i) => ({ x: Math.round((2 + i * 14) * k), y: Math.round(2 * k), w: Math.round(12 * k), h: Math.round(9 * k) })),
    });
    const studio = createStudio({ engine, kv, opener, now: () => clock.now() });
    const { app } = buildVariant((await VARIANTS.tiny()).default);
    const rt = await app.boot(studio.services({ clock }));
    studio.attach(rt);
    return studio;
  }

  it('the crop and rebate are scaled to the new decode once, as an "auto" step; a crop moved inside its frame follows', async () => {
    const kv = memoryKV();
    const a = await scaled(kv, 1);
    const r1 = await a.openFile(makeM1Tiff(), 'raw010.dng');
    const e2 = r1.entries[1]!;
    // he moved frame 2's crop inside its frame by a pixel
    e2.log.apply([{ op: 'set', path: 'view.frame.crop', value: { x: 17, y: 3, w: 11, h: 8 } }], 'user', 'Crop');
    await a.flush();
    const b = await scaled(kv, 2);
    const r2 = await b.openFile(makeM1Tiff(), 'raw010.dng');
    expect(r2.outcome).toBe('resumed');
    expect(r2.entries[0]!.log.committed.view.frame.crop).toEqual({ x: 4, y: 4, w: 24, h: 18 });
    expect(r2.entries[1]!.log.committed.view.frame.crop).toEqual({ x: 34, y: 6, w: 22, h: 16 });
    expect(r2.entries[1]!.log.toJSON().entries.at(-1)).toMatchObject({ by: 'auto' });
    await b.flush();
    // opened again at the same size: nothing more to do
    const c = await scaled(kv, 2);
    const r3 = await c.openFile(makeM1Tiff(), 'raw010.dng');
    expect(r3.entries[1]!.log.committed.view.frame.crop).toEqual({ x: 34, y: 6, w: 22, h: 16 });
    expect(r3.entries[1]!.log.toJSON().entries.length).toBe(r2.entries[1]!.log.toJSON().entries.length);
    // and back at the first size (the other engine): scaled back
    await c.flush();
    const d = await scaled(kv, 1);
    const r4 = await d.openFile(makeM1Tiff(), 'raw010.dng');
    expect(r4.entries[0]!.log.committed.view.frame.crop).toEqual({ x: 2, y: 2, w: 12, h: 9 });
  });
});
