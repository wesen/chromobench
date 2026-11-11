// About-screen and export-header data (guide §12.4): every pack in use, with its licence, its
// attribution string and its source, so the Studio (CHB-009) and exported files (CHB-011) can show
// the credit the CC BY-SA licence requires without reading pack files themselves.
import type { Pack } from './pack.ts';

export interface AboutEntry {
  packId: string;
  packHash: string;
  title: string;
  spdx: string;
  /** Path of the licence text inside the pack (ship it unchanged). */
  licenceFile: string;
  changelog?: string;
  attribution: string;
  source: { kind: string; repo?: string; commit?: string };
  /** True when any item is illustrative (not measured). */
  illustrative: boolean;
}

export function aboutData(packs: readonly Pack[]): AboutEntry[] {
  return packs.map((p) => {
    const m = p.manifest;
    return {
      packId: p.packId,
      packHash: p.packHash,
      title: m.title ?? p.packId,
      spdx: m.license.spdx,
      licenceFile: m.license.file,
      ...(m.license.changelog ? { changelog: m.license.changelog } : {}),
      attribution: m.license.attribution,
      source: { kind: m.source.kind, ...(m.source.repo ? { repo: m.source.repo } : {}), ...(m.source.commit ? { commit: m.source.commit } : {}) },
      illustrative: m.items.some((i) => i.illustrative === true),
    };
  });
}
