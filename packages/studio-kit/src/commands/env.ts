// What cb.core's command tables share (CHB-029 item 3): the studio service, the frame guards, flagging, orientation,
// re-opening, stepping through the library, approving agent proposals. Edits of a frame are
// transactions of its document (ctx.tx writes under docs.<frame>; structural edits go through studio.commit).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Document } from '@chromobench/contract';
import type { Studio } from '../studio.ts';
import { sel, type CatalogFrame } from '../sel.ts';
import { DOCS, storePath } from '../model/doc.ts';
import { orientFrame } from '../../kits/finish/src/geometry.ts';

/** the studio service (ctx.services.studio) */
export const studioOf = (ctx: any): Studio => {
  const s = ctx.services?.studio as Studio | undefined;
  if (!s) throw new Error('No studio service: start the app with studio.services()');
  return s;
};
/** a frame's document as the state shows it */
export const docOf = (ctx: any, f: string): Document | undefined => ctx.state.docs?.[f];
/** one set on a frame's document as a transaction (one step): the document path is written at its place in the tree */
export const setDoc = (ctx: any, f: string, path: string, value: unknown, label: string, o: Record<string, unknown> = {}): unknown => {
  const d = docOf(ctx, f);
  if (!d) return null;
  return ctx.tx(label, (t: any) => t.$set(storePath(f, d, path), value), o);
};
export const needFrame = { enabled: (s: any) => !!sel.current(s), why: 'Open a frame first' };
export const flag = (ctx: any, v: CatalogFrame['flag'], label: string) =>
  ctx.tx(label, (t: any) => {
    for (const id of sel.targets(ctx.state)) if (t.catalog.frames[id]) t.catalog.frames[id].flag = v;
  });
export const openFrame = { enabled: (s: any) => !!sel.doc(s), why: 'Open a frame first' };
export const orientCurrent = (ctx: any, step: 'cw90' | 'ccw90' | 'flipH', label: string): void => {
  const f = sel.current(ctx.state);
  const d = f ? docOf(ctx, f) : undefined;
  if (!f || !d) return;
  const next = orientFrame(d.geometry, step);
  ctx.tx(label, (t: any) => t.$set([DOCS, f, 'geometry'], { ...next, crop: next.crop ? { ...next.crop } : null }));
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
    ctx.toast(`${name} is open as a ${as} now${r.outcome === 'resumed' ? ` (its saved edit as a ${as})` : ''}`, { kind: 'ok' });
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
/** Approve one proposal card (its checked changes); E_STALE is shown on the card with Apply anyway. */
export function approve(ctx: any, f: string, tx: string, force: boolean): unknown {
  const p = sel.proposals(ctx.state, f).find(x => x.tx === tx);
  if (!p) return null;
  const off: number[] = ctx.state.ui.approvals?.[tx]?.off ?? [];
  if (off.length >= p.changes.length) return null;
  const res = studioOf(ctx).approve(p.seq, { force, off });
  if (!res.ok) {
    ctx.set({ ui: { approvals: { [tx]: { off, stale: res.diags.map(d => ({ code: d.code, message: d.message })) } } } });
    ctx.rt.diagnostics.info('CB-H410', `Approval of ${tx} refused: ${res.diags[0]?.code}`, { runtime: true, facts: res.diags.map(d => d.message) });
    return res.diags;
  }
  ctx.set({ ui: { approvals: { [tx]: { off: [], stale: [] } }, showProposal: ctx.state.ui.showProposal === tx ? null : ctx.state.ui.showProposal } });
  return res;
}
