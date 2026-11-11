// FrameSession (guide §5.4): one open frame — its graph, edit log (with the drag overlay), the nodes
// the viewer and the tools compile from the effective recipe, and snapshots.
import {
  canonicalJSON, compile, defaultRecipe, EditLog, getPath, Graph, RECIPE_FIELDS, sha256Hex,
  type AgentMode, type EditLogData, type Engine, type FrameRecipe, type Mutation, type Node, type OutputSpaceId, type SourceInfo,
} from '@chromobench/contract';

export type ViewMode = 'print' | 'negative' | 'dyes' | 'classes';

/** Computes a frame's first recipe from the default one (the source is registered in `graph`). */
export type InitialRecipe = (defaults: FrameRecipe, graph: Graph) => Promise<FrameRecipe>;

export interface Snapshot {
  id: string;
  frame: string;
  name: string;
  ts: number;
  stateHash: string;
  recipe: FrameRecipe;
}

export class FrameSession {
  readonly sha: string;
  readonly name: string;
  readonly graph: Graph;
  readonly log: EditLog;
  readonly info: SourceInfo;
  readonly engine: Engine;
  displaySpace: OutputSpaceId = 'srgb';
  snapshots: Snapshot[] = [];

  constructor(engine: Engine, info: SourceInfo, name: string, log: EditLog, graph: Graph) {
    this.engine = engine;
    this.graph = graph;
    this.info = info;
    this.sha = info.sha256;
    this.name = name;
    this.log = log;
  }

  /**
   * Opens bytes in the engine and creates (or resumes, by hash) the frame's edit log. `initial` may
   * compute the first recipe from the opened frame (CHB-023: the automatic first print).
   */
  static async open(engine: Engine, bytes: Uint8Array, name: string, opts: { mode: AgentMode; saved?: EditLogData | null; initial?: FrameRecipe | InitialRecipe; sha256?: string }): Promise<FrameSession> {
    const sha = opts.sha256 ?? sha256Hex(bytes);
    const info = await engine.open({ kind: 'file', sha256: sha, name, bytes });
    const graph = new Graph();
    graph.registerSource(info);
    const first = typeof opts.initial === 'function' ? (opts.saved ? null : await opts.initial(defaultFor(sha, name), graph)) : opts.initial;
    const log = opts.saved
      ? new EditLog(opts.saved, { mode: opts.mode, graph })
      : EditLog.create(first ?? defaultFor(sha, name), { mode: opts.mode, by: 'auto', graph });
    return new FrameSession(engine, info, name, log, graph);
  }

  get width(): number {
    return this.info.width;
  }

  get height(): number {
    return this.info.height;
  }

  get initial(): FrameRecipe {
    return this.log.toJSON().initial;
  }

  private adopt(n: Node): Node {
    this.engine.adopt(this.graph.closure(n.id));
    return n;
  }

  /** The display node of a recipe (default: the effective state, drag overlay included). */
  displayNode(r: FrameRecipe = this.log.state): Node {
    return this.adopt(compile(r, this.graph, { displaySpace: this.displaySpace }));
  }

  /** The first node of `op` in the display chain of r. */
  chainNode(op: string, r: FrameRecipe = this.log.state): Node | null {
    const top = compile(r, this.graph, { displaySpace: this.displaySpace });
    const def = this.graph.closure(top.id).find((d) => d.op === op);
    if (!def) return null;
    return this.graph.adopt([def])[0] ?? null;
  }

  /** The print-xyz node that output.display consumes (densitometer, tools). */
  printXyzNode(r: FrameRecipe = this.log.state): Node {
    const top = this.displayNode(r);
    const d = this.graph.closure(top.id).find((x) => x.op === 'output.display')!;
    return this.graph.get(d.inputs[0]!)!;
  }

