// Node-only helpers: the file-system DataSource for the packs committed in packages/data/packs, and a
// drop-in replacement for core's interimData(). It reaches node:fs through process.getBuiltinModule
// rather than a static import, so the module also loads (and bundles) in a browser; calling the file
// system there fails.
import { fail } from '@chromobench/contract';
import { DEFAULT_SCANNER_PACK, DEFAULT_STOCK_PACK } from './index.ts';
import { Pack, type OpenOptions } from './pack.ts';
import { physicsData, type CorePhysicsData } from './physics.ts';
import type { DataSource } from './sources.ts';

type Fs = typeof import('node:fs');
const fs = (): Fs => (process.getBuiltinModule('node:fs') as Fs | undefined) ?? fail('E_DATA_SCHEMA', 'the file-system pack source needs Node');
const urlPath = (u: URL): string => (process.getBuiltinModule('node:url') as typeof import('node:url')).fileURLToPath(u);

/** packages/data/packs/ */
export const PACKS_DIR = new URL('../packs/', import.meta.url);

export function fsSource(root: string | URL = PACKS_DIR): DataSource {
  const base = typeof root === 'string' ? root.replace(/\/?$/, '/') : urlPath(root);
  const resolve = (p: string): string => {
    if (p.split('/').some((s) => s === '..' || s === '')) fail('E_DATA_SCHEMA', `invalid pack path ${p}`);
    return base + p;
  };
  return {
    read: async (p) => new Uint8Array(await fs().promises.readFile(resolve(p))),
    readSync: (p) => new Uint8Array(fs().readFileSync(resolve(p))),
  };
}

const opened = new Map<string, Pack>();

/** Open a committed pack (cached per process). */
export function openPackFromDisk(packId: string, opts?: OpenOptions): Pack {
  if (opts) return Pack.openSync(fsSource(), packId, opts);
  let p = opened.get(packId);
  if (!p) {
    p = Pack.openSync(fsSource(), packId);
    opened.set(packId, p);
  }
  return p;
}

const physics = new Map<string, CorePhysicsData>();

/**
 * Core's PhysicsData served from packs, synchronously, like core's interimData(). Default: the
 * spektrafilm pack for stocks, enlarger, light and observer, and illustrative@1 for the camera and
 * scanner lights. To switch core: `import { nodePhysicsData as interimData } from '@chromobench/data/node'`.
 */
export function nodePhysicsData(o: { stocks?: string; scanners?: string | null } = {}): CorePhysicsData {
  const sid = o.stocks ?? DEFAULT_STOCK_PACK;
  const cid = o.scanners === undefined ? DEFAULT_SCANNER_PACK : o.scanners;
  const key = `${sid}|${cid ?? ''}`;
  let d = physics.get(key);
  if (!d) {
    d = physicsData(openPackFromDisk(sid), cid ? openPackFromDisk(cid) : undefined);
    physics.set(key, d);
  }
  return d;
}
