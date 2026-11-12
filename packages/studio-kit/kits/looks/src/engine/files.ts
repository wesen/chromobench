// Preset files (guide §7.2): `*.cbpreset.json`, the Preset shape with format, version and contract. Sharing a preset
// is safe (data). Reading migrates paths that moved in a contract change (MOVED_PATHS, e.g. scan.crop →
// view.frame.crop) and marks a preset with unknown paths "needs review" instead of dropping it; a file version newer
// than the app refuses to load.
//
// Look files (*.cblook.js, code) are evaluated in the DSL's QuickJS sandbox, not in the page (decision §7.2) —
// not built yet; see the CHB-021 tasks.

import { ChromobenchError, CONTRACT_VERSION, MOVED_PATHS, diag, type Diagnostic } from '@chromobench/contract';
import { kitDiag, PRESET_FORMAT, PRESET_VERSION, validatePreset, type Preset } from './look.ts';

export const PRESET_EXT = '.cbpreset.json';

export function presetToFile(p: Preset): string {
  return `${JSON.stringify({ ...p, format: PRESET_FORMAT, version: PRESET_VERSION, contract: p.contract || CONTRACT_VERSION }, null, 2)}\n`;
}

/** old path → new path for a contract rename (exact or as a prefix) */
export function migratePresetPath(path: string): string {
  for (const [from, to] of Object.entries(MOVED_PATHS)) {
    if (path === from) return to;
    if (path.startsWith(`${from}.`)) return `${to}${path.slice(from.length)}`;
  }
  return path;
}

export interface ReadPreset {
  preset: Preset;
  status: 'ok' | 'needs-review';
  /** migrations done and problems found (E_PATH with did-you-mean) */
  diags: Diagnostic[];
}

/** Parse, migrate and check a preset file. Throws E_FORMAT for something that is not a preset (or too new). */
export function readPresetFile(text: string): ReadPreset {
  let x: Preset;
  try {
    x = JSON.parse(text) as Preset;
  } catch (e) {
    throw new ChromobenchError(diag('E_FORMAT', `not JSON: ${(e as Error).message}`));
  }
  const fatal = validatePreset(x).filter((d) => d.code === 'E_FORMAT');
  if (fatal.length) throw new ChromobenchError(fatal[0]!);
  const diags: Diagnostic[] = [];
  const entries = x.entries.map((e) => {
    const to = migratePresetPath(e.path);
    if (to === e.path) return e;
    diags.push(kitDiag('CB-L130', `${e.path} moved to ${to}`, { path: to }));
    return { ...e, path: to };
  });
  const preset: Preset = { ...x, entries };
  const problems = validatePreset(preset);
  diags.push(...problems);
  return { preset, status: problems.length ? 'needs-review' : 'ok', diags };
}
