// Builder values (CHB-035 design §30): the shell, its modules and its kits are immutable values like nodes. A value
// holds frozen data; every chain method is a modifier on that data, applied with `with` (`s.theme('x')` ≡
// `s.with(shellMods.theme('x'))`), and returns a new value. `with` takes a modifier (it acts on the data), a function
// of the value (it returns a value of the same kind), or a patch of the data. Every `with` is recorded (its modifier
// and call site) for explain. Builder fragments registered with ck.extend add chain methods (they return what `with`
// takes). An unknown method throws CK-X120 with "did you mean" where it is called.
//
// The containers a builder makes (its data object, the lists it appends to) are frozen; what the program puts in
// (an initial state, a command's spec, a node) is the program's.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { EXPLAIN, explain, isModifier, isPlainObject, modifier, site, type CallSite, type Json, type Modifier } from '@chromobench/values';
import { BuildError, diag } from '../core/diag.ts';
import { suggest } from '../core/util.ts';
import type { Fragment } from './types.ts';

export interface TrailStep {
  readonly name: string;
  readonly at: CallSite | null;
}

/** What every builder value has. */
export interface Built<D> {
  readonly kind: string;
  readonly data: D;
  /** where the value was first built */
  readonly at: CallSite | null;
  /** the modifiers applied since, by name and call site */
  readonly trail: readonly TrailStep[];
}

/** What `.with(x)` takes on a builder value V with data D. */
export type BuilderWith<D, V> = Modifier<D> | ((v: V) => V) | Partial<D>;

const PROBES = new Set(['then', 'catch', 'finally', 'toJSON', 'toString', 'valueOf', 'constructor', 'asymmetricMatch', 'nodeType', 'tagName', 'inspect', 'length', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'kind', 'form', 'spec', 'isCommand', 'name', 'def']);
const isMethodName = (k: string): boolean => /^[a-zA-Z][A-Za-z0-9_]*$/.test(k) && !PROBES.has(k);
const KIND = Symbol.for('ck.builder.kind');

/** freeze a value's data and the lists and records directly under it (the containers a builder made; not `init`) */
export function freezeData<D extends object>(d: D): D {
  for (const [k, v] of Object.entries(d)) if (k !== 'init' && (Array.isArray(v) || isPlainObject(v))) Object.freeze(v);
  return Object.freeze(d);
}

export interface KindSpec<D extends object> {
  /** the chain methods: modifier factories on the data */
  methods: Record<string, (...a: any[]) => Modifier<D>>;
  /** methods that are not modifiers (build, the explain text…) */
  extra?: Record<string, (this: any, ...a: any[]) => unknown>;
  /** builder fragments (ck.extend) for this kind: their methods return what `with` takes */
  fragments?: () => readonly Fragment[];
  /** the fragment target name ('shell', 'module') */
  target?: string;
  /** fields computed from the data onto every value (a kit's name and def) */
  derived?: (d: D) => Record<string, unknown>;
  explain?: (d: D) => Json;
}

