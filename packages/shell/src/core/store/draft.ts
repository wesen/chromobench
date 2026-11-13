// The draft a transaction (ctx.tx) hands to its lambda: writes go to a copy of the document and are recorded
// per path with their before value; patches() collapses them for the history entry.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { isObj, pathStr, parsePath, getIn, setIn, prefixOf, type Key, type Path } from '../util.ts';
import type { Store } from '../store.ts';
import { strip } from './readonly.ts';
import type { Patch } from './types.ts';

// ── drafts: what ctx.tx hands to its lambda ──────────────────────────────
// t.develop.light.exposure = 0.3 · t.catalog.photos[3].flag = 'pick' · t.$set(path, v) · t.$update(path, f)
// t.$merge(path, obj) · t.$push(path, ...items) · t.$remove(path, pred) · array methods on draft arrays
const MUTATING = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);
export class Draft {
  next: any;
  writes = new Map<string, { path: Key[]; before: unknown }>();
  readonly store: Store;
  constructor(store: Store) {
    this.store = store;
    this.next = store.doc;
  }
  read(path: Key[]): any {
    const d = this.store.derivedAt(path);
    if (d) return d.compute();
    return getIn(this.next, path);
  }
  write(path: Key[], value: unknown): void {
    value = strip(value);
    const k = pathStr(path);
    // a write inside a path written earlier, or above it, is fine: keep the earliest 'before' per exact path
    if (!this.writes.has(k)) this.writes.set(k, { path, before: getIn(this.store.doc, path) });
    this.next = setIn(this.next, path, value);
  }
  patches(): Patch[] {
    // collapse: if both a path and its ancestor were written, keep the ancestor's write only
    const list = [...this.writes.values()].sort((a, b) => a.path.length - b.path.length);
    const kept: typeof list = [];
    for (const w of list) if (!kept.some(k => prefixOf(k.path, w.path))) kept.push(w);
    return kept.map(w => ({ path: w.path, before: w.before, after: getIn(this.next, w.path) })).filter(p => p.before !== p.after);
  }
  proxy(path: Key[] = []): any {
    const d = this;
    const target = function () {};
    return new Proxy(target, {
      get(_t, k) {
        if (k === '$set') return (p: string | Path, v: unknown) => d.write(path.concat(parsePath(p)), v);
        if (k === '$update')
          return (p: string | Path, f: (x: any) => unknown) => {
            const pp = path.concat(parsePath(p));
            d.write(pp, f(d.read(pp)));
          };
        if (k === '$merge')
          return (p: string | Path, o: object) => {
            const pp = path.concat(parsePath(p));
            const cur = d.read(pp);
            d.write(pp, Object.assign({}, cur, o));
          };
        if (k === '$push')
          return (p: string | Path, ...items: unknown[]) => {
            const pp = path.concat(parsePath(p));
            d.write(pp, (d.read(pp) || []).concat(items));
          };
        if (k === '$remove')
          return (p: string | Path, pred: (x: any, i: number) => boolean) => {
            const pp = path.concat(parsePath(p));
            d.write(
              pp,
              (d.read(pp) || []).filter((x: any, i: number) => !pred(x, i)),
            );
          };
        if (k === '$get') return (p?: string | Path) => d.read(path.concat(parsePath(p == null ? [] : p)));
        if (k === '$path') return path;
        if (k === '$value') return d.read(path);
        if (typeof k === 'symbol') {
          const v = d.read(path);
          return v == null ? undefined : v[k];
        }
        const cur = d.read(path);
        if (Array.isArray(cur)) {
          if (k === 'length') return cur.length;
          if (MUTATING.has(k))
            return (...args: unknown[]) => {
              const copy: any = cur.slice();
              const r = copy[k](...args);
              d.write(path, copy);
              return r;
            };
          if (typeof (Array.prototype as any)[k] === 'function' && !/^\d+$/.test(k)) {
            const els = cur.map((x, i) => (isObj(x) ? d.proxy(path.concat([i])) : x));
            return (...args: unknown[]) => (Array.prototype as any)[k].apply(els, args);
          }
        }
        const kk: Key = Array.isArray(cur) && /^\d+$/.test(k) ? +k : k;
        const child = path.concat([kk]);
        const v = d.read(child);
        return isObj(v) ? d.proxy(child) : v;
      },
      set(_t, k, v) {
        const cur = d.read(path);
        const kk: Key = Array.isArray(cur) && typeof k === 'string' && /^\d+$/.test(k) ? +k : (k as string);
        d.write(path.concat([kk]), v && v.$path && v.$value !== undefined ? v.$value : v);
        return true;
      },
      deleteProperty(_t, k) {
        d.write(path.concat([k as string]), undefined);
        return true;
      },
      has(_t, k) {
        const cur = d.read(path);
        return isObj(cur) && k in cur;
      },
      ownKeys() {
        const cur = d.read(path);
        return isObj(cur) ? Reflect.ownKeys(cur).concat(['prototype']).filter((x, i, a) => a.indexOf(x) === i) : ['prototype'];
      },
      getOwnPropertyDescriptor(t, k) {
        if (k === 'prototype') return Reflect.getOwnPropertyDescriptor(t, k);
        const cur = d.read(path);
        if (!isObj(cur) || !(k in cur)) return undefined;
        return { value: cur[k as string], writable: true, enumerable: true, configurable: true };
      },
    });
  }
}
