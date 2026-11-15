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
