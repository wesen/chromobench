// Recipe paths: settable paths, get/set, per-path value checks, defaultRecipe and the validator.
import { ChromobenchError, diag, fail, type Diagnostic } from './errors.ts';
import { RECIPE_FIELDS, RECIPE_VERSION, splitPath, type FieldRule, type FrameRecipe } from './recipe.ts';
import { closest, pathOwners } from './registry.ts';
import { checkArgValue, type ArgSpec, type CheckResult } from './spec.ts';
import type { SourceRef, DecodeOptions } from './source.ts';

const PATTERNS = Object.keys(RECIPE_FIELDS).sort();

/** Every settable path pattern ('*' = record key or exposure id). */
export function settablePaths(): string[] {
  return [...PATTERNS];
}

function matches(pattern: string[], path: string[]): boolean {
  return pattern.length === path.length && pattern.every((p, i) => p === '*' || p === path[i]);
}

export function fieldPattern(path: string): string | undefined {
  const segs = splitPath(path);
  return PATTERNS.find((p) => matches(splitPath(p), segs));
}

/** The ArgSpec that checks a path's values (op-owned paths: the first owner), if any. */
export function fieldSpec(pattern: string): ArgSpec | undefined {
  const rule = RECIPE_FIELDS[pattern];
  if (!rule) return undefined;
  if (rule.kind === 'op') return pathOwners(pattern)[0]?.spec;
  if (rule.kind === 'spec') return rule.spec;
  return undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads a path; array segments (print.exposures) are addressed by element id. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of splitPath(path)) {
    if (Array.isArray(cur)) cur = cur.find((e) => isObj(e) && e['id'] === seg);
    else if (isObj(cur)) cur = Object.hasOwn(cur, seg) ? cur[seg] : undefined;
    else return undefined;
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** Copy-on-write delete of a record key (a `set … null` on a deletable entry). A missing key is a no-op. */
export function deletePath<T>(obj: T, path: string): T {
  const segs = splitPath(path);
  const parent = getPath(obj, segs.slice(0, -1).join('.'));
  const key = segs[segs.length - 1]!;
  if (!isObj(parent) || !Object.hasOwn(parent, key)) return obj;
  const { [key]: _gone, ...rest } = parent;
  return setPath(obj, segs.slice(0, -1).join('.'), rest);
}

/** Whether `set path null` deletes a record entry (print.densityMasks.*, retouch.spots.*; contract 0.3). */
export function deletesOnNull(path: string): boolean {
  const pattern = fieldPattern(path);
  const rule = pattern ? RECIPE_FIELDS[pattern] : undefined;
  return rule?.kind === 'custom' && rule.deletes === true;
}

/** Copy-on-write set. Missing record keys are created; missing array ids are refused. */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const segs = splitPath(path);
  const rec = (cur: unknown, i: number): unknown => {
    if (i === segs.length) return value;
    const seg = segs[i]!;
    if (Array.isArray(cur)) {
      const idx = cur.findIndex((e) => isObj(e) && e['id'] === seg);
      if (idx < 0) fail('E_PATH', `no element with id "${seg}" at ${segs.slice(0, i).join('.')}`, { path });
      const copy = cur.slice();
      copy[idx] = rec(cur[idx], i + 1);
      return copy;
    }
    const base = isObj(cur) ? cur : {};
    return { ...base, [seg]: rec(base[seg], i + 1) };
  };
  return rec(obj, 0) as T;
}

function sectionAvailable(r: FrameRecipe, pattern: string): boolean {
  if (pattern.startsWith('scan.')) return r.scan !== undefined;
  if (pattern.startsWith('capture.')) return r.capture !== undefined;
  return true;
}

/** Paths that moved in a contract change: old prefix → new prefix (the E_PATH hint names the new one). */
export const MOVED_PATHS: Readonly<Record<string, string>> = Object.freeze({
  'scan.orientation': 'view.frame.orientation',
  'scan.crop': 'view.frame.crop',
});

function pathError(path: string): never {
  const moved = MOVED_PATHS[path];
  if (moved) fail('E_PATH', `${path} moved to ${moved} in contract 0.3 (both frame kinds have it)`, { path, hint: `set ${moved}`, fix: moved, valid: [moved] });
  const segs = splitPath(path);
  const children = PATTERNS.filter((p) => p.startsWith(`${path}.`));
  if (children.length) {
    fail('E_PATH', `${path} is a group, not a settable value`, { path, hint: `set one of its fields, e.g. ${children[0]}`, valid: children });
  }
  const parent = segs.slice(0, -1).join('.');
  const siblings = PATTERNS.filter((p) => p.startsWith(`${parent}.`));
  const guess = closest(path, PATTERNS);
  return fail('E_PATH', `unknown recipe path "${path}"`, { path, ...(guess ? { hint: `did you mean ${guess}?` } : {}), valid: siblings.length ? siblings : PATTERNS });
}

