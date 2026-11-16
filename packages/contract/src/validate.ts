// Validation of format-3 documents (contract 1.0, design §24): structure comes from @chromobench/values (Colls, unique
// ids, paths); meaning from here — the media, geometry and output schemas, every entry's ArgSpecs, the stage law's
// rules (amount range, blend, groups), the stage's accepted ops (catalogue `stages`), masks and the cuts they read,
// bindings and the cuts they read, and the darkroom's one main exposure. The values hooks run it on every edit:
// `validate` per mutation checks what the mutation touched; `validateTransaction` checks the whole document once at
// the end (rules a transaction may break midway: exactly one main, mask references).
import {
  applyTransaction, Coll, indexOf, isId, isPlainObject, transaction, ValueError,
  type Change, type DocIndex, type Id, type JsonObject, type Mutation, type Rules, type TransactionInit, type TxApplied, type TxOptions,
} from '@chromobench/values';
import { isBindingRef } from './bindings.ts';
import { PITCH_FIELDS } from './compile.ts';
import {
  BLEND_MODES, CUT_NAMES, cutDef, DOCUMENT_FORMAT, isLinked, MASK_COMBINES, MASK_COMPONENT_KINDS, readableCuts, ROOT_KEYS, STAGE_NAMES, STAGES,
  type Document, type FrameKind, type StageName,
} from './document.ts';
import { ChromobenchError, diag, isChromobenchError, type Diagnostic } from './errors.ts';
import { linkKind } from './links.ts';
import { getOp, hasOp, opsForStage, closest } from './registry.ts';
import { checkParams, checkRule, ruleAt, schemas, type CheckCtx } from './schema.ts';
import { getLaw } from './stage-laws.ts';

type Out = Diagnostic[];

const STAGES_OF: Record<FrameKind, StageName[]> = {
  'negative-scan': ['scan', 'darkroom', 'print'],
  'digital-raw': ['scene', 'film', 'darkroom', 'print'],
};

function kindOf(stages: Record<string, unknown>): FrameKind {
  return stages['scan'] !== undefined ? 'negative-scan' : 'digital-raw';
}

// ---- pieces --------------------------------------------------------------------------------------------------------

function checkMedium(doc: Document, s: StageName, m: unknown, out: Out): void {
  const kind = kindOf(doc.stages as unknown as Record<string, unknown>);
  const at = `stages.${s}.medium`;
  const schema = schemas().media[s];
  const ctx: CheckCtx = { kind, stage: s, use: 'medium' };
  if (isLinked(m)) {
    try {
      linkKind(m.link);
    } catch (e) {
      if (isChromobenchError(e)) out.push({ ...e.diag, path: `${at}.link` } as Diagnostic);
    }
    if (!isPlainObject(m.overrides)) out.push(diag('E_DOCUMENT', `${at}.overrides must be an object of field paths`, { path: `${at}.overrides` }));
    else for (const [p, v] of Object.entries(m.overrides)) {
      const rule = ruleAt(schema, p);
      if (!rule) out.push(diag('E_PATH', `${at}: override of unknown field ${p}`, { path: `${at}.overrides.${p}` }));
      else checkRule(rule, v, `${at}.${p}`, ctx, out);
    }
    return;
  }
  checkRule(schema, m, at, ctx, out);
  for (const f of PITCH_FIELDS) {
    if (!f.startsWith(`${at}.`)) continue;
    const v = f.slice(at.length + 1).split('.').reduce<unknown>((o, k) => (isPlainObject(o) ? o[k] : undefined), m);
    if (isBindingRef(v)) out.push(diag('E_BINDING', `${f} sets a pitch and cannot be bound`, { path: f }));
  }
}

