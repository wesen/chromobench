// Proxies in and out of the state: the read-only view runtime handlers get (Store.readonly), and strip, which
// takes proxies (read-only or tracking) out of a value before it is written.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { isObj, overProxy, pathStr, type Key } from '../util.ts';
import { rawOf as trackedRaw } from '../track.ts';
import type { Store } from '../store.ts';

// State never holds proxies. A value written back may contain objects read through a proxy (ctx.state.spots
// .concat([spot]) yields the read-only proxies of the old spots): strip replaces them by the plain objects,
// walking only the new structure (plain state objects contain no proxies, so the walk stops at them).
const RO = Symbol('ck.readonly');
export function strip<T>(v: T, depth = 0): T {
  if (v === null || typeof v !== 'object') return v;
  const r = (v as any)[RO] || trackedRaw(v);
  if (r !== v) return r;
  if (depth > 12) return v;
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map(x => {
      const y = strip(x, depth + 1);
      if (y !== x) changed = true;
      return y;
    });
    return (changed ? out : v) as T;
  }
  if (Object.getPrototypeOf(v) !== Object.prototype) return v;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    const x = (v as any)[k];
    const y = strip(x, depth + 1);
    if (y !== x) changed = true;
    out[k] = y;
  }
  return (changed ? out : v) as T;
}

/** A read-only view of the state for runtime handlers: derived paths resolve, writes throw (CK-T410). */
export function readonlyView(store: Store): any {
  const wrap = (v: unknown, path: Key[]): any => {
    if (!isObj(v)) return v;
    return overProxy(v, {
      get(t: any, k, r) {
        if (k === RO) return t;
        if (typeof k === 'symbol') return Reflect.get(t, k, r);
        const kk: Key = Array.isArray(t) && /^\d+$/.test(k) ? +k : k;
        const child = path.concat([kk]);
        const d = store.derivedAt(child);
        if (d) return d.compute();
        const x = Reflect.get(t, k, r);
        return typeof x === 'function' ? x : wrap(x, child);
      },
      set(_t, k) {
        const e = new TypeError(`State is read-only in handlers: '${pathStr(path.concat([String(k)]))}' was not changed. Use ctx.tx(label, t => …).`);
        (e as any).code = 'CK-T410';
        throw e;
      },
      deleteProperty(_t, k) {
        const e = new TypeError(`State is read-only in handlers: '${pathStr(path.concat([String(k)]))}' was not deleted. Use ctx.tx(label, t => …).`);
        (e as any).code = 'CK-T410';
        throw e;
      },
    });
  };
  return wrap(store.current, []);
}
