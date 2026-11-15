// Control arrangements (guide §5.7). "Darkroom" is a hand-written list of document paths in groups (the main
// exposure's and the printer lights' params, the media); "All parameters" is generated from the catalogue by group.
// auditArrangement() is Filmbench's Scheme.audit: every path must exist as a generated control.
import type { Document } from '@chromobench/contract';
import type { ControlModel } from './controls.ts';
import { FILTRATION_PATH, FSTOP_PATH, GRADE_PATH, isNormalised, LIGHTS_PATH, MODE_PATH, PAPER_PATH, TIME_PATH } from './doc.ts';

export interface Arrangement {
  name: string;
  /** `note`: a short wrapped line after the group's controls for the selected frame's document ('' for none) */
  groups: { title: string; paths: string[]; note?: (d: Document) => string }[];
}

/** what the Exposure group says while the enlarger is normalised (its Time and Aperture are hidden; CHB-031) */
export const NORMALISED_NOTE = 'Normalised enlarger: the grey card prints at the aim whatever the time, so Time and Aperture are hidden. Make the print lighter or darker with the printer lights.';

export const DARKROOM: Arrangement = {
  name: 'Darkroom',
  groups: [
    // a control a frame's document has no value for is hidden: time and aperture in normalised mode, the scanner
    // and the scan's film for a photo, the film of a camera file for a negative (CHB-031 F17, F23)
    { title: 'Exposure', paths: [MODE_PATH, TIME_PATH, FSTOP_PATH], note: (d) => (isNormalised(d) ? NORMALISED_NOTE : '') },
    { title: 'Filtration', paths: [FILTRATION_PATH] },
    { title: 'Printer lights', paths: [LIGHTS_PATH] },
    // the preflash is a darkroom layer now (Exposures: + preflash), not a paper setting
    { title: 'Paper', paths: [PAPER_PATH, GRADE_PATH] },
    // the film and the light the print is seen under (CHB-023's demo had them beside the paper)
    {
      title: 'Film and viewing', paths: ['stages.film.medium.stock', 'stages.scan.medium.stock', 'stages.scan.medium.scanner', 'stages.print.medium.illuminant'],
      note: (d) => (!d.stages.scan
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
