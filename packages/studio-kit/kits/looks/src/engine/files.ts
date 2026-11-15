// Preset files (guide §7.2; CHB-037 P7): `*.cbpreset.json` is the contract's Preset (format chromobench.preset,
// version 3: stored entries per stage and the masks they use). Sharing a preset is safe (data). Reading marks a
// preset whose entries name ops this app does not know, or put an op where it may not live, "needs review" instead
// of dropping it; a file version newer than the app, or a version 1 or 2 file (recipe or document paths: the hard
// cut-off of CHB-037), refuses to load.
//
// Look files (*.cblook.js, code) are evaluated in the DSL's QuickJS sandbox, not in the page (design §31): not built
// yet (see the P7 diary).
import { Coll } from '@chromobench/values';
import { ChromobenchError, diag, hasOp, getOp, PRESET_FORMAT, PRESET_VERSION, validatePreset, type Diagnostic, type Entry, type Preset, type StageName } from '@chromobench/contract';

export function presetToFile(p: Preset): string {
  return `${JSON.stringify({ ...p, format: PRESET_FORMAT, version: PRESET_VERSION }, null, 2)}\n`;
}

export interface ReadPreset {
  preset: Preset;
  status: 'ok' | 'needs-review';
  /** problems found in the entries (unknown ops, ops in the wrong stage) */
  diags: Diagnostic[];
}

function entryProblems(stage: StageName, c: Coll<Entry>, out: Diagnostic[]): void {
  for (const [id, e] of Coll.entries(c)) {
    if (e.kind === 'group') entryProblems(stage, e.stack, out);
    else if (e.kind === 'layer') {
      if (!hasOp(e.op)) out.push(diag('E_UNKNOWN_OP', `${id}: unknown op ${e.op}`, { path: id }));
      else if (!getOp(e.op).stages?.includes(stage)) out.push(diag('E_DOCUMENT', `${id}: ${e.op} does not live in the ${stage} stage`, { path: id }));
    }
  }
}

/** Parse and check a preset file. Throws E_FORMAT for something that is not a preset (or too new, or too old). */
export function readPresetFile(text: string): ReadPreset {
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch (e) {
    throw new ChromobenchError(diag('E_FORMAT', `not JSON: ${(e as Error).message}`));
  }
  const fatal = validatePreset(x);
  if (fatal.length) throw new ChromobenchError(fatal[0]!);
  const preset = x as Preset;
  const diags: Diagnostic[] = [];
  for (const [s, c] of Object.entries(preset.stacks)) if (c) entryProblems(s as StageName, c, diags);
  return { preset, status: diags.length ? 'needs-review' : 'ok', diags };
}