/** One entry (and, for a group, its children), in a stage. */
function checkEntry(doc: Document, s: StageName, id: Id, e: unknown, out: Out): void {
  const kind = kindOf(doc.stages as unknown as Record<string, unknown>);
  const lawName = STAGES[s].law;
  if (lawName === null) {
    out.push(diag('E_DOCUMENT', `the ${s} stage takes no entries yet`, { path: id }));
    return;
  }
  const law = getLaw(lawName);
  if (!isPlainObject(e)) {
    out.push(diag('E_DOCUMENT', `entry ${id} must be an object`, { path: id }));
    return;
  }
  const k = e['kind'];
  if (k !== 'layer' && k !== 'group' && k !== 'link') {
    out.push(diag('E_DOCUMENT', `entry ${id}: kind must be layer, group or link`, { path: `${id}.kind`, valid: ['layer', 'group', 'link'] }));
    return;
  }
  const keys = k === 'layer' ? ['op', 'params'] : k === 'group' ? ['stack'] : ['ref', 'params', 'overrides'];
  const all = ['kind', 'name', 'enabled', 'amount', 'mask', 'blend', 'source', ...keys];
  for (const f of Object.keys(e)) if (!all.includes(f)) out.push(diag('E_PATH', `entry ${id} has no field "${f}"`, { path: `${id}.${f}`, valid: all }));
  for (const f of all) if (!(f in e)) out.push(diag('E_DOCUMENT', `entry ${id} needs ${f}`, { path: `${id}.${f}` }));
  if (typeof e['name'] !== 'string') out.push(diag('E_ARG_TYPE', `${id}.name must be a string`, { path: `${id}.name` }));
  if (typeof e['enabled'] !== 'boolean') out.push(diag('E_ARG_TYPE', `${id}.enabled must be a boolean`, { path: `${id}.enabled` }));
  const [lo, hi] = law.amountRange;
  const a = e['amount'];
  if (typeof a !== 'number' || !Number.isFinite(a) || a < lo || a > hi) {
    out.push(diag('E_ARG_RANGE', `${id}.amount = ${JSON.stringify(a)} is outside [${lo}, ${hi}] (the ${law.name} law: ${law.amount === 'scale' ? 'it scales light and density' : 'it is opacity'})`, { path: `${id}.amount`, valid: [`[${lo}, ${hi}]`] }));
  }
  const mask = e['mask'];
  if (mask !== null && (typeof mask !== 'string' || !isId(mask))) out.push(diag('E_ARG_TYPE', `${id}.mask must be a mask id or null`, { path: `${id}.mask` }));
  const src = e['source'];
  if (!isPlainObject(src) || typeof src['kind'] !== 'string') out.push(diag('E_ARG_TYPE', `${id}.source must be a provenance {kind, …}`, { path: `${id}.source` }));
  const blend = e['blend'];
  const layerBlends: readonly string[] = law.blend ? BLEND_MODES : ['normal'];
  const groupBlends: readonly string[] = [...(law.groups.includes('pass') ? ['pass'] : []), ...(law.groups.includes('isolated') ? BLEND_MODES : [])];
  const blends = k === 'layer' ? layerBlends : groupBlends;
  if (!blends.includes(blend as string)) {
    out.push(diag('E_DOCUMENT', `${id}.blend = ${JSON.stringify(blend)}: the ${law.name} law allows ${blends.join(', ')} for a ${k}`, { path: `${id}.blend`, valid: [...blends] }));
  }
  if (k === 'layer') {
    const op = e['op'];
    if (typeof op !== 'string' || !hasOp(op)) {
      const names = opsForStage(s).map((o) => o.name);
      const g = typeof op === 'string' ? closest(op, names) : undefined;
      out.push(diag('E_UNKNOWN_OP', `${id}: unknown op ${JSON.stringify(op)}`, { path: `${id}.op`, ...(g ? { hint: `did you mean ${g}?` } : {}), valid: names }));
      return;
    }
    const def = getOp(op);
    if (!def.stages?.includes(s)) {
      out.push(diag('E_DOCUMENT', `${id}: ${op} does not live in the ${s} stage${def.stages ? ` (it lives in ${def.stages.join(', ')})` : ' (it is not a layer op)'}`, { path: `${id}.op`, valid: opsForStage(s).map((o) => o.name) }));
      return;
    }
    checkParams(def, e['params'], `${id}.params`, { kind, stage: s, use: 'binding' }, out);
  } else if (k === 'group') {
    const p = Coll.problem(e['stack']);
    if (p) out.push(diag('E_DOCUMENT', `${id}.stack: ${p}`, { path: `${id}.stack` }));
    else for (const [cid, c] of Coll.entries(e['stack'] as Coll<unknown>)) checkEntry(doc, s, cid, c, out);
  } else {
    try {
      linkKind(e['ref'] as never);
    } catch (err) {
      if (isChromobenchError(err)) out.push({ ...err.diag, path: `${id}.ref` } as Diagnostic);
    }
    if (!isPlainObject(e['params'])) out.push(diag('E_ARG_TYPE', `${id}.params must be an object`, { path: `${id}.params` }));
    if (!isPlainObject(e['overrides'])) out.push(diag('E_ARG_TYPE', `${id}.overrides must be an object of paths`, { path: `${id}.overrides` }));
  }
}

