// cb.looks.* (CHB-021; CHB-037 P7: looks are links): the contract's registered looks and the session's presets,
// applied as link entries. apply queues, on every target frame, the link inserts (one per stage the look touches,
// one key, one Amount: the stage law's amount) or the adjustment of the frame's link of that look; the eval's edits
// are submitted as one batch (plan, by the agent), so the photographer approves the look on one card and one undo
// takes it off. whatIf is a view of the document with the link (its cuts compile with the session's links); diff
// compares two documents; bake turns a frame's link into its plain groups.
import {
  allLooks, bakeLink, ChromobenchError, closest, diag, documentKind, expandLink, getLook, insertLink, keyOf, linksOf, lookParams, lookSkip, readField, setLinkAmount,
  setLinkParams, STAGES, type Document, type Entry, type Group, type LinkContext, type LinkRef,
} from '@chromobench/contract';
import { Coll, diff as diffOf, type Json, type Mutation } from '@chromobench/values';
import type { Host } from '../host.ts';
import type { At } from './types.ts';
import { literal } from './calls.ts';
import { applyTo } from './cuts.ts';
import { queue } from './edits.ts';

/** A look the agent can name: a registered look (by name or label) or a session preset (by id or name). */
interface Named {
  ref: LinkRef;
  name: string;
  label: string;
  group: string;
  params: Record<string, { type: string; unit?: string; min?: number; max?: number; default?: unknown }>;
}

function named(h: Host): Named[] {
  const looks = allLooks().map((d) => ({
    ref: { look: d.name, version: d.version } as LinkRef, name: d.name, label: d.label, group: d.group,
    params: Object.fromEntries(Object.entries(d.params).map(([k, s]) => [k, { type: s.type, ...(s.unit ? { unit: s.unit } : {}), ...(s.min !== undefined ? { min: s.min } : {}), ...(s.max !== undefined ? { max: s.max } : {}), default: s.default }])),
  }));
  const presets = Object.values(h.linkData().presets ?? {}).map((p) => ({ ref: { preset: p.id } as LinkRef, name: p.id, label: p.name, group: p.group, params: {} }));
  return [...looks, ...presets];
}

function find(h: Host, name: string): Named {
  const all = named(h);
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const hit = all.find((x) => x.name === name || x.name === slug || x.label.toLowerCase() === name.trim().toLowerCase());
  if (hit) return hit;
  const g = closest(name, all.map((x) => x.name)) ?? closest(name, all.map((x) => x.label));
  throw new ChromobenchError(diag('E_UNKNOWN_OPTION', `no look "${name}"`, { ...(g ? { hint: `did you mean '${g}'?`, fix: `cb.looks.apply('${g}', …)` } : {}), valid: all.map((x) => x.name) }));
}

