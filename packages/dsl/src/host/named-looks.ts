// cb.looks.* (split from host.ts, CHB-032; CHB-021): the studio's named looks through the injected
// LooksProvider: apply as one batch, what-ifs, diffs.
import { ChromobenchError, applyMutation, diag, type FrameRecipe } from '@chromobench/contract';
import type { Host } from '../host.ts';
import type { At, LooksProvider } from './types.ts';
import { literal } from './calls.ts';
import { printOf } from './print.ts';
import { queue } from './edits.ts';

export function needLooks(h: Host): LooksProvider {
  if (!h.looksProvider) throw new ChromobenchError(diag('E_NOT_IMPLEMENTED', 'no looks are available in this session', { hint: 'the studio provides cb.looks; describe the change with frame.edit instead' }));
  return h.looksProvider;
}

/** Frames a look goes to: the bound frame (default), an id, ids, 'all', or { roll: id }; where: 'unedited'. */
export function lookTargets(h: Host, to: unknown, where: unknown): string[] {
  let ids: string[];
  if (to === undefined || to === null || to === 'frame') ids = h.bound ? [h.bound] : h.noFrame();
  else if (to === 'all') ids = [...h.frames.keys()];
  else if (typeof to === 'string') ids = [to];
  else if (Array.isArray(to)) ids = to.map((x) => (x && typeof x === 'object' && 'id' in x ? String((x as { id: unknown }).id) : String(x)));
  else if (to && typeof to === 'object' && 'roll' in to) ids = [...h.frames.keys()].filter((f) => h.entry(f).log.committed.roll?.id === (to as { roll: unknown }).roll);
  else throw new ChromobenchError(diag('E_ARG_TYPE', "cb.looks.apply: `to` is a frame id, an array of ids, 'all' or { roll: id }", { fix: "{ to: 'all' }" }));
  for (const f of ids) h.entry(f);
  if (where === 'unedited') ids = ids.filter((f) => lookFrameInfo(h, f).unedited);
  else if (where !== undefined && where !== null) throw new ChromobenchError(diag('E_ARG_TYPE', "cb.looks.apply: `where` is a function of the frame (x => x.unedited) or 'unedited'"));
  return ids;
}

export function lookFrameInfo(h: Host, id: string): { id: string; name: string; kind: string; unedited: boolean; stock: string | null; roll: string | null } {
  const f = h.entry(id);
  const r = f.log.committed;
  return { id, name: f.name ?? id, kind: r.kind, unedited: f.log.inEffect().every((e) => e.by === 'auto' || e.m.op === 'frame.add'), stock: r.scan?.stock ?? r.capture?.stock ?? null, roll: r.roll?.id ?? null };
}

export function looksApply(h: Host, a: Record<string, unknown>): unknown {
  const P = needLooks(h);
  const name = String(a['name'] ?? '');
  const params = (literal(h, 'cb.looks.apply', 'params', a['params'] ?? {}) ?? {}) as Record<string, unknown>;
  const o = (a['opts'] ?? {}) as Record<string, unknown>;
  const amount = o['amount'] === undefined ? 1 : Number(o['amount']);
  if (!Number.isFinite(amount) || amount < 0 || amount > 2) throw new ChromobenchError(diag('E_ARG_RANGE', `cb.looks.apply: amount ${String(o['amount'])} is outside [0, 2] (1 = 100 %)`, { fix: '{ amount: 0.6 }' }));
  const ids = lookTargets(h, o['to'], o['where']);
  if (!ids.length) throw new ChromobenchError(diag('E_NO_FRAME', 'cb.looks.apply: no frame matches `to` / `where`', { valid: [...h.frames.keys()] }));
  for (const f of ids)
    if (h.entry(f).log.mode === 'read-only') throw new ChromobenchError(diag('E_READONLY', `the agent is read-only for ${f}: cb.looks.apply cannot propose changes`, { hint: 'describe the change instead; the photographer can switch the mode' }));
  h.batchCounter += 1;
  const batch = `look:${h.evalN}-${h.batchCounter}`;
  const from = o['from'] === 'defaults' ? ('defaults' as const) : undefined;
  const at = a['at'] as At;
  const skipped: { frame: string; why: string }[] = [];
  const queued: string[] = [];
  const diff = new Map<string, number>();
  let label = name;
  for (const f of ids) {
    const res = P.resolve(name, { id: f, recipe: h.state(f).draft }, params, { amount, ...(from ? { from } : {}) });
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
    queue(h, f, res.mutations.map((m) => (m.op === 'set' ? { op: 'set' as const, path: m.path, value: m.value } : m)), why, at, batch);
    queued.push(f);
    for (const d of res.diff) diff.set(d.shown, (diff.get(d.shown) ?? 0) + 1);
  }
  return {
    id: batch, status: queued.length ? 'queued' : 'nothing to do', label, frames: queued.length, skipped,
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
  const base = h.state(frame).draft;
  const res = P.resolve(String(a['name'] ?? ''), { id: frame, recipe: base }, params, { amount: o['amount'] === undefined ? 1 : Number(o['amount']), ...(o['from'] === 'defaults' ? { from: 'defaults' as const } : {}) });
  let r = base;
  for (const m of res.mutations) r = applyMutation(r, m.op === 'set' ? { op: 'set', path: m.path, value: m.value } : m, { graph: h.graph }).recipe;
  const key = `w${h.whatIfs.size + 1}`;
  h.whatIfs.set(key, r);
  const preview = h.info(printOf(h, r), frame, `cb.looks.whatIf(${h.frameExpr(frame)}, ${JSON.stringify(res.look.name)}).print()`);
  h.vocabulary['cb.looks.whatIf'] = (h.vocabulary['cb.looks.whatIf'] ?? 0) + 1;
  return { key, look: res.look.name, label: res.label, frame, preview, diff: res.diff.map((d) => d.shown), mutations: res.mutations.length, ...(res.skip ? { skipped: res.skip.hint ?? res.skip.message } : {}) };
}

export function looksDiff(h: Host, a: Record<string, unknown>): string[] {
  const P = needLooks(h);
  const recipe = (x: unknown): FrameRecipe => {
    if (x && typeof x === 'object' && 'whatIf' in x) {
      const r = h.whatIfs.get(String((x as { whatIf: unknown }).whatIf));
      if (r) return r;
    }
    if (x && typeof x === 'object' && 'frame' in x) return h.state(String((x as { frame: unknown }).frame)).draft;
    throw new ChromobenchError(diag('E_ARG_TYPE', 'cb.looks.diff(a, b) compares two frames or what-ifs', { fix: "cb.looks.diff(frame, cb.looks.whatIf(frame, 'warm print'))" }));
  };
  return P.diff(recipe(a['a']), recipe(a['b'])).map((d) => d.shown);
}
