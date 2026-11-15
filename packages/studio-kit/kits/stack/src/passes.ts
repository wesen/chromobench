// cb.kits.stack: the stage policy pass (CB-S101, CB-S102; replaces CB-F101 and v1's CB-E101). A module declares the
// stages it shows (`ck.module(id, { stages: ['darkroom', 'print'] })` or `.stages(…)`); every control knows its
// op's stages from the catalogue and every stack view names its stage, so the pass warns when a module shows a
// stage it does not declare. A layout that mixes stages on purpose declares them all, which documents the choice.
// Media controls are a stage's settings, not its edits, and are not counted (a darkroom module shows the film stock
// and the viewing light that set up the print).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Ck, NodeData } from '@chromobench/shell';
import { closest, getOp, hasOp, STAGE_NAMES, type StageName } from '@chromobench/contract';
import { modelAt } from '../../../src/kit/args.ts';

/** every node under a node (children, and nodes held in props: a match's cases, a row lambda's fixed parts) */
export function walk(n: unknown, f: (n: NodeData) => void, seen = new Set<unknown>()): void {
  if (!n || typeof n !== 'object' || seen.has(n)) return;
  seen.add(n);
  const d = n as NodeData;
  if (typeof d.$ === 'string' && d.props) {
    f(d);
    for (const k of d.kids ?? []) walk(k, f, seen);
    for (const v of Object.values(d.props)) {
      if (Array.isArray(v)) for (const x of v) walk(x, f, seen);
      else if (v && typeof v === 'object') {
        walk(v, f, seen);
        for (const x of Object.values(v as object)) walk(x, f, seen);
      }
    }
  }
}

const PARAM_RE = /^([A-Za-z0-9_-]+)\.params\.[A-Za-z_]\w*/;
/** The stages a node shows: a layer control's op stages, a stack view's stage; [] for anything else. */
export function stagesShown(n: NodeData): StageName[] {
  if (n.$ === 'cb.arg') {
    const path = String(n.props['path'] ?? '');
    if (!PARAM_RE.test(path)) return [];
    const m = modelAt(path.replace(/\.[cmyrgb012]$/i, '')) ?? modelAt(path);
    return m && hasOp(m.op) ? [...(getOp(m.op).stages ?? [])] : [];
  }
  if (n.$ === 'stack.layers' || n.$ === 'stack.row') {
    const s = n.props['stage'];
    return typeof s === 'string' ? [s as StageName] : [];
  }
  return [];
}

export function stagePolicy(ck: Ck): any {
  return ck.pass('cb.stack.stages', { on: 'ui', after: 'slots' }, (ir: any, p) => {
    for (const m of ir.modules as { id: string; label: string; at?: unknown; stages?: readonly string[]; regions: Record<string, NodeData | null> }[]) {
      const declared = m.stages ?? [];
      for (const s of declared) {
        if ((STAGE_NAMES as readonly string[]).includes(s)) continue;
        const g = closest(s, [...STAGE_NAMES]);
        p.error('CB-S102', `module '${m.id}' declares the stage '${s}', which does not exist`, { at: m.at as any, facts: [`stages: ${STAGE_NAMES.join(', ')}`], ...(g ? { fix: `'${g}'` } : {}) });
      }
      const seen = new Set<string>();
      for (const r of Object.values(m.regions ?? {})) walk(r, (n) => {
        const shown = stagesShown(n);
        if (!shown.length || shown.some((s) => declared.includes(s))) return;
        const what = n.$ === 'cb.arg' ? `cb.arg('${n.props['path']}')` : `${n.$}('${n.props['stage']}')`;
        if (seen.has(what)) return;
        seen.add(what);
        const stage = shown.join(' or ');
        p.warn('CB-S101', `${what} shows the ${stage} stage in the module '${m.label}', which ${declared.length ? `declares ${declared.join(', ')}` : 'declares no stages'}`, {
          at: n.at,
          facts: [`the ${stage} stage ${shown.length > 1 ? 'are' : 'is'} where this edit acts; a module says which stages it shows`],
          fix: `ck.module('${m.id}', { …, stages: [${[...declared, shown[0]!].map((x) => `'${x}'`).join(', ')}] })`,
        });
      });
    }
  });
}
