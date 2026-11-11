// React bindings to the framework-free core: a component re-renders only when its slice changes.
import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import type { Studio, StudioState } from '../core/studio.ts';
import type { Store } from '../core/store.ts';

export const StudioContext = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const s = useContext(StudioContext);
  if (!s) throw new Error('no studio');
  return s;
}

/** Subscribes to a store through a selector; shallow-equal arrays/objects do not re-render. */
export function useStore<T, U>(store: Store<T>, select: (t: T) => U): U {
  const cache = useRef<{ in: T; out: U } | null>(null);
  const get = (): U => {
    const v = store.get();
    if (cache.current && cache.current.in === v) return cache.current.out;
    const out = select(v);
    if (cache.current && shallowEqual(cache.current.out, out)) {
      cache.current = { in: v, out: cache.current.out };
      return cache.current.out;
    }
    cache.current = { in: v, out };
    return out;
  };
  return useSyncExternalStore(store.subscribe, get, get);
}

export function useStudioState<U>(select: (s: StudioState) => U): U {
  return useStore(useStudio().state, select);
}

/** Re-renders on every edit-log event of the open frame. */
export function useLogVersion(): number {
  const st = useStudio();
  return useStore(st.logSignal, (n) => n);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
