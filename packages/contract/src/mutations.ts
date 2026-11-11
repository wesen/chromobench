// The closed set of recipe mutations (architecture doc §5.4, guide §5.8). Enforced by the host
// (the frame's EditLog), never by the agent's good behaviour.
import { ChromobenchError, diag, fail, type Diagnostic } from './errors.ts';
import { Graph } from './graph.ts';
import { assertRecipe, checkSet, getPath, setPath } from './paths.ts';
import type { Exposure, FrameRecipe, MaskSpec } from './recipe.ts';
import { closest, getOp } from './registry.ts';

export type Mutation =
  | { op: 'set'; path: string; value: unknown; /** Value the proposer saw (DR-7); filled by propose(). */ expect?: unknown }
  | { op: 'exposure.add'; exposure: ExposureInput }
  | { op: 'exposure.remove'; id: string }
  | { op: 'mask.set'; id: string; mask: MaskSpec }
  | { op: 'frame.add'; recipe: FrameRecipe };

/** Missing optional fields are filled with neutral values (enabled, no mask, …). */
export type ExposureInput = Pick<Exposure, 'id' | 'kind'> & Partial<Omit<Exposure, 'id' | 'kind'>>;

export const MUTATION_OPS = ['set', 'exposure.add', 'exposure.remove', 'mask.set', 'frame.add'] as const;
export type MutationOp = (typeof MUTATION_OPS)[number];

export type Author = 'user' | 'agent' | 'auto';

export interface LoggedMutation {
  /** Per-frame monotonic sequence number, from 1. */
  seq: number;
  frame: string;
  m: Mutation;
  by: Author;
  tx?: string;
  ts: number;
  status: 'applied' | 'pending' | 'rejected';
  /** The agent's one-line reason, shown on the approval card. */
  why?: string;
  approvedBy?: 'user';
}

export interface MutationContext {
  /** When given, mask.set adopts the MaskSpec into it (full check); otherwise structure only. */
  graph?: Graph;
}

const ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Validates one mutation against a recipe and returns the new recipe plus warnings.
 * Throws ChromobenchError (E_UNKNOWN_OP, E_PATH, E_ARG_*, E_MUTATION, E_RECIPE).
 */
export function applyMutation(r: FrameRecipe, m: Mutation, ctx: MutationContext = {}): { recipe: FrameRecipe; warnings: Diagnostic[]; value?: unknown } {
  switch (m?.op) {
    case 'set': {
      if (typeof m.path !== 'string') fail('E_PATH', 'set needs a path');
      const { value, warnings } = checkSet(r, m.path, m.value);
      return { recipe: setPath(r, m.path, value), warnings, value };
    }
    case 'exposure.add': {
      const e = m.exposure;
      if (!e || typeof e.id !== 'string' || !ID_RE.test(e.id)) fail('E_MUTATION', 'exposure.add needs an id of letters, digits, _ or -');
      if (r.print.exposures.some((x) => x.id === e.id)) fail('E_MUTATION', `exposure ${e.id} already exists`, { valid: r.print.exposures.map((x) => x.id) });
      if ((e.kind as string) === 'main') fail('E_MUTATION', "kind 'main' is reserved: the main exposure is print.enlarger", { valid: ['dodge', 'burn', 'flash', 'split'] });
      if (e.kind === 'dodge' && e.filtration) fail('E_MUTATION', 'a dodge cannot carry filtration');
      const full: Exposure = { id: e.id, kind: e.kind, enabled: e.enabled ?? true, mask: e.mask ?? null, time_s: e.time_s ?? null, stops: e.stops ?? null, filtration: e.filtration ?? null, through: e.through ?? null };
      const next = { ...r, print: { ...r.print, exposures: [...r.print.exposures, full] } };
      for (const k of ['kind', 'enabled', 'mask', 'time_s', 'stops', 'filtration', 'through'] as const) checkSet(next, `print.exposures.${e.id}.${k}`, full[k]);
      if (full.mask !== null && !(full.mask in r.masks)) fail('E_MUTATION', `unknown mask ${full.mask}`, { valid: Object.keys(r.masks) });
      return { recipe: next, warnings: [] };
    }
    case 'exposure.remove': {
      if (!r.print.exposures.some((x) => x.id === m.id)) fail('E_MUTATION', `no exposure ${m.id}`, { valid: r.print.exposures.map((x) => x.id) });
      return { recipe: { ...r, print: { ...r.print, exposures: r.print.exposures.filter((x) => x.id !== m.id) } }, warnings: [] };
    }
    case 'mask.set': {
      if (typeof m.id !== 'string' || !ID_RE.test(m.id)) fail('E_MUTATION', 'mask.set needs an id of letters, digits, _ or -');
      const spec = m.mask;
      if (!spec || spec.version !== 1 || !Array.isArray(spec.nodes) || spec.nodes.length === 0) fail('E_MUTATION', 'mask must be {version: 1, nodes: NodeDef[]}');
      const last = spec.nodes[spec.nodes.length - 1]!;
      if (getOp(last.op).returns !== 'Mask') fail('E_DOMAIN', `mask root ${last.op} does not produce a mask`, { hint: 'the last node must be a mask.* op' });
      if (ctx.graph) {
        const nodes = ctx.graph.adopt(spec.nodes);
        const root = nodes[nodes.length - 1]!;
        if (root.info.kind !== 'Image' || root.info.domain !== 'mask') fail('E_DOMAIN', 'mask root is not in the mask domain');
      }
      return { recipe: { ...r, masks: { ...r.masks, [m.id]: spec } }, warnings: [] };
    }
    case 'frame.add': {
      assertRecipe(m.recipe);
      return { recipe: m.recipe, warnings: [] };
    }
    default: {
      const op = String((m as { op?: unknown })?.op);
      const guess = closest(op, MUTATION_OPS);
      return fail('E_UNKNOWN_OP', `unknown mutation op "${op}"`, { ...(guess ? { hint: `did you mean ${guess}?` } : {}), valid: [...MUTATION_OPS] });
    }
  }
}

/** Validates without applying; returns a Diagnostic or null. */
export function validateMutation(r: FrameRecipe, m: Mutation, ctx: MutationContext = {}): Diagnostic | null {
  try {
    applyMutation(r, m, ctx);
    return null;
  } catch (e) {
    if (e instanceof ChromobenchError) return e.diag;
    return diag('E_INTERNAL', String(e));
  }
}

/** Paths a mutation writes (for why()). */
export function mutationPaths(m: Mutation): string[] {
  switch (m.op) {
    case 'set': return [m.path];
    case 'exposure.add': return [`print.exposures.${m.exposure.id}`];
    case 'exposure.remove': return [`print.exposures.${m.id}`];
    case 'mask.set': return [`masks.${m.id}`];
    case 'frame.add': return [''];
  }
}

/** Current value a `set` would replace (DR-7 expect). */
export function currentValue(r: FrameRecipe, path: string): unknown {
  return getPath(r, path);
}
