// The path index: a trie of subscribers by path. A write marks everyone who read the written path, an ancestor
// of it, or something inside it.

import type { Path } from '../util.ts';

// ── the path index: a trie of subscribers ─────────────────────────────────
class TrieNode {
  kids = new Map<string, TrieNode>();
  subs: Set<unknown> | null = null;
}
export class PathIndex {
  root = new TrieNode();
  count = 0;
  add(path: Path, sub: unknown): void {
    let n = this.root;
    for (const k of path) {
      const kk = String(k);
      let c = n.kids.get(kk);
      if (!c) {
        c = new TrieNode();
        n.kids.set(kk, c);
      }
      n = c;
    }
    (n.subs || (n.subs = new Set())).add(sub);
    this.count++;
  }
  remove(path: Path, sub: unknown): void {
    const trail = [this.root];
    let n: TrieNode | undefined = this.root;
    for (const k of path) {
      n = n.kids.get(String(k));
      if (!n) return;
      trail.push(n);
    }
    if (n.subs && n.subs.delete(sub)) this.count--;
    // prune empty branches
    for (let i = trail.length - 1; i > 0; i--) {
      const x = trail[i]!;
      if ((x.subs && x.subs.size) || x.kids.size) break;
      trail[i - 1]!.kids.delete(String(path[i - 1]));
    }
  }
  /** everyone who read the written path, an ancestor of it, or something inside it */
  affected(path: Path, out: Set<unknown>): Set<unknown> {
    let n: TrieNode | undefined = this.root;
    if (n.subs) for (const s of n.subs) out.add(s);
    for (const k of path) {
      n = n.kids.get(String(k));
      if (!n) return out;
      if (n.subs) for (const s of n.subs) out.add(s);
    }
    const stack = [...n.kids.values()];
    while (stack.length) {
      const x = stack.pop()!;
      if (x.subs) for (const s of x.subs) out.add(s);
      for (const c of x.kids.values()) stack.push(c);
    }
    return out;
  }
}
