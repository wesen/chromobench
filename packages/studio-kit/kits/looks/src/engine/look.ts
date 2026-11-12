// Looks and presets (CHB-021 guide §2): a preset is a partial recipe (path entries: absolute `set`, offset `add`,
// factor `mul`); a look is a JS function with declared, ArgSpec-shaped parameters that produces such entries for
// one frame. Both resolve to the same list of entries; Amount, diff, apply and survey work on that list only
// (decision: a look never stores a pipeline, it always resolves to mutations).
//
//   const warm = look('warm print').group('Print')
//     .param('warmth', slider(0, 10, { unit: 'pt', default: 4, label: 'Warmth' }))
//     .edits((f, p) => ({ 'print.lights.logH': add(pt([-p.warmth / 2, 0, p.warmth / 2])) }))
//   resolveLook(warm, lookFrame('f1', recipe), { warmth: 6 })  → { entries: [{ path, add: [...] }], … }

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ChromobenchError, CONTRACT_VERSION, LOGH_PER_POINT, PRINT_OPTION_PATHS, checkArgValue, closest, diag, fail, fieldPattern, settablePaths,
  type ArgSpec, type Diagnostic, type ExposureInput, type FrameRecipe, type Unit,
} from '@chromobench/contract';
import { isImageHandle, frameRef, type FrameRef, type ImageHandle } from '../../../../src/handles.ts';

/** How Amount scales one path (guide §4.2); `{ step }` is a threshold for discrete values. */
export type AmountRule = 'linear' | 'stops' | 'mired' | 'keep' | 'step' | { step: number };
/**
 * One preset entry. `add` is an offset in the path's working space: log H for printer lights (write it with
 * `pt()`), stops for times and f-numbers, mired for colour temperature, the stored unit otherwise (CC, D, grade).
 * `mul` multiplies the base value (halation, grain strength).
 */
export type PresetEntry =
  | { path: string; set: unknown }
  | { path: string; add: number | number[] | Record<string, number> }
  | { path: string; mul: number };

export type SourceKind = 'film-scan' | 'digital-raw' | 'any';
export type AmountBase = 'current' | 'defaults';

export const PRESET_FORMAT = 'chromobench.preset';
export const PRESET_VERSION = 1;

export interface Preset {
  format: typeof PRESET_FORMAT;
  version: 1;
  /** slug, unique in the library */
  id: string;
  name: string;
  group?: string;
  notes?: string;
  entries: PresetEntry[];
  /** dodge/burn/flash rows to add (exposure.add); their stops scale with Amount */
  exposures?: ExposureInput[];
  requires?: { source?: SourceKind };
  /** per-path overrides of the default Amount rule */
  amount?: Record<string, AmountRule>;
  /** what Amount 0 means for `set` entries (default 'current') */
  base?: AmountBase;
  /** the contract version it was written against */
  contract: string;
}

/** What a look body may return per path: cb.set / cb.add / cb.mul, or a plain value (an absolute set). */
export interface LookEdit {
  readonly $: 'look.edit';
  readonly kind: 'set' | 'add' | 'mul';
  readonly value: unknown;
}
export const set = (value: unknown): LookEdit => Object.freeze({ $: 'look.edit' as const, kind: 'set' as const, value });
export const add = (value: number | number[] | Record<string, number>): LookEdit => Object.freeze({ $: 'look.edit' as const, kind: 'add' as const, value });
/** a factor on the base value (guide's cb.scaleOf): grain × 1.5 */
export const mul = (value: number): LookEdit => Object.freeze({ $: 'look.edit' as const, kind: 'mul' as const, value });
const isEdit = (x: unknown): x is LookEdit => !!x && typeof x === 'object' && (x as LookEdit).$ === 'look.edit';

/** printer points → log H (numbers or arrays), for `add` on print.lights.logH */
export const pt = (x: number | number[]): any => (Array.isArray(x) ? x.map((v) => v * LOGH_PER_POINT) : x * LOGH_PER_POINT);