function checkRule(rule: FieldRule, pattern: string, value: unknown, label: string): CheckResult {
  if (rule.kind === 'custom') {
    if (value === null && rule.deletes) return { value: null, warnings: [] };
    const msg = rule.check(value);
    if (msg) fail('E_ARG_TYPE', `${label}: ${msg}`, { path: label, hint: rule.doc });
    return { value, warnings: [] };
  }
  const spec = rule.kind === 'op' ? pathOwners(pattern)[0]?.spec : rule.spec;
  if (!spec) return fail('E_INTERNAL', `recipe path ${pattern} has no owning op argument`);
  if (value === null) {
    if (rule.kind === 'spec' ? rule.nullable : spec.optional) return { value: null, warnings: [] };
    fail('E_ARG_TYPE', `${label} cannot be null`, { path: label });
  }
  return checkArgValue(spec, value, label);
}

/**
 * Checks a `set` of `path` to `value` against the current recipe. Returns the normalised value
 * (frozen arrays/objects) and RANGE warnings; throws E_PATH / E_ARG_TYPE / E_ARG_RANGE.
 */
export function checkSet(r: FrameRecipe, path: string, value: unknown): CheckResult {
  const pattern = fieldPattern(path);
  if (!pattern) return pathError(path);
  if (!sectionAvailable(r, pattern)) fail('E_PATH', `${path} is not available for a ${r.kind} frame`, { path });
  if (pattern.startsWith('print.exposures.') && getPath(r, splitPath(path).slice(0, 3).join('.')) === undefined) {
    fail('E_PATH', `no exposure "${splitPath(path)[2]}"`, { path, valid: r.print.exposures.map((e) => e.id) });
  }
  return checkRule(RECIPE_FIELDS[pattern]!, pattern, value, path);
}

/** checkSet, then the new recipe: setPath, or deletePath for `null` on a deletable record entry. */
export function applySet(r: FrameRecipe, path: string, value: unknown): CheckResult & { recipe: FrameRecipe } {
  const res = checkSet(r, path, value);
  const recipe = res.value === null && deletesOnNull(path) ? deletePath(r, path) : setPath(r, path, res.value);
  return { ...res, recipe };
}

// ----------------------------------------------------------------------------------------------

export interface NewSource {
  sha256: string;
  kind?: SourceRef['kind'];
  path?: string;
  name?: string;
}

export interface DefaultRecipeOptions {
  frame?: string;
  decode?: Partial<DecodeOptions>;
}

/** A complete recipe with neutral settings; frame.add writes it, so frames never depend on later default changes. */
export function defaultRecipe(kind: FrameRecipe['kind'], source: NewSource, opts: DefaultRecipeOptions = {}): FrameRecipe {
  const src: FrameRecipe['source'] = {
    kind: source.kind ?? 'file',
    sha256: source.sha256,
    ...(source.path !== undefined ? { path: source.path } : {}),
    ...(source.name !== undefined ? { name: source.name } : {}),
    decode: { mode: kind === 'digital-raw' ? 'photo' : 'scan', encoding: 'linear', ...opts.decode },
  };
  const knee = { method: 'oklch' as const, strength: 6 };
  const r: FrameRecipe = {
    version: RECIPE_VERSION,
    frame: opts.frame ?? `frame_${source.sha256.slice(0, 8)}`,
    kind,
    source: src,
    data: null,
    print: {
      paper: 'kodak_portra_endura',
      aim: 'grey-0.184',
      enlarger: { mode: 'real', lamp: 'TH-KG3', filtration: { c: 0, m: 0, y: 0 }, time_s: 10, fstop: 8, magnification: null },
      lights: {
        logH: [0, 0, 0],
        auto: { method: 'none', alpha: 1, analysisLongSide_px: 256, rollConsistency: null, matchFrame: null, matchAmount: null, applied: false, logH: [0, 0, 0] },
      },
      exposures: [],
      densityMasks: {},
      grade: 2,
      preflash: 0,
    },
    view: {
      illuminant: 'D50',
      flare: 0.48,
      output: {
        rendering: 'scan-of-print',
        white: 'D65',
        display: { knee, proof: null },
        export: { format: 'tiff16', space: 'prophoto', knee, scale: 'full', dpi: 300, compression: 'deflate', signal: 'icc', recipe: 'sidecar' },
        printer: null,
      },
      frame: { orientation: 'none', angle_deg: 0, crop: null },
    },
    masks: {},
    probes: {},
    retouch: { spots: {} },
    finishing: { look: 0, values: { clarity: 0, clarity_radius_px: 40 }, hues: {} },
    roll: null,
  };
  if (kind === 'negative-scan') {
    r.scan = {
      scanner: 'xt5-rgb-led', stock: 'kodak_portra_400', format: '135', rebate: null, baseT: null, flat: null, openGate: null,
      flare: 0, dust: { spots: [], method: 'patch', marginPx: 2 },
    };
  } else {
    r.capture = {
      stock: 'kodak_portra_400', exposureEV: 0,
      whiteBalance: { mode: 'daylight', temperature_K: 5500, tint: 0 },
      adapt: 'to-film-reference',
      autoExposure: { method: 'off', analysisLongSide_px: 256 },
      format: { longEdge_mm: 36 },
      development: { push: 0, dir: { amount: 1, diffusion_um: 0 }, halation: { strength: 1 }, grain: { amount: 1, size_um: 12, seed: 1 } },
    };
  }
  return r;
}

