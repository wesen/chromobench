// cb.kits.finish: the command table (split from kit.ts, CHB-032): crop, straighten, orientation, aspect, spots,
// before / after and the finishing tones.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FrameRecipe, Mutation } from '@chromobench/contract';
import { centreOf, constrain, cropOf, fitCrop, orientFrame, swapAspect } from './geometry.ts';
import type { KitBuilder } from '@chromobench/shell';
import { type SpotMode, FINISHING_PATHS, type DustSpot, plain, current, spotsOf, cropProblem } from './state.ts';
import type { FinishContext } from './context.ts';
import type { FinishTools } from './tools.ts';

export function addFinishCommands(c: Parameters<Parameters<KitBuilder['commands']>[0]>[0], F: FinishContext, T: FinishTools): void {
  const { studioOf, frameOf, sizes, remember, opts, setFrame, needFrame } = F;
  // ── commands ──
  const withFrame = (run: (ctx: any, fr: { f: string; W: number; H: number; r: FrameRecipe }, ...a: any[]) => unknown) => (ctx: any, ...a: any[]) => {
    const fr = frameOf(ctx);
    if (!fr) return null;
    remember(fr);
    return run(ctx, fr, ...a);
  };
  const spotCommandsEnabled = (s: any) => !!s.finish?.selected && spotsOf(s.recipes?.[current(s) ?? '']).some((x) => x.id === s.finish.selected);
  const deleteSpots = (ctx: any, fr: { f: string; r: FrameRecipe }, ids: string[], label: string): void => {
    const ms: Mutation[] = [];
    const dust = ((fr.r.scan?.dust.spots ?? []) as DustSpot[]);
    const dustOut = dust.filter((d) => ids.includes(d.id));
    if (dustOut.length) ms.push({ op: 'set', path: 'scan.dust.spots', value: plain(dust.filter((d) => !ids.includes(d.id))) });
    for (const id of ids) if (fr.r.retouch.spots[id]) ms.push({ op: 'set', path: `retouch.spots.${id}`, value: null });
    if (ms.length) studioOf(ctx).route.applyMutations(fr.f, ms, label);
    ctx.set({ finish: { selected: null } });
  };

  function cycle(ctx: any, dir: number): void {
    const list = spotsOf(ctx.state.recipes?.[current(ctx.state) ?? '']);
    if (!list.length) return;
    const i = list.findIndex((x) => x.id === ctx.state.finish?.selected);
    ctx.set({ finish: { selected: list[(i + dir + list.length) % list.length]!.id } });
  }

  c.add('crop.reset', {
    label: 'Reset Crop', menu: 'Finish', ...needFrame,
    run: withFrame((ctx, fr) => setFrame(ctx, fr.f, { orientation: fr.r.view.frame.orientation, angle_deg: 0, crop: null }, 'Reset Crop')),
  })
    .add('crop.aspect', {
      label: 'Crop Aspect', palette: false, ...needFrame,
      run: withFrame((ctx, fr, aspect: string) => {
        ctx.set({ finish: { crop: { aspect, locked: aspect !== 'free' } } });
        if (aspect === 'free') return;
        const fs = fr.r.view.frame;
        const next = fitCrop(fr.W, fr.H, { orientation: fs.orientation, angle_deg: fs.angle_deg, aspect, centre: centreOf(cropOf(fs, fr.W, fr.H)) });
        setFrame(ctx, fr.f, next, `Crop Aspect ${aspect}`);
      }),
    })
    .add('crop.lock', {
      label: 'Lock Crop Aspect', menu: 'Finish',
      checked: (s: any) => !!s.finish?.crop?.locked,
      run: (ctx: any) => ctx.set({ finish: { crop: { locked: !opts(ctx.state).crop.locked } } }),
    })
    .add('crop.swap', {
      label: 'Swap Crop Aspect', menu: 'Finish', ...needFrame,
      run: withFrame((ctx, fr) => setFrame(ctx, fr.f, swapAspect(fr.r.view.frame, fr.W, fr.H), 'Swap Crop Aspect')),
    })
    .add('crop.straighten', {
      label: 'Straighten', palette: false, ...needFrame,
      /** by `delta` degrees (or to `{ to }`), keeping the crop inside the picture */
      run: withFrame((ctx, fr, by: number | { to: number }) => {
        const fs = fr.r.view.frame;
        const a = Math.max(-45, Math.min(45, typeof by === 'object' ? by.to : fs.angle_deg + by));
        const next = constrain({ ...fs, angle_deg: Number(a.toFixed(2)), crop: cropOf(fs, fr.W, fr.H) }, fr.W, fr.H);
        setFrame(ctx, fr.f, next, `Straighten ${a.toFixed(1)}°`);
      }),
    })
    .add('crop.fix', {
      label: 'Fix Crop (Keep Inside)', menu: 'Finish',
      enabled: (s: any) => {
        const f = current(s);
        const z = f ? sizes.get(f) : undefined;
        return !!(f && z && s.recipes?.[f] && cropProblem(s.recipes[f], z.W, z.H));
      },
      why: 'The crop lies inside the picture',
      run: withFrame((ctx, fr) => {
        const p = cropProblem(fr.r, fr.W, fr.H);
        if (p) setFrame(ctx, fr.f, p.fix, 'Fix Crop');
      }),
    })
    .add('crop.done', { label: 'Done Cropping', palette: false, run: (ctx: any) => ctx.set({ ui: { tool: null } }) })
    .add('orient.cw', { label: 'Rotate Right', menu: 'Finish', ...needFrame, run: withFrame((ctx, fr) => setFrame(ctx, fr.f, orientFrame(fr.r.view.frame, 'cw90'), 'Rotate Right')) })
    .add('orient.ccw', { label: 'Rotate Left', menu: 'Finish', ...needFrame, run: withFrame((ctx, fr) => setFrame(ctx, fr.f, orientFrame(fr.r.view.frame, 'ccw90'), 'Rotate Left')) })
    .add('orient.flipH', { label: 'Flip Horizontal', menu: 'Finish', ...needFrame, run: withFrame((ctx, fr) => setFrame(ctx, fr.f, orientFrame(fr.r.view.frame, 'flipH'), 'Flip Horizontal')) })
    .add('orient.flipV', { label: 'Flip Vertical', menu: 'Finish', ...needFrame, run: withFrame((ctx, fr) => setFrame(ctx, fr.f, orientFrame(fr.r.view.frame, 'flipV'), 'Flip Vertical')) })
    .add('spot.mode', { label: 'Spot Mode', palette: false, run: (ctx: any, mode: SpotMode) => ctx.set({ finish: { spot: { mode } } }) })
    .add('spot.size', {
      label: 'Spot Size', palette: false,
      run: (ctx: any, by: number) => ctx.set({ finish: { spot: { r: Math.max(1, Math.min(500, Math.round(opts(ctx.state).spot.r * (by > 0 ? 1.2 : 1 / 1.2)))) } } }),
    })
    .add('spot.delete', {
      label: 'Delete Spot', menu: 'Finish', enabled: spotCommandsEnabled, why: 'Click a spot to select it',
      run: withFrame((ctx, fr, id?: string) => deleteSpots(ctx, fr, [id ?? ctx.state.finish.selected], 'Delete Spot')),
    })
    .add('spot.clear', {
      label: 'Clear All Spots', menu: 'Finish',
      enabled: (s: any) => spotsOf(s.recipes?.[current(s) ?? '']).length > 0, why: 'No spots on this frame',
      run: withFrame((ctx, fr) => deleteSpots(ctx, fr, spotsOf(fr.r).map((x) => x.id), 'Clear All Spots')),
    })
    .add('spot.show', { label: 'Show Spots', menu: 'Finish', checked: (s: any) => s.finish?.show !== false, run: (ctx: any) => ctx.set({ finish: { show: !opts(ctx.state).show } }) })
    .add('spot.next', { label: 'Next Spot', palette: false, run: (ctx: any) => cycle(ctx, 1) })
    .add('spot.prev', { label: 'Previous Spot', palette: false, run: (ctx: any) => cycle(ctx, -1) })
    .add('spot.select', { label: 'Select Spot', palette: false, run: (ctx: any, id: string | null) => ctx.set({ finish: { selected: id } }) })
    .add('finish.toggle', {
      label: 'Before / After Finishing', menu: 'Finish',
      checked: (s: any) => !!s.finish?.bypass,
      run: (ctx: any) => ctx.set({ finish: { bypass: !opts(ctx.state).bypass } }),
    })
    .add('finish.resetTones', {
      label: 'Reset Finishing Tones', menu: 'Finish', ...needFrame,
      run: withFrame((ctx, fr) => ctx.tx('Reset Finishing Tones', (t: any) => {
        for (const p of FINISHING_PATHS) if (fr.r.finishing.values[p.split('.').pop()!] !== undefined) t.$set(['recipes', fr.f, ...p.split('.')], 0);
      })),
    });
}
