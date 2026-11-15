// What the model sees (CHB-032 split; contract 1.0): h.show() requests (images with their numbers, rendered after
// the eval), a handle's chain (h.explain()) and a document's structure with the nodes its entries compile to
// (frame.explain()).
import { ChromobenchError, STAGES, canonicalJSON, diag, documentKind, formatValue, isLinked, stagesOf, type Entry } from '@chromobench/contract';
import { Coll } from '@chromobench/values';
import type { Host } from '../host.ts';
import { short } from './words.ts';
import type { At } from './types.ts';
import { closureIds, compiled } from './cuts.ts';

export function show(h: Host, ids: string[], frame: string | null, opts: Record<string, unknown>, at: At): { show: number; caption: string } {
  for (const id of ids) {
    const n = h.node(id);
    if (n.info.kind !== 'Image') throw new ChromobenchError(diag('E_WRONG_KIND', 'show() shows images; a measurement is numbers: await it and return it'));
  }
  h.vocabulary['h.show'] = (h.vocabulary['h.show'] ?? 0) + 1;
  const label = typeof opts['label'] === 'string' ? (opts['label'] as string) : ids.length > 1 ? 'compare' : h.node(ids[0]!).op;
  const key = canonicalJSON({ ids, opts });
  const dup = h.shows.find((l) => l.key === key);
  if (dup) return { show: dup.n, caption: dup.label };
  const n = h.shows.length + 1;
  h.shows.push({ n, ids, frame, label, opts, key, ...(at && at.eval === h.evalN ? { line: at.line } : {}) });
  return { show: n, caption: label };
}

export function explain(h: Host, id: string): string {
  return closureIds(h, id).map((nid) => {
    const n = h.node(nid);
    const args = Object.entries(n.args).filter(([, v]) => !(typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)));
    const dom = n.info.kind === 'Image' ? ` → ${(n.info as { domain: string }).domain}` : ' → value';
    return `#${short(nid)} ${n.op}(${args.length ? formatValue(Object.fromEntries(args)) : ''})${dom}`;
  }).join('\n');
}

const brief = (o: unknown, max = 100): string => {
  const s = formatValue(o);
  return s.length > max ? `${s.slice(0, max - 3)}…` : s;
};

/** frame.explain(): the document's stages (medium, law, entries with the nodes they compile to), masks, geometry. */
export function explainView(h: Host, key: string, at: At): string {
  const v = h.view(key);
  const d = v.doc;
  const c = compiled(h, d, at);
  const nodes = (id: string): string => (c.entries[id]?.length ? ` → ${[...new Set(c.entries[id])].map((n) => `#${short(n)}`).join(' ')}` : ' → (no node)');
  const lines = [`${v.frame} · ${documentKind(d)} · source ${d.source.sha256.slice(0, 8)}…`];
  const entry = (id: string, e: Entry, depth: number): void => {
    const pad = '  '.repeat(depth);
    const bits = [e.enabled ? '' : 'disabled', e.amount !== 1 ? `amount ${e.amount}` : '', e.mask ? `mask ${e.mask}` : '', e.kind !== 'group' && e.blend !== 'normal' ? `blend ${e.blend}` : ''].filter(Boolean);
    const extra = bits.length ? ` [${bits.join(', ')}]` : '';
    if (e.kind === 'group') {
      lines.push(`${pad}${id} group ${JSON.stringify(e.name)}${e.blend !== 'pass' ? ` ${e.blend}` : ''}${extra}`);
      for (const [cid, ce] of Coll.entries(e.stack)) entry(cid, ce, depth + 1);
    } else if (e.kind === 'link') lines.push(`${pad}${id} link ${brief(e.ref)}${extra}${nodes(id)}`);
    else lines.push(`${pad}${id} ${e.op} ${brief(e.params)}${extra}${nodes(id)}`);
  };
  for (const s of stagesOf(d)) {
    const st = d.stages[s]!;
    const law = STAGES[s].law ?? 'no law';
    lines.push(`${s} (${law}): ${isLinked(st.medium) ? `linked ${brief(st.medium.link)}` : brief(st.medium, 240)}`);
    if (!st.stack.order.length) lines.push('  (no entries)');
    for (const [id, e] of Coll.entries(st.stack)) entry(id, e, 1);
  }
  lines.push(`masks: ${d.masks.order.length ? d.masks.order.map((id) => `${id} ${JSON.stringify(Coll.get(d.masks, id)!.name)}`).join(', ') : 'none'}`);
  lines.push(`geometry: ${brief(d.geometry)} · output: ${d.output.rendering}, white ${d.output.white}`);
  return lines.join('\n');
}
