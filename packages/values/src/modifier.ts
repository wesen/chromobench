// Modifiers: named, explainable functions from a value to a value of the same kind (design §30). A modifier is a
// sequence of atoms; `then` concatenates sequences, so it is associative and `identity()` is its unit, both by
// value and by structure. A named composite (`m.named('soft')`) becomes one atom of its own.
//
// Typing: `Modifier<T>` applies to anything that is at least a T and returns the same type, so `field('amount')`
// gives a `Modifier<{ amount: number }>` that applies to a layer, a group or any record with an amount. A modifier
// must return a value of the kind it received (a copy with some fields changed); it must not mutate its input.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { EXPLAIN, atField, explain, type Explainable } from './explain.ts';
import { isPlainObject, type Json } from './json.ts';
import { site, type CallSite } from './site.ts';

const MOD = Symbol.for('chromobench.modifier');

export interface Modifier<T> extends Explainable {
  readonly [MOD]: true;
  /** the atom's name; a composite's is its atoms' names joined by ' · ' */
  readonly name: string;
  /** the arguments the atom was made with (for explain) */
  readonly args: readonly unknown[];
  /** where the atom was made (null for composites and when capture is off) */
  readonly at: CallSite | null;
  /** the atoms, in order: [] for identity, [this] for an atom */
  readonly steps: readonly Modifier<any>[];
  /** apply to one value */
  run<V extends T>(v: V): V;
  /** this, then next */
  then<U>(next: Modifier<U>): Modifier<T & U>;
  /** the same function as one named atom (its steps stay visible in explain) */
  named(name: string): Modifier<T>;
}

interface Atom {
  name: string;
  args: readonly unknown[];
  at: CallSite | null;
  fn: (v: any) => any;
  /** a named composite: the atoms it was made of */
  of?: readonly Modifier<any>[];
}

function make<T>(atom: Atom | null, steps: readonly Modifier<any>[] | null): Modifier<T> {
  let own: readonly Modifier<any>[] | null = null;
  const self: Modifier<T> = Object.freeze({
    [MOD]: true as const,
    name: atom ? atom.name : steps!.length ? steps!.map((s) => s.name).join(' · ') : 'identity',
    args: atom ? atom.args : [],
    at: atom ? atom.at : null,
    get steps(): readonly Modifier<any>[] {
      return atom ? (own ??= Object.freeze([self])) : steps!;
    },
    run<V extends T>(v: V): V {
      if (atom) return atom.fn(v);
      let x: any = v;
      for (const s of steps!) x = s.run(x);
      return x;
    },
    then<U>(next: Modifier<U>): Modifier<T & U> {
      return sequence<T & U>([...self.steps, ...next.steps]);
    },
    named(name: string): Modifier<T> {
      return make<T>({ name, args: [], at: site(), fn: (v) => self.run(v), of: self.steps }, null);
    },
    [EXPLAIN](): Json {
      if (atom) {
        return {
          kind: 'modifier', name: atom.name,
          ...(atom.args.length ? { args: explain(atom.args) } : {}),
          ...atField(atom.at),
          ...(atom.of ? { of: atom.of.map((s) => s[EXPLAIN]()) } : {}),
        };
      }
      return { kind: 'modifier', name: self.name, steps: steps!.map((s) => s[EXPLAIN]()) };
    },
  });
  return self;
}

function sequence<T>(steps: readonly Modifier<any>[]): Modifier<T> {
  if (steps.length === 0) return IDENTITY as Modifier<T>;
  if (steps.length === 1) return steps[0] as Modifier<T>;
  return make<T>(null, Object.freeze(steps.slice()));
}

const IDENTITY: Modifier<unknown> = make<unknown>(null, Object.freeze([]));

/** A named modifier. `args` are shown by explain; `fn` must return a new value and leave its input alone. */
export function modifier<T>(name: string, fn: (v: T) => T, args: readonly unknown[] = []): Modifier<T> {
  return make<T>({ name, args: Object.freeze(args.slice()), at: site(), fn }, null);
}

/** The modifier that changes nothing: the unit of `then`. */
export function identity<T = unknown>(): Modifier<T> {
  return IDENTITY as Modifier<T>;
}

export function isModifier(v: unknown): v is Modifier<unknown> {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[MOD] === true;
}

/** ms[0], then ms[1], … (identity for none). */
export function compose<T>(...ms: Modifier<T>[]): Modifier<T> {
  return sequence<T>(ms.flatMap((m) => m.steps));
}

/** Apply modifiers in order. */
export function apply<T>(v: T, ...ms: Modifier<T>[]): T {
  let x = v;
  for (const m of ms) x = m.run(x);
  return x;
}

/** A modifier factory for one field of a plain record: `const amount = field('amount'); amount(0.8)`. */
export function field<K extends string>(key: K): <V>(value: V) => Modifier<{ [P in K]: V }> {
  return <V>(value: V) => modifier<{ [P in K]: V }>(key, (d) => ({ ...d, [key]: value }), [value]);
}

/** A modifier that merges a patch into a plain record (shallow). */
export function assign<P extends object>(patch: P, name = 'with'): Modifier<P> {
  return modifier<P>(name, (d) => ({ ...d, ...patch }), [patch]);
}

/** What `.with(x)` accepts: a modifier, a plain function (named after itself, or 'λ') or a patch. */
export type With<T> = Modifier<T> | ((v: T) => T) | Partial<T>;

/**
 * Normalise what `.with(x)` received into a modifier. A patch is merged by `patch` (default: a shallow spread, for
 * plain records); pass your own for values that are not plain records (a UI node merges into its props).
 */
export function toModifier<T>(x: With<T>, patch?: (v: T, p: Partial<T>) => T): Modifier<T> {
  if (isModifier(x)) return x as Modifier<T>;
  if (typeof x === 'function') return modifier<T>(x.name || 'λ', x as (v: T) => T);
  if (isPlainObject(x)) {
    const p = x as Partial<T>;
    return modifier<T>('with', patch ? (v) => patch(v, p) : (v) => ({ ...v, ...p }), [p]);
  }
  throw new TypeError(`.with() takes a modifier, a function or a plain object, not ${x === null ? 'null' : typeof x}`);
}
