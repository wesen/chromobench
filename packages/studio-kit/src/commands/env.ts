// What cb.core's command tables share (CHB-029 item 3): the studio service, the frame guards, flagging, orientation,
// re-opening, stepping through the library, approving agent proposals, the mask gesture.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FrameRecipe } from '@chromobench/contract';
import type { Studio } from '../studio.ts';
import { sel, type CatalogFrame } from '../sel.ts';
import { maskSpec, nextExposureId, type MaskDoc } from '../model/tools.ts';
import { orientFrame } from '../../kits/finish/src/geometry.ts';

/** the studio service (ctx.services.studio) */
export const studioOf = (ctx: any): Studio => {
  const s = ctx.services?.studio as Studio | undefined;
  if (!s) throw new Error('No studio service: start the app with studio.services()');
  return s;
};
export const recipeOf = (ctx: any, f: string): FrameRecipe | undefined => ctx.state.recipes?.[f];
export const needFrame = { enabled: (s: any) => !!sel.current(s), why: 'Open a frame first' };
export const flag = (ctx: any, v: CatalogFrame['flag'], label: string) =>
  ctx.tx(label, (t: any) => {
    for (const id of sel.targets(ctx.state)) if (t.catalog.frames[id]) t.catalog.frames[id].flag = v;
  });
export const openFrame = { enabled: (s: any) => !!sel.recipe(s), why: 'Open a frame first' };
export const orientCurrent = (ctx: any, step: 'cw90' | 'ccw90' | 'flipH', label: string): void => {
  const f = sel.current(ctx.state);
  const r = f ? recipeOf(ctx, f) : undefined;
  if (!f || !r) return;
  const next = orientFrame(r.view.frame, step);
  ctx.tx(label, (t: any) => t.$set(['recipes', f, 'view', 'frame'], { ...next, crop: next.crop ? { ...next.crop } : null }));
};
export const reopenAs = async (ctx: any, id: string | null, as: 'photo' | 'negative'): Promise<unknown> => {
  if (!id) return null;
  const studio = studioOf(ctx);
  const name = ctx.state.catalog?.frames?.[id]?.name ?? id;
  if (!studio.frames.get(id)) {
    ctx.toast(`${name} is not open: select it to open its file first`, { kind: 'why' });
    return null;
  }
  ctx.toast(`Re-opening ${name} as a ${as}…`, { kind: 'info' });
  try {
    const r = await studio.reopen(id, as);
    ctx.toast(`${name} is open as a ${as} now${r.outcome === 'resumed' ? ` (its saved recipe as a ${as})` : ''}`, { kind: 'ok' });
    return r.entry.id;
  } catch (e) {
    ctx.toast(`${name}: ${String((e as { diag?: { message?: string } })?.diag?.message ?? (e as Error)?.message ?? e)}`, { kind: 'error' });
    return null;
  }
};

export function step(ctx: any, dir: number): void {
  const list = sel.library(ctx.state);
  if (!list.length) return;
  const i = list.findIndex(x => x.id === sel.current(ctx.state));
  const next = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i) + dir))]!;
  ctx.run('frame.select', next.id);
}
export function approve(ctx: any, f: string, tx: string, force: boolean): unknown {
  const p = (sel.proposals(ctx.state, f)).find((x: any) => x.tx === tx);
  if (!p) return null;
  const off: number[] = ctx.state.ui.approvals?.[tx]?.off ?? [];
  const seqs = p.seqs.filter((s: number) => !off.includes(s));
  if (!seqs.length) return null;
  const res = studioOf(ctx).route.approve(f, seqs, force);
  if (Array.isArray(res)) {
    ctx.set({ ui: { approvals: { [tx]: { off, stale: res.map(d => ({ code: d.code, message: d.message })) } } } });
    ctx.rt.diagnostics.info('CB-H410', `Approval of ${tx} refused: ${res[0]?.code}`, { runtime: true, facts: res.map(d => d.message) });
    return res;
  }
  ctx.set({ ui: { approvals: { [tx]: { off: [], stale: [] } }, showProposal: ctx.state.ui.showProposal === tx ? null : ctx.state.ui.showProposal } });
  return res;
}
export function maskGesture(ctx: any, shape: MaskDoc['shapes'][number]): void {
  const f = sel.current(ctx.state);
  const studio = studioOf(ctx);
  const e = f ? studio.frames.get(f) : undefined;
  if (!f || !e) return;
  const r = e.log.committed;
  const src = e.graph.intern('source.open', [], { source: r.source.sha256, encoding: r.source.decode.encoding }).node;
  const id = `m${Object.keys(r.masks).length + 1}`;
  const spec = maskSpec(e.graph, src.id, { shapes: [shape], feather: 8, invert: false });
  const ex = nextExposureId(r, 'burn');
  studio.route.applyMutations(f, [{ op: 'mask.set', id, mask: spec }, { op: 'exposure.add', exposure: { id: ex, kind: 'burn', stops: 0.5, mask: id } }], `Burn ${ex} through mask ${id}`);
}
