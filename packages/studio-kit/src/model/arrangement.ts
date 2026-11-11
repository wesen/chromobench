// Moved from apps/studio/src/core/arrangement.ts (CHB-009) for CHB-019 (the original was deleted in the apps/studio migration).
// Control arrangements (guide §5.7). "Darkroom" is a hand-written list of recipe paths in groups;
// "All parameters" is generated from the registry by group. auditArrangement() is Filmbench's
// Scheme.audit: every path must exist as a generated control.
import type { ControlModel } from './controls.ts';

export interface Arrangement {
  name: string;
  groups: { title: string; paths: string[] }[];
}

export const DARKROOM: Arrangement = {
  name: 'Darkroom',
  groups: [
    { title: 'Exposure', paths: ['print.enlarger.time_s', 'print.enlarger.fstop'] },
    { title: 'Filtration', paths: ['print.enlarger.filtration'] },
    { title: 'Printer lights', paths: ['print.lights.logH'] },
    { title: 'Paper', paths: ['print.paper', 'print.grade', 'print.preflash'] },
    // the negative and the light the print is seen under (CHB-023's demo had them beside the paper)
    { title: 'Film and viewing', paths: ['scan.stock', 'scan.scanner', 'view.illuminant'] },
  ],
};

export function allParameters(models: readonly ControlModel[]): Arrangement {
  const groups = new Map<string, string[]>();
  for (const m of models) groups.set(m.group, [...(groups.get(m.group) ?? []), m.path]);
  return { name: 'All parameters', groups: [...groups].map(([title, paths]) => ({ title, paths })) };
}

/** Paths of the arrangement that no generated control provides. */
export function auditArrangement(a: Arrangement, models: readonly ControlModel[]): string[] {
  const have = new Set(models.map((m) => m.path));
  return a.groups.flatMap((g) => g.paths.filter((p) => !have.has(p)));
}
