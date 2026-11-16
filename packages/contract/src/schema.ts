// The field schema of a document's fixed parts (media, geometry, output) and the check of layer params, mask
// component params and binding references. A field that an op argument consumes takes that argument's ArgSpec
// (`arg(op, name)`), so a value valid in the document is valid in the graph; the others carry their own.
import { Coll, isPlainObject, type JsonObject } from '@chromobench/values';
import { isBindingRef, getBinding } from './bindings.ts';
import {
  CUT_NAMES, FILM_FORMATS, KNEE_METHODS, OUTPUT_SPACES, readableCuts, type FrameKind, type StageName,
} from './document.ts';
import { diag, isChromobenchError, type Diagnostic } from './errors.ts';
import { closest, getOp, type OpDef } from './registry.ts';
import { checkArgValue, type ArgSpec } from './spec.ts';

/** A leaf with its own check (a union the ArgSpec types cannot say). */
export interface CustomRule { check: (v: unknown) => string | null; doc: string }
export type FieldRule = ArgSpec | CustomRule | Schema;
export interface Schema { readonly [k: string]: FieldRule }

const isSpec = (r: FieldRule): r is ArgSpec => typeof (r as ArgSpec).type === 'string' && typeof (r as ArgSpec).doc === 'string';
const isCustom = (r: FieldRule): r is CustomRule => typeof (r as CustomRule).check === 'function';