/** The read-only frame a look body sees: no measurements (an auto look that measures is a different object). */
export interface LookFrame {
  readonly id: string;
  readonly recipe: FrameRecipe;
  readonly kind: FrameRecipe['kind'];
  readonly source: Exclude<SourceKind, 'any'>;
  /** the film stock (scan.stock, or capture.stock for a digital RAW) */
  readonly stock: string | null;
  readonly paper: string;
  /** what-if print handles, the "pipeline" form: (f, p) => f.print({ grade: 3 }) */
  print(o?: Record<string, unknown>): ImageHandle;
}
export function lookFrame(id: string, recipe: FrameRecipe): LookFrame {
  const ref: FrameRef = frameRef(id, recipe);
  return Object.freeze({
    id,
    recipe,
    kind: recipe.kind,
    source: recipe.kind === 'digital-raw' ? ('digital-raw' as const) : ('film-scan' as const),
    stock: recipe.scan?.stock ?? recipe.capture?.stock ?? null,
    paper: recipe.print.paper,
    print: (o: Record<string, unknown> = {}) => ref.print(o),
  });
}

export type LookBody = (f: LookFrame, p: Record<string, any>) => unknown;

export interface Look {
  readonly $: 'look';
  readonly id: string;
  readonly name: string;
  readonly group: string;
  readonly notes?: string;
  /** ArgSpec-shaped parameters: the registry's per-value check and control generation apply to them */
  readonly params: Readonly<Record<string, ArgSpec>>;
  readonly requires: SourceKind;
  readonly amount: Readonly<Record<string, AmountRule>>;
  readonly base: AmountBase;
  readonly body: LookBody;
  readonly exposures?: (f: LookFrame, p: Record<string, any>) => ExposureInput[];
  readonly origin: 'builtin' | 'preset' | 'file' | 'sweep';
  readonly preset?: Preset;
}
export const isLook = (x: unknown): x is Look => !!x && typeof x === 'object' && (x as Look).$ === 'look';

const UNIT_ALIASES: Record<string, Unit> = { pt: 'point', point: 'point', st: 'stop', stop: 'stop', stops: 'stop', s: 's', K: 'K', CC: 'CC', D: 'D', none: 'none', fraction: 'fraction', '%': 'percent', percent: 'percent' };

/** A number parameter (guide's cb.slider): an ArgSpec, not a widget; the control is generated from it. */
export function slider(min: number, max: number, o: { unit?: string; default?: number; step?: number; label?: string; doc?: string } = {}): ArgSpec {
  const unit = o.unit ? UNIT_ALIASES[o.unit] : undefined;
  if (o.unit && !unit) fail('E_UNIT', `unknown unit "${o.unit}" for a look parameter`, { valid: Object.keys(UNIT_ALIASES) });
  return Object.freeze({
    type: 'number' as const,
    ...(unit ? { unit } : {}),
    min,
    max,
    default: o.default ?? Math.min(max, Math.max(min, 0)),
    ui: { widget: 'slider' as const, ...(o.step !== undefined ? { step: o.step } : {}), ...(o.label ? { label: o.label } : {}) },
    doc: o.doc ?? o.label ?? '',
  });
}
/** An enum parameter. */
export function choice(values: string[], o: { default?: string; label?: string } = {}): ArgSpec {
  return Object.freeze({ type: 'enum' as const, values: [...values], default: o.default ?? values[0], ui: { widget: 'segmented' as const, ...(o.label ? { label: o.label } : {}) }, doc: o.label ?? '' });
}

/** a kit diagnostic (CB-L…): the contract's diag() only takes its closed list of codes */
export const kitDiag = (code: string, message: string, extra: Omit<Diagnostic, 'code' | 'message'> = {}): Diagnostic => ({ code, message, ...extra });

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'look';

