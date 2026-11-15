// Looks and presets (CHB-021 guide §2; CHB-037: on format-3 documents): a preset is a partial document (path
// entries: absolute `set`, offset `add`, factor `mul`, on document paths) plus darkroom layers to add; a look is a JS
// function with declared, ArgSpec-shaped parameters that produces such entries for one frame. Both resolve to the
// same list of entries; Amount, diff, apply and survey work on that list only (a look never stores a pipeline, it
// always resolves to mutations; phase 7 turns looks into links).
//
//   const warm = look('warm print').group('Print')
//     .param('warmth', slider(0, 10, { unit: 'pt', default: 4, label: 'Warmth' }))
//     .edits((f, p) => ({ 'lights.params.logH': add(pt([-p.warmth / 2, 0, p.warmth / 2])) }))
//   resolveLook(warm, lookFrame('f1', doc), { warmth: 6 })  → { entries: [{ path, add: [...] }], … }

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ChromobenchError, CONTRACT_VERSION, LOGH_PER_POINT, checkArgValue, closest, diag, documentKind, fail,
  type ArgSpec, type Diagnostic, type Document, type FrameKind, type Unit,
} from '@chromobench/contract';
import { darkroomMedium } from '../../../../src/model/doc.ts';
import { checkPath, specAt } from './paths.ts';

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
/** 2: document paths (contract 1.0); a version-1 preset named recipe paths and is not read (hard cut-off). */
export const PRESET_VERSION = 2;

/** A darkroom layer a preset or look adds (a dodge, a burn, a flash, the preflash, a contrast mask). Amount scales its
 *  stops, time and preflash fraction; an existing layer of the same id gets its params moved instead. */
export interface LayerInput {
  id: string;
  op: 'burn' | 'dodge' | 'flash' | 'preflash' | 'densityMask';
  params: Record<string, number | string>;
  name?: string;
  mask?: string | null;
}