export function looksList(h: Host): unknown {
  return named(h).map((x) => ({ name: x.name, label: x.label, group: x.group, kind: 'look' in x.ref ? 'look' : 'preset', params: x.params }));
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

export function lookFrameInfo(h: Host, id: string): { id: string; name: string; kind: string; unedited: boolean; stock: string | null; looks: string[] } {
  const d = h.state(id).base;
  const unedited = h.log.inEffect(id).every((e) => e.tx.by === 'auto');
  const stock = (readField(d, d.stages.scan ? 'stages.scan.medium.stock' : 'stages.film.medium.stock', h.links()) as string | undefined) ?? null;
  return { id, name: h.frameName(id), kind: documentKind(d), unedited, stock, looks: [...new Set(linksOf(d).map((l) => l.entry.name))] };
}

const sameRef = (a: LinkRef, b: LinkRef): boolean => ('look' in a && 'look' in b && a.look === b.look) || ('preset' in a && 'preset' in b && a.preset === b.preset);

/** The mutations that give a document the look: a fresh link, or its link of this look adjusted. */
function lookMutations(d: Document, n: Named, params: Record<string, unknown>, amount: number, ctx: LinkContext): { key: string; ms: Mutation[] } {
  const p = 'look' in n.ref ? lookParams(getLook(n.ref.look, n.ref.version), params) : {};
  const have = linksOf(d).find((l) => sameRef(l.entry.ref, n.ref));
  if (have) {
    const key = keyOf(have);
    return { key, ms: [...('look' in n.ref ? setLinkParams(d, key, p) : []), ...setLinkAmount(d, key, amount)] };
  }
  const used = new Set(linksOf(d).map(keyOf));
  const base = n.name.replace(/[^A-Za-z0-9_-]+/g, '-');
  let i = 1;
  while (used.has(`${base}${i}`)) i++;
  const key = `${base}${i}`;
  return { key, ms: insertLink(d, n.ref, { key, params: p, amount, name: n.label, source: { kind: 'agent', look: n.name } }, ctx) };
}

/** What a frame's look does: its layers per stage, with the law's amount (data, for the agent to read). */
function layersOf(d: Document, key: string, ctx: LinkContext): string[] {
  const out: string[] = [];
  const walk = (c: Coll<Entry>, k: number, stage: string, light: boolean): void => {
    for (const e of Coll.values(c)) {
      if (e.kind === 'group') walk(e.stack, k * e.amount, stage, light);
      else if (e.kind === 'layer') out.push(`${stage}: ${e.op} ${JSON.stringify(e.params)}${Math.abs(k * e.amount - 1) > 1e-9 ? ` × ${Number((k * e.amount).toFixed(3))} (${light ? 'light and density' : 'opacity'})` : ''}${e.mask ? ` under ${e.mask}` : ''}`);
    }
  };
  try {
    for (const l of linksOf(d)) {
      if (keyOf(l) !== key) continue;
      const g: Group = expandLink(d, l.id, l.entry, l.stage, ctx).group;
      walk(g.stack, g.amount, l.stage, STAGES[l.stage].law === 'light');
    }
  } catch (e) {
    out.push(`(not expanded here: ${e instanceof ChromobenchError ? e.diag.message : String(e)})`);
  }
  return out;
}

function amountOf(raw: unknown, what: string): number {
  const amount = raw === undefined ? 1 : Number(raw);
  if (!Number.isFinite(amount) || amount < 0 || amount > 2) throw new ChromobenchError(diag('E_ARG_RANGE', `${what}: amount ${String(raw)} is outside [0, 2] (1 = 100 %; the print stage takes at most 1)`, { fix: '{ amount: 0.6 }' }));
  return amount;
}

const labelOf = (n: Named, k: number): string => `Look: ${n.label}${Math.abs(k - 1) < 1e-9 ? '' : ` at ${Math.round(k * 100)} %`}`;

export function looksApply(h: Host, a: Record<string, unknown>): unknown {
  const n = find(h, String(a['name'] ?? ''));
  const params = (literal(h, 'cb.looks.apply', 'params', a['params'] ?? {}) ?? {}) as Record<string, unknown>;
  const o = (a['opts'] ?? {}) as Record<string, unknown>;
  const amount = amountOf(o['amount'], 'cb.looks.apply');
  if ('look' in n.ref) lookParams(getLook(n.ref.look, n.ref.version), params); // a bad parameter is the agent's error
  const ids = lookTargets(h, o['to'], o['where']);
  if (!ids.length) throw new ChromobenchError(diag('E_NO_FRAME', 'cb.looks.apply: no frame matches `to` / `where`', { valid: h.frameIds() }));
  if (h.history.mode() === 'read-only') throw new ChromobenchError(diag('E_READONLY', 'the agent is read-only: cb.looks.apply cannot change anything', { hint: 'describe the change instead; the photographer can switch the mode' }));
  h.vocabulary['cb.looks'] = (h.vocabulary['cb.looks'] ?? 0) + 1;
  const at = a['at'] as At;
  const label = labelOf(n, amount);
  const why = typeof o['why'] === 'string' ? (o['why'] as string) : label;
  const skipped: { frame: string; why: string }[] = [];
  const queued: string[] = [];
  const counts = new Map<string, number>();
  let key = '';
  for (const f of ids) {
    const d = h.state(f).draft;
    const skip = 'look' in n.ref ? lookSkip(getLook(n.ref.look, n.ref.version), documentKind(d)) : null;
    if (skip) {
      skipped.push({ frame: f, why: skip.hint ?? skip.message });
      continue;
    }
    const r = lookMutations(d, n, params, amount, h.links());
    const ms = r.ms.filter((m) => m.op !== 'set' || JSON.stringify(readField(d, m.path)) !== JSON.stringify(m.value));
    if (!ms.length) {
      skipped.push({ frame: f, why: 'no change: the frame has this look already' });
      continue;
    }
    key = r.key;
    queue(h, f, ms, { why, label, look: n.label, where: 'cb.looks.apply' }, at);
    queued.push(f);
    for (const t of layersOf(h.state(f).draft, r.key, h.links())) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return {
    status: queued.length ? 'queued' : 'nothing to do', label, frames: queued.length, skipped, ...(key ? { link: key } : {}),
    layers: [...counts].map(([t, c]) => (c === queued.length ? t : `${t} (${c} frames)`)),
    note: queued.length ? 'a link per stage the look touches: submitted when this eval ends as one batch, approved on one card' : 'no frame changes',
  };
}

export function looksWhatIf(h: Host, a: Record<string, unknown>): unknown {
  const frame = String(a['frame'] ?? h.bound ?? '');
  if (!frame) h.noFrame();
  const n = find(h, String(a['name'] ?? ''));
  const o = (a['opts'] ?? {}) as Record<string, unknown>;
  const params = (literal(h, 'cb.looks.whatIf', 'params', a['params'] ?? {}) ?? {}) as Record<string, unknown>;
  const v = h.view(`@${frame}`);
  const base = h.state(frame).draft;
  const amount = amountOf(o['amount'], 'cb.looks.whatIf');
  h.vocabulary['cb.looks'] = (h.vocabulary['cb.looks'] ?? 0) + 1;
  const skip = 'look' in n.ref ? lookSkip(getLook(n.ref.look, n.ref.version), documentKind(base)) : null;
  const r = skip ? { key: '', ms: [] as Mutation[] } : lookMutations(base, n, params, amount, h.links());
  const doc = r.ms.length ? applyTo(h, { ...v, doc: base }, r.ms, 'cb.looks.whatIf').doc : base;
  const view = h.addView({ frame, doc, expr: `cb.looks.whatIf(${h.frameExpr(frame)}, ${JSON.stringify(n.name)})` });
  return { ...view, look: n.name, label: labelOf(n, amount), diff: r.key ? layersOf(doc, r.key, h.links()) : [], changes: r.ms.length, ...(skip ? { skipped: skip.hint ?? skip.message } : {}) };
}

/** cb.looks.diff(a, b): what differs between two frames or what-ifs, as mutations in words. */
export function looksDiff(h: Host, a: Record<string, unknown>): string[] {
  const doc = (x: unknown): Document => {
    if (x && typeof x === 'object' && '__frame' in x) return h.view(String((x as { __frame: unknown }).__frame)).doc;
    throw new ChromobenchError(diag('E_ARG_TYPE', 'cb.looks.diff(a, b) compares two frames or what-ifs', { fix: "cb.looks.diff(frame, cb.looks.whatIf(frame, 'warm-print'))" }));
  };
  const show = (v: unknown): string => JSON.stringify(v as Json).slice(0, 160);
  return diffOf(doc(a['a']), doc(a['b'])).map((m) => (m.op === 'set' ? `${m.path} = ${show((m as { value?: unknown }).value)}` : m.op === 'insert' ? `insert ${m.id} into ${m.coll}${(m.item as Entry)?.kind === 'link' ? ` (look ${(m.item as Entry).name})` : ''}` : m.op === 'remove' ? `remove ${m.id}` : `move ${m.id}`));
}

/** cb.looks.bake(key, { frame }): the frame's link of a look becomes its plain groups (queued like an edit). */
export function looksBake(h: Host, a: Record<string, unknown>): unknown {
  const frame = String(a['frame'] ?? h.bound ?? '');
  if (!frame) h.noFrame();
  if (h.history.mode() === 'read-only') throw new ChromobenchError(diag('E_READONLY', 'the agent is read-only: cb.looks.bake cannot change anything'));
  const d = h.state(frame).draft;
  const key = String(a['key'] ?? '');
  const ms = bakeLink(d, key, h.links());
  queue(h, frame, ms, { label: `Bake ${key}`, where: 'cb.looks.bake' }, a['at'] as At);
  return { status: 'queued', frame, link: key, note: 'the look becomes ordinary groups (its source recorded); submitted when this eval ends' };
}
