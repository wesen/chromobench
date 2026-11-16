// cb.core's commands before the film (CHB-048, D2): a camera file's white balance, by its numbers, by a preset (As
// shot, Lightroom's, None) or by picking a neutral in the picture (the eyedropper tool). One transaction each; a
// negative has none (its colour was fixed when the film was exposed).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { pickedWhiteBalance, TEMPERATURE_RANGE, TINT_RANGE, type WhiteBalance } from '@chromobench/contract';
import type { CommandTable, ToolTable } from '@chromobench/shell';
import { sel, type CbState } from '../sel.ts';
import { NEGATIVE_WB_NOTE, WB_PATH, wbChoices, wbWords, whiteBalanceIn } from '../model/white-balance.ts';
import { sampleCut } from '../../kits/stack/src/editors.ts';
import { docOf, setDoc, studioOf } from './env.ts';

/** What `scene.whiteBalance` takes: numbers (either or both), a preset id, or a document point to make neutral. */
export interface WhiteBalanceArg {
  temperature_K?: number;
  tint?: number;
  preset?: string;
  /** the eyedropper: a point of the picture (document px) whose colour becomes neutral */
  at?: readonly [number, number] | { x: number; y: number };
}

const isCamera = (s: any): boolean => !!whiteBalanceIn(sel.doc(s));
const cameraFrame = { enabled: isCamera, why: (s: any) => (sel.doc(s) ? NEGATIVE_WB_NOTE : 'Open a photo from a digital camera first') };
const clampTo = (v: number, r: readonly [number, number]): number => Math.min(r[1], Math.max(r[0], v));
const round = (wb: WhiteBalance): WhiteBalance => ({ temperature_K: Number(wb.temperature_K.toFixed(4)), tint: Number(wb.tint.toFixed(4)) });

/** The frame's as-shot white balance (its catalog entry, from the raw), or null. */
const asShotOf = (s: any, f: string): WhiteBalance | null => s.catalog?.frames?.[f]?.asShot ?? null;

export const sceneCommands = (): CommandTable<CbState> => ({
  'scene.whiteBalance': {
    label: 'White Balance…',
    ...cameraFrame,
    /**
     * Sets the camera file's white balance, one step: `{ temperature_K, tint }` (Lightroom's units; either may be left
     * out), `{ preset: 'as-shot' | 'daylight' | 'cloudy' | 'shade' | 'tungsten' | 'fluorescent' | 'flash' | 'none' }`, or
     * `{ at: [x, y] }`: the colour at that point of the picture (document px) becomes neutral.
     */
    run: async (ctx, o: WhiteBalanceArg = {}) => {
      const f = sel.current(ctx.state);
      const d = f ? docOf(ctx, f) : undefined;
      const now = whiteBalanceIn(d);
      if (!f || !d || !now) {
        ctx.toast(d ? NEGATIVE_WB_NOTE : 'Open a photo from a digital camera first', { kind: 'why' });
        return null;
      }
      let next: WhiteBalance;
      let label: string;
      if (o.preset !== undefined) {
        const c = wbChoices(asShotOf(ctx.state, f)).find((x) => x.id === o.preset);
        if (!c || !c.wb) {
          ctx.toast(c ? 'This file records no as-shot white balance: choose a preset or pick a neutral' : `No white balance preset "${o.preset}"`, { kind: 'warn' });
          return null;
        }
        next = c.wb;
        label = `White balance: ${c.label.replace(/ \(.*\)$/, '')}`;
      } else if (o.at !== undefined) {
        const [x, y] = Array.isArray(o.at) ? o.at : [(o.at as { x: number }).x, (o.at as { y: number }).y];
        try {
          // the colour of the white-balanced scene there (scene.input), then the white that makes it neutral
          const xyz = await sampleCut(studioOf(ctx), f, d, 'scene.input', x!, y!);
          next = pickedWhiteBalance(xyz, now);
        } catch (e) {
          ctx.toast(`White balance: ${(e as Error)?.message ?? String(e)}`, { kind: 'warn' });
          return null;
        }
        label = 'White balance: picked a neutral';
      } else {
        next = {
          temperature_K: clampTo(o.temperature_K ?? now.temperature_K, TEMPERATURE_RANGE),
          tint: clampTo(o.tint ?? now.tint, TINT_RANGE),
        };
        label = 'White balance';
      }
      next = round(next);
      setDoc(ctx, f, WB_PATH, next, `${label} (${wbWords(next)})`);
      return next;
    },
  },
});

export const sceneTools = (): ToolTable<CbState> => ({
  'white-balance': {
    label: 'White Balance (click a neutral)',
    icon: 'eyedropper',
    key: 'W',
    cursor: 'crosshair',
    enabled: isCamera,
    why: NEGATIVE_WB_NOTE,
    // one click: the colour under it becomes neutral (the scene's light is corrected before the film); then no tool
    on: {
      down: (e, ctx) => {
        void ctx.run('scene.whiteBalance', { at: [e.x, e.y] });
        ctx.set({ ui: { tool: null } });
        return false;
      },
    },
  },
});
