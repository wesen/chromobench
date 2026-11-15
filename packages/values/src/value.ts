// Value kinds: immutable values with `with`, chain methods defined as modifiers, provenance and explain.
//
//   const Layer = defineValue<LayerData>()('layer', { amount: (k: number) => amount(k), mask: (id: string) => … });
//   const l = Layer({ op: 'curve', amount: 1, mask: null });   // records the call site
//   l.amount(0.8)                                              // ≡ l.with(amount(0.8)): a new value
//
// A value holds deep-frozen data; modifiers act on the data, so the same modifier applies to a value and to the
// plain record a document stores. Every `with` is recorded (modifier and call site) for explain.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { EXPLAIN, atField, explain, type Explainable } from './explain.ts';
import { deepFreeze, type Frozen, type Json, type JsonObject } from './json.ts';
import { toModifier, type Modifier, type With } from './modifier.ts';
import { site, type CallSite } from './site.ts';

const VALUE = Symbol.for('chromobench.value');

/** One `with` in a value's history. */
export interface TrailStep {
  readonly modifier: Modifier<any>;
  readonly at: CallSite | null;
}

export interface Value<D extends object> extends Explainable {
  readonly kind: string;
  readonly data: Frozen<D>;
  /** where the value was first built */
  readonly at: CallSite | null;
  /** the modifiers applied since, in order */
  readonly trail: readonly TrailStep[];
  /** a new value: the modifier (or function, or shallow patch) applied to the data */
  with(x: With<D>): this;
  /** the data (JSON.stringify writes a value as its data) */
  toJSON(): Frozen<D>;
}

export type Methods<D> = Record<string, (...args: any[]) => Modifier<D>>;

/** A value of a kind with chain methods: each method returns the value with its modifier applied. */
export type ValueOf<D extends object, M extends Methods<D>> = Value<D> & {
  readonly [K in keyof M]: (...args: Parameters<M[K]>) => ValueOf<D, M>;
};

export interface ValueKind<D extends object, M extends Methods<D>> {
  /** build a value from data (normalised, then deep-frozen) */
  (data: D): ValueOf<D, M>;
  readonly kind: string;
  /** the modifier factories behind the chain methods */
  readonly methods: M;
  is(v: unknown): v is ValueOf<D, M>;
}

export interface ValueOptions<D> {
  /** complete or check the data of every value, after building and after every `with` (throw to refuse) */
  normalize?: (d: D) => D;
  /** how `with(patch)` merges a patch (default: shallow spread) */
  patch?: (d: D, p: Partial<D>) => D;
  /** extra fields for explain (binding times, compiled node ids…) */
  explain?: (data: Frozen<D>) => JsonObject;
}

const RESERVED = new Set(['kind', 'data', 'at', 'trail', 'with', 'toJSON', 'constructor']);

/**
 * Define a kind of value. Curried so that D is given and M inferred: `defineValue<LayerData>()('layer', methods)`.
 */
export function defineValue<D extends object>() {
  return function kindOf<M extends Methods<D>>(kind: string, methods: M, opts: ValueOptions<D> = {}): ValueKind<D, M> {
    const proto: Record<string | symbol, unknown> = {};
    const norm = (d: D): Frozen<D> => deepFreeze(opts.normalize ? opts.normalize(d) : d);
    const build = (data: Frozen<D>, at: CallSite | null, trail: readonly TrailStep[]): ValueOf<D, M> => {
      const v = Object.create(proto) as Record<string, unknown>;
      v['kind'] = kind;
      v['data'] = data;
      v['at'] = at;
      v['trail'] = Object.freeze(trail);
      return Object.freeze(v) as unknown as ValueOf<D, M>;
    };
    proto[VALUE] = kind;
    proto['with'] = function (this: Value<D>, x: With<D>) {
      const m = toModifier<D>(x, opts.patch);
      return build(norm(m.run(this.data as D)), this.at, [...this.trail, { modifier: m, at: site() }]);
    };
    proto['toJSON'] = function (this: Value<D>) {
      return this.data;
    };
    proto[EXPLAIN] = function (this: Value<D>): Json {
      return {
        kind,
        ...atField(this.at),
        data: explain(this.data),
        ...(this.trail.length ? { built: this.trail.map((s) => ({ ...atField(s.at), modifier: s.modifier[EXPLAIN]() })) } : {}),
        ...(opts.explain ? opts.explain(this.data) : {}),
      };
    };
    for (const [name, factory] of Object.entries(methods)) {
      if (RESERVED.has(name)) throw new TypeError(`defineValue(${kind}): "${name}" is reserved and cannot be a chain method`);
      proto[name] = function (this: Value<D>, ...args: unknown[]) {
        return this.with(factory(...args));
      };
    }
    Object.freeze(proto);
    const make = (data: D): ValueOf<D, M> => build(norm(data), site(), []);
    return Object.freeze(Object.assign(make, {
      kind,
      methods,
      is: (v: unknown): v is ValueOf<D, M> => typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === proto,
    })) as ValueKind<D, M>;
  };
}

/** Whether v is a value of any kind. */
export function isValue(v: unknown): v is Value<object> {
  return typeof v === 'object' && v !== null && typeof (v as Record<symbol, unknown>)[VALUE] === 'string';
}

/** A value's data; anything else unchanged (so mutations accept values where they take data). */
export function dataOf<T>(v: T): unknown {
  return isValue(v) ? v.data : v;
}