function checkMask(doc: Document, id: Id, m: unknown, out: Out): void {
  const kind = kindOf(doc.stages as unknown as Record<string, unknown>);
  if (!isPlainObject(m)) {
    out.push(diag('E_DOCUMENT', `mask ${id} must be an object`, { path: id }));
    return;
  }
  const all = ['name', 'components', 'feather_mm', 'invert', 'reads', 'grow_mm', 'density'];
  for (const f of Object.keys(m)) if (!all.includes(f)) out.push(diag('E_PATH', `mask ${id} has no field "${f}"`, { path: `${id}.${f}`, valid: all }));
  if (typeof m['name'] !== 'string') out.push(diag('E_ARG_TYPE', `${id}.name must be a string`, { path: `${id}.name` }));
  const f = m['feather_mm'];
  if (typeof f !== 'number' || !Number.isFinite(f) || f < 0 || f > 1000) out.push(diag('E_ARG_RANGE', `${id}.feather_mm must be in [0, 1000] (mm on the print)`, { path: `${id}.feather_mm` }));
  if (typeof m['invert'] !== 'boolean') out.push(diag('E_ARG_TYPE', `${id}.invert must be a boolean`, { path: `${id}.invert` }));
  // contract 1.6: absent means the default (0, 1), as a layer's params may omit a defaulted argument
  const g = m['grow_mm'];
  if (g !== undefined && (typeof g !== 'number' || !Number.isFinite(g) || Math.abs(g) > 1000)) out.push(diag('E_ARG_RANGE', `${id}.grow_mm must be in [-1000, 1000] (mm on the print)`, { path: `${id}.grow_mm` }));
  const dn = m['density'];
  if (dn !== undefined && (typeof dn !== 'number' || !Number.isFinite(dn) || dn < 0 || dn > 1)) out.push(diag('E_ARG_RANGE', `${id}.density must be in [0, 1]`, { path: `${id}.density` }));
  const reads = m['reads'];
  const cut = typeof reads === 'string' ? cutDef(reads) : undefined;
  if (reads !== 'stage-input' && (!cut || !cut.kinds.includes(kind))) {
    out.push(diag('E_CUT', `${id}.reads = ${JSON.stringify(reads)}: 'stage-input' or a cut of a ${kind} document`, { path: `${id}.reads`, valid: ['stage-input', ...CUT_NAMES.filter((c) => cutDef(c)!.kinds.includes(kind))] }));
  }
  const comps = m['components'];
  const p = Coll.problem(comps);
  if (p) {
    out.push(diag('E_DOCUMENT', `${id}.components: ${p}`, { path: `${id}.components` }));
    return;
  }
  for (const [cid, c] of Coll.entries(comps as Coll<unknown>)) {
    if (!isPlainObject(c)) {
      out.push(diag('E_DOCUMENT', `component ${cid} must be an object`, { path: cid }));
      continue;
    }
    const call = ['kind', 'params', 'combine', 'amount', 'enabled', 'invert'];
    for (const x of Object.keys(c)) if (!call.includes(x)) out.push(diag('E_PATH', `component ${cid} has no field "${x}"`, { path: `${cid}.${x}`, valid: call }));
    if (!MASK_COMPONENT_KINDS.includes(c['kind'] as never)) {
      out.push(diag('E_DOCUMENT', `${cid}.kind must be one of ${MASK_COMPONENT_KINDS.join(', ')}`, { path: `${cid}.kind`, valid: [...MASK_COMPONENT_KINDS] }));
      continue;
    }
    if (!MASK_COMBINES.includes(c['combine'] as never)) out.push(diag('E_DOCUMENT', `${cid}.combine must be add, subtract or intersect`, { path: `${cid}.combine`, valid: [...MASK_COMBINES] }));
    const a = c['amount'];
    if (typeof a !== 'number' || !Number.isFinite(a) || a < 0 || a > 1) out.push(diag('E_ARG_RANGE', `${cid}.amount must be in [0, 1]`, { path: `${cid}.amount` }));
    if (typeof c['enabled'] !== 'boolean') out.push(diag('E_ARG_TYPE', `${cid}.enabled must be a boolean`, { path: `${cid}.enabled` }));
    if (c['invert'] !== undefined && typeof c['invert'] !== 'boolean') out.push(diag('E_ARG_TYPE', `${cid}.invert must be a boolean`, { path: `${cid}.invert` }));
    checkParams(getOp(`mask.${c['kind'] as string}`), c['params'], `${cid}.params`, { kind, use: 'binding' }, out);
  }
}

