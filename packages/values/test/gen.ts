// The random documents and mutations of the property tests (seeded: the same seed gives the same sequence).
import { Coll, document, getPath, indexOf, insert, move, remove, set, unset, type Mutation } from '../src/index.ts';
import type { Rng } from './rng.ts';

export interface Gen {
  r: Rng;
  next: number;
}
export const fresh = (g: Gen): string => `n${g.next++}`;

export function entry(g: Gen, depth: number): unknown {
  if (depth < 3 && g.r.chance(0.3)) {
    const kids: [string, unknown][] = [];
    for (let i = g.r.int(4); i > 0; i--) kids.push([fresh(g), entry(g, depth + 1)]);
    return { kind: 'group', amount: g.r.int(10) / 10, stack: Coll.of(kids) };
  }
  return { kind: 'layer', amount: g.r.int(10) / 10, params: { ev: g.r.int(7) - 3, rgb: [g.r(), g.r(), g.r()] }, ...(g.r.chance(0.3) ? { note: 'n' } : {}) };
}
const coll = (g: Gen, n: number, depth = 0): Coll<unknown> => Coll.of(Array.from({ length: g.r.int(n + 1) }, () => [fresh(g), entry(g, depth)] as const));

export function randomDoc(g: Gen): object {
  return document({
    title: 'frame',
    settings: { a: g.r.int(5), b: [1, 2, 3] },
    stages: { one: { stack: coll(g, 4) }, two: { stack: coll(g, 3) } },
    lib: Coll.of(Array.from({ length: g.r.int(3) }, () => [fresh(g), { v: g.r.int(9) }] as const)),
  });
}

/** Every collection path of a document (roots and groups' stacks). */
export function colls(d: object): string[] {
  const out = ['stages.one.stack', 'stages.two.stack', 'lib'];
  for (const id of indexOf(d).ids()) if (Coll.is(getPath(d, `${id}.stack`))) out.push(`${id}.stack`);
  return out;
}

export function randomMutation(g: Gen, d: object): Mutation {
  const { r } = g;
  const ids = indexOf(d).ids().sort();
  const id = ids.length ? r.pick(ids) : 'none';
  const k = r.int(ids.length ? 12 : 3);
  switch (k) {
    case 0: return set('settings.a', r.int(100));
    case 1: return set('title', r.pick(['a', 'b']));
    case 2: return insert(r.pick(colls(d)), fresh(g), entry(g, 1), r.chance(0.5) ? undefined : r.int(4));
    case 3: return set(`${id}.amount`, r.int(10) / 10);
    case 4: return set(`${id}.params.rgb.${r.int(3)}`, r());
    case 5: return r.chance(0.5) ? set(`${id}.note`, 'x') : unset(`${id}.note`);
    case 6: return set(id, entry(g, 2));
    case 7: return set('stages.two.stack', coll(g, 2, 1));
    case 8: return remove(id);
    case 9: return move(id, { at: r.int(3) });
    default: return move(id, { into: r.pick(colls(d)), ...(r.chance(0.5) ? { at: r.int(3) } : {}) });
  }
}