/** The look builder: cb.kits.looks.look(name).group().param().edits(fn) → a frozen Look. */
export interface LookBuilder {
  id(id: string): LookBuilder;
  group(g: string): LookBuilder;
  notes(n: string): LookBuilder;
  requires(r: { source?: SourceKind }): LookBuilder;
  param(name: string, spec: ArgSpec): LookBuilder;
  amount(path: string, rule: AmountRule): LookBuilder;
  base(b: AmountBase): LookBuilder;
  exposures(fn: (f: LookFrame, p: Record<string, any>) => ExposureInput[]): LookBuilder;
  edits(fn: LookBody): Look;
}
export function look(name: string): LookBuilder {
  const d: { id: string; group: string; notes?: string; requires: SourceKind; params: Record<string, ArgSpec>; amount: Record<string, AmountRule>; base: AmountBase; exposures?: Look['exposures'] } = {
    id: slug(name), group: 'Mine', requires: 'any', params: {}, amount: {}, base: 'current',
  };
  const b: LookBuilder = {
    id: (id) => ((d.id = id), b),
    group: (g) => ((d.group = g), b),
    notes: (n) => ((d.notes = n), b),
    requires: (r) => ((d.requires = r.source ?? 'any'), b),
    param: (n, spec) => ((d.params[n] = spec), b),
    amount: (p, r) => ((d.amount[p] = r), b),
    base: (x) => ((d.base = x), b),
    exposures: (fn) => ((d.exposures = fn), b),
    edits: (body) =>
      Object.freeze({
        $: 'look' as const, id: d.id, name, group: d.group, ...(d.notes ? { notes: d.notes } : {}), params: Object.freeze({ ...d.params }), requires: d.requires,
        amount: Object.freeze({ ...d.amount }), base: d.base, body, ...(d.exposures ? { exposures: d.exposures } : {}), origin: 'builtin' as const,
      }),
  };
  return b;
}

/** Parameter values: defaults filled, each checked like a registry argument (E_ARG_RANGE, E_UNKNOWN_OPTION). */
export function paramValues(l: Look, given: Record<string, unknown> = {}): Record<string, any> {
  const names = Object.keys(l.params);
  for (const k of Object.keys(given)) {
    if (!(k in l.params)) {
      const guess = closest(k, names);
      fail('E_UNKNOWN_OPTION', `look '${l.name}' has no parameter "${k}"`, { ...(guess ? { hint: `did you mean ${guess}?` } : {}), valid: names });
    }
  }
  const out: Record<string, any> = {};
  for (const [k, spec] of Object.entries(l.params)) out[k] = checkArgValue(spec, given[k] ?? spec.default, `${l.name}.${k}`).value;
  return out;
}

/** The what-if handle form: frame.print({ grade: 3, lights: [...] }) → set entries (PRINT_OPTION_PATHS, 1:1). */
export function lookEdits(h: ImageHandle): PresetEntry[] {
  if (h.what !== 'print') fail('E_ARG_TYPE', `a look may return frame.print({...}); got ${h.expr}`);
  return Object.entries(h.args).map(([k, v]) => {
    const path = PRINT_OPTION_PATHS[k];
    if (!path) fail('E_UNKNOWN_OPTION', `print() option "${k}" has no recipe path, so a look cannot apply it`, { valid: Object.keys(PRINT_OPTION_PATHS) });
    return { path, set: v };
  });
}

function checkPath(path: string): void {
  if (fieldPattern(path)) return;
  const guess = closest(path, settablePaths());
  fail('E_PATH', `unknown recipe path "${path}"`, { path, ...(guess ? { hint: `did you mean ${guess}?`, fix: guess } : {}) });
}

/** A body's result → entries: a path map of cb.set/cb.add/cb.mul or plain values, or a what-if print handle. */
export function normaliseEdits(out: unknown): PresetEntry[] {
  if (out === undefined || out === null) return [];
  if (isImageHandle(out)) return lookEdits(out);
  if (Array.isArray(out)) return out.map((e) => (checkPath(String((e as PresetEntry).path)), e as PresetEntry));
  if (typeof out !== 'object') fail('E_ARG_TYPE', 'a look body returns a map of recipe paths to cb.set / cb.add / values');
  const entries: PresetEntry[] = [];
  for (const [path, v] of Object.entries(out as Record<string, unknown>)) {
    checkPath(path);
    if (isEdit(v)) entries.push(v.kind === 'set' ? { path, set: v.value } : v.kind === 'add' ? { path, add: v.value as number } : { path, mul: v.value as number });
    else entries.push({ path, set: v });
  }
  return entries;
}

export interface Resolved {
  look: Look;
  frame: string;
  params: Record<string, any>;
  entries: PresetEntry[];
  exposures: ExposureInput[];
  /** set when the look does not apply to this frame (requires) */
  skip?: Diagnostic;
}

const SOURCE_WORDS: Record<string, string> = { 'digital-raw': 'a digital RAW', 'film-scan': 'a film scan' };

