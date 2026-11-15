// Structured errors of the prelude's traps (CHB-032 split; contract 1.0): unknown members, lazy nodes used as
// numbers, assignments to immutable handles and documents.
import { ChromobenchError, diag, type Document } from '@chromobench/contract';
import { Coll, canonicalPath, isPlainObject } from '@chromobench/values';
import type { Host } from '../host.ts';
import { HANDLE_MEMBERS, suggest, dslOps, proposeFix } from './words.ts';
import type { HandleInfo } from './types.ts';

export function unknownMethodErr(h: Host, info: HandleInfo, area: string | null, key: string): ChromobenchError {
  const accepts = (o: ReturnType<typeof dslOps>[number]): boolean =>
    !!info.domain && (o.domainIn === 'any' || (Array.isArray(o.domainIn) ? o.domainIn.includes(info.domain) : o.domainIn === info.domain));
  if (area) {
    const all = dslOps().filter((o) => o.area === area);
    const ok = all.filter(accepts);
    const names = (ok.length ? ok : all).map((o) => o.name.slice(area.length + 1));
    const guess = suggest(key, names);
    return new ChromobenchError(diag('E_UNKNOWN_METHOD', `${area}.${key} is not an op`, {
      ...(guess ? { hint: `Did you mean "${guess}"?`, fix: `${info.expr}.${area}.${guess}(…)` } : {}), valid: names.map((n) => `${area}.${n}`),
    }));
  }
  const areas = [...new Set(dslOps().filter((o) => o.on !== 'none' && accepts(o)).map((o) => o.area))];
  const valid = [...areas, ...HANDLE_MEMBERS];
  const guess = suggest(key, valid);
  void h;
  return new ChromobenchError(diag('E_UNKNOWN_METHOD', `a ${info.domain ?? info.kind} handle has no member "${key}"`, {
    ...(guess ? { hint: `Did you mean "${guess}"?`, fix: `${info.expr}.${guess}${HANDLE_MEMBERS.includes(guess) && guess !== 'show' && guess !== 'explain' ? '' : '(…)'}` } : {}), valid,
  }));
}

export function unknownMember(h: Host, a: Record<string, unknown>): never {
  const where = String(a['where']);
  const key = String(a['key']);
  if (where === 'handle') throw unknownMethodErr(h, a['info'] as HandleInfo, null, key);
  if (where === 'namespace') throw unknownMethodErr(h, a['info'] as HandleInfo, String(a['area']), key);
  const valid = ((a['valid'] ?? []) as string[]).filter((k) => k !== 'toString');
  const guess = suggest(key, valid);
  throw new ChromobenchError(diag('E_UNKNOWN_METHOD', `${where} has no member "${key}"`, {
    ...(guess ? { hint: `Did you mean "${guess}"?`, fix: `${where}.${guess}` } : {}), valid,
  }));
}

export function notAwaited(h: Host, info: HandleInfo, key: string | null): never {
  void h;
  if (info.kind === 'Image') {
    throw new ChromobenchError(diag('E_NOT_AWAITED', `${info.op}() is an image node; it has no number value`, {
      hint: 'images never become numbers; measure them', fix: `(await ${info.expr}.measure.stats()).mean`, path: info.label,
    }));
  }
  const field = key ?? info.fields?.[0];
  throw new ChromobenchError(diag('E_NOT_AWAITED', key ? `${info.op}() is a lazy node: read .${key} after awaiting it.` : `${info.op}() is a lazy node: await it before using it as a number.`, {
    path: `${info.label} → ✗ ${key ?? '(value)'}`,
    hint: 'Nothing has been computed yet; awaiting the node evaluates it.',
    fix: `(await ${info.expr})${field ? `.${field}` : ''}`,
    ...(info.fields?.length ? { valid: info.fields } : {}),
  }));
}

/** The id-anchored paths of a document whose last segment is `key` (an entry's param, a medium field). */
export function leafPaths(doc: Document, key: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string, depth: number): void => {
    if (depth > 8) return;
    if (Coll.is(v)) {
      for (const [id, x] of Coll.entries(v as Coll<unknown>)) walk(x, id, depth + 1);
      return;
    }
    if (!isPlainObject(v)) return;
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      if (k === key && !isPlainObject(x)) out.push(p);
      else walk(x, p, depth + 1);
    }
  };
  walk(doc, '', 0);
  return out;
}

export function immutable(h: Host, info: HandleInfo | null, key: string, value: unknown): never {
  const frame = info?.frame ?? h.bound;
  const leaf = key.split('.').pop()!;
  const paths = frame ? leafPaths(h.state(frame).base, leaf) : [];
  const fx = h.frameExpr(frame);
  throw new ChromobenchError(diag('E_IMMUTABLE', `${info ? info.label : key.split('.')[0]} is immutable: assigning ${key} changes nothing`, {
    hint: 'handles are what-ifs: view the change with frame.with(change), propose it with frame.propose(change)',
    ...(paths[0] && value !== undefined ? { fix: proposeFix(fx, paths[0], value) } : {}),
    ...(paths.length > 1 ? { valid: paths } : {}),
  }));
}

/** An assignment into frame.doc: the path as the frozen view saw it (collections as order/items). */
export function immutableDoc(h: Host, frame: string, phys: string, value: unknown): never {
  const fx = h.frameExpr(frame);
  let path = phys.split('.').filter((s, i, all) => !(s === 'items' && i > 0) && !(s === 'order' && i === all.length - 2)).join('.');
  try {
    path = canonicalPath(h.state(frame).base, path);
  } catch {
    // a path the document does not have: show it as written
  }
  throw new ChromobenchError(diag('E_IMMUTABLE', `frame.doc is a read-only snapshot: assigning ${path} changes nothing`, {
    hint: 'propose the change with frame.propose(set(path, value)); in ask mode the photographer approves it',
    ...(value !== undefined ? { fix: proposeFix(fx, path, value) } : {}),
  }));
}