/** Expands a pattern over the keys present in the recipe. */
function expand(r: unknown, pattern: string): string[] {
  const segs = splitPath(pattern);
  let paths: string[][] = [[]];
  for (const seg of segs) {
    const next: string[][] = [];
    for (const p of paths) {
      if (seg !== '*') {
        next.push([...p, seg]);
        continue;
      }
      const cur = getPath(r, p.join('.'));
      if (Array.isArray(cur)) for (const e of cur) if (isObj(e) && typeof e['id'] === 'string') next.push([...p, e['id']]);
      if (isObj(cur)) for (const k of Object.keys(cur)) next.push([...p, k]);
    }
    paths = next;
  }
  return paths.map((p) => p.join('.'));
}

/** Validates a whole recipe document. Returns diagnostics (empty = valid). */
export function validateRecipe(x: unknown): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!isObj(x)) return [diag('E_RECIPE', 'recipe must be an object')];
  const r = x as unknown as FrameRecipe;
  if (x['version'] !== RECIPE_VERSION) out.push(diag('E_RECIPE', `unsupported recipe version ${String(x['version'])}`, { hint: 'migrateRecipe() first' }));
  if (typeof x['frame'] !== 'string' || !x['frame']) out.push(diag('E_RECIPE', 'frame must be a non-empty string', { path: 'frame' }));
  if (x['kind'] !== 'negative-scan' && x['kind'] !== 'digital-raw') out.push(diag('E_RECIPE', 'kind must be negative-scan or digital-raw', { path: 'kind' }));
  const src = x['source'];
  if (!isObj(src) || typeof src['sha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(src['sha256']) || !isObj(src['decode'])) {
    out.push(diag('E_RECIPE', 'source needs a 64-hex sha256 and decode options', { path: 'source' }));
  } else if ('bytes' in src) out.push(diag('E_RECIPE', 'source bytes are never persisted', { path: 'source.bytes' }));
  if (x['kind'] === 'negative-scan' && !isObj(x['scan'])) out.push(diag('E_RECIPE', 'negative-scan needs scan settings', { path: 'scan' }));
  if (x['kind'] === 'digital-raw' && !isObj(x['capture'])) out.push(diag('E_RECIPE', 'digital-raw needs capture settings', { path: 'capture' }));
  if (out.length) return out;
  for (const pattern of PATTERNS) {
    if (!sectionAvailable(r, pattern)) continue;
    const isWild = pattern.includes('*');
    for (const p of expand(r, pattern)) {
      const v = getPath(r, p);
      if (v === undefined) {
        if (!isWild) out.push(diag('E_RECIPE', `missing ${p}`, { path: p }));
        continue;
      }
      try {
        checkRule(RECIPE_FIELDS[pattern]!, pattern, v, p);
      } catch (e) {
        if (e instanceof ChromobenchError) out.push(e.diag);
        else throw e;
      }
    }
  }
  const ids = new Set<string>();
  for (const e of r.print.exposures ?? []) {
    if (ids.has(e.id)) out.push(diag('E_RECIPE', `duplicate exposure id ${e.id}`, { path: 'print.exposures' }));
    ids.add(e.id);
    if (e.id.includes('.')) out.push(diag('E_RECIPE', `exposure id ${e.id} contains a dot`, { path: 'print.exposures' }));
    if (e.mask !== null && !(e.mask in (r.masks ?? {}))) out.push(diag('E_RECIPE', `exposure ${e.id} references unknown mask ${e.mask}`, { path: `print.exposures.${e.id}.mask` }));
  }
  for (const [id, m] of Object.entries(r.masks ?? {})) {
    if (!isObj(m) || m['version'] !== 1 || !Array.isArray(m['nodes']) || m['nodes'].length === 0) out.push(diag('E_RECIPE', `mask ${id} must be {version: 1, nodes: NodeDef[]}`, { path: `masks.${id}` }));
  }
  return out;
}

