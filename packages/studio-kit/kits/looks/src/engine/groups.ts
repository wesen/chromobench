// Sync groups (guide §6.3): CraftKit's SYNC_GROUPS as recipe path patterns. A look applied with `groups` keeps only
// the entries whose path is in a chosen group; copy/paste/sync use the same table. Groups that describe this
// frame's physical situation (crop, dust, probes, scan conditioning) default to off. The table is data: a variant
// passes its own (cb.kits.looks.syncGroups({...})).

export interface SyncGroup {
  /** recipe path patterns; `*` is one segment, a trailing `.*` any suffix */
  match: string[];
  default: boolean;
  note?: string;
}
export type SyncGroups = Record<string, SyncGroup>;

export const SYNC_GROUPS: SyncGroups = {
  'Film simulation': { match: ['capture.*'], default: true },
  Paper: { match: ['print.paper', 'print.aim'], default: true },
  Exposure: { match: ['print.enlarger.time_s', 'print.enlarger.fstop', 'print.enlarger.magnification', 'print.enlarger.mode', 'print.enlarger.lamp'], default: true },
  'Colour balance': { match: ['print.enlarger.filtration', 'print.lights.*'], default: true },
  Contrast: { match: ['print.grade', 'print.preflash'], default: true },
  'Dodge and burn': { match: ['print.exposures.*', 'print.densityMasks.*', 'masks.*'], default: true },
  Finishing: { match: ['finishing.*'], default: true },
  Output: { match: ['view.output.*', 'view.illuminant', 'view.flare'], default: false },
  'Scan conditioning': { match: ['scan.flare', 'scan.flat', 'scan.baseT', 'scan.rebate', 'scan.scanner', 'scan.stock', 'scan.format', 'scan.openGate', 'source.*'], default: false, note: 'this frame’s scan' },
  'Crop and dust': { match: ['view.frame.*', 'scan.dust.*', 'probes.*', 'retouch.*'], default: false, note: 'this frame’s physical situation' },
};

/** Whether a recipe path matches a pattern: segment-wise `*`, and a trailing `*` matches any rest. */
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

/** The group a path belongs to (first match), or null. */
export function groupOf(path: string, groups: SyncGroups = SYNC_GROUPS): string | null {
  for (const [name, g] of Object.entries(groups)) if (g.match.some((m) => matchPath(m, path))) return name;
  return null;
}

export const defaultGroups = (groups: SyncGroups = SYNC_GROUPS): string[] => Object.entries(groups).filter(([, g]) => g.default).map(([n]) => n);

/** Whether a path is in one of the chosen groups (a path in no group passes only when `all`). */
export function inGroups(path: string, chosen: readonly string[], groups: SyncGroups = SYNC_GROUPS): boolean {
  const g = groupOf(path, groups);
  return g !== null && chosen.includes(g);
}