/** A kind of builder value, per ck instance (its prototype carries the instance's builder fragments). */
export class BuilderKind<D extends object, V extends Built<D>> {
  readonly kind: string;
  private readonly spec: KindSpec<D>;
  private proto: object | null = null;
  constructor(kind: string, spec: KindSpec<D>) {
    this.kind = kind;
    this.spec = spec;
  }
  /** after ck.extend: values made from now on answer the new methods */
  invalidate(): void {
    this.proto = null;
  }
  /** a value from data (frozen), first built at `at` */
  make(data: D, at: CallSite | null = site(), trail: readonly TrailStep[] = []): V {
    const v = Object.create(this.protoOf()) as Record<string, unknown>;
    v['kind'] = this.kind;
    v['data'] = freezeData(data);
    v['at'] = at;
    v['trail'] = Object.freeze(trail.slice());
    for (const [k, x] of Object.entries(this.spec.derived?.(v['data'] as D) ?? {})) v[k] = x;
    return Object.freeze(v) as unknown as V;
  }
  is(v: unknown): v is V {
    return !!v && typeof v === 'object' && (v as any)[KIND] === this;
  }
  /** the method names a value answers (for "did you mean") */
  names(): string[] {
    return ['with', ...Object.keys(this.spec.methods), ...Object.keys(this.spec.extra || {}), ...this.fragmentMethods().map(([n]) => n)];
  }
  private fragmentMethods(): [string, (...a: any[]) => unknown][] {
    const out: [string, (...a: any[]) => unknown][] = [];
    for (const f of this.spec.fragments?.() ?? []) if (f.target === this.spec.target) for (const [n, m] of Object.entries(f.spec.methods || {})) out.push([n, m]);
    return out;
  }
  private protoOf(): object {
    if (this.proto) return this.proto;
    const self = this;
    const guard = new Proxy(Object.create(Object.prototype) as object, {
      get(t, k, r) {
        if (typeof k === 'symbol' || !isMethodName(k) || k in t) return Reflect.get(t, k, r);
        return () => {
          const s = suggest(k, self.names());
          throw new BuildError(
            diag('CK-X120', `No method .${k}() on ${self.spec.target ? `the ${self.spec.target}` : self.kind}`, {
              at: site(),
              facts: [`${self.kind} offers: ${self.names().slice(0, 24).join(', ')}`],
              fix: s.length ? `Did you mean .${s[0]}()?` : 'Register the builder fragment that adds it with ck.extend(…) first, or remove the call.',
            }),
          );
        };
      },
    });
    const p = Object.create(guard) as Record<string | symbol, unknown>;
    p[KIND] = this;
    p['with'] = function (this: V, x: BuilderWith<D, V>) {
      return self.apply(this, x);
    };
    for (const [name, factory] of Object.entries(this.spec.methods))
      p[name] = function (this: V, ...args: unknown[]) {
        return self.apply(this, factory(...args));
      };
    for (const [name, m] of this.fragmentMethods())
      p[name] = function (this: V, ...args: unknown[]) {
        return self.apply(this, m(...args) as BuilderWith<D, V>);
      };
    for (const [name, f] of Object.entries(this.spec.extra || {})) p[name] = f;
    p[EXPLAIN] = function (this: V): Json {
      return {
        kind: self.kind,
        ...(this.at ? { at: `${this.at.file}:${this.at.line}:${this.at.col}` } : {}),
        data: self.spec.explain ? self.spec.explain(this.data) : explain(this.data),
        ...(this.trail.length ? { built: this.trail.map(t => ({ modifier: t.name, ...(t.at ? { at: `${t.at.file}:${t.at.line}:${t.at.col}` } : {}) })) } : {}),
      };
    };
    p['toJSON'] = function (this: V) {
      return { kind: self.kind, name: (this.data as any).name ?? (this.data as any).id };
    };
    this.proto = Object.freeze(p);
    return this.proto;
  }
  /** apply what `with` takes: a modifier on the data, a function of the value, or a patch of the data */
  apply(v: V, x: BuilderWith<D, V>): V {
    const at = site();
    if (isModifier(x)) return this.make((x as Modifier<D>).run(v.data), v.at, [...v.trail, { name: (x as Modifier<D>).name, at }]);
    if (typeof x === 'function') {
      const r = (x as (v: V) => V)(v);
      if (!this.is(r)) throw new TypeError(`.with(fn): the function must return a ${this.kind}, not ${r === null ? 'null' : typeof r}`);
      return r;
    }
    if (isPlainObject(x)) return this.make({ ...v.data, ...(x as Partial<D>) }, v.at, [...v.trail, { name: 'with', at }]);
    throw new TypeError(`.with() takes a modifier, a function or a plain object, not ${x === null ? 'null' : typeof x}`);
  }
}

/** a modifier on a record that appends to one of its lists */
export const push = <D>(name: string, key: keyof D & string, ...items: unknown[]): Modifier<D> =>
  modifier<D>(name, d => ({ ...d, [key]: [...((d as any)[key] as unknown[]), ...items] }), items);
/** a modifier that sets one field */
export const put = <D>(name: string, key: keyof D & string, value: unknown): Modifier<D> => modifier<D>(name, d => ({ ...d, [key]: value }), [value]);