/** An op argument's spec, as a document field (nullable when `nullable`: the field stores null for "none"). */
function arg(op: string, name: string, over: Partial<ArgSpec> = {}): ArgSpec {
  const s = getOp(op).args[name];
  if (!s) throw new Error(`schema: ${op} has no argument ${name}`);
  const { default: _d, ...rest } = s;
  return { ...rest, ...over };
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const custom = (doc: string, check: (v: unknown) => string | null): CustomRule => ({ doc, check });
const boxOr = (v: unknown, also: unknown[]): boolean => also.includes(v) || (isPlainObject(v) && Object.keys(v).sort().join() === 'h,w,x,y' && ['x', 'y', 'w', 'h'].every((k) => fin(v[k])));
const knee = (): Schema => ({
  method: { type: 'enum', values: [...KNEE_METHODS], doc: 'Gamut compression method.' },
  strength: { type: 'number', unit: 'none', min: 0, max: 20, doc: 'Knee strength (p for oklch, s for tanh-shoulder).' },
});

let cache: { media: Record<StageName, Schema>; geometry: Schema; output: Schema } | null = null;

/** The schemas (built on first use, after the catalog is registered). */
export function schemas(): { media: Record<StageName, Schema>; geometry: Schema; output: Schema } {
  if (cache) return cache;
  cache = {
    media: {
      scan: {
        scanner: arg('invert.dyes', 'scanner'),
        stock: arg('invert.dyes', 'stock'),
        format: { type: 'enum', values: [...FILM_FORMATS], doc: 'Film format.' },
        umPerPx: arg('source.open', 'umPerPx'),
        rebate: arg('scan.density', 'rebate'),
        baseT: arg('scan.density', 'baseT'),
        flat: arg('scan.flatField', 'flat'),
        openGate: custom('a box, "flat" or null (document px)', (v) => (boxOr(v, [null, 'flat']) ? null : 'expected a box, "flat" or null')),
        flare: arg('scan.flare', 'flare'),
      },
      scene: { whiteBalance: { temperature_K: arg('source.xyz', 'temperature_K'), tint: arg('source.xyz', 'tint') } },
      film: {
        stock: arg('capture.expose', 'stock'),
        exposureEV: arg('capture.expose', 'exposureEV'),
        format: { longEdge_mm: { type: 'number', unit: 'mm', min: 10, max: 300, doc: 'Long edge of the simulated film format; over the source\'s long side it is the film pitch.' } },
        push: arg('film.develop', 'push'),
        dir: { amount: arg('film.couple', 'amount'), diffusion_um: arg('film.couple', 'diffusion_um') },
        halation: { strength: arg('film.halation', 'strength') },
        grain: { amount: arg('film.grain', 'amount'), size_um: arg('film.grain', 'size_um'), seed: arg('film.grain', 'seed') },
      },
      darkroom: {
        paper: arg('print.expose', 'paper'),
        aim: arg('print.expose', 'aim'),
        mode: arg('print.expose', 'mode'),
        lamp: arg('print.expose', 'lamp'),
        magnification: arg('print.expose', 'magnification'),
        grade: arg('print.develop', 'grade'),
      },
      print: { illuminant: arg('view.reflect', 'illuminant'), flare: arg('view.flare', 'flare') },
    },
    geometry: {
      orientation: arg('output.frame', 'orientation'),
      angle_deg: arg('output.frame', 'angle_deg'),
      crop: arg('output.frame', 'crop'),
    },
    output: {
      rendering: arg('output.display', 'rendering'),
      white: arg('view.adapt', 'to'),
      display: { knee: knee(), proof: custom('ProofSettings or null', (v) => (v === null || isPlainObject(v) ? null : 'expected ProofSettings or null')) },
      export: {
        format: arg('output.encode', 'format'),
        space: { type: 'enum', values: [...OUTPUT_SPACES], doc: 'Export colour space.' },
        knee: knee(),
        scale: custom("'full' or a number in (0, 1]", (v) => (v === 'full' || (fin(v) && v > 0 && v <= 1) ? null : "expected 'full' or a number in (0, 1]")),
        dpi: arg('output.encode', 'dpi'),
        compression: arg('output.encode', 'compression'),
        signal: { type: 'enum', values: ['icc', 'icc+cicp', 'none'], doc: 'Colour signalling.' },
        document: { type: 'enum', values: ['sidecar', 'embedded', 'none'], doc: 'How the document travels with the export.' },
      },
      printer: custom('PrinterSettings or null', (v) => (v === null || isPlainObject(v) ? null : 'expected PrinterSettings or null')),
    },
  };
  return cache;
}

/** Where a value is checked: the frame kind and stage (for binding reads) and what uses it. */
export interface CheckCtx {
  kind: FrameKind;
  stage?: StageName;
  /** 'medium' and 'binding' (entry params) bound different cuts (design §28). */
  use: 'medium' | 'binding';
}

function guard(out: Diagnostic[], f: () => void): void {
  try {
    f();
  } catch (e) {
    if (isChromobenchError(e)) out.push(e.diag as Diagnostic);
    else throw e;
  }
}

/** Checks a binding reference: registered, and reading only a cut computed before its value is used. */
export function checkBinding(v: JsonObject, label: string, ctx: CheckCtx, out: Diagnostic[]): void {
  guard(out, () => {
    const ref = v as unknown as { bind: string; version: number; reads?: string };
    const def = getBinding(ref.bind, ref.version);
    if (def.measure && ref.reads === undefined) out.push(diag('E_BINDING', `${label}: ${ref.bind} measures a cut; say which in reads`, { path: label, valid: [...CUT_NAMES] }));
    if (ref.reads !== undefined) {
      const ok = ctx.stage ? readableCuts(ctx.stage, ctx.kind, ctx.use) : [];
      if (!ok.includes(ref.reads as never)) {
        out.push(diag('E_BINDING', `${label}: a binding here may not read ${ref.reads}: only cuts computed before its value is used`, { path: label, valid: ok }));
      }
    }
  });
}

/** Checks a value against a field rule (a schema object must have exactly its keys). Collects diagnostics. */
export function checkRule(rule: FieldRule, v: unknown, label: string, ctx: CheckCtx, out: Diagnostic[]): void {
  if (isBindingRef(v)) {
    checkBinding(v as unknown as JsonObject, label, ctx, out);
    return;
  }
  if (isCustom(rule)) {
    const msg = rule.check(v);
    if (msg) out.push(diag('E_ARG_TYPE', `${label}: ${msg}`, { path: label, hint: rule.doc }));
    return;
  }
  if (isSpec(rule)) {
    if (v === undefined) {
      out.push(diag('E_DOCUMENT', `missing ${label}`, { path: label, hint: rule.doc }));
      return;
    }
    if (v === null && !rule.optional) {
      out.push(diag('E_ARG_TYPE', `${label} cannot be null`, { path: label }));
      return;
    }
    guard(out, () => checkArgValue(rule, v, label));
    return;
  }
  if (!isPlainObject(v)) {
    out.push(diag('E_ARG_TYPE', `${label} must be an object with ${Object.keys(rule).join(', ')}`, { path: label, valid: Object.keys(rule) }));
    return;
  }
  for (const k of Object.keys(v)) {
    if (!(k in rule)) {
      const g = closest(k, Object.keys(rule));
      out.push(diag('E_PATH', `${label} has no field "${k}"`, { path: `${label}.${k}`, ...(g ? { hint: `did you mean ${g}?` } : {}), valid: Object.keys(rule) }));
    }
  }
  for (const [k, r] of Object.entries(rule)) checkRule(r, v[k], `${label}.${k}`, ctx, out);
}

/** The rule at a field path of a schema (for an override or a set on one field), or undefined. */
export function ruleAt(schema: Schema, path: string): FieldRule | undefined {
  let cur: FieldRule | undefined = schema;
  for (const seg of path.split('.')) {
    if (!cur || isSpec(cur) || isCustom(cur)) return undefined;
    cur = (cur as Schema)[seg];
  }
  return cur;
}

/** Layer or mask-component params → node args: list Colls become arrays of their items in order. */
export function paramsToArgs(op: OpDef, params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) out[k] = op.args[k]?.type === 'list' && Coll.is(v) ? Coll.values(v) : v;
  return out;
}

