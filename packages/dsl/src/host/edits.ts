// frame.edit (split from host.ts, CHB-032; DR-3): mutations validated against the frame's draft and queued for
// submission at the end of the eval.
import { ChromobenchError, applyMutation, diag, getPath, settablePaths, type Mutation } from '@chromobench/contract';
import type { Host } from '../host.ts';
import { suggest, editFix } from './words.ts';
import type { QueuedEdit, At } from './types.ts';
import { literal } from './calls.ts';
import { printOf } from './print.ts';

export function edit(h: Host, a: Record<string, unknown>): unknown {
  const frame = String(a['frame']);
  const log = h.entry(frame).log;
  const fx = h.frameExpr(frame);
  if (log.mode === 'read-only') {
    throw new ChromobenchError(diag('E_READONLY', 'the agent is read-only for this frame: frame.edit cannot propose changes', { hint: 'describe the change instead; the photographer can switch the mode' }));
  }
  const kind = String(a['kind']);
  const why = typeof a['why'] === 'string' ? (a['why'] as string) : undefined;
  const ms: Mutation[] = [];
  if (kind === 'set') {
    const ch = a['changes'];
    if (!ch || typeof ch !== 'object' || Array.isArray(ch) || Object.keys(ch).length === 0) {
      throw new ChromobenchError(diag('E_ARG_TYPE', 'frame.edit takes an object of recipe paths', { fix: `${fx}.edit({ 'print.enlarger.time_s': 12 })` }));
    }
    for (const [path, v] of Object.entries(ch as Record<string, unknown>)) ms.push({ op: 'set', path, value: literal(h, 'frame.edit', path, v) });
  } else if (kind === 'exposure.add') {
    const ex = { ...((a['exposure'] ?? {}) as Record<string, unknown>) };
    const m = ex['mask'];
    if (m && typeof m === 'object' && '__node' in m) {
      const id = String(ex['id']);
      ms.push({ op: 'mask.set', id, mask: { version: 1, nodes: h.graph.closure((m as { __node: string }).__node) } });
      ex['mask'] = id;
    }
    ms.push({ op: 'exposure.add', exposure: literal(h, 'frame.edit.exposure.add', 'exposure', ex) as never });
  } else if (kind === 'exposure.remove') {
    ms.push({ op: 'exposure.remove', id: String(a['id']) });
  } else if (kind === 'mask.set') {
    const m = a['mask'];
    if (!m || typeof m !== 'object' || !('__node' in m)) throw new ChromobenchError(diag('E_ARG_TYPE', 'frame.edit.mask.set(id, mask) needs a mask handle', { hint: 'build one with h.mask.*' }));
    ms.push({ op: 'mask.set', id: String(a['id']), mask: { version: 1, nodes: h.graph.closure((m as { __node: string }).__node) } });
  }
  const q = queue(h, frame, ms, why, a['at'] as At);
  const preview = h.info(printOf(h, h.state(frame).draft), frame, `${fx}.print() after ${q.id}`);
  preview.expr = 'receipt.preview';
  return {
    id: q.id, status: 'queued', mutations: q.mutations, preview,
    note: log.mode === 'ask' ? 'submitted when this eval ends; ask mode: waits for the photographer' : 'submitted when this eval ends; auto mode: applied at once',
  };
}

/** Validate mutations against the frame's draft and queue them for submission at the end of the eval (DR-3). */
export function queue(h: Host, frame: string, ms: readonly Mutation[], why: string | undefined, at: At, batch?: string): QueuedEdit {
  const fx = h.frameExpr(frame);
  const s = h.state(frame);
  let r = s.draft;
  const out: Mutation[] = [];
  const was: unknown[] = [];
  for (const m of ms) {
    try {
      const res = applyMutation(r, m, { graph: h.graph });
      was.push(m.op === 'set' ? getPath(r, m.path) : undefined);
      out.push(m.op === 'set' ? { ...m, value: res.value } : m);
      r = res.recipe;
      for (const w of res.warnings) h.warnings.push(at && at.eval === h.evalN ? { ...w, where: { line: at.line } } : w);
    } catch (e) {
      if (e instanceof ChromobenchError && e.diag.code === 'E_PATH' && m.op === 'set') {
        const guess = suggest(m.path, settablePaths());
        const d = { ...e.diag };
        if (guess && !guess.includes('*')) d.fix = editFix(fx, guess, m.value);
        throw new ChromobenchError(d);
      }
      throw e;
    }
  }
  s.draft = r;
  h.editCounter += 1;
  const q: QueuedEdit = { id: `e${h.editCounter}`, frame, mutations: out, was, ...(why !== undefined ? { why } : {}), ...(at && at.eval === h.evalN ? { line: at.line } : {}), ...(batch ? { batch } : {}) };
  h.edits.push(q);
  const key = batch ? 'cb.looks.apply' : 'frame.edit';
  h.vocabulary[key] = (h.vocabulary[key] ?? 0) + 1;
  return q;
}
