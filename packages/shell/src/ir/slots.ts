// Slots and binding times. Every option (slot) of every form declares when its value is read:
//
//   β     build      once, while the program builds (min, max, a list of sections)
//   τ     traced     a lambda of state, re-run when what it read changes (label, enabled, a readout)
//   bind  binding    a τ lambda naming one state path; two-way (bind: s => s.dev.light.exposure)
//   θ     per item   called with the real item when its row is drawn (cell: (photo, i) => …)
//   ƒ     helper     a pure function of the form's own value (format: v => v.toFixed(1)) or a mount function
//   ρ     runtime    handlers, called with ctx (run: ctx => …, drag: (e, ctx, g) => …)
//
// A slot descriptor carries its binding time at runtime and its value type as a phantom type, so TS variants
// get errors in the editor (a lambda in a β slot is a type error) and JS variants get the same checks at build.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Time = 'β' | 'τ' | 'bind' | 'θ' | 'ƒ' | 'ρ';

export interface Slot<T = unknown, B extends Time = Time> {
  readonly time: B;
  readonly doc?: string;
  /** a list slot: .slot(key, ...items) appends */
  readonly list?: boolean;
  /** phantom: the value type */
  readonly _t?: T;
}

const mk =
  <B extends Time>(time: B) =>
  <T>(doc?: string, list?: boolean): Slot<T, B> => {
    const s: { time: B; doc?: string; list?: boolean } = { time };
    if (doc) s.doc = doc;
    if (list) s.list = true;
    return s as Slot<T, B>;
  };
export const slot = {
  build: mk('β'),
  traced: mk('τ'),
  bind: mk('bind'),
  item: mk('θ'),
  helper: mk('ƒ'),
  handler: mk('ρ'),
};

export type NotFn<T> = T extends (...a: never[]) => unknown ? never : T;
type Plain = string | number | boolean | bigint | symbol | null | undefined | object;
/** a value, or a lambda of state (τ). For unknown value types the lambda still gets a typed state. */
export type Traced<S, T> = unknown extends T ? ((s: Readonly<S>) => unknown) | Plain : T | ((s: Readonly<S>) => T);
/** 'photo.pick' or ['photo.rate', 3] */
export type CommandRef = string | [string, ...unknown[]];

export type PropOf<D, S> =
  D extends Slot<infer T, 'β'>
    ? NotFn<T>
    : D extends Slot<infer T, 'τ'>
      ? Traced<S, T>
      : D extends Slot<infer T, 'bind'>
        ? ((s: S) => T) | string
        : D extends Slot<infer F, 'θ' | 'ƒ'>
          ? F
          : D extends Slot<unknown, 'ρ'>
            ? CommandRef | ((...args: any[]) => unknown)
            : never;
export type PropsOf<Slots, S> = { [K in keyof Slots]?: PropOf<Slots[K], S> };

export type SlotTable = Record<string, Slot<any, Time>>;

/** Options every form understands. */
export const commonSlots = {
  id: slot.build<string>('an id: data-ck-id, the key of view state the form keeps'),
  class: slot.build<string>('extra CSS classes'),
  tip: slot.traced<string>('tooltip'),
  hidden: slot.traced<boolean>(),
  enabled: slot.traced<boolean>('false greys it out (and why says why)'),
  why: slot.traced<string>('why it is not enabled'),
  keys: slot.build<Record<string, unknown>>('keys that apply while it has focus'),
  grow: slot.build<number | boolean>(),
  style: slot.build<Record<string, string | number>>(),
  label: slot.traced<string>(),
  key: slot.build<string>(),
  at: slot.build<string>(),
  width: slot.build<number | string>(),
  height: slot.build<number | string>(),
  help: slot.build<string>(),
  data: slot.build<unknown>(),
  lazy: slot.build<boolean>('skip the build-time binding check'),
} as const;

