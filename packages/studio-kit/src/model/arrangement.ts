// Moved from apps/studio/src/core/arrangement.ts (CHB-009) for CHB-019 (the original was deleted in the apps/studio migration).
// Control arrangements (guide §5.7). "Darkroom" is a hand-written list of recipe paths in groups;
// "All parameters" is generated from the registry by group. auditArrangement() is Filmbench's
// Scheme.audit: every path must exist as a generated control.
import type { FrameRecipe } from '@chromobench/contract';
import type { ControlModel } from './controls.ts';

export interface Arrangement {
  name: string;
  /** `note`: one line under the group's title for the selected frame's recipe ('' for none) */
  groups: { title: string; paths: string[]; note?: (r: FrameRecipe) => string }[];
}

/** what the Exposure group says while the enlarger is normalised (its Time and Aperture are hidden; CHB-031) */
export const NORMALISED_NOTE = 'Normalised enlarger: the grey card prints at the aim whatever the time, so Time and Aperture are hidden. Make the print lighter or darker with the printer lights.';

export const DARKROOM: Arrangement = {
  name: 'Darkroom',
  groups: [
    // a control a frame's recipe has no value for is hidden: time and aperture in normalised mode, the scanner and
    // the scan's film for a photo, the capture film for a negative (CHB-031 F17, F23)
    { title: 'Exposure', paths: ['print.enlarger.mode', 'print.enlarger.time_s', 'print.enlarger.fstop'], note: (r) => (r.print.enlarger.mode === 'normalised' ? NORMALISED_NOTE : '') },
    { title: 'Filtration', paths: ['print.enlarger.filtration'] },
    { title: 'Printer lights', paths: ['print.lights.logH'] },
    { title: 'Paper', paths: ['print.paper', 'print.grade', 'print.preflash'] },
    // the film and the light the print is seen under (CHB-023's demo had them beside the paper)
    {
      title: 'Film and viewing', paths: ['capture.stock', 'scan.stock', 'scan.scanner', 'view.illuminant'],
      note: (r) => (r.kind === 'digital-raw'
        ? 'A photo prints as if the scene had been shot on this film. The viewing light is the light the print is seen under.'
        : 'The film of the negative and the scanner that digitised it. The viewing light is the light the print is seen under.'),
    },
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
