// The frame vocabulary (contract 0.3, CHB-019 R2): the words `frame.negative()`, `frame.print({…})` … that the
// agent DSL (packages/dsl Host) and the studio's viewer handles (packages/studio-kit cb.frame(s)) both use, so
// viewer and agent name the same node for the same words. One module, imported by both.
import type { Domain } from './domains.ts';
import { fail } from './errors.ts';
import { compile, type CompileOptions, type Graph, type Node } from './graph.ts';
import type { FrameRecipe } from './recipe.ts';

export type Accessor = 'negative' | 'print' | 'scan' | 'source' | 'display';

/** Accessors on `frame`: the compiled-chain op whose node they name, and its domain. */
export const FRAME_ACCESSORS: readonly { readonly name: Accessor; readonly domain: Domain; readonly op: string }[] = Object.freeze([
  { name: 'negative', domain: 'film-dyes', op: 'invert.dyes' },
  { name: 'print', domain: 'print-xyz', op: 'view.adapt' },
  { name: 'scan', domain: 'scanner-density', op: 'scan.density' }, // accessorNode: the receiver of invert.dyes (scan.heal when dust is healed)
  { name: 'source', domain: 'camera-linear', op: 'source.open' },
  { name: 'display', domain: 'display-rgb', op: 'output.frame' },
]);
export const ACCESSORS: readonly Accessor[] = Object.freeze(FRAME_ACCESSORS.map((a) => a.name));

/** Options of the `frame.print({…})` macro → the op argument that owns and validates each one. */
export const PRINT_OPTIONS: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  paper: ['print.expose', 'paper'],
  time_s: ['print.expose', 'time_s'],
  fstop: ['print.expose', 'fstop'],
  filtration: ['print.expose', 'filtration'],
  lights: ['print.lights', 'logH'],
  grade: ['print.develop', 'grade'],
  preflash: ['print.preflash', 'amount'],
  illuminant: ['view.reflect', 'illuminant'],
  flare: ['view.flare', 'flare'],
});

/** The recipe path each print() option sets (a what-if on a copy of the recipe). */
export const PRINT_OPTION_PATHS: Readonly<Record<string, string>> = Object.freeze({
  paper: 'print.paper',
  time_s: 'print.enlarger.time_s',
  fstop: 'print.enlarger.fstop',
  filtration: 'print.enlarger.filtration',
  lights: 'print.lights.logH',
  grade: 'print.grade',
  preflash: 'print.preflash',
  illuminant: 'view.illuminant',
  flare: 'view.flare',
});

/** Node ids of a node's closure, inputs first (Graph.closure order). */
function closureNodes(g: Graph, id: string): Node[] {
  const out: Node[] = [];
  const seen = new Set<string>();
  const visit = (nid: string): void => {
    if (seen.has(nid)) return;
    seen.add(nid);
    const n = g.get(nid) ?? fail('E_NO_NODE', `unknown node ${nid.slice(0, 12)}…`);
    for (const i of n.inputs) visit(i);
    out.push(n);
  };
  visit(id);
  return out;
}

/**
 * The node of a frame's compiled chain with the given op: the last one in the closure of compile(r), or the
 * top (output.frame) itself. E_INTERNAL when the chain has no such op (e.g. invert.dyes of a digital-raw frame).
 */
export function cut(r: FrameRecipe, g: Graph, op: string, opts: CompileOptions = {}): Node {
  const top = compile(r, g, opts);
  if (op === top.op) return top;
  let found: Node | undefined;
  for (const n of closureNodes(g, top.id)) if (n.op === op) found = n;
  return found ?? fail('E_INTERNAL', `compiled chain has no ${op}`);
}

/** The node an accessor names (frame.negative() → invert.dyes, …); `scan` is invert.dyes' receiver. */
export function accessorNode(r: FrameRecipe, g: Graph, name: Accessor, opts: CompileOptions = {}): Node {
  if (name === 'scan') {
    const dyes = cut(r, g, 'invert.dyes', opts);
    return g.get(dyes.inputs[0]!) ?? fail('E_INTERNAL', 'invert.dyes without a receiver');
  }
  const a = FRAME_ACCESSORS.find((x) => x.name === name) ?? fail('E_INTERNAL', `unknown accessor ${name}`);
  return cut(r, g, a.op, opts);
}