/** Run a look on one frame: requires, params, body → entries. Throws on bad params or paths (E_ARG_RANGE, E_PATH). */
export function resolveLook(l: Look, f: LookFrame, given: Record<string, unknown> = {}): Resolved {
  const params = paramValues(l, given);
  if (l.requires !== 'any' && l.requires !== f.source)
    return { look: l, frame: f.id, params, entries: [], exposures: [], skip: diag('E_KIND', `'${l.name}' needs ${SOURCE_WORDS[l.requires]}; ${f.id} is ${SOURCE_WORDS[f.source]}`, { hint: `This look needs ${SOURCE_WORDS[l.requires]}` }) };
  const entries = normaliseEdits(l.body(f, params));
  const exposures = l.exposures ? l.exposures(f, params) : [];
  return { look: l, frame: f.id, params, entries, exposures };
}

/** A preset as a look with no parameters and a constant body. */
export function fromPreset(p: Preset, origin: Look['origin'] = 'preset'): Look {
  const entries = p.entries.map((e) => ({ ...e }));
  return Object.freeze({
    $: 'look' as const, id: p.id, name: p.name, group: p.group ?? 'Mine', ...(p.notes ? { notes: p.notes } : {}), params: Object.freeze({}), requires: p.requires?.source ?? 'any',
    amount: Object.freeze({ ...(p.amount ?? {}) }), base: p.base ?? 'current', body: () => entries, ...(p.exposures?.length ? { exposures: () => p.exposures!.map((x) => ({ ...x })) } : {}),
    origin, preset: p,
  });
}

/** A look with chosen parameters, resolved on a frame, as a preset (data, safe to share). */
export function bake(l: Look, f: LookFrame, given: Record<string, unknown> = {}, o: { id?: string; name?: string } = {}): Preset {
  const r = resolveLook(l, f, given);
  if (r.skip) throw new ChromobenchError(r.skip);
  const name = o.name ?? (Object.keys(r.params).length ? `${l.name} (${Object.entries(r.params).map(([k, v]) => `${k} ${v}`).join(', ')})` : l.name);
  return {
    format: PRESET_FORMAT, version: PRESET_VERSION, id: o.id ?? slug(name), name, group: l.group, entries: r.entries, ...(r.exposures.length ? { exposures: r.exposures } : {}),
    ...(l.requires !== 'any' ? { requires: { source: l.requires } } : {}), ...(Object.keys(l.amount).length ? { amount: { ...l.amount } } : {}), base: l.base, contract: CONTRACT_VERSION,
  };
}

/** Structural checks of a preset document; unknown paths are reported, not dropped (needs review). */
export function validatePreset(x: unknown): Diagnostic[] {
  const out: Diagnostic[] = [];
  const p = x as Preset;
  if (!p || typeof p !== 'object') return [diag('E_FORMAT', 'a preset is a JSON object')];
  if (p.format !== PRESET_FORMAT) out.push(diag('E_FORMAT', `not a chromobench preset (format ${JSON.stringify(p.format)})`, { fix: PRESET_FORMAT }));
  if (typeof p.version !== 'number') out.push(diag('E_FORMAT', 'preset version missing'));
  else if (p.version > PRESET_VERSION) out.push(diag('E_FORMAT', `preset version ${p.version} is newer than this app (${PRESET_VERSION})`, { hint: 'update chromobench to read it' }));
  if (typeof p.id !== 'string' || !p.id) out.push(diag('E_FORMAT', 'preset id missing'));
  if (typeof p.name !== 'string' || !p.name) out.push(diag('E_FORMAT', 'preset name missing'));
  if (!Array.isArray(p.entries)) return [...out, diag('E_FORMAT', 'preset entries must be an array')];
  for (const [i, e] of p.entries.entries()) {
    const kinds = ['set', 'add', 'mul'].filter((k) => e && typeof e === 'object' && k in e);
    if (!e || typeof e.path !== 'string' || kinds.length !== 1) {
      out.push(diag('E_FORMAT', `entry ${i}: { path, set | add | mul }`));
      continue;
    }
    if (!fieldPattern(e.path)) {
      const guess = closest(e.path, settablePaths());
      out.push(diag('E_PATH', `entry ${i}: unknown recipe path "${e.path}"`, { path: e.path, ...(guess ? { hint: `did you mean ${guess}?`, fix: guess } : {}) }));
    }
  }
  return out;
}
