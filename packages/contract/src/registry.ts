// The op registry: one schema from which the DSL methods, the GUI controls, the conformance cases,
// the reference docs and the did-you-mean errors are generated. Metadata only; engines implement
// ops (DR-1). Ported from goja-cv pkg/cv/graph/registry.go, args.go and suggest.go.
//
// Contract 1.0: an op is a node op (engines evaluate it; a dotted name `area.verb`), a layer op (it lives in stage
// stacks: `stages` lists where, the stage's law gives it meaning; an undotted name, design §23), or both (heal,
// clarity: a layer whose law compiles it to a node of the same op). Light-law ops (expose, burn, …) return 'Term':
// the darkroom law lowers them to print.expose / print.densityMask nodes and one print.combine.
import { jsonProblem } from '@chromobench/values';
import { isDomain, DOMAINS, type Domain } from './domains.ts';
import type { StageName } from './document.ts';
import { fail, isChromobenchError, type Diagnostic } from './errors.ts';
import type { FieldSpec } from './graph-types.ts';
import { checkArgValue, formatValue, NODE_ARG_TYPES, normaliseShape, tidy, type ArgSpec } from './spec.ts';
import { UNITS } from './units.ts';

export type Kind = 'Image' | 'Mask' | 'Value' | 'Regions' | 'Table' | 'Term';
export type Area = 'source' | 'scan' | 'invert' | 'capture' | 'film' | 'print'
  | 'view' | 'retouch' | 'output' | 'mask' | 'measure' | 'darkroom' | 'composite';
export const AREAS: readonly Area[] = ['source', 'scan', 'invert', 'capture', 'film', 'print', 'view', 'retouch', 'output', 'mask', 'measure', 'darkroom', 'composite'];
export type OpClass = 'pointwise' | 'spatial' | 'global' | 'decoration' | 'measure' | 'geometric';
export type Binding = 'stock' | 'scan' | 'setting' | 'pixel';

/**
 * The working encoding of a layer op's arithmetic (design §22): 'stage' = the stage's own values (scanner density,
 * log H, print XYZ); 'linear' = linear light (both composite stages hold linear XYZ, so no conversion is inserted);
 * 'oklab' = OkLab/OkLCh, for ops defined by eye (P8: the compiler inserts the conversions).
 */
export type Encoding = 'stage' | 'linear' | 'oklab';
export const ENCODINGS: readonly Encoding[] = ['stage', 'linear', 'oklab'];

/** A light-law term (design §22): light that reaches the paper, or a filter in the light path. */
export type LightTerm = 'main' | 'contribution' | 'modulator';

/** How adjacent layers of a coalescible op merge into one node (design §23): their `list` args concatenate. */
export interface Coalesce {
  /** the list argument whose items concatenate */
  list: string;
  /** the item field a layer's amount multiplies (its opacity) */
  opacity: string;
}

export interface OpDef {
  /** Dotted for node-only ops ('print.expose'); a bare word for layer ops ('burn', 'heal', 'clarity'). */
  name: string;
  area: Area;
  /** Owning ticket, e.g. 'CHB-003'. */
  owner: string;
  /** Receiver kind; 'none' for receiver-less ops (source.open, darkroom.contactSheet) and light-law terms. */
  on: Kind | 'none';
  returns: Kind;
  /** Accepted input domains; 'any' accepts every Image domain. */
  domainIn?: Domain | Domain[] | 'any';
  /** Output domain; 'same' copies the receiver's. Required for Image/Mask returns. */
  domainOut?: Domain | 'same';
  /** The output domain is the value of this enum argument (source.pattern). */
  domainFromArg?: string;
  /** Overrides DOMAINS[domainOut].channels (invert.dyes → 4). */
  channels?: 1 | 3 | 4;
  class: OpClass;
  binding: Binding;
  args: Readonly<Record<string, ArgSpec>>;
  /** Fields of the returned Value / Regions / Table. */
  fields?: FieldSpec[];
  /** Cross-argument check on the bound args; returns an error message or null. */
  validate?: (args: Readonly<Record<string, unknown>>) => string | null;
  /** The stages whose stacks may hold this op as a layer (design §21). Absent: not a layer op. */
  stages?: readonly StageName[];
  /** Layer ops: the encoding the op computes in. */
  encoding?: Encoding;
  /** Light-law ops: what the term is. */
  term?: LightTerm;
  /** Layer ops whose adjacent layers merge into one node. */
  coalesce?: Coalesce;
  /** Layer ops: params for which the layer changes nothing (it then produces no node, design §29). */
  identity?: (params: Readonly<Record<string, unknown>>) => boolean;
  /** Hidden from the DSL, the UI and the docs (source.pattern). */
  internal?: boolean;
  /** false keeps the op out of the DSL only (output.encode). Default true. */
  dsl?: boolean;
  doc: string;
  see?: string[];
  /** DSL snippets; parsed by registerOp, executed by CHB-007's doc tests. */
  examples?: string[];
}