export function assertRecipe(x: unknown): asserts x is FrameRecipe {
  const d = validateRecipe(x);
  if (d.length) throw new ChromobenchError({ ...d[0]!, message: `${d[0]!.message}${d.length > 1 ? ` (+${d.length - 1} more)` : ''}` });
}

/**
 * Contract 0.1 → 0.2 value rename inside recipe version 1: knee method 'cam16-ucs' → 'oklch' (it always was
 * OkLCh; CHB-003 R5). Since contract 0.3 'cam16-ucs' is CAM16-UCS proper, so the rename runs only as part
 * of migrations[1] (version-1 documents). Returns the recipe unchanged (same object) when nothing needs renaming.
 */
export function renameLegacyValues(x: Record<string, unknown>): Record<string, unknown> {
  const knee = (o: unknown, k: 'display' | 'export'): Record<string, unknown> | undefined => {
    const out = isObj(o) && isObj(o['view']) && isObj(o['view']['output']) ? o['view']['output'][k] : undefined;
    return isObj(out) && isObj(out['knee']) ? out['knee'] : undefined;
  };
  if (![knee(x, 'display'), knee(x, 'export')].some((k) => k?.['method'] === 'cam16-ucs')) return x;
  const copy = structuredClone(x);
  for (const k of [knee(copy, 'display'), knee(copy, 'export')]) if (k?.['method'] === 'cam16-ucs') k['method'] = 'oklch';
  return copy;
}

/**
 * Recipe version 1 (contracts 0.1, 0.2) → 2 (contract 0.3): the knee rename; scan.orientation / scan.crop move
 * to view.frame (angle 0); scan.baseT null; print.densityMasks {}; retouch {spots: {}}; roll null.
 */
export function migrateV1(x: Record<string, unknown>): Record<string, unknown> {
  const r = structuredClone(renameLegacyValues(x)) as Record<string, any>;
  const scan = isObj(r['scan']) ? r['scan'] : undefined;
  const frame = { orientation: scan?.['orientation'] ?? 'none', angle_deg: 0, crop: scan?.['crop'] ?? null };
  if (scan) {
    delete scan['orientation'];
    delete scan['crop'];
    if (!('baseT' in scan)) scan['baseT'] = null;
  }
  if (isObj(r['view']) && !('frame' in r['view'])) r['view']['frame'] = frame;
  if (isObj(r['print']) && !('densityMasks' in r['print'])) r['print']['densityMasks'] = {};
  if (!('retouch' in r)) r['retouch'] = { spots: {} };
  if (!('roll' in r)) r['roll'] = null;
  r['version'] = 2;
  return r;
}

/** Path renames of migrateV1, for logged `set` mutations (EditLog version 1 → 2). */
export function migratePathV1(path: string): string {
  return MOVED_PATHS[path] ?? path;
}

/** migrations[n] turns a version-n recipe into version n+1 (there was never a version 0). */
export const migrations: ReadonlyArray<(r: Record<string, unknown>) => Record<string, unknown>> = [
  () => fail('E_RECIPE', 'recipe version 0 never existed'),
  migrateV1,
];

export function migrateRecipe(x: Record<string, unknown>): FrameRecipe {
  let cur = x;
  let v = Number(cur['version']);
  while (v < RECIPE_VERSION) {
    const m = migrations[v] ?? fail('E_RECIPE', `no migration from version ${v}`);
    cur = m(cur);
    v = Number(cur['version']);
  }
  assertRecipe(cur);
  return cur;
}