/**
 * Checks params against an op's arguments: unknown keys (did-you-mean), list args stored as Colls, binding
 * references, ArgSpecs, the op's cross-argument rule. Collects diagnostics.
 */
export function checkParams(op: OpDef, params: unknown, label: string, ctx: CheckCtx, out: Diagnostic[]): void {
  if (!isPlainObject(params)) {
    out.push(diag('E_ARG_TYPE', `${label} must be an object of ${op.name}'s arguments`, { path: label, valid: Object.keys(op.args) }));
    return;
  }
  const names = Object.keys(op.args);
  for (const k of Object.keys(params)) {
    if (k in op.args) continue;
    const g = closest(k, names);
    out.push(diag('E_UNKNOWN_OPTION', `${op.name} has no option "${k}"`, { path: `${label}.${k}`, ...(g ? { hint: `did you mean ${g}?` } : {}), valid: names }));
  }
  const bound: Record<string, unknown> = {};
  let literal = true;
  for (const [k, s] of Object.entries(op.args)) {
    let v = params[k];
    const at = `${label}.${k}`;
    if (isBindingRef(v)) {
      checkBinding(v as unknown as JsonObject, at, ctx, out);
      literal = false;
      continue;
    }
    if (s.type === 'list' && v !== undefined) {
      const p = Coll.problem(v);
      if (p) {
        out.push(diag('E_ARG_TYPE', `${at} is a list: in a document it is a Coll (${p})`, { path: at }));
        continue;
      }
      v = Coll.values(v as Coll<unknown>);
    }
    if (v === undefined || (v === null && s.optional)) {
      if (s.default !== undefined) bound[k] = s.default;
      else if (!s.optional) out.push(diag('E_ARG_TYPE', `${op.name} needs argument "${k}"`, { path: at, hint: s.doc }));
      continue;
    }
    const before = out.length;
    guard(out, () => {
      const r = checkArgValue(s, v, at);
      if (r.value !== null) bound[k] = r.value;
    });
    if (out.length > before) literal = false;
  }
  if (literal && op.validate) {
    const msg = op.validate(bound);
    if (msg) out.push(diag('E_ARG_RANGE', `${label}: ${op.name}: ${msg}`, { path: label }));
  }
}
