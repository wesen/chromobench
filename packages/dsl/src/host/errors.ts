// Structured errors of the prelude's traps (split from host.ts, CHB-032): unknown members, lazy nodes used as
// numbers, assignments to immutable handles and recipes.
import { ChromobenchError, diag, settablePaths } from '@chromobench/contract';
import type { Host } from '../host.ts';
import { HANDLE_MEMBERS, suggest, dslOps, editFix } from './words.ts';
import type { HandleInfo } from './types.ts';

export function unknownMethodErr(h: Host, info: HandleInfo, area: string | null, key: string): ChromobenchError {
  if (area) {
    const all = dslOps().filter((o) => o.area === area);
    const ok = all.filter((o) => info.domain && (o.domainIn === 'any' || (Array.isArray(o.domainIn) ? o.domainIn.includes(info.domain) : o.domainIn === info.domain)));
    const names = (ok.length ? ok : all).map((o) => o.name.slice(area.length + 1));
    const guess = suggest(key, names);
    return new ChromobenchError(diag('E_UNKNOWN_METHOD', `${area}.${key} is not an op`, {
      ...(guess ? { hint: `Did you mean "${guess}"?`, fix: `${info.expr}.${area}.${guess}(…)` } : {}), valid: names.map((n) => `${area}.${n}`),
    }));
  }
  const ops = dslOps().filter((o) => o.on !== 'none' && info.domain && (o.domainIn === 'any' || (Array.isArray(o.domainIn) ? o.domainIn.includes(info.domain) : o.domainIn === info.domain)));
  const areas = [...new Set(ops.map((o) => o.area))];
  if (info.domain === 'film-dyes' && !areas.includes('print')) areas.push('print');
  const valid = [...areas, ...HANDLE_MEMBERS];
  const guess = suggest(key, valid);
  return new ChromobenchError(diag('E_UNKNOWN_METHOD', `a ${info.domain ?? info.kind} handle has no member "${key}"`, {
    ...(guess ? { hint: `Did you mean "${guess}"?`, fix: `${info.expr}.${guess}${HANDLE_MEMBERS.includes(guess) && guess !== 'look' && guess !== 'explain' ? '' : '(…)'}` } : {}), valid,
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

export function immutable(h: Host, info: HandleInfo | null, key: string, value: unknown): never {
  const leaf = key.split('.').pop()!;
  const exact = settablePaths().filter((p) => !p.includes('*') && (p === key || p.endsWith(`.${leaf}`)));
  const path = exact[0];
  const fx = h.frameExpr(info?.frame ?? h.bound);
  throw new ChromobenchError(diag('E_IMMUTABLE', `${info ? info.label : key.split('.')[0]} is immutable: assigning ${key} changes nothing`, {
    hint: 'handles are what-ifs; change the recipe with frame.edit, or build a new node with literal options',
    ...(path && value !== undefined ? { fix: editFix(fx, path, value) } : {}),
    ...(exact.length > 1 ? { valid: exact } : {}),
  }));
}

export function immutableRecipe(h: Host, frame: string, path: string, value: unknown): never {
  const fx = h.frameExpr(frame);
  throw new ChromobenchError(diag('E_IMMUTABLE', `frame.recipe is a read-only snapshot: assigning ${path} changes nothing`, {
    hint: 'propose the change with frame.edit; the photographer approves it in ask mode',
    ...(value !== undefined ? { fix: editFix(fx, path, value) } : {}),
  }));
}
