// cb.core's medium presets (CHB-048 LOOK-6, D6): a film stock, a paper or a paper grade chosen by name sets the medium
// (the data pack's stocks; contract media-presets.ts), one undo step. Agents run the same command.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PRESET_KINDS, PRESET_STAGE, presetSets, type PresetKind } from '@chromobench/contract';
import type { CommandTable } from '@chromobench/shell';
import { sel, type CbState } from '../sel.ts';
import { storePath } from '../model/doc.ts';
import { presetsOf } from '../model/presets.ts';
import { docOf } from './env.ts';

export interface MediumPresetArg {
  /** 'film' (a camera file's film), 'paper' or 'grade' (the darkroom's paper) */
  kind: PresetKind;
  /** the preset's id: the pack's stock id (a pushed profile's own, e.g. kodak_portra_800_push1) or grade-<n> */
  preset: string;
}

export const mediaCommands = (): CommandTable<CbState> => ({
  'medium.preset': {
    label: 'Film Stock, Paper or Grade…',
    enabled: (s: any) => !!sel.doc(s),
    why: 'Open a frame first',
    /**
     * Sets a medium from a preset, one step: `{ kind: 'film', preset: 'kodak_gold_200' }` (a camera file's film: the
     * stock, and the push of a pushed profile), `{ kind: 'paper', preset: 'kodak_supra_endura' }`,
     * `{ kind: 'grade', preset: 'grade-3' }`. The ids are the data pack's (`medium.presets` lists them).
     */
    run: (ctx, o: MediumPresetArg) => {
      const f = sel.current(ctx.state);
      const d = f ? docOf(ctx, f) : undefined;
      if (!f || !d) return null;
      if (!PRESET_KINDS.includes(o?.kind)) {
        ctx.toast(`No kind of preset "${String(o?.kind)}": film, paper or grade`, { kind: 'warn' });
        return null;
      }
      if (!d.stages[PRESET_STAGE[o.kind]]) {
        ctx.toast('A negative was shot on its film already: its film is the scan\'s (the Scan settings), not a film to shoot on', { kind: 'why' });
        return null;
      }
      const p = presetsOf(o.kind).find((x) => x.id === o.preset);
      if (!p) {
        ctx.toast(`No ${o.kind} "${o.preset}" in the data pack`, { kind: 'warn' });
        return null;
      }
      ctx.tx(`${o.kind === 'film' ? 'Film' : o.kind === 'paper' ? 'Paper' : 'Grade'}: ${p.label}`, (t: any) => {
        for (const s of presetSets(p)) t.$set(storePath(f, d, s.path), s.value);
      });
      return { kind: o.kind, preset: p.id, set: p.set };
    },
  },
  'medium.presets': {
    label: 'List Medium Presets',
    palette: false,
    /** The presets of a kind (for agents): id, name, group, the fields they set. */
    run: (_ctx, kind: PresetKind) => presetsOf(kind).map((p) => ({ id: p.id, label: p.label, group: p.group, set: p.set })),
  },
});