export interface BindResult {
  args: Readonly<Record<string, unknown>>;
  warnings: Diagnostic[];
}

const REGISTRY = new Map<string, OpDef>();

// ----------------------------------------------------------------------------------------------
// closest(): case-insensitive Damerau–Levenshtein (optimal string alignment); edit budget
// max(1, min(3, floor(len/3))). Port of goja-cv pkg/cv/graph/suggest.go.

export function editDistance(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

export function closest(name: string, candidates: readonly string[]): string | undefined {
  const budget = Math.max(1, Math.min(3, Math.floor(name.length / 3)));
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const dd = editDistance(name, c);
    if (dd < bestD) {
      bestD = dd;
      best = c;
    }
  }
  return bestD <= budget ? best : undefined;
}

// ----------------------------------------------------------------------------------------------

function invalid(op: string, why: string): never {
  return fail('E_INVALID_OP_DEF', `registerOp(${op}): ${why}`);
}

function domainsOf(d: OpDef['domainIn']): Domain[] | 'any' {
  if (d === undefined) return [];
  if (d === 'any') return 'any';
  return Array.isArray(d) ? d : [d];
}

/** Ops allowed to consume display-rgb (CHB-011/015 rule: the print stack comes before output.display). */
export const DISPLAY_RGB_CONSUMERS: ReadonlySet<string> = new Set(['output.frame', 'output.encode']);