export interface Preset {
  format: typeof PRESET_FORMAT;
  version: 2;
  /** slug, unique in the library */
  id: string;
  name: string;
  group?: string;
  notes?: string;
  entries: PresetEntry[];
  /** darkroom layers to add; their stops, time and preflash fraction scale with Amount */
  layers?: LayerInput[];
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

/** printer points → log H (numbers or arrays), for `add` on lights.params.logH */
export const pt = (x: number | number[]): any => (Array.isArray(x) ? x.map((v) => v * LOGH_PER_POINT) : x * LOGH_PER_POINT);

/** The read-only frame a look body sees: no measurements (an auto look that measures is a different object). */
export interface LookFrame {
  readonly id: string;
  readonly doc: Document;
  readonly kind: FrameKind;
  readonly source: Exclude<SourceKind, 'any'>;
  /** the film stock (the scan's, or the film a camera file is put on) */
  readonly stock: string | null;
  readonly paper: string;
}
export function lookFrame(id: string, doc: Document): LookFrame {
  const kind = documentKind(doc);
  const st = doc.stages as { scan?: { medium: { stock?: string } }; film?: { medium: { stock?: string } } };
  return Object.freeze({
    id,
    doc,
    kind,
    source: kind === 'digital-raw' ? ('digital-raw' as const) : ('film-scan' as const),
    stock: st.scan?.medium.stock ?? st.film?.medium.stock ?? null,
    paper: darkroomMedium(doc).paper,
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
  readonly layers?: (f: LookFrame, p: Record<string, any>) => LayerInput[];
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
  layers(fn: (f: LookFrame, p: Record<string, any>) => LayerInput[]): LookBuilder;
  edits(fn: LookBody): Look;
}
export function look(name: string): LookBuilder {
  const d: { id: string; group: string; notes?: string; requires: SourceKind; params: Record<string, ArgSpec>; amount: Record<string, AmountRule>; base: AmountBase; layers?: Look['layers'] } = {
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
    layers: (fn) => ((d.layers = fn), b),
    edits: (body) =>
      Object.freeze({
        $: 'look' as const, id: d.id, name, group: d.group, ...(d.notes ? { notes: d.notes } : {}), params: Object.freeze({ ...d.params }), requires: d.requires,
        amount: Object.freeze({ ...d.amount }), base: d.base, body, ...(d.layers ? { layers: d.layers } : {}), origin: 'builtin' as const,
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

/** A body's result → entries: a path map of cb.set/cb.add/cb.mul or plain values, or a list of entries. */
export function normaliseEdits(out: unknown, doc?: Document): PresetEntry[] {
  if (out === undefined || out === null) return [];
  if (Array.isArray(out)) return out.map((e) => (checkPath(String((e as PresetEntry).path), doc), e as PresetEntry));
  if (typeof out !== 'object') fail('E_ARG_TYPE', 'a look body returns a map of document paths to cb.set / cb.add / values');
  const entries: PresetEntry[] = [];
  for (const [path, v] of Object.entries(out as Record<string, unknown>)) {
    checkPath(path, doc);
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
  layers: LayerInput[];
  /** set when the look does not apply to this frame (requires) */
  skip?: Diagnostic;
}

const SOURCE_WORDS: Record<string, string> = { 'digital-raw': 'a digital RAW', 'film-scan': 'a film scan' };

/** Run a look on one frame: requires, params, body → entries. Throws on bad params or paths (E_ARG_RANGE, E_PATH). */
export function resolveLook(l: Look, f: LookFrame, given: Record<string, unknown> = {}): Resolved {
  const params = paramValues(l, given);
  if (l.requires !== 'any' && l.requires !== f.source)
    return { look: l, frame: f.id, params, entries: [], layers: [], skip: diag('E_KIND', `'${l.name}' needs ${SOURCE_WORDS[l.requires]}; ${f.id} is ${SOURCE_WORDS[f.source]}`, { hint: `This look needs ${SOURCE_WORDS[l.requires]}` }) };
  const entries = normaliseEdits(l.body(f, params), f.doc);
  const layers = l.layers ? l.layers(f, params) : [];
  return { look: l, frame: f.id, params, entries, layers };
}

/** A preset as a look with no parameters and a constant body. */
export function fromPreset(p: Preset, origin: Look['origin'] = 'preset'): Look {
  const entries = p.entries.map((e) => ({ ...e }));
  return Object.freeze({
    $: 'look' as const, id: p.id, name: p.name, group: p.group ?? 'Mine', ...(p.notes ? { notes: p.notes } : {}), params: Object.freeze({}), requires: p.requires?.source ?? 'any',
    amount: Object.freeze({ ...(p.amount ?? {}) }), base: p.base ?? 'current', body: () => entries, ...(p.layers?.length ? { layers: () => p.layers!.map((x) => ({ ...x, params: { ...x.params } })) } : {}),
    origin, preset: p,
  });
}

/** A look with chosen parameters, resolved on a frame, as a preset (data, safe to share). */
export function bake(l: Look, f: LookFrame, given: Record<string, unknown> = {}, o: { id?: string; name?: string } = {}): Preset {
  const r = resolveLook(l, f, given);
  if (r.skip) throw new ChromobenchError(r.skip);
  const name = o.name ?? (Object.keys(r.params).length ? `${l.name} (${Object.entries(r.params).map(([k, v]) => `${k} ${v}`).join(', ')})` : l.name);
  return {
    format: PRESET_FORMAT, version: PRESET_VERSION, id: o.id ?? slug(name), name, group: l.group, entries: r.entries, ...(r.layers.length ? { layers: r.layers } : {}),
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
  else if (p.version < PRESET_VERSION) out.push(diag('E_FORMAT', `preset version ${p.version} names recipe paths, which no longer exist`, { hint: 'make the preset again from a frame (Save Frame as Preset)' }));
  if (typeof p.id !== 'string' || !p.id) out.push(diag('E_FORMAT', 'preset id missing'));
  if (typeof p.name !== 'string' || !p.name) out.push(diag('E_FORMAT', 'preset name missing'));
  if (!Array.isArray(p.entries)) return [...out, diag('E_FORMAT', 'preset entries must be an array')];
  for (const [i, e] of p.entries.entries()) {
    const kinds = ['set', 'add', 'mul'].filter((k) => e && typeof e === 'object' && k in e);
    if (!e || typeof e.path !== 'string' || kinds.length !== 1) {
      out.push(diag('E_FORMAT', `entry ${i}: { path, set | add | mul }`));
      continue;
    }
    if (!specAt(e.path)) {
      try {
        checkPath(e.path);
      } catch (err) {
        const d = (err as ChromobenchError).diag;
        out.push(diag('E_PATH', `entry ${i}: unknown document path "${e.path}"`, { path: e.path, ...(d?.hint ? { hint: d.hint } : {}), ...(d?.fix ? { fix: d.fix } : {}) }));
      }
    }
  }
  return out;
}
