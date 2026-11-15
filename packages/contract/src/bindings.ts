// Bindings (contract 1.0, design §28, §31): a parameter computed at compile time by a registered, pure, versioned
// function: `{ bind: 'grain.fromIso', version: 1, args: {}, reads?: 'negative' }`. The compiler calls it with the
// frame's facts and, when the function measures an image, the measurement of a cut strictly upstream of where the
// value is used, so a binding can never depend on its own output. Results are cached by the hash of their inputs.
import { canonicalJSON, isPlainObject, type Json, type JsonObject } from '@chromobench/values';
import type { BindingRef } from './document.ts';
import { fail } from './errors.ts';
import type { SourceInfo } from './source.ts';

/** What a binding may know about the frame besides the image (EXIF via the source, the roll, analysis results). */
export interface FrameFacts {
  source?: SourceInfo;
  roll?: string;
  [k: string]: unknown;
}

export interface BindingDef {
  name: string;
  version: number;
  doc: string;
  /** The measurement a binding reads, on the cut its reference names (`reads`); absent: facts only. */
  measure?: { op: string; args?: JsonObject };
  /** Pure and deterministic: the same args, facts and measurement give the same value. */
  fn(args: JsonObject, input: { facts: FrameFacts; measured?: Json }): Json;
}

const BINDINGS = new Map<string, BindingDef>();
const CACHE = new Map<string, Json>();

export function defineBinding(def: BindingDef): BindingDef {
  const key = `${def.name}@${def.version}`;
  if (BINDINGS.has(key)) fail('E_BINDING', `binding ${key} is already defined`);
  const frozen = Object.freeze({ ...def });
  BINDINGS.set(key, frozen);
  return frozen;
}

export function getBinding(name: string, version: number): BindingDef {
  return BINDINGS.get(`${name}@${version}`) ?? fail('E_BINDING', `unknown binding ${name}@${version}`, { valid: [...BINDINGS.keys()] });
}

export function allBindings(): BindingDef[] {
  return [...BINDINGS.values()];
}

/** Whether a stored value is a binding reference rather than a literal. */
export function isBindingRef(v: unknown): v is BindingRef {
  return isPlainObject(v) && typeof v['bind'] === 'string' && typeof v['version'] === 'number'
    && Object.keys(v).every((k) => k === 'bind' || k === 'version' || k === 'args' || k === 'reads');
}

/** Calls a binding (cached by the canonical hash of its inputs). */
export function callBinding(ref: BindingRef, facts: FrameFacts, measured?: Json): Json {
  const def = getBinding(ref.bind, ref.version);
  const key = canonicalJSON({ b: `${ref.bind}@${ref.version}`, a: ref.args ?? {}, f: facts as unknown as Json, m: measured ?? null });
  const hit = CACHE.get(key);
  if (hit !== undefined) return hit;
  const v = def.fn(ref.args ?? {}, { facts, ...(measured !== undefined ? { measured } : {}) });
  if (CACHE.size > 1000) CACHE.clear();
  CACHE.set(key, v);
  return v;
}
