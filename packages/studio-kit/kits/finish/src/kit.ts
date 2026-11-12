// cb.kits.finish (CHB-022 guide §5, §9): crop and straighten, heal and clone, finishing tones — viewport tools
// that write vectors into the recipe (view.frame, retouch.spots.<id>, scan.dust.spots), commands, panels built
// from ck.ui and cb.arg only (so every host renders them without extra renderers), passes. Headless.
//
// Modules (CHB-032): state.ts (state, spots, crop check, edits), context.ts (what tools, commands and panels
// share), tools.ts (crop and spot tools), commands.ts, panels.ts (builder calls), passes.ts; this file declares the kit.
//
//   const fin = cb.kits.finish;
//   cb.studio('X').use(fin.kit)
//     .module('finish', m => m.label('Finish').center(fin.viewer()).right(fin.cropPanel(), fin.retouchPanel(), fin.tonesPanel()).keys(fin.keys))
//
// Units: everything the recipe stores is sensor px of the un-oriented source (geometry.ts); a gesture converts
// at the boundary. The crop tool shows the whole frame, oriented and not straightened, with the region the crop
// will read drawn as a turned rectangle; every other tool shows the finished (cropped, straightened) print.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Ck } from '@chromobench/shell';
import type { Cb } from '../../../src/cb.ts';
import { frameRef, isImageHandle } from '../../../src/handles.ts';
import { largestCrop } from './geometry.ts';
import { FINISH_STATE, spotsOf, cropProblem, edits } from './state.ts';
import { finishPasses } from './passes.ts';
import { createFinishContext } from './context.ts';
import { createFinishTools } from './tools.ts';
import { addFinishCommands } from './commands.ts';
import { createFinishPanels } from './panels.ts';

const FINISH_DOCS = `## cb.kits.finish
Crop and straighten (tool R: drag inside to move, a handle to resize, outside to turn; Shift snaps to 0.5°; the
crop stays inside the picture), spot heal and clone (tool Q: click a speck, drag to choose the source; the source
is found automatically on a click), and the finishing tones, which are digital and after the print, not darkroom
controls. The recipe stores vectors, never pixels: view.frame {orientation, angle_deg, crop} and
retouch.spots.<id> in sensor px of the un-oriented source, so a crop or a turn never moves a spot. Every source is
read from the print before retouching; a later spot covers an earlier one.`;

export function createFinishKit(ck: Ck, cb: Cb) {
  const F = createFinishContext();
  const { frameOf, remember, needFrame } = F;
  const T = createFinishTools(F);
  const { canvasOf, cropDown, cropDrag, cropUp, cropOverlay, spotDown, spotDrag, spotUp, spotOverlay } = T;

  // ── passes (guide §9.5): CB-F101 on the kit; CB-F102 (finish tools without the kit) on the ck instance ──
  const { labelPass, framePass } = finishPasses(ck);
  ck.install(framePass);

  const kit = ck.kit<typeof FINISH_STATE>('cb.finish', (k) => {
    k.version('1')
      .requires('cb.core')
      .state('finish', { init: FINISH_STATE.finish, view: true })
      .passes(labelPass)
      .tools((t) =>
        t
          .tool('crop', {
            label: 'Crop & Straighten',
            icon: 'crop',
            key: 'R',
            cursor: 'crosshair',
            ...needFrame,
            // the whole frame, oriented and not straightened; the crop is drawn over it
            image: (h: unknown) => (isImageHandle(h) && h.what === 'print' && h.recipe !== 'initial' ? frameRef(h.frame, canvasOf(h.recipe)).print() : h),
            overlay: cropOverlay,
            on: { down: cropDown, drag: cropDrag as any, up: cropUp as any, escape: (ctx: any) => ctx.cancel() },
          })
          .tool('spot', {
            label: 'Spot Removal',
            icon: 'heal',
            key: 'Q',
            cursor: 'crosshair',
            ...needFrame,
            overlay: spotOverlay,
            on: {
              hover: (e: any, ctx: any) => {
                const fr = frameOf(ctx);
                if (fr) remember(fr);
                return { hover: { sx: e.sx, sy: e.sy } };
              },
              leave: () => undefined,
              down: spotDown,
              drag: spotDrag as any,
              up: spotUp as any,
              escape: (ctx: any) => ctx.cancel(),
            },
          }),
      )
      .commands((c) => {
        addFinishCommands(c, F, T);
      })
      .docs(FINISH_DOCS);
  });

  const P = createFinishPanels(ck, cb, F);
  const { shown, viewer, cropPanel, retouchPanel, tonesPanel } = P;

  return {
    kit,
    state: FINISH_STATE,
    viewer,
    shown,
    cropPanel,
    retouchPanel,
    tonesPanel,
    /** the finish module's keys: X swaps the aspect, Delete removes the selected spot, [ ] size the brush */
    keys: { X: 'crop.swap', Enter: 'crop.done', Delete: 'spot.delete', Backspace: 'spot.delete', '[': ['spot.size', -1], ']': ['spot.size', 1], 'Shift+[': 'spot.prev', 'Shift+]': 'spot.next', '\\': 'finish.toggle' } as Record<string, any>,
    edits,
    spots: spotsOf,
    cropProblem,
    largestCrop,
  };
}

export type FinishKit = ReturnType<typeof createFinishKit>;
