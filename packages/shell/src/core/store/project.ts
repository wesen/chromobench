// How the log's documents appear in the state tree. The main document (the program's own document state) sits at
// the root, around the view tier and the mounted documents; a mounted document (a frame) sits at its path. After the
// log changes, each document that changed is projected into the tree along the paths where it differs, and readers
// are told exactly those paths.

import { isPlainObject, type Key, type Path, getIn, setIn, prefixOf } from '../util.ts';

/** The id of the program's own document in the store's log. */
export const MAIN = 'main';

/** The paths where a and b differ, as deep as both are objects (or arrays of one length) there. */
export function changedPaths(a: unknown, b: unknown, at: Key[] = [], out: Key[][] = []): Key[][] {
  if (a === b) return out;
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) changedPaths(a[k], b[k], [...at, k], out);
  } else if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    a.forEach((x, i) => changedPaths(x, b[i], [...at, i], out));
  } else out.push(at);
  return out;
}

/**
 * Write b's values at the given paths into the tree, then put back what other tiers hold strictly below them
 * (`keep`: view-tier prefixes and mounted documents, which the main document never holds).
 */
export function project(tree: unknown, base: Path, paths: readonly Key[][], b: unknown, keep: readonly Path[]): unknown {
  const before = tree;
  let t = tree;
  for (const p of paths) t = setIn(t, [...base, ...p], getIn(b, p));
  for (const k of keep) {
    if (!paths.some(p => p.length + base.length < k.length && prefixOf([...base, ...p], k))) continue;
    t = setIn(t, k, getIn(before, k));
  }
  return t;
}
