// Sync groups (guide §6.3): CraftKit's SYNC_GROUPS as document path patterns (CHB-037). A look applied with `groups`
// keeps only the entries whose path is in a chosen group; copy/paste/sync use the same table. A layer's paths are
// matched by its op (`@burn` matches `b1` and `b1.params.stops` when b1 is a burn); `@link` matches a look's or a
// preset's link entry. Groups that describe this
// frame's physical situation (crop, dust, probes, scan conditioning) default to off. The table is data: a layout
// passes its own (cb.kits.looks.syncGroups({...})).
import type { Document } from '@chromobench/contract';
import { findEntry, opOfId } from '../../../../src/model/doc.ts';
import { layerIdOf } from './paths.ts';

export interface SyncGroup {
  /** document path patterns; `*` is one segment, a trailing `.*` any suffix; `@op` a layer of that op */
  match: string[];
  default: boolean;
  note?: string;
}
export type SyncGroups = Record<string, SyncGroup>;

export const SYNC_GROUPS: SyncGroups = {
  'Film simulation': { match: ['stages.film.medium.*', 'stages.scene.medium.*'], default: true },
  Paper: { match: ['stages.darkroom.medium.paper', 'stages.darkroom.medium.aim'], default: true },
  Exposure: { match: ['main.params.time_s', 'main.params.fstop', 'stages.darkroom.medium.magnification', 'stages.darkroom.medium.mode', 'stages.darkroom.medium.lamp'], default: true },
  'Colour balance': { match: ['main.params.filtration', 'lights.params.*', '@filter'], default: true },
  Contrast: { match: ['stages.darkroom.medium.grade', '@preflash'], default: true },
  'Dodge and burn': { match: ['@burn', '@dodge', '@flash', '@densityMask', 'masks.*'], default: true },
  Looks: { match: ['@link'], default: true, note: 'the looks and presets a frame links' },
  Finishing: { match: ['@clarity'], default: true },
  Output: { match: ['output.*', 'stages.print.medium.*'], default: false },
  'Scan conditioning': { match: ['stages.scan.medium.*', 'source.*'], default: false, note: 'this frame’s scan' },
  'Crop and dust': { match: ['geometry.*', 'probes.*', '@heal', '@clone'], default: false, note: 'this frame’s physical situation' },
};

/** Whether a document path matches a pattern: segment-wise `*`, and a trailing `*` matches any rest. */
export function matchPath(pattern: string, path: string): boolean {
  const p = pattern.split('.');
  const s = path.split('.');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*' && i === p.length - 1) return s.length >= p.length;
    if (i >= s.length) return false;
    if (p[i] !== '*' && p[i] !== s[i]) return false;
  }
  return s.length === p.length;
}

/** The group a path belongs to (first match), or null. A layer path is matched by its op (from `doc`). */
export function groupOf(path: string, groups: SyncGroups = SYNC_GROUPS, doc?: Document | null): string | null {
  const id = layerIdOf(path);
  const op = id ? (doc && findEntry(doc, id)?.entry.kind === 'link' ? 'link' : opOfId(doc, id)) : undefined;
  for (const [name, g] of Object.entries(groups)) if (g.match.some((m) => (m.startsWith('@') ? !!op && m.slice(1) === op && id !== 'main' && id !== 'lights' : matchPath(m, path)))) return name;
  return null;
}

export const defaultGroups = (groups: SyncGroups = SYNC_GROUPS): string[] => Object.entries(groups).filter(([, g]) => g.default).map(([n]) => n);

/** Whether a path is in one of the chosen groups (a path in no group passes only when `all`). */
export function inGroups(path: string, chosen: readonly string[], groups: SyncGroups = SYNC_GROUPS, doc?: Document | null): boolean {
  const g = groupOf(path, groups, doc);
  return g !== null && chosen.includes(g);
}