function checkProbe(id: Id, p: unknown, out: Out): void {
  const ok = isPlainObject(p) && Object.keys(p).sort().join() === 'r,x,y' && ['x', 'y', 'r'].every((k) => typeof p[k] === 'number' && Number.isFinite(p[k])) && (p['r'] as number) > 0;
  if (!ok) out.push(diag('E_ARG_TYPE', `probe ${id} must be {x, y, r} in document px with r > 0`, { path: id }));
}

function checkSource(v: unknown, out: Out): void {
  if (!isPlainObject(v) || typeof v['sha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(v['sha256']) || !isPlainObject(v['decode'])) {
    out.push(diag('E_DOCUMENT', 'source needs a 64-hex sha256 and decode options', { path: 'source' }));
    return;
  }
  if (v['kind'] !== 'file' && v['kind'] !== 'triplet') out.push(diag('E_DOCUMENT', "source.kind must be 'file' or 'triplet'", { path: 'source.kind' }));
  if ('bytes' in v) out.push(diag('E_DOCUMENT', 'source bytes are never persisted', { path: 'source.bytes' }));
  const d = v['decode'];
  if (d['mode'] !== 'scan' && d['mode'] !== 'photo') out.push(diag('E_DOCUMENT', "source.decode.mode must be 'scan' or 'photo'", { path: 'source.decode.mode' }));
  if (!['linear', 'srgb', 'gamma22'].includes(d['encoding'] as string)) out.push(diag('E_DOCUMENT', 'source.decode.encoding must be linear, srgb or gamma22', { path: 'source.decode.encoding' }));
}

function walk(stack: Coll<unknown>, f: (id: Id, e: Record<string, unknown>) => void): void {
  for (const [id, e] of Coll.entries(stack)) {
    if (!isPlainObject(e)) continue;
    f(id, e);
    if (e['kind'] === 'group' && Coll.is(e['stack'])) walk(e['stack'], f);
  }
}

/** Rules over the whole document: one main exposure; masks exist and are readable where they are used. */
function checkGlobal(doc: Document, out: Out): void {
  const kind = kindOf(doc.stages as unknown as Record<string, unknown>);
  const mains: Id[] = [];
  const dark = doc.stages.darkroom?.stack;
  if (dark && Coll.is(dark)) walk(dark as Coll<unknown>, (id, e) => { if (e['kind'] === 'layer' && e['op'] === 'expose') mains.push(id); });
  if (mains.length !== 1 || mains[0] !== 'main') {
    out.push(diag('E_DOCUMENT', mains.length === 0 ? 'the darkroom needs its main exposure: an expose layer with id main'
      : mains.length > 1 ? `the darkroom has ${mains.length} main exposures (${mains.join(', ')}); exactly one, id main`
        : `the main exposure's id must be main, not ${mains[0]}`, { path: 'stages.darkroom.stack', valid: ['main'] }));
  }
  for (const s of STAGE_NAMES) {
    const st = doc.stages[s];
    if (!st || !Coll.is(st.stack)) continue;
    walk(st.stack as Coll<unknown>, (id, e) => {
      const m = e['mask'];
      if (typeof m !== 'string') return;
      const mask = Coll.get(doc.masks, m);
      if (!mask) {
        out.push(diag('E_DOCUMENT', `${id}.mask: no mask ${m}`, { path: `${id}.mask`, valid: [...doc.masks.order] }));
        return;
      }
      const ok = readableCuts(s, kind, 'mask');
      if (mask.reads !== 'stage-input' && !ok.includes(mask.reads)) {
        out.push(diag('E_CUT', `${id} (${s}) uses mask ${m}, which reads ${mask.reads}: the ${s} stage may only read cuts before it`, { path: `${id}.mask`, valid: ok }));
      }
    });
  }
}

// ---- the document ------------------------------------------------------------------------------------------------

/** Every problem of a document (empty = valid). Recipes (versions 1 and 2) are refused: there is no migration. */
export function validateDocument(x: unknown): Diagnostic[] {
  const out: Out = [];
  if (!isPlainObject(x)) return [diag('E_DOCUMENT', 'a document must be an object')];
  if (x['format'] !== DOCUMENT_FORMAT) {
    const old = 'version' in x;
    return [diag('E_DOCUMENT', old ? `this is a recipe (version ${String(x['version'])}), not a document: contract 1.0 reads format 3 only, with no migration`
      : `unsupported document format ${String(x['format'])}`, { path: 'format', hint: old ? 'open the frame again from its source' : 'format 3' })];
  }
  for (const k of Object.keys(x)) if (!ROOT_KEYS.includes(k)) out.push(diag('E_PATH', `a document has no field "${k}"`, { path: k, valid: [...ROOT_KEYS] }));
  for (const k of ROOT_KEYS) if (!(k in x)) out.push(diag('E_DOCUMENT', `missing ${k}`, { path: k }));
  if (out.length) return out;
  try {
    indexOf(x);
  } catch (e) {
    if (e instanceof ValueError) return [e.diag as Diagnostic];
    throw e;
  }
  const doc = x as unknown as Document;
  if (typeof x['frame'] !== 'string' || !x['frame']) out.push(diag('E_DOCUMENT', 'frame must be a non-empty string', { path: 'frame' }));
  checkSource(x['source'], out);
  const data = x['data'];
  if (!(data === null || (isPlainObject(data) && typeof data['pack'] === 'string' && typeof data['packHash'] === 'string'))) out.push(diag('E_DOCUMENT', 'data must be {pack, packHash} or null', { path: 'data' }));
  const stages = x['stages'];
  if (!isPlainObject(stages)) return [...out, diag('E_DOCUMENT', 'stages must be an object', { path: 'stages' })];
  const kind = kindOf(stages);
  const want = STAGES_OF[kind];
  for (const s of Object.keys(stages)) {
    if (!want.includes(s as StageName)) out.push(diag('E_DOCUMENT', `a ${kind} document has no ${s} stage`, { path: `stages.${s}`, valid: want }));
  }
  for (const s of want) {
    const st = stages[s];
    if (!isPlainObject(st) || Object.keys(st).sort().join() !== 'medium,stack') {
      out.push(diag('E_DOCUMENT', `stages.${s} must be {medium, stack}`, { path: `stages.${s}` }));
      continue;
    }
    checkMedium(doc, s, st['medium'], out);
    for (const [id, e] of Coll.entries(st['stack'] as Coll<unknown>)) checkEntry(doc, s, id, e, out);
  }
  for (const [id, m] of Coll.entries(doc.masks as Coll<unknown>)) checkMask(doc, id, m, out);
  for (const [id, p] of Coll.entries(doc.probes as Coll<unknown>)) checkProbe(id, p, out);
  checkRule(schemas().geometry, x['geometry'], 'geometry', { kind, use: 'medium' }, out);
  checkRule(schemas().output, x['output'], 'output', { kind, use: 'medium' }, out);
  if (!out.length) checkGlobal(doc, out);
  return out;
}

function raise(d: readonly Diagnostic[]): never {
  throw new ChromobenchError({ ...d[0]!, message: `${d[0]!.message}${d.length > 1 ? ` (+${d.length - 1} more)` : ''}` });
}

export function assertDocument(x: unknown): asserts x is Document {
  const d = validateDocument(x);
  if (d.length) raise(d);
}

// ---- the values hooks ----------------------------------------------------------------------------------------------

/** What a change touched: an entry (with its stage), a mask, a probe, a medium, a root section. */
type Unit = { entry: Id; stage: StageName } | { mask: Id } | { probe: Id } | { medium: StageName } | { section: string } | null;

function stageOfTop(idx: DocIndex, id: Id): StageName | undefined {
  let cur: Id = id;
  for (let p = idx.parentOf(cur); p !== null && p !== undefined; p = idx.parentOf(cur)) cur = p;
  const m = /^stages\.(\w+)\.stack$/.exec(idx.locate(cur)?.coll ?? '');
  return m ? (m[1] as StageName) : undefined;
}

/** The unit an item belongs to: the nearest entry (an item of a stage or group stack), mask or probe above it. */
function unitOf(doc: Document, idx: DocIndex, id: Id): Unit {
  for (let cur: Id | null | undefined = id; cur; cur = idx.parentOf(cur)) {
    const coll = idx.locate(cur)?.coll ?? '';
    const parent = idx.parentOf(cur);
    const inGroup = parent && coll === `${parent}.stack` && stageOfTop(idx, parent) !== undefined;
    if (/^stages\.\w+\.stack$/.test(coll) || inGroup) return { entry: cur, stage: stageOfTop(idx, cur)! };
    if (coll === 'masks') return { mask: cur };
    if (coll === 'probes') return { probe: cur };
  }
  void doc;
  return null;
}

function unitOfPath(doc: Document, idx: DocIndex, path: string): Unit {
  const [first, second, third] = path.split('.');
  if (idx.has(first!)) return unitOf(doc, idx, first!);
  if (first === 'stages' && second && third === 'medium') return { medium: second as StageName };
  if (first === 'stages' && second && third === 'stack') return { section: `stages.${second}.stack` };
  return { section: first! };
}

function checkUnit(doc: Document, u: Unit, out: Out): void {
  if (!u) return;
  const kind = kindOf(doc.stages as unknown as Record<string, unknown>);
  if ('entry' in u) {
    const st = doc.stages[u.stage]!;
    const find = (stack: Coll<unknown>): unknown => {
      for (const [id, e] of Coll.entries(stack)) {
        if (id === u.entry) return e;
        if (isPlainObject(e) && Coll.is(e['stack'])) {
          const f = find(e['stack']);
          if (f !== undefined) return f;
        }
      }
      return undefined;
    };
    checkEntry(doc, u.stage, u.entry, find(st.stack as Coll<unknown>), out);
  } else if ('mask' in u) checkMask(doc, u.mask, Coll.get(doc.masks, u.mask), out);
  else if ('probe' in u) checkProbe(u.probe, Coll.get(doc.probes, u.probe), out);
  else if ('medium' in u) {
    if (!STAGES_OF[kind].includes(u.medium)) out.push(diag('E_PATH', `a ${kind} document has no ${u.medium} stage`, { path: `stages.${u.medium}` }));
    else checkMedium(doc, u.medium, doc.stages[u.medium]!.medium, out);
  } else {
    const s = u.section;
    if (s === 'geometry') checkRule(schemas().geometry, doc.geometry, 'geometry', { kind, use: 'medium' }, out);
    else if (s === 'output') checkRule(schemas().output, doc.output, 'output', { kind, use: 'medium' }, out);
    else if (s === 'source') checkSource(doc.source, out);
    else if (s.startsWith('stages.') && s.endsWith('.stack')) {
      const st = s.split('.')[1] as StageName;
      for (const [id, e] of Coll.entries((doc.stages[st]?.stack ?? Coll.empty()) as Coll<unknown>)) checkEntry(doc, st, id, e, out);
    } else if (s === 'format' || s === 'stages') out.push(diag('E_PATH', `${s} cannot be set; a document's ${s === 'format' ? 'format' : 'stages'} are fixed when it is made`, { path: s }));
  }
}

/** The per-mutation hook: checks what the mutation touched (the global rules wait for the end of the transaction). */
export function validateChange(c: Change<Document>): readonly Diagnostic[] {
  const m: Mutation = c.mutation;
  const out: Out = [];
  const doc = c.after;
  const idx = c.index;
  switch (m.op) {
    case 'set': checkUnit(doc, unitOfPath(doc, idx, m.path), out); break;
    case 'insert': {
      const coll = m.coll;
      if (/^stages\.\w+\.stack$/.test(coll)) checkUnit(doc, { entry: m.id, stage: coll.split('.')[1] as StageName }, out);
      else if (coll === 'masks') checkUnit(doc, { mask: m.id }, out);
      else if (coll === 'probes') checkUnit(doc, { probe: m.id }, out);
      else checkUnit(doc, unitOf(doc, idx, m.id), out);
      break;
    }
    case 'remove': {
      const before = indexOf(c.before).locate(m.id);
      if (before?.parent) checkUnit(doc, unitOf(doc, idx, before.parent), out);
      break;
    }
    case 'move': checkUnit(doc, unitOf(doc, idx, m.id), out); break;
  }
  if (out.length) raise(out);
  return [];
}

/** The per-transaction hook: the whole document, once, on the final version. */
export function validateFinal(c: { after: Document }): readonly Diagnostic[] {
  const d = validateDocument(c.after);
  if (d.length) raise(d);
  return [];
}

/** The contract's rules as values transaction options (pass to applyTransaction / tryTransaction). */
export const DOCUMENT_RULES: TxOptions<Diagnostic, Document> = Object.freeze({ validate: validateChange, validateTransaction: validateFinal });

/**
 * The document log's rules (design §26): a frame's document is opened with kind 'frame', so every commit, proposal,
 * approval and draft of it is checked by DOCUMENT_RULES. `Log.create({ rules: LOG_RULES })`,
 * `log.open(doc.frame, doc, { kind: 'frame', by: 'auto' })`.
 */
export const LOG_RULES: Rules = Object.freeze({ frame: DOCUMENT_RULES });

/** Applies mutations to a document as one transaction under the contract's rules (all or nothing). */
export function edit(doc: Document, mutations: readonly Mutation[], meta: Partial<Omit<TransactionInit, 'mutations'>> = {}): TxApplied<Document, Diagnostic> {
  const tx = transaction({ id: meta.id ?? 'edit', label: meta.label ?? 'edit', by: meta.by ?? 'user', source: (meta.source ?? {}) as JsonObject, ...(meta.batch !== undefined ? { batch: meta.batch } : {}), mutations });
  return applyTransaction(doc, tx, DOCUMENT_RULES);
}
