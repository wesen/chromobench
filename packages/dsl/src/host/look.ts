// What the model sees of a handle (split from host.ts, CHB-032): h.look() requests and h.explain() text.
import { ChromobenchError, canonicalJSON, diag, formatValue } from '@chromobench/contract';
import type { Host } from '../host.ts';
import { short } from './words.ts';
import type { At } from './types.ts';
import { closureIds } from './print.ts';

export function look(h: Host, ids: string[], frame: string | null, opts: Record<string, unknown>, at: At): { look: number; caption: string } {
  for (const id of ids) {
    const n = h.node(id);
    if (n.info.kind !== 'Image') throw new ChromobenchError(diag('E_WRONG_KIND', 'look() shows images; a measurement is numbers: await it and return it'));
  }
  const label = typeof opts['label'] === 'string' ? (opts['label'] as string) : ids.length > 1 ? 'compare' : h.node(ids[0]!).op;
  const key = canonicalJSON({ ids, opts });
  const dup = h.looks.find((l) => l.key === key);
  if (dup) return { look: dup.n, caption: dup.label };
  const n = h.looks.length + 1;
  h.looks.push({ n, ids, frame, label, opts, key, ...(at && at.eval === h.evalN ? { line: at.line } : {}) });
  return { look: n, caption: label };
}

export function explain(h: Host, id: string): string {
  return closureIds(h, id).map((nid) => {
    const n = h.node(nid);
    const args = Object.entries(n.args).filter(([, v]) => !(typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)));
    const dom = n.info.kind === 'Image' ? ` → ${(n.info as { domain: string }).domain}` : ' → value';
    return `#${short(nid)} ${n.op}(${args.length ? formatValue(Object.fromEntries(args)) : ''})${dom}`;
  }).join('\n');
}
