// One line per mutation, for receipts, the result's edits block and the chat's approval cards: what changed and,
// from the inverse, what it was.
import { formatValue } from '@chromobench/contract';
import type { Mutation } from '@chromobench/values';

const fmt = (v: unknown): string => formatValue(v);

function itemText(item: unknown): string {
  if (!item || typeof item !== 'object') return fmt(item);
  const it = item as Record<string, unknown>;
  if (it['kind'] === 'layer') {
    const p = it['params'] as Record<string, unknown> | undefined;
    const bits = [p && Object.keys(p).length ? fmt(p) : '', it['amount'] !== 1 && it['amount'] !== undefined ? `amount ${fmt(it['amount'])}` : '', it['mask'] ? `mask ${String(it['mask'])}` : ''].filter(Boolean);
    return `${String(it['op'])}${bits.length ? ` ${bits.join(', ')}` : ''}`;
  }
  if (it['kind'] === 'group') {
    const n = (it['stack'] as { order?: unknown[] } | undefined)?.order?.length ?? 0;
    return `group ${fmt(it['name'])} of ${n}`;
  }
  if ('components' in it) return `mask ${fmt(it['name'])}`;
  return fmt(item);
}

/** "set main.params.time_s = 12.6 (was 10)", "insert b1 into stages.darkroom.stack (burn {stops: 0.5})", … */
export function describeMutation(m: Mutation, inverse?: Mutation): string {
  switch (m.op) {
    case 'set': {
      const was = inverse && inverse.op === 'set' ? (inverse.value === undefined ? ' (was unset)' : ` (was ${fmt(inverse.value)})`) : '';
      return m.value === undefined ? `unset ${m.path}${was}` : `set ${m.path} = ${fmt(m.value)}${was}`;
    }
    case 'insert': return `insert ${m.id} into ${m.coll}${m.at !== undefined ? ` at ${m.at}` : ''} (${itemText(m.item)})`;
    case 'remove': return `remove ${m.id}`;
    case 'move': return `move ${m.id}${m.into ? ` into ${m.into}` : ''}${m.at !== undefined ? ` at ${m.at}` : ''}`;
  }
}

/** The document paths a mutation touches, id-anchored (set: its path; insert, remove, move: the item's id). */
export function touched(m: Mutation): string {
  return m.op === 'set' ? m.path : m.id;
}