function checkSyntax(code: string): string | null {
  try {
    // Parse only: the body is wrapped in a function that is never called.
    new Function('frame', 'units', 'neg', `return async () => {\n${code}\n}`);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Validates and registers an op. Throws E_INVALID_OP_DEF on an invalid definition. */
export function registerOp(def: OpDef): OpDef {
  const n = def.name;
  const dot = n.indexOf('.');
  if (dot < 0) {
    if (!/^[a-z][A-Za-z]*$/.test(n)) invalid(n, 'a layer op is one word, e.g. "burn"');
    if (!def.stages?.length) invalid(n, 'an undotted name is a layer op and needs stages; node-only ops are dotted, e.g. "print.expose"');
  } else if (dot < 1 || n.slice(0, dot) !== def.area) invalid(n, `name prefix must equal the area "${def.area}"`);
  if (REGISTRY.has(n)) invalid(n, 'duplicate op name');
  if (def.stages) {
    if (def.stages.length === 0) invalid(n, 'stages must not be empty (omit it for a node-only op)');
    if (!def.encoding) invalid(n, 'a layer op declares its encoding');
    if (def.stages.includes('darkroom') !== (def.returns === 'Term')) invalid(n, 'darkroom layer ops (and only they) return Term');
  }
  if (def.returns === 'Term' && (!def.term || def.on !== 'none' || def.stages?.join() !== 'darkroom')) invalid(n, "a Term op is a darkroom-only layer op with on 'none' and a term role");
  if (def.coalesce) {
    const l = def.args[def.coalesce.list];
    if (l?.type !== 'list' || !l.of?.[def.coalesce.opacity]) invalid(n, `coalesce: ${def.coalesce.list} must be a list with a field ${def.coalesce.opacity}`);
  }
  if ((def.returns === 'Image' || def.returns === 'Mask') && !def.domainOut) invalid(n, 'Image/Mask ops need domainOut');
  if (def.returns === 'Mask' && def.domainOut !== 'mask') invalid(n, 'Mask ops must output the mask domain');
  if (def.domainOut === 'same' && def.on === 'none') invalid(n, "domainOut 'same' needs a receiver");
  if (def.domainOut && def.domainOut !== 'same' && !isDomain(def.domainOut)) invalid(n, `unknown domainOut ${def.domainOut}`);
  const din = domainsOf(def.domainIn);
  if (din !== 'any') for (const d of din) if (!isDomain(d)) invalid(n, `unknown domainIn ${d}`);
  if ((def.on === 'Image' || def.on === 'Mask') && din !== 'any' && din.length === 0) invalid(n, 'Image receivers need domainIn');
  if (def.on === 'Mask' && din !== 'any' && din.some((d) => d !== 'mask')) invalid(n, 'Mask receivers take the mask domain');
  if ((def.returns === 'Value' || def.returns === 'Regions' || def.returns === 'Table') && !def.fields) invalid(n, 'Value ops need fields');
  // CHB-011/015 graph rule: nothing but output.frame/encode and measurements consumes display-rgb.
  if (din !== 'any' && din.includes('display-rgb') && def.area !== 'measure' && def.area !== 'mask' && !DISPLAY_RGB_CONSUMERS.has(n)) {
    invalid(n, 'only output.frame, output.encode, mask.* and measure.* may consume display-rgb');
  }
  for (const [a, s] of Object.entries(def.args)) {
    if (!s.type) invalid(n, `argument ${a} has no type`);
    if (!s.doc) invalid(n, `argument ${a} has no doc`);
    if ((s.type === 'number' || s.type === 'vec3' || s.type === 'cmy') && !s.unit) invalid(n, `numeric argument ${a} needs a unit`);
    if (s.unit && !UNITS.includes(s.unit)) invalid(n, `argument ${a} has unknown unit ${s.unit}`);
    if (s.min !== undefined && s.max !== undefined && s.min > s.max) invalid(n, `argument ${a}: min > max`);
    if (s.usual && ((s.min !== undefined && s.usual[0] < s.min) || (s.max !== undefined && s.usual[1] > s.max) || s.usual[0] > s.usual[1])) {
      invalid(n, `argument ${a}: usual lies outside [min, max]`);
    }
    if (s.type === 'enum' && (!s.values || s.values.length === 0)) invalid(n, `enum argument ${a} needs values`);
    if (s.default !== undefined) {
      try {
        checkArgValue(s, s.default, `${n}.${a}`);
      } catch (e) {
        invalid(n, `default of ${a} violates its spec: ${isChromobenchError(e) ? e.diag.message : String(e)}`);
      }
    }
    if (s.redirects) for (const r of Object.keys(s.redirects)) if (r in def.args) invalid(n, `redirect ${r} shadows an argument`);
    if (s.type === 'list') {
      if (!s.of || Object.keys(s.of).length === 0) invalid(n, `list argument ${a} needs an item schema (of)`);
      for (const [f, fs] of Object.entries(s.of)) {
        if (!fs.doc) invalid(n, `argument ${a}.${f} has no doc`);
        if ((fs.type === 'number' || fs.type === 'vec3' || fs.type === 'cmy') && !fs.unit) invalid(n, `numeric field ${a}.${f} needs a unit`);
        if (fs.type === 'list') invalid(n, `argument ${a}.${f}: lists do not nest in node args`);
      }
    }
  }
  for (const ex of def.examples ?? []) {
    const err = checkSyntax(ex);
    if (err) invalid(n, `example does not parse: ${err}`);
  }
  const frozen = Object.freeze({ ...def, args: Object.freeze({ ...def.args }) });
  REGISTRY.set(n, frozen);
  return frozen;
}

/** Identity helper so catalog files get type checking without registering at import. */
export function defineOp(def: OpDef): OpDef {
  return def;
}

export function hasOp(name: string): boolean {
  return REGISTRY.has(name);
}

export function getOp(name: string): OpDef {
  const op = REGISTRY.get(name);
  if (op) return op;
  const names = [...REGISTRY.keys()].filter((k) => !REGISTRY.get(k)!.internal);
  const guess = closest(name, names);
  return fail('E_UNKNOWN_OP', `unknown op "${name}"`, { ...(guess ? { hint: `did you mean ${guess}?` } : {}), valid: names });
}

export function allOps(opts: { includeInternal?: boolean } = {}): OpDef[] {
  return [...REGISTRY.values()].filter((o) => opts.includeInternal || !o.internal).sort((a, b) => a.name.localeCompare(b.name));
}

export function opsByArea(area: Area): OpDef[] {
  return allOps().filter((o) => o.area === area);
}

export function acceptsDomain(op: OpDef, d: Domain): boolean {
  const din = domainsOf(op.domainIn);
  return din === 'any' ? d !== 'display-rgb' || op.area === 'measure' || op.area === 'mask' : din.includes(d);
}

/** What a handle of this kind (and domain) can call. */
export function opsAccepting(kind: Kind, domain?: Domain): OpDef[] {
  return allOps().filter((o) => {
    if (o.on === 'none') return false;
    if (kind === 'Value' || kind === 'Regions' || kind === 'Table') return o.on === kind;
    if (o.on !== 'Image' && o.on !== 'Mask') return false;
    if (o.on === 'Mask' && domain !== undefined && domain !== 'mask') return false;
    return domain === undefined || acceptsDomain(o, domain);
  });
}

/** Ops that produce a given domain (for E_DOMAIN hints). */
export function opsProducing(domain: Domain): OpDef[] {
  return allOps().filter((o) => o.domainOut === domain);
}

/** Layer ops a stage accepts (catalogue `stages`, design §24). */
export function opsForStage(stage: StageName): OpDef[] {
  return allOps({ includeInternal: true }).filter((o) => o.stages?.includes(stage));
}

/**
 * Turns a raw call into canonical arguments: normalise shapes, reject unknown keys (redirects,
 * did-you-mean), fill defaults, type-check (NaN/±Infinity → E_ARG_RANGE), hard range → E_ARG_RANGE,
 * soft range → RANGE warning, run op.validate, freeze.
 */
export function bindArgs(op: OpDef, raw: Readonly<Record<string, unknown>> = {}): BindResult {
  const names = Object.keys(op.args);
  for (const k of Object.keys(raw)) {
    if (k in op.args) continue;
    for (const [target, s] of Object.entries(op.args)) {
      const r = s.redirects?.[k];
      if (!r) continue;
      const v = raw[k];
      const converted = r.scale !== undefined ? scaleForFix(normaliseShape(s.type, v), r.scale) : v;
      const fixed: Record<string, unknown> = { ...raw };
      delete fixed[k];
      fixed[target] = converted;
      fail('E_UNKNOWN_OPTION', `${op.name} has no option "${k}"; use "${target}"`, { hint: r.hint, fix: `${op.name}(${formatValue(fixed)})`, valid: names });
    }
    const guess = closest(k, names);
    fail('E_UNKNOWN_OPTION', `${op.name} has no option "${k}"`, {
      ...(guess ? { hint: `did you mean ${guess}?`, fix: `${op.name}(${formatValue({ ...Object.fromEntries(Object.entries(raw).filter(([x]) => x !== k)), [guess]: raw[k] })})` } : {}),
      valid: names,
    });
  }
  const out: Record<string, unknown> = {};
  const warnings: Diagnostic[] = [];
  for (const name of names) {
    const s = op.args[name]!;
    let v = raw[name];
    if (v === undefined || (v === null && s.optional)) {
      if (s.default !== undefined) v = s.default;
      else if (s.optional) continue;
      else fail('E_ARG_TYPE', `${op.name} needs argument "${name}"`, { path: `${op.name}.${name}`, hint: s.doc });
    }
    const r = checkArgValue(s, v, `${op.name}.${name}`);
    if (r.value === null) continue;
    out[name] = r.value;
    warnings.push(...r.warnings);
  }
  if (op.validate) {
    const msg = op.validate(out);
    if (msg) fail('E_ARG_RANGE', `${op.name}: ${msg}`, { path: op.name });
  }
  // nothing non-finite (or otherwise not JSON) reaches canonicalJSON and the node hash
  const bad = jsonProblem(out);
  if (bad) fail('E_ARG_RANGE', `${op.name}${bad.path ? `.${bad.path}` : ''}: ${bad.message}`, { path: `${op.name}${bad.path ? `.${bad.path}` : ''}` });
  return { args: Object.freeze(out), warnings };
}

function scaleForFix(v: unknown, k: number): unknown {
  if (typeof v === 'number') return tidy(v * k);
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'number' ? tidy(x * k) : x));
  return v;
}

