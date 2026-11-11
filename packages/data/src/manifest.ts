// Pack manifest: the typed form of manifest.json (guide §7.5). The JSON Schema in
// ../schema/manifest.schema.json documents the same shape; validateManifest enforces it.
import { fail } from '@chromobench/contract';
import type { MissingPolicy } from './missing.ts';

export const SCHEMA_VERSION = 1;
export const GRID = Object.freeze({ start_nm: 380, step_nm: 5, count: 81 });

export type Role = 'film' | 'print';
export type SourceKind = 'upstream' | 'interim' | 'measured' | 'illustrative';
export type ItemKind = 'stock' | 'illuminant' | 'filter' | 'dichroics' | 'cmf' | 'neutral-print-filters' | 'preset' | 'upsampling' | 'camera' | 'light';

export interface ManifestItem {
  kind: ItemKind | string;
  id: string;
  files: string[];
  contentHash: string;
  role?: Role;
  type?: 'negative' | 'positive';
  tensor?: string;
  illustrative?: boolean;
  about?: string;
  missingRows_nm?: Record<string, number[]> | number[];
  [k: string]: unknown;
}

export interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
  /** Present when the file is not committed and is generated on demand; the text says how. */
  onDemand?: string;
}

export interface PackManifest {
  schemaVersion: number;
  packId: string;
  title?: string;
  source: { kind: SourceKind; repo?: string; commit?: string; profileVersion?: string; exporter?: string; sha256?: string; from?: string; note?: string };
  grid: { start_nm: number; step_nm: number; count: number };
  logExposureGrid?: { start_logH: number; stop_logH: number; count: number };
  missing: { default: MissingPolicy; supported: MissingPolicy[]; note?: string };
  license: { spdx: string; file: string; changelog?: string; attribution: string };
  items: ManifestItem[];
  files: ManifestFile[];
  knownIssues: { id: string; items: string[]; text: string }[];
  counts?: Record<string, number>;
  scanners?: Record<string, { camera: string; lights: string[]; capture: 'sequential' | 'single' }>;
}

/** Required keys, mirrored in schema/manifest.schema.json (a test checks they agree). */
export const MANIFEST_REQUIRED = ['schemaVersion', 'packId', 'source', 'grid', 'missing', 'license', 'items', 'files', 'knownIssues'] as const;
export const ITEM_REQUIRED = ['kind', 'id', 'files', 'contentHash'] as const;
export const FILE_REQUIRED = ['path', 'bytes', 'sha256'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateManifest(m: unknown, where: string): PackManifest {
  if (!isObj(m)) return fail('E_DATA_SCHEMA', `${where}: manifest is not an object`);
  for (const k of MANIFEST_REQUIRED) if (!(k in m)) fail('E_DATA_SCHEMA', `${where}: manifest lacks "${k}"`, { valid: [...MANIFEST_REQUIRED] });
  if (typeof m['schemaVersion'] !== 'number') fail('E_DATA_SCHEMA', `${where}: schemaVersion is not a number`);
  if ((m['schemaVersion'] as number) > SCHEMA_VERSION) {
    fail('E_DATA_SCHEMA', `${where}: pack schemaVersion ${String(m['schemaVersion'])} is newer than this loader (${SCHEMA_VERSION})`, { hint: 'update @chromobench/data' });
  }
  const g = m['grid'];
  if (!isObj(g) || g['start_nm'] !== GRID.start_nm || g['step_nm'] !== GRID.step_nm || g['count'] !== GRID.count) {
    fail('E_DATA_GRID', `${where}: grid ${JSON.stringify(g)} is not 380–780 nm in 5 nm steps (81 samples)`);
  }
  const lic = m['license'];
  if (!isObj(lic) || typeof lic['spdx'] !== 'string' || typeof lic['file'] !== 'string' || typeof lic['attribution'] !== 'string' || !lic['attribution']) {
    fail('E_DATA_SCHEMA', `${where}: license must carry spdx, file and a non-empty attribution`);
  }
  const miss = m['missing'];
  if (!isObj(miss) || !Array.isArray(miss['supported']) || !(miss['supported'] as unknown[]).includes(miss['default'])) {
    fail('E_DATA_SCHEMA', `${where}: missing.default must be one of missing.supported`);
  }
  if (!Array.isArray(m['items']) || !Array.isArray(m['files']) || !Array.isArray(m['knownIssues'])) fail('E_DATA_SCHEMA', `${where}: items, files and knownIssues must be arrays`);
  const files = new Set<string>();
  for (const f of m['files'] as unknown[]) {
    if (!isObj(f) || FILE_REQUIRED.some((k) => !(k in f))) fail('E_DATA_SCHEMA', `${where}: file entry ${JSON.stringify(f)} lacks path, bytes or sha256`);
    if (!/^[0-9a-f]{64}$/.test(String(f['sha256']))) fail('E_DATA_SCHEMA', `${where}: ${String(f['path'])} sha256 is not 64 hex digits`);
    files.add(String(f['path']));
  }
  for (const it of m['items'] as unknown[]) {
    if (!isObj(it) || ITEM_REQUIRED.some((k) => !(k in it))) fail('E_DATA_SCHEMA', `${where}: item ${JSON.stringify(it)?.slice(0, 80)} lacks kind, id, files or contentHash`);
    for (const f of it['files'] as string[]) if (!files.has(f)) fail('E_DATA_SCHEMA', `${where}: item ${String(it['kind'])}:${String(it['id'])} names unlisted file ${f}`);
  }
  if (!files.has(String(lic['file']))) fail('E_DATA_SCHEMA', `${where}: licence file ${String(lic['file'])} is not listed in files`);
  return m as unknown as PackManifest;
}
