// Stage 2 acceptance (guide §14): every item of every committed pack loads; corrupted files, wrong
// grids, newer schemas, unknown names and refused policies fail with their codes.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isChromobenchError, type Diagnostic } from '@chromobench/contract';
import { fetchSource, memorySource, openPack, Pack, PACK_IDS, parseSafetensors, sha256Hex } from '../src/index.ts';
import { fsSource, openPackFromDisk, PACKS_DIR } from '../src/node.ts';
import { disk, memPack, open, packFiles, SF, withManifest } from './helpers.ts';

function codeOf(f: () => unknown): Diagnostic | undefined {
  try {
    f();
  } catch (e) {
    if (isChromobenchError(e)) return e.diag;
    throw e;
  }
  return undefined;
}

describe('every committed pack loads', () => {
  for (const id of PACK_IDS) {
    it(`${id}: manifest, hashes and every item`, async () => {
      const p = await openPack(disk(), id);
      await p.preload();
      expect(p.packHash).toBe(`sha256:${sha256Hex(new Uint8Array(readFileSync(new URL(`${id}/manifest.json`, PACKS_DIR))))}`);
      for (const it of p.manifest.items) {
        switch (it.kind) {
          case 'stock': {
            const s = p.stockSync(it.id);
            expect(s.base_D.values.length).toBe(81);
            expect(s.dyeCurves[0].length).toBe(256);
            expect(s.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
            expect(s.attribution).toMatch(/Andrea Volpato/);
            break;
          }
          case 'illuminant': expect(p.illuminantSync(it.id).values.length).toBe(81); break;
          case 'cmf': expect(p.cmfSync(it.id)[1].values.length).toBe(81); break;
          case 'dichroics': expect(p.dichroicsSync(it.id)[0].values.length).toBe(81); break;
          case 'camera': expect(p.cameraSync(it.id).responsivity[0].values.length).toBe(81); break;
          case 'light': expect(p.lightSync(it.id).spd.values.length).toBe(81); break;
          default: break;
        }
      }
    });
  }

  it('the spektrafilm pack has 28 stocks: 20 films, 8 prints; 2383 and 2393 are print films', () => {
    const p = open(SF);
    expect(p.stockIds()).toHaveLength(28);
    expect(p.stockIds({ role: 'film' })).toHaveLength(20);
    expect(p.stockIds({ role: 'print' })).toHaveLength(8);
    const s = p.stockSync('kodak_2383');
    expect([s.role, s.support, s.stage]).toEqual(['print', 'film', 'printing']);
    expect(p.stockIds({ role: 'film', type: 'positive' }).sort()).toEqual(['fujifilm_provia_100f', 'fujifilm_velvia_100', 'kodak_ektachrome_100', 'kodak_kodachrome_64']);
  });

  it('async accessors over fetch() load the same bytes as the file system', async () => {
    const fakeFetch = (async (url: string) => {
      const path = decodeURIComponent(String(url).replace('https://packs.test/', ''));
      return existsSync(new URL(path, PACKS_DIR))
        ? new Response(readFileSync(new URL(path, PACKS_DIR)))
        : new Response('missing', { status: 404, statusText: 'Not Found' });
    }) as typeof fetch;
    const viaFetch = await openPack(fetchSource('https://packs.test', fakeFetch), SF);
    const s = await viaFetch.stock('kodak_portra_400');
    const t = open(SF).stockSync('kodak_portra_400');
    expect(viaFetch.packHash).toBe(open(SF).packHash);
    expect(Array.from(s.base_D.values)).toEqual(Array.from(t.base_D.values));
    expect((await viaFetch.illuminant('TH-KG3')).values).toEqual(open(SF).illuminantSync('TH-KG3').values);
    expect(await viaFetch.neutralFilters({ paper: 'kodak_portra_endura', film: 'kodak_portra_400' })).toEqual(open(SF).neutralFiltersSync({ paper: 'kodak_portra_endura', film: 'kodak_portra_400' }));
  });

  it('sync accessors on an async-only source ask for preload', async () => {
    const files = packFiles('interim-chromogen@1');
    const asyncOnly = { read: memorySource(files).read };
    const p = await Pack.open(asyncOnly, 'interim-chromogen@1');
    expect(codeOf(() => p.stockSync('kodak_gold_200'))?.message).toMatch(/not loaded/);
    await p.preload();
    expect(p.stockSync('kodak_gold_200').id).toBe('kodak_gold_200');
  });
});

describe('integrity and refusals', () => {
  const files = packFiles(SF);

  it('a flipped byte in any committed file is E_DATA_HASH on first read', () => {
    let n = 0;
    for (const [path, bytes] of files) {
      if (path.endsWith('manifest.json')) continue;
      const bad = new Map(files);
      const b = bytes.slice();
      const at = Math.floor(b.length / 2);
      b[at] = b[at]! ^ 0x01;
      bad.set(path, b);
      const p = memPack(bad, SF);
      const rel = path.slice(SF.length + 1);
      const d = codeOf(() => (p as any).bytes(rel));
      expect(d?.code, path).toBe('E_DATA_HASH');
      n++;
    }
    expect(n).toBeGreaterThan(60);
  });

  it('the unbroken variant passes the same read (the hash check can fail)', () => {
    const p = memPack(files, SF);
    expect(codeOf(() => p.stockSync('kodak_portra_400'))).toBeUndefined();
  });

  it('a manifest grid other than 380/5/81 is E_DATA_GRID', () => {
    const bad = withManifest(files, SF, (m) => { m.grid.step_nm = 10; });
    expect(codeOf(() => memPack(bad, SF))?.code).toBe('E_DATA_GRID');
  });

  it('a stock whose wavelengths are off the grid is E_DATA_GRID (with a matching hash)', () => {
    const rel = 'stocks/kodak_gold_200.safetensors';
    const b = files.get(`${SF}/${rel}`)!.slice();
    const st = parseSafetensors(b);
    const wl = st.tensors.get('wavelengths_nm')!;
    const off = st.dataStart + (wl.data.byteOffset - (b.byteOffset + st.dataStart));
    new DataView(b.buffer, b.byteOffset).setFloat64(off, 381, true);
    const bad = withManifest(new Map(files).set(`${SF}/${rel}`, b), SF, (m) => {
      const f = m.files.find((x: any) => x.path === rel);
      f.sha256 = sha256Hex(b);
    });
    expect(codeOf(() => memPack(bad, SF).stockSync('kodak_gold_200'))?.code).toBe('E_DATA_GRID');
  });

  it('a newer schemaVersion is E_DATA_SCHEMA; a missing licence attribution too', () => {
    expect(codeOf(() => memPack(withManifest(files, SF, (m) => { m.schemaVersion = 2; }), SF))?.code).toBe('E_DATA_SCHEMA');
    expect(codeOf(() => memPack(withManifest(files, SF, (m) => { m.license.attribution = ''; }), SF))?.code).toBe('E_DATA_SCHEMA');
  });

  it('unknown stocks are E_STOCK_UNKNOWN with did-you-mean', () => {
    const d = codeOf(() => open(SF).stockSync('kodak_portra400'));
    expect(d?.code).toBe('E_STOCK_UNKNOWN');
    expect(d?.valid?.[0]).toBe('kodak_portra_400');
    expect(d?.hint).toContain('kodak_portra_400');
    expect(codeOf(() => open(SF).dirPresetSync('kodak_portra_endura'))?.code).toBe('E_STOCK_UNKNOWN');
  });

  it('interim-filmbench refuses every policy but opaque (E_DATA_POLICY)', () => {
    const p = open('interim-filmbench@1');
    expect(p.stockSync('kodak_portra_400').missing).toBe('opaque');
    const d = codeOf(() => p.stockSync('kodak_portra_400', { missing: 'zero-density' }));
    expect(d?.code).toBe('E_DATA_POLICY');
    expect(d?.valid).toEqual(['opaque']);
    expect(codeOf(() => open(SF).stockSync('kodak_portra_400', { missing: 'bogus' as any }))?.code).toBe('E_DATA_POLICY');
  });

  it('warnings: known issues, missing paper model, illustrative data — once each', () => {
    const seen: string[] = [];
    const p = Pack.openSync(disk(), SF, { onWarning: (d) => seen.push(`${d.code}:${d.path}`) });
    p.stockSync('kodak_supra_endura');
    p.stockSync('kodak_supra_endura', { missing: 'zero-density' });
    expect(seen.filter((s) => s.startsWith('W_STOCK_KNOWN_ISSUE')).length).toBe(2); // two distinct issues
    p.stockSync('kodak_portra_400');
    expect(seen).toHaveLength(2);
    const cg = open('interim-chromogen@1');
    cg.stockSync('kodak_portra_endura');
    expect(cg.warnings.map((w) => w.code)).toEqual(['W_STOCK_NO_MODEL']);
    const il = open('illustrative@1');
    il.cameraSync('generic-bayer');
    il.cameraSync('generic-bayer');
    il.lightSync('white-led');
    expect(il.warnings.map((w) => w.code)).toEqual(['W_DATA_ILLUSTRATIVE', 'W_DATA_ILLUSTRATIVE']);
  });

  it('the on-demand hanatos table: hinted when absent, F16 192x192x81 when generated', async () => {
    const p = await openPack(disk(), SF);
    const local = existsSync(new URL(`${SF}/upsampling/hanatos2025-irradiance-xy-tc.safetensors`, PACKS_DIR));
    if (local) {
      const t = await p.upsamplingTable();
      expect(t.shape).toEqual([192, 192, 81]);
      expect(t.data).toBeInstanceOf(Uint16Array);
    }
    const committedOnly = memPack(files, SF);
    let d: Diagnostic | undefined;
    try { await committedOnly.upsamplingTable(); } catch (e) { d = isChromobenchError(e) ? e.diag : undefined; }
    expect(d?.code).toBe('E_DATA_SCHEMA');
    expect(d?.hint).toMatch(/sfx\.py export/);
  });

  it('openPackFromDisk caches and fsSource refuses path traversal', () => {
    expect(openPackFromDisk(SF)).toBe(openPackFromDisk(SF));
    expect(codeOf(() => fsSource().readSync!('../package.json'))?.code).toBe('E_DATA_SCHEMA');
  });
});
