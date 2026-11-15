// cb.kits.finish (CHB-022 guide §5, §9; CHB-037 on documents): crop and straighten, heal and clone, finishing tones
// — viewport tools that write vectors into the frame's document (its geometry, heal and clone layers in the print
// stage's Retouch group, heal layers in the scan stage's Dust group, the clarity layer), commands, panels built
// from ck.ui and cb.arg only (so every host renders them without extra renderers), passes. Headless.
//
// Modules (CHB-032): state.ts (state, spots, crop check, edits), context.ts (what tools, commands and panels
// share), tools.ts (crop and spot tools), commands.ts, panels.ts (builder calls), passes.ts; this file declares the kit.
//
//   const { finish } = cb.kits;
//   cb.studio('X').use(finish.kit).menus(...cb.menus.standard(), finish.menus.finish()).module(finish.modules.finish())
//   ck.module('f').center(finish.views.viewer()).right(finish.panels.crop(), finish.panels.retouch()).keys(finish.keys.finish)
//
// Units: everything the document stores is document px of the un-oriented source (geometry.ts); a gesture converts
// at the boundary. The crop tool shows the whole frame, oriented and not straightened, with the region the crop
// will read drawn as a turned rectangle; every other tool shows the finished (cropped, straightened) print.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Ck } from '@chromobench/shell';
import type { Cb } from '../../../src/cb.ts';
import { frameRef, isImageHandle } from '../../../src/handles.ts';
import { largestCrop } from './geometry.ts';
import { FINISH_STATE, spotsOf, cropProblem, edits, withoutFinishing } from './state.ts';
import { finishPasses } from './passes.ts';
import { createFinishContext } from './context.ts';
import { createFinishTools } from './tools.ts';
import { finishCommands } from './commands.ts';
import { createFinishPanels } from './panels.ts';

const FINISH_DOCS = `## cb.kits.finish
Crop and straighten (tool R: drag inside to move, a handle to resize, outside to turn; Shift snaps to 0.5°; the
crop stays inside the picture), spot heal and clone (tool Q: click a speck, drag to choose the source; the source
is found automatically on a click), and the finishing tones, which are digital and after the print, not darkroom
controls. The document stores vectors, never pixels: geometry {orientation, angle_deg, crop}, and one heal or clone
layer per spot (print stage, group "Retouch"; Dust on a scan's negative: scan stage, group "Dust") in document px of
the un-oriented source, so a crop or a turn never moves a spot. Spots apply in order, each reading the image as the
spots before it left it.`;

export function createFinishKit(ck: Ck, cb: Cb) {
  const F = createFinishContext();
  const { frameOf, remember, needFrame } = F;
  const T = createFinishTools(F);
  const { canvasOf, cropDown, cropDrag, cropUp, cropOverlay, spotDown, spotDrag, spotUp, spotOverlay } = T;

  // ── passes (guide §9.5): CB-F101 on the kit; CB-F102 (finish tools without the kit) is run by cb.core's cb.kits ──
  const { labelPass, missing } = finishPasses(ck);

  const kit = ck
    .kit('cb.finish')
    .version('1')
    .requires('cb.core')
    .state('finish', { init: FINISH_STATE.finish, view: true })
    .passes(labelPass)
    .tools({
      crop: {
        label: 'Crop & Straighten',
        icon: 'crop',
        key: 'R',
        cursor: 'crosshair',
        ...needFrame,
        // the whole frame, oriented and not straightened; the crop is drawn over it
        image: (h: unknown) => (isImageHandle(h) && h.what === 'print' && h.doc !== 'initial' ? frameRef(h.frame, canvasOf(h.doc)).print() : h),
        overlay: cropOverlay,
        on: { down: cropDown, drag: cropDrag as any, up: cropUp as any, escape: (ctx: any) => ctx.cancel() },
      },
      spot: {
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
      },
    })
    .commands(finishCommands(F, T))
    .docs(FINISH_DOCS);

  const P = createFinishPanels(ck, cb, F);
  const { shown, viewer, cropPanel, retouchPanel, tonesPanel } = P;

  const keys = {
    /** the finish module's keys: X swaps the aspect, Delete removes the selected spot, [ ] size the brush */
    finish: { X: 'crop.swap', Enter: 'crop.done', Delete: 'spot.delete', Backspace: 'spot.delete', '[': ['spot.size', -1], ']': ['spot.size', 1], 'Shift+[': 'spot.prev', 'Shift+]': 'spot.next', '\\': 'finish.toggle' } as Record<string, any>,
  };
  /** the Finish module (CHB-022 guide §9.1): crop and straighten (R), spot heal and clone (Q), the finishing tones, on the
   *  finished print; tones: false leaves the tones out (their ops run on the mock engine only until CHB-015 lands them) */
  const finishModule = (o: { id?: string; tones?: boolean; extraRight?: unknown[] } = {}) =>
    ck
      .module(o.id ?? 'finish', { label: 'Finish', key: 'F' })
      .left(ck.dock.column({ width: 236 }, cb.panels.navigator({ id: 'navigator-finish' }), cb.panels.history({ id: 'history-finish' })))
      .center(viewer({ hud: cb.hud.readout() }))
      .right(ck.dock.column({ width: 300 }, cropPanel(), retouchPanel(), ...(o.tones === false ? [] : [tonesPanel()]), ...((o.extraRight ?? []) as any[])))
      .bottom(ck.dock.column({ width: 124 }, cb.views.strip({ id: 'strip-finish' })))
      .keys(keys.finish);

  return ck.product(kit, {
    panels: { crop: cropPanel, retouch: retouchPanel, tones: tonesPanel },
    views: { viewer },
    modules: { finish: finishModule },
    menus: {
      /** the Finish menu: every finish command, so each is also in the palette and has its key shown */
      finish: () => ck.menu('Finish', ['tool.crop', 'crop.reset', 'crop.swap', 'crop.lock', 'crop.fix', '-', 'orient.ccw', 'orient.cw', 'orient.flipH', 'orient.flipV', '-', 'tool.spot', 'spot.delete', 'spot.clear', 'spot.show', '-', 'finish.addClarity', 'finish.toggle', 'finish.resetTones']),
    },
    keys,
    sel: { shown },
    lib: { state: FINISH_STATE, edits, spots: spotsOf, cropProblem, largestCrop, withoutFinishing },
    whenAbsent: missing,
  });
}

export type FinishKit = ReturnType<typeof createFinishKit>;