/** Node-typed argument names of an op, at top level or as list-item fields ('terms.image'). */
export function nodeArgs(op: OpDef): string[] {
  const out: string[] = [];
  for (const [a, s] of Object.entries(op.args)) {
    if (NODE_ARG_TYPES.has(s.type)) out.push(a);
    if (s.type === 'list') for (const [f, fs] of Object.entries(s.of ?? {})) if (NODE_ARG_TYPES.has(fs.type)) out.push(`${a}.${f}`);
  }
  return out;
}

/** A node id in a node-typed slot: where it sits, its spec, and the id. */
export interface NodeSlot { at: string; spec: ArgSpec; id: string }

/**
 * Every node id in bound args, in a fixed order (arguments in catalogue order, list items in order, fields in schema
 * order): the extra inputs of the node. `replace` maps a value before it is read (Node objects → ids).
 */
export function nodeSlots(op: OpDef, args: Readonly<Record<string, unknown>>): NodeSlot[] {
  const out: NodeSlot[] = [];
  for (const [a, s] of Object.entries(op.args)) {
    const v = args[a];
    if (v === undefined || v === null) continue;
    if (NODE_ARG_TYPES.has(s.type)) out.push({ at: a, spec: s, id: v as string });
    if (s.type === 'list' && Array.isArray(v)) {
      v.forEach((item, i) => {
        for (const [f, fs] of Object.entries(s.of ?? {})) {
          const x = (item as Record<string, unknown>)[f];
          if (NODE_ARG_TYPES.has(fs.type) && x !== undefined && x !== null) out.push({ at: `${a}.${i}.${f}`, spec: fs, id: x as string });
        }
      });
    }
  }
  return out;
}

/** Default channel count of an op's output. */
export function outputChannels(op: OpDef, inputDomain?: Domain): 1 | 3 | 4 {
  if (op.channels) return op.channels;
  const d = op.domainOut === 'same' ? inputDomain : op.domainOut;
  return d ? DOMAINS[d].channels : 3;
}

/** For tests only: clears and re-registers. Not exported from the package index. */
export function _registrySize(): number {
  return REGISTRY.size;
}
