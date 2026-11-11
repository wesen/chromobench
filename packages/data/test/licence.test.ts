// Stage 6 check (guide §12, §14): every pack carries its licence file, a changelog where the licence
// asks for one, and an attribution on every item; no pack mixes CC BY-SA stock data with camera or
// light data (BY-NC-SA measured cameras must stay in packs of their own). Also: the JSON Schemas and
// the loader's validator agree on required keys, and every file in a pack directory is in its manifest.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FILE_REQUIRED, ITEM_REQUIRED, MANIFEST_REQUIRED, PACK_IDS, type PackManifest } from '../src/index.ts';
import { PACKS_DIR } from '../src/node.ts';
import { SF } from './helpers.ts';

const root = fileURLToPath(PACKS_DIR);
const read = (p: string): Buffer => readFileSync(join(root, p));
const manifest = (id: string): PackManifest => JSON.parse(read(`${id}/manifest.json`).toString('utf8'));
const schema = (n: string): any => JSON.parse(readFileSync(new URL(`../schema/${n}`, import.meta.url), 'utf8'));

function* walk(dir: string): Generator<string> {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

describe('licences and attribution', () => {
  const dirs = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory());

  it('the committed pack directories are exactly PACK_IDS', () => {
    expect(dirs.sort()).toEqual([...PACK_IDS].sort());
  });

  for (const id of PACK_IDS) {
    it(`${id}: licence file listed and present, attribution set, no unlisted files`, () => {
      const m = manifest(id);
      expect(m.license.attribution.length).toBeGreaterThan(20);
      const listed = new Set(m.files.map((f) => f.path));
      expect(listed.has(m.license.file)).toBe(true);
      expect(read(`${id}/${m.license.file}`).length).toBeGreaterThan(100);
      if (m.license.changelog) expect(listed.has(m.license.changelog)).toBe(true);
      for (const f of walk(join(root, id))) {
        const rel = relative(join(root, id), f).split('\\').join('/');
        if (rel !== 'manifest.json') expect(listed.has(rel), `${id}/${rel} is not in the manifest`).toBe(true);
      }
      for (const f of m.files) if (!f.onDemand) expect(read(`${id}/${f.path}`).length, f.path).toBe(f.bytes);
    });
  }

  it('CC BY-SA packs ship SPEKTRAFILM_LICENSE.txt verbatim, a CHANGELOG.txt, and the author on every stock', () => {
    const lic = read(`${SF}/SPEKTRAFILM_LICENSE.txt`);
    expect(lic.toString('utf8')).toMatch(/Attribution-ShareAlike 4\.0/);
    for (const id of PACK_IDS) {
      const m = manifest(id);
      if (m.license.spdx !== 'CC-BY-SA-4.0') continue;
      expect(m.license.file).toBe('SPEKTRAFILM_LICENSE.txt');
      expect(read(`${id}/SPEKTRAFILM_LICENSE.txt`).equals(lic)).toBe(true);
      expect(m.license.changelog).toBe('CHANGELOG.txt');
      expect(m.license.attribution).toMatch(/Andrea Volpato.*github\.com\/andreavolpato\/spektrafilm.*CC BY-SA 4\.0/);
      for (const it of m.items.filter((i) => i.kind === 'stock')) {
        const side = JSON.parse(read(`${id}/stocks/${it.id}.json`).toString('utf8'));
        expect(side.attribution, `${id}:${it.id}`).toMatch(/Andrea Volpato.*CC BY-SA 4\.0/);
      }
    }
  });

  it('no pack mixes licences: stock data and camera/light data never share a pack', () => {
    for (const id of PACK_IDS) {
      const kinds = new Set(manifest(id).items.map((i) => i.kind));
      const stockSide = kinds.has('stock');
      const scannerSide = kinds.has('camera') || kinds.has('light');
      expect(stockSide && scannerSide, id).toBe(false);
      if (stockSide) expect(manifest(id).license.spdx).toBe('CC-BY-SA-4.0');
      if (scannerSide) expect(manifest(id).license.spdx).not.toBe('CC-BY-SA-4.0');
      expect(manifest(id).license.spdx).not.toMatch(/NC/); // no non-commercial data is committed yet (measured cameras: stage 4)
    }
  });

  it('illustrative items are flagged', () => {
    for (const it of manifest('illustrative@1').items) expect(it.illustrative, it.id).toBe(true);
  });
});

describe('schemas agree with the loader and the packs', () => {
  it('required keys of manifest.schema.json match validateManifest', () => {
    const s = schema('manifest.schema.json');
    expect([...s.required].sort()).toEqual([...MANIFEST_REQUIRED].sort());
    expect([...s.properties.items.items.required].sort()).toEqual([...ITEM_REQUIRED].sort());
    expect([...s.properties.files.items.required].sort()).toEqual([...FILE_REQUIRED].sort());
  });

  it('every stock sidecar has the keys stock.schema.json requires, and tensors declare unit, missing and shape', () => {
    const s = schema('stock.schema.json');
    for (const id of PACK_IDS) {
      for (const it of manifest(id).items.filter((i) => i.kind === 'stock')) {
        const side = JSON.parse(read(`${id}/stocks/${it.id}.json`).toString('utf8'));
        for (const k of s.required) expect(side, `${id}:${it.id} lacks ${k}`).toHaveProperty(k);
        for (const [n, t] of Object.entries(side.tensors as Record<string, any>)) {
          for (const k of ['unit', 'missing', 'shape']) expect(t, `${id}:${it.id}:${n}`).toHaveProperty(k);
        }
      }
    }
  });
});
