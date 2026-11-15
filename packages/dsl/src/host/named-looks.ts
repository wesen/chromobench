// cb.looks.* (CHB-021, contract 1.0): the studio's named looks through the injected LooksProvider. Until links (P7)
// a named look resolves, per frame, to mutations of the frame's document: apply queues them on every target frame
// (the eval's edits are then submitted as one batch, built with plan(…, { by: 'agent' })), whatIf is a view of the
// document with the look applied, diff compares two documents the way the studio does.
import { ChromobenchError, diag, documentKind, isLinked, type Document } from '@chromobench/contract';
import type { Host } from '../host.ts';
import type { At, LooksProvider } from './types.ts';
import { literal } from './calls.ts';
import { applyTo } from './cuts.ts';
import { queue } from './edits.ts';

export function needLooks(h: Host): LooksProvider {
  if (!h.looksProvider) throw new ChromobenchError(diag('E_NOT_IMPLEMENTED', 'no named looks are available in this session', { hint: 'the studio provides cb.looks; build the change with set, insert, remove and move instead' }));
  return h.looksProvider;
}

/** Frames a look goes to: the bound frame (default), an id, ids, or 'all'; where: 'unedited'. */
export function lookTargets(h: Host, to: unknown, where: unknown): string[] {
  let ids: string[];
  if (to === undefined || to === null || to === 'frame') ids = h.bound ? [h.bound] : h.noFrame();
  else if (to === 'all') ids = h.frameIds();
  else if (typeof to === 'string') ids = [to];
  else if (Array.isArray(to)) ids = to.map((x) => (x && typeof x === 'object' && 'id' in x ? String((x as { id: unknown }).id) : String(x)));
  else throw new ChromobenchError(diag('E_ARG_TYPE', "cb.looks.apply: `to` is a frame id, an array of ids or 'all'", { fix: "{ to: 'all' }" }));
  for (const f of ids) h.state(f);
  if (where === 'unedited') ids = ids.filter((f) => lookFrameInfo(h, f).unedited);
  else if (where !== undefined && where !== null) throw new ChromobenchError(diag('E_ARG_TYPE', "cb.looks.apply: `where` is a function of the frame (x => x.unedited) or 'unedited'"));
  return ids;
}

const stockOf = (d: Document): string | null => {
  const m = (d.stages.scan ?? d.stages.film)?.medium;
  return m && !isLinked(m) ? (m as { stock: string }).stock : null;
};

export function lookFrameInfo(h: Host, id: string): { id: string; name: string; kind: string; unedited: boolean; stock: string | null } {
  const d = h.state(id).base;
  const unedited = h.log.inEffect(id).every((e) => e.tx.by === 'auto');
  return { id, name: h.frameName(id), kind: documentKind(d), unedited, stock: stockOf(d) };
}

export function looksApply(h: Host, a: Record<string, unknown>): unknown {
  const P = needLooks(h);
  const name = String(a['name'] ?? '');
  const params = (literal(h, 'cb.looks.apply', 'params', a['params'] ?? {}) ?? {}) as Record<string, unknown>;
  const o = (a['opts'] ?? {}) as Record<string, unknown>;
  const amount = o['amount'] === undefined ? 1 : Number(o['amount']);
  if (!Number.isFinite(amount) || amount < 0 || amount > 2) throw new ChromobenchError(diag('E_ARG_RANGE', `cb.looks.apply: amount ${String(o['amount'])} is outside [0, 2] (1 = 100 %)`, { fix: '{ amount: 0.6 }' }));
  const ids = lookTargets(h, o['to'], o['where']);
  if (!ids.length) throw new ChromobenchError(diag('E_NO_FRAME', 'cb.looks.apply: no frame matches `to` / `where`', { valid: h.frameIds() }));
  if (h.history.mode() === 'read-only') throw new ChromobenchError(diag('E_READONLY', 'the agent is read-only: cb.looks.apply cannot change anything', { hint: 'describe the change instead; the photographer can switch the mode' }));
  h.vocabulary['cb.looks'] = (h.vocabulary['cb.looks'] ?? 0) + 1;
  const from = o['from'] === 'defaults' ? ('defaults' as const) : undefined;
  const at = a['at'] as At;
  const skipped: { frame: string; why: string }[] = [];
  const queued: string[] = [];
  const diff = new Map<string, number>();
  let label = name;
  for (const f of ids) {
    const res = P.resolve(name, { id: f, doc: h.state(f).draft }, params, { amount, ...(from ? { from } : {}) });
    label = res.label;
    if (res.skip) {
      skipped.push({ frame: f, why: res.skip.hint ?? res.skip.message });
      continue;
    }
    if (!res.mutations.length) {
      skipped.push({ frame: f, why: 'no change' });
      continue;
    }
    const why = typeof o['why'] === 'string' ? (o['why'] as string) : res.label;
    queue(h, f, res.mutations, { why, label: res.label, look: res.look.name, where: 'cb.looks.apply' }, at);
    queued.push(f);
    for (const d of res.diff) diff.set(d.shown, (diff.get(d.shown) ?? 0) + 1);
  }
  return {
    status: queued.length ? 'queued' : 'nothing to do', label, frames: queued.length, skipped,
    diff: [...diff].map(([t, n]) => (n === queued.length ? t : `${t} (${n} frames)`)),
    note: queued.length ? 'submitted when this eval ends as one batch: the photographer approves it on one card' : 'no frame changes',
  };
}

export function looksWhatIf(h: Host, a: Record<string, unknown>): unknown {
  const P = needLooks(h);
  const frame = String(a['frame'] ?? h.bound ?? '');
  if (!frame) h.noFrame();
  const o = (a['opts'] ?? {}) as Record<string, unknown>;
  const params = (literal(h, 'cb.looks.whatIf', 'params', a['params'] ?? {}) ?? {}) as Record<string, unknown>;
  const v = h.view(`@${frame}`);
  const base = h.state(frame).draft;
  const res = P.resolve(String(a['name'] ?? ''), { id: frame, doc: base }, params, { amount: o['amount'] === undefined ? 1 : Number(o['amount']), ...(o['from'] === 'defaults' ? { from: 'defaults' as const } : {}) });
  const doc = res.mutations.length ? applyTo(h, { ...v, doc: base }, res.mutations, 'cb.looks.whatIf').doc : base;
  h.vocabulary['cb.looks'] = (h.vocabulary['cb.looks'] ?? 0) + 1;
  const view = h.addView({ frame, doc, expr: `cb.looks.whatIf(${h.frameExpr(frame)}, ${JSON.stringify(res.look.name)})` });
  return { ...view, look: res.look.name, label: res.label, diff: res.diff.map((d) => d.shown), changes: res.mutations.length, ...(res.skip ? { skipped: res.skip.hint ?? res.skip.message } : {}) };
}

export function looksDiff(h: Host, a: Record<string, unknown>): string[] {
  const P = needLooks(h);
  const doc = (x: unknown): Document => {
    if (x && typeof x === 'object' && '__frame' in x) return h.view(String((x as { __frame: unknown }).__frame)).doc;
    throw new ChromobenchError(diag('E_ARG_TYPE', 'cb.looks.diff(a, b) compares two frames or what-ifs', { fix: "cb.looks.diff(frame, cb.looks.whatIf(frame, 'warm print'))" }));
  };
  return P.diff(doc(a['a']), doc(a['b'])).map((d) => d.shown);
}
