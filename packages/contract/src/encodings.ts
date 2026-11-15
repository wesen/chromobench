// The working encodings of the composite stages (contract 1.1, design §22). A composite stage holds XYZ (the op
// encoding 'stage'); ops that model light compute in linear RGB, ops defined by eye in OkLab. Each encoding of each
// stage is a domain, so a graph says what its numbers are, and `composite.encode` converts between them:
//
//   scene-xyz ↔ scene-rgb ↔ scene-oklab        print-xyz ↔ print-rgb ↔ print-oklab
//
// rgb: linear Rec. 2020 primaries under D65, XYZ adapted from the stage's white by Bradford, white = (1, 1, 1)·Y_white.
// oklab: Ottosson's OkLab over that RGB with the LMS rows normalised (core oklabFor('rec2020')): white L = 1, a = b = 0;
// a neutral of luminance Y has L = ∛Y. The compiler inserts the conversions; engines implement composite.encode.
import type { Domain } from './domains.ts';
import type { OpEncoding } from './registry.ts';

export type WorkingStage = 'scene' | 'print';
export const WORKING_STAGES: readonly WorkingStage[] = ['scene', 'print'];

export const ENCODED_DOMAINS: Readonly<Record<WorkingStage, Readonly<Record<OpEncoding, Domain>>>> = Object.freeze({
  scene: Object.freeze({ stage: 'scene-xyz', linear: 'scene-rgb', oklab: 'scene-oklab' }),
  print: Object.freeze({ stage: 'print-xyz', linear: 'print-rgb', oklab: 'print-oklab' }),
});

/** Every domain of the working encodings, scene first. */
export const WORKING_DOMAINS: readonly Domain[] = WORKING_STAGES.flatMap((s) => Object.values(ENCODED_DOMAINS[s]));

/** Which stage and encoding a domain is, or undefined for every other domain. */
export function encodingOfDomain(d: Domain): { stage: WorkingStage; encoding: OpEncoding } | undefined {
  for (const stage of WORKING_STAGES) {
    for (const [encoding, dom] of Object.entries(ENCODED_DOMAINS[stage]) as [OpEncoding, Domain][]) if (dom === d) return { stage, encoding };
  }
  return undefined;
}

/** The domains of one encoding in both composite stages (what a layer op of that encoding accepts). */
export const domainsOf = (e: OpEncoding): Domain[] => WORKING_STAGES.map((s) => ENCODED_DOMAINS[s][e]);
