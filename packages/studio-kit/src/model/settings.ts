// The studio's view modes and the print settings "Apply Print Settings to Selection" copies between documents.
import { getPath, type Mutation } from '@chromobench/values';
import type { Document } from '@chromobench/contract';
import { FILTRATION_PATH, FSTOP_PATH, GRADE_PATH, LIGHTS_PATH, MODE_PATH, PAPER_PATH, read, TIME_PATH, withoutInert } from './doc.ts';

export type ViewMode = 'print' | 'negative' | 'dyes' | 'classes';
export const VIEW_MODES: readonly ViewMode[] = ['print', 'negative', 'dyes', 'classes'];

/** The print settings copied between frames: the paper and its grade, the enlarger mode, the main exposure, the printer lights. */
export const PRINT_SETTINGS: readonly string[] = [PAPER_PATH, GRADE_PATH, MODE_PATH, TIME_PATH, FSTOP_PATH, FILTRATION_PATH, LIGHTS_PATH];

/**
 * The sets that give `to` the print settings of `from` (only paths both documents have; none that would not change
 * anything; none that are inert in `to`'s enlarger mode: they become the same exposure on its printer lights).
 */
export function copySettings(from: Document, to: Document, paths: readonly string[] = PRINT_SETTINGS): Mutation[] {
  const out: Mutation[] = [];
  for (const p of paths) {
    const a = read(from, p);
    const b = read(to, p);
    if (a === undefined || b === undefined || JSON.stringify(a) === JSON.stringify(b)) continue;
    out.push({ op: 'set', path: p, value: a });
  }
  return withoutInert(to, out);
}

export { getPath };

/** One print setting Apply Print Settings would copy: its name, the source's value in his units, the frames it changes. */
export interface SettingCopy {
  path: string;
  label: string;
  value: string;
  /** the targets whose value differs (their names) */
  changes: string[];
}

/**
 * What "Apply Print Settings to Selection" will do (CHB-046, P9-9: it copied silently from the last-clicked frame):
 * every print setting that differs on at least one target, with the source's value as the controls show it and the
 * targets it changes. `label` names a setting (the control's own label).
 */
export function settingsPlan(from: Document, targets: readonly { name: string; doc: Document }[], describe: (path: string) => { label: string; format(v: unknown): string } | null): SettingCopy[] {
  const out: SettingCopy[] = [];
  for (const p of PRINT_SETTINGS) {
    const v = read(from, p);
    if (v === undefined) continue;
    const changes = targets.filter((t) => copySettings(from, t.doc, [p]).length > 0).map((t) => t.name);
    if (!changes.length) continue;
    const m = describe(p);
    out.push({ path: p, label: m?.label ?? p, value: m ? m.format(v) : String(v), changes });
  }
  return out;
}
