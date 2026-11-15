// cb.kits.finish: the command table (split from kit.ts, CHB-032): crop, straighten, orientation, aspect, spots,
// before / after (clarity is a layer of the stack kit's finish view). Edits are transactions of the frame's document.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Document } from '@chromobench/contract';
import { centreOf, constrain, cropOf, fitCrop, orientFrame, swapAspect } from './geometry.ts';
import type { CommandTable } from '@chromobench/shell';
import { type SpotMode, removeSpots, spotsOf, cropProblem } from './state.ts';
import { sel } from '../../../src/sel.ts';
import type { FinishContext } from './context.ts';
import type { FinishTools } from './tools.ts';

/** the finish kit's command table: crop, straighten, orientation, aspect, spots, before / after, tones */
export function finishCommands(F: FinishContext, T: FinishTools): CommandTable {
  const { studioOf, frameOf, sizes, remember, opts, setFrame, needFrame } = F;
  // ── commands ──
  const withFrame = (run: (ctx: any, fr: { f: string; W: number; H: number; r: Document }, ...a: any[]) => unknown) => (ctx: any, ...a: any[]) => {
    const fr = frameOf(ctx);
    if (!fr) return null;
    remember(fr);
    return run(ctx, fr, ...a);
  };
  const spotCommandsEnabled = (s: any) => !!s.finish?.selected && spotsOf(s.docs?.[sel.current(s) ?? '']).some((x) => x.id === s.finish.selected);
  const deleteSpots = (ctx: any, fr: { f: string; r: Document }, ids: string[], label: string): void => {
    const ms = removeSpots(fr.r, ids);
    if (ms.length) studioOf(ctx).commit(fr.f, ms, label);
    ctx.set({ finish: { selected: null } });
  };

  function cycle(ctx: any, dir: number): void {
    const list = spotsOf(ctx.state.docs?.[sel.current(ctx.state) ?? '']);
    if (!list.length) return;
    const i = list.findIndex((x) => x.id === ctx.state.finish?.selected);
    ctx.set({ finish: { selected: list[(i + dir + list.length) % list.length]!.id } });
  }

  return {
    'crop.reset': {
      label: 'Reset Crop', ...needFrame,
      run: withFrame((ctx, fr) => setFrame(ctx, fr.f, { orientation: fr.r.geometry.orientation, angle_deg: 0, crop: null }, 'Reset Crop')),
    },
    'crop.aspect': {
      label: 'Crop Aspect', palette: false, ...needFrame,
      run: withFrame((ctx, fr, aspect: string) => {
        ctx.set({ finish: { crop: { aspect, locked: aspect !== 'free' } } });
        if (aspect === 'free') return;
        const fs = fr.r.geometry;
        const next = fitCrop(fr.W, fr.H, { orientation: fs.orientation, angle_deg: fs.angle_deg, aspect, centre: centreOf(cropOf(fs, fr.W, fr.H)) });
        setFrame(ctx, fr.f, next, `Crop Aspect ${aspect}`);
      }),
    },
    'crop.lock': {
      label: 'Lock Crop Aspect', checked: (s: any) => !!s.finish?.crop?.locked,
      run: (ctx: any) => ctx.set({ finish: { crop: { locked: !opts(ctx.state).crop.locked } } }),
    },
    'crop.swap': {
      label: 'Swap Crop Aspect', ...needFrame,
      run: withFrame((ctx, fr) => setFrame(ctx, fr.f, swapAspect(fr.r.geometry, fr.W, fr.H), 'Swap Crop Aspect')),
    },
    'crop.straighten': {
      label: 'Straighten', palette: false, ...needFrame,
      /** by `delta` degrees (or to `{ to }`), keeping the crop inside the picture */
      run: withFrame((ctx, fr, by: number | { to: number }) => {
        const fs = fr.r.geometry;
        const a = Math.max(-45, Math.min(45, typeof by === 'object' ? by.to : fs.angle_deg + by));
        const next = constrain({ ...fs, angle_deg: Number(a.toFixed(2)), crop: cropOf(fs, fr.W, fr.H) }, fr.W, fr.H);
        setFrame(ctx, fr.f, next, `Straighten ${a.toFixed(1)}°`);
      }),
    },
    'crop.fix': {
      label: 'Fix Crop (Keep Inside)', enabled: (s: any) => {
        const f = sel.current(s);
        const z = f ? sizes.get(f) : undefined;
        return !!(f && z && s.docs?.[f] && cropProblem(s.docs[f], z.W, z.H));
      },
      why: 'The crop lies inside the picture',
      run: withFrame((ctx, fr) => {
        const p = cropProblem(fr.r, fr.W, fr.H);
        if (p) setFrame(ctx, fr.f, p.fix, 'Fix Crop');
      }),
    },
    'crop.done': { label: 'Done Cropping', palette: false, run: (ctx: any) => ctx.set({ ui: { tool: null } }) },
    'orient.cw': { label: 'Rotate Right', ...needFrame, run: withFrame((ctx, fr) => setFrame(ctx, fr.f, orientFrame(fr.r.geometry, 'cw90'), 'Rotate Right')) },
    'orient.ccw': { label: 'Rotate Left', ...needFrame, run: withFrame((ctx, fr) => setFrame(ctx, fr.f, orientFrame(fr.r.geometry, 'ccw90'), 'Rotate Left')) },
    'orient.flipH': { label: 'Flip Horizontal', ...needFrame, run: withFrame((ctx, fr) => setFrame(ctx, fr.f, orientFrame(fr.r.geometry, 'flipH'), 'Flip Horizontal')) },
    'orient.flipV': { label: 'Flip Vertical', ...needFrame, run: withFrame((ctx, fr) => setFrame(ctx, fr.f, orientFrame(fr.r.geometry, 'flipV'), 'Flip Vertical')) },
    'spot.mode': { label: 'Spot Mode', palette: false, run: (ctx: any, mode: SpotMode) => ctx.set({ finish: { spot: { mode } } }) },
    'spot.size': {
      label: 'Spot Size', palette: false,
      run: (ctx: any, by: number) => ctx.set({ finish: { spot: { r: Math.max(1, Math.min(500, Math.round(opts(ctx.state).spot.r * (by > 0 ? 1.2 : 1 / 1.2)))) } } }),
    },
    'spot.delete': {
      label: 'Delete Spot', enabled: spotCommandsEnabled, why: 'Click a spot to select it',
      run: withFrame((ctx, fr, id?: string) => deleteSpots(ctx, fr, [id ?? ctx.state.finish.selected], 'Delete Spot')),
    },
    'spot.clear': {
      label: 'Clear All Spots', enabled: (s: any) => spotsOf(s.docs?.[sel.current(s) ?? '']).length > 0, why: 'No spots on this frame',
      run: withFrame((ctx, fr) => deleteSpots(ctx, fr, spotsOf(fr.r).map((x) => x.id), 'Clear All Spots')),
    },
    'spot.show': { label: 'Show Spots', checked: (s: any) => s.finish?.show !== false, run: (ctx: any) => ctx.set({ finish: { show: !opts(ctx.state).show } }) },
    'spot.next': { label: 'Next Spot', palette: false, run: (ctx: any) => cycle(ctx, 1) },
    'spot.prev': { label: 'Previous Spot', palette: false, run: (ctx: any) => cycle(ctx, -1) },
    'spot.select': {
      label: 'Select Spot', palette: false,
      // the spot's layer is also the selected entry of the stack (its row and its settings show it)
      run: (ctx: any, id: string | null) => {
        const f = sel.current(ctx.state);
        ctx.set({ finish: { selected: id }, ...(f && id ? { stack: { selected: { [f]: id } } } : {}) });
      },
    },
    'finish.toggle': {
      label: 'Before / After Finishing', checked: (s: any) => !!s.finish?.bypass,
      run: (ctx: any) => ctx.set({ finish: { bypass: !opts(ctx.state).bypass } }),
    },
  };
}
