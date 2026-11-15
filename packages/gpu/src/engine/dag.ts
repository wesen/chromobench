// DAG evaluation plan (CHB-010; split from engine-gpu.ts, CHB-032). A graph is cut into pointwise tails that end
// at a materialised node: the target, every barrier (isBarrier: multi-input or spatial ops, design §29), every input
// of one, every mask.paint, and every node read by two consumers. planGraph orders the nodes, picks the materialised
// ones and counts how often each texture is read (to release it after its last reader); GpuEngine.execute runs a plan.
import { fail, getOp, type Graph, type Node } from '@chromobench/contract';
import { MAXOPS } from '../chain/program.ts';
import { BARRIER_OPS, FUSIBLE_TOP_OPS, GENERATOR_OPS, type Plan } from './defs.ts';
import { combineArgs, combineIsPointwise } from './light.ts';

type Nodes = Pick<Graph, 'get'>;

/**
 * The top of a composite.mix that fuses into the pointwise kernel (contract 1.1, design §29): no mask, and the top a
 * chain of pointwise single-input ops (FUSIBLE_TOP_OPS) on the mix's own backdrop, short enough that SAVE, the chain
 * and MIX fit one program. Returns the chain (receiver first), or null: the mix is a combine pass.
 */
export function fusedMixTop(g: Nodes, n: Node): Node[] | null {
  if (n.op !== 'composite.mix' || n.args['mask'] !== undefined) return null;
  const back = n.inputs[0]!;
  const chain: Node[] = [];
  for (let id = n.args['top'] as string; id !== back;) {
    const m = g.get(id);
    if (!m || !FUSIBLE_TOP_OPS.has(m.op) || chain.length >= MAXOPS - 2) return null;
    chain.unshift(m);
    id = m.inputs[0]!;
  }
  return chain.length ? chain : null;
}

/**
 * A node computed from materialised inputs (not fused). print.combine fuses when no term reads a texture, a
 * composite.mix when its top is a short pointwise chain on its backdrop and it has no mask (fusedMixTop; without the
 * graph a mix counts as a barrier).
 */
export function isBarrier(n: Node, g?: Nodes): boolean {
  if (n.op === 'print.combine') return !combineIsPointwise(combineArgs(n.args));
  if (n.op === 'composite.mix') return !g || fusedMixTop(g, n) === null;
  return BARRIER_OPS.has(n.op);
}

/**
 * The inputs whose pixels a node reads: none for a generator (it reads only its receiver's size); for print.combine
 * every input but the flash terms' images (a flash is uniform: its x comes from the physics, not from a texture), so
 * a fused print.combine reads its receiver alone.
 */
export function readsOf(n: Node, g?: Nodes): readonly string[] {
  if (GENERATOR_OPS.has(n.op)) return [];
  // a fused mix reads its backdrop alone: its top is recomputed from it inside the program
  if (n.op === 'composite.mix' && g && fusedMixTop(g, n)) return [n.inputs[0]!];
  if (n.op === 'print.combine') {
    const c = combineArgs(n.args);
    const used = new Set<string>([n.inputs[0]!]);
    const add = (id: string | undefined): void => { if (id !== undefined) used.add(id); };
    add(c.mainMask);
    for (const t of c.terms) {
      if (t.role === 'burn' || t.role === 'dodge') add(t.image);
      add(t.mask);
    }
    for (const d of c.densities) { add(d.image); add(d.mask); }
    for (const f of [...c.filters, ...c.preflash]) add(f.mask);
    return n.inputs.filter((i) => used.has(i));
  }
  return n.inputs;
}

/** Evaluation order (inputs first), the plan of each materialised node, and the read count of each texture. */
export function planGraph(graph: Graph, id: string, check: (n: Node) => void, chainOf: (id: string) => Node[]): { order: string[]; plans: Map<string, Plan>; refs: Map<string, number> } {
  const order: string[] = [];
  const seen = new Set<string>();
  const consumers = new Map<string, number>();
  const visit = (nid: string): void => {
    if (seen.has(nid)) return;
    seen.add(nid);
    const n = graph.get(nid) ?? fail('E_NO_NODE', `unknown node ${nid.slice(0, 12)}…`);
    check(n);
    for (const i of readsOf(n, graph)) {
      consumers.set(i, (consumers.get(i) ?? 0) + 1);
      visit(i);
    }
    order.push(nid);
  };
  visit(id);
  const mat = new Set<string>([id]);
  for (const nid of order) {
    const n = graph.get(nid)!;
    if ((consumers.get(nid) ?? 0) >= 2 || n.op === 'mask.paint') mat.add(nid);
    if (isBarrier(n, graph)) {
      mat.add(nid);
      for (const i of readsOf(n, graph)) mat.add(i);
    }
  }
  // plan: what each materialised node reads, for reference counts
  const plans = new Map<string, Plan>();
  const refs = new Map<string, number>([[id, 1]]);
  for (const nid of order) {
    if (!mat.has(nid)) continue;
    const p = planNode(graph, nid, mat, chainOf);
    plans.set(nid, p);
    for (const r of p.reads) refs.set(r, (refs.get(r) ?? 0) + 1);
  }
  return { order, plans, refs };
}

/** What a materialised node reads, and from where its pointwise tail starts. */
export function planNode(graph: Graph, nid: string, mat: ReadonlySet<string>, chainOf: (id: string) => Node[]): Plan {
  const n = graph.get(nid)!;
  if (isBarrier(n, graph)) return { kind: 'barrier', reads: [...new Set(readsOf(n, graph))] };
  const nodes = chainOf(nid);
  for (let i = nodes.length - 1; ; i--) {
    const m = nodes[i]!;
    if (getOp(m.op).on === 'none') return { kind: 'tail', reads: [], nodes, from: 0, root: 'source' };
    if (GENERATOR_OPS.has(m.op)) return { kind: 'tail', reads: [], nodes, from: i, root: 'none' };
    const r = nodes[i - 1]!;
    if (mat.has(r.id)) return { kind: 'tail', reads: [r.id], nodes, from: i, root: 'texture', rootId: r.id };
  }
}