  /** Display node for one of the inspection views (view.inspect, CONTRACT-DECISIONS CHB-009 #7). */
  viewNode(mode: ViewMode, r: FrameRecipe = this.log.state): Node {
    if (mode === 'print') return this.displayNode(r);
    const dyes = this.chainNode('invert.dyes', r) ?? this.chainNode('film.grain', r);
    if (mode === 'negative') {
      const src = this.chainNode('source.open', r)!;
      return this.adopt(this.graph.intern('view.inspect', [src.id], { mode: 'negative' }).node);
    }
    if (mode === 'dyes') return this.adopt(this.graph.intern('view.inspect', [dyes!.id], { mode: 'dyes' }).node);
    const classes = this.graph.intern('invert.classes', [dyes!.id], {}).node;
    return this.adopt(this.graph.intern('view.inspect', [classes.id], { mode: 'classes' }).node);
  }

  /** Display node of a print-xyz node (tools render through the same output step as the view). */
  displayOf(printXyz: Node, r: FrameRecipe = this.log.state): Node {
    return this.adopt(this.graph.intern('output.display', [printXyz.id], { space: this.displaySpace, rendering: r.view.output.rendering, knee: r.view.output.display.knee.method }).node);
  }

  // ---- snapshots --------------------------------------------------------------------------

  snapshot(name: string): Snapshot {
    const s: Snapshot = { id: `snap-${Date.now().toString(36)}-${this.snapshots.length}`, frame: this.sha, name, ts: Date.now(), stateHash: this.log.stateHash, recipe: this.log.committed };
    this.snapshots = [...this.snapshots, s];
    return s;
  }

  deleteSnapshot(id: string): void {
    this.snapshots = this.snapshots.filter((s) => s.id !== id);
  }
}

export function defaultFor(sha: string, name: string): FrameRecipe {
  return defaultRecipe('negative-scan', { sha256: sha, name });
}

/**
 * The mutations that turn `from` into `to` (snapshot restore, contact-sheet apply). `only` limits
 * the comparison to paths under these prefixes. Masks are added or replaced (the contract has no
 * mask removal); exposures are removed, added or field-set by id.
 */
export function diffRecipes(from: FrameRecipe, to: FrameRecipe, only?: readonly string[]): Mutation[] {
  const want = (p: string): boolean => !only || only.some((o) => p === o || p.startsWith(`${o}.`));
  const out: Mutation[] = [];
  const same = (a: unknown, b: unknown): boolean => canonicalJSON(a) === canonicalJSON(b);
  for (const pattern of Object.keys(RECIPE_FIELDS)) {
    if (pattern.includes('*') || !want(pattern)) continue;
    const a = getPath(from, pattern);
    const b = getPath(to, pattern);
    if (a === undefined || b === undefined || same(a, b)) continue;
    out.push({ op: 'set', path: pattern, value: b });
  }
  if (want('masks')) {
    for (const [id, spec] of Object.entries(to.masks)) if (!same(from.masks[id], spec)) out.push({ op: 'mask.set', id, mask: spec });
  }
  if (want('print.exposures')) {
    const fromIds = new Map(from.print.exposures.map((e) => [e.id, e]));
    const toIds = new Map(to.print.exposures.map((e) => [e.id, e]));
    for (const e of from.print.exposures) if (!toIds.has(e.id)) out.push({ op: 'exposure.remove', id: e.id });
    for (const e of to.print.exposures) {
      const old = fromIds.get(e.id);
      if (!old) {
        out.push({ op: 'exposure.add', exposure: e });
        continue;
      }
      for (const k of ['kind', 'enabled', 'mask', 'time_s', 'stops', 'filtration', 'through'] as const) {
        if (!same(old[k], e[k])) out.push({ op: 'set', path: `print.exposures.${e.id}.${k}`, value: e[k] });
      }
    }
  }
  if (want('probes')) {
    for (const [id, p] of Object.entries(to.probes)) if (!same(from.probes[id], p)) out.push({ op: 'set', path: `probes.${id}`, value: p });
  }
  return out;
}

/** The print settings "Apply these settings" copies between frames (contact sheet). */
export const PRINT_SETTINGS = ['print.paper', 'print.enlarger', 'print.lights.logH', 'print.grade', 'print.preflash'] as const;
