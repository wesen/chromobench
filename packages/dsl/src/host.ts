// Host side of the DSL (guide §5.6–5.9): the synchronous natives the prelude calls through
// `host(name, json)`. Everything here answers from session-local data (registry, graph, recipe
// snapshot); only `evaluate` (deferred) and the end-of-eval submission reach the engine/edit log.
//
// This file keeps the per-eval state, the dispatcher, frames and node handles. The natives live by vocabulary
// area in host/ (CHB-032): calls.ts (op calls on handles), print.ts (frame accessors and the print() macro),
// look.ts (look, explain), edits.ts (frame.edit), named-looks.ts (cb.looks.*), errors.ts (the prelude's traps);
// words.ts and types.ts hold the shared helpers and records. Each native is a function of the Host.
import { AREAS, ChromobenchError, DOMAINS, LOG10_2, LOGH_PER_POINT, CONTRACT_VERSION, diag, PRINT_OPTIONS, type Diagnostic, type Domain, type FrameRecipe, type Graph, type Node } from '@chromobench/contract';
import { callOp } from './host/calls.ts';
import { edit } from './host/edits.ts';
import { immutable, immutableRecipe, notAwaited, unknownMember } from './host/errors.ts';
import { explain, look } from './host/look.ts';
import { lookFrameInfo, looksApply, looksDiff, looksWhatIf, lookTargets, needLooks } from './host/named-looks.ts';
import { closureIds, macro, printChain, printOf, vocab } from './host/print.ts';
import type { At, DocsProvider, FrameEntry, FrameState, HandleInfo, LogLine, LookRequest, LooksProvider, QueuedEdit } from './host/types.ts';
import { dslOps, short } from './host/words.ts';

export type { DocsProvider, FrameEntry, HandleInfo, LogLine, LookRequest, LooksProvider, QueuedEdit } from './host/types.ts';
export { dslOps, editFix, HANDLE_MEMBERS, isDslOp, suggest } from './host/words.ts';

// The frame vocabulary (accessors, print() options, cut) is the contract's (contract 0.3, vocab.ts), shared with
// packages/studio-kit's viewer handles so viewer and agent name the same node for the same words.
export { PRINT_OPTIONS };

export class Host {
  readonly graph: Graph;
  /** @internal the session's frames (host/*.ts) */
  readonly frames: Map<string, FrameEntry>;
  // per-eval state
  bound: string | null = null;
  evalN = 0;
  states = new Map<string, FrameState>();
  edits: QueuedEdit[] = [];
  looks: LookRequest[] = [];
  logs: LogLine[] = [];
  warnings: Diagnostic[] = [];
  ops: Record<string, number> = {};
  vocabulary: Record<string, number> = {};
  /** @internal host/edits.ts */
  editCounter = 0;
  /** @internal the handle of each node id seen in this session (host/calls.ts) */
  readonly exprs = new Map<string, HandleInfo>();
  docs: DocsProvider = EMPTY_DOCS;
  /** cb.looks.* (CHB-021): the studio's looks registry, injected by the host; null = no looks */
  looksProvider: LooksProvider | null = null;
  /** @internal host/named-looks.ts */
  whatIfs = new Map<string, FrameRecipe>();
  /** @internal host/named-looks.ts */
  batchCounter = 0;

  constructor(graph: Graph, frames: Map<string, FrameEntry>) {
    this.graph = graph;
    this.frames = frames;
  }

  begin(evalN: number, frame: string | null): void {
    this.evalN = evalN;
    this.bound = frame;
    this.states = new Map();
    this.edits = [];
    this.looks = [];
    this.logs = [];
    this.warnings = [];
    this.ops = {};
    this.vocabulary = {};
    this.whatIfs = new Map();
  }

  tables(): unknown {
    const ops: Record<string, { area: string; on: string; returns: string }> = {};
    for (const o of dslOps()) ops[o.name] = { area: o.area, on: o.on, returns: o.returns };
    return { areas: [...AREAS], ops, units: { logHPerPoint: LOGH_PER_POINT, log10_2: LOG10_2 }, version: CONTRACT_VERSION };
  }

  /** The dispatcher. Returns `{ok}` or `{err}` as JSON; never throws. */
  dispatch(name: string, json: string): string {
    try {
      const arg = JSON.parse(json) as Record<string, unknown>;
      return JSON.stringify({ ok: this.handle(name, arg) ?? null });
    } catch (e) {
      const d = e instanceof ChromobenchError ? e.diag : diag('E_INTERNAL', e instanceof Error ? `${e.message}` : String(e));
      return JSON.stringify({ err: d });
    }
  }

  private handle(name: string, a: Record<string, unknown>): unknown {
    switch (name) {
      case 'tables': return this.tables();
      case 'call': return callOp(this, a['op'] as string, a['recv'] as HandleInfo, a['args'], a['at'] as At);
      case 'macro': return macro(this, a['name'] as string, a['recv'] as HandleInfo, a['opts'], a['at'] as At);
      case 'vocab': return vocab(this, a['name'] as string, a['frame'] as string, a['opts'], a['at'] as At);
      case 'frame': return this.frameView(a['id'] as string);
      case 'frameId': return this.frameId(a['id']);
      case 'frames': return [...this.frames.entries()].map(([id, f]) => ({ id, name: f.name ?? id, kind: f.log.committed.kind, mode: f.log.mode }));
      case 'mode': return a['frame'] ? this.entry(a['frame'] as string).log.mode : null;
      case 'noFrame': return this.noFrame();
      case 'look': return look(this, a['ids'] as string[], (a['frame'] as string | null) ?? null, (a['opts'] ?? {}) as Record<string, unknown>, a['at'] as At);
      case 'explain': return explain(this, a['id'] as string);
      case 'why': return this.entry(a['frame'] as string).log.formatWhy(String(a['path']));
      case 'pending': return this.entry(a['frame'] as string).log.pending().map((e) => ({ seq: e.seq, tx: e.tx, m: e.m, ...(e.why ? { why: e.why } : {}) }));
      case 'edit': return edit(this, a);
      case 'looks.list': return needLooks(this).list();
      case 'looks.targets': return lookTargets(this, a['to'], null).map((id) => lookFrameInfo(this, id));
      case 'looks.apply': return looksApply(this, a);
      case 'looks.whatIf': return looksWhatIf(this, a);
      case 'looks.diff': return looksDiff(this, a);
      case 'help': return this.docs.help((a['name'] as string | null) ?? null);
      case 'docs': return this.docs.docs(a);
      case 'log': {
        const at = a['at'] as At;
        this.logs.push({ level: String(a['level']), text: String(a['text']), ...(at && at.eval === this.evalN ? { line: at.line } : {}) });
        return null;
      }
      case 'unknown': return unknownMember(this, a);
      case 'notAwaited': return notAwaited(this, a['info'] as HandleInfo, (a['key'] as string | null) ?? null);
      case 'immutable': return immutable(this, a['info'] as HandleInfo | null, String(a['key']), a['value']);
      case 'immutableRecipe': return immutableRecipe(this, String(a['frame']), String(a['path']), a['value']);
      case 'argType': throw new ChromobenchError(diag('E_ARG_TYPE', `${String(a['what'])} must be ${String(a['expect'])}`));
      default: throw new ChromobenchError(diag('E_INTERNAL', `unknown native ${name}`));
    }
  }

  // ---- frames --------------------------------------------------------------------------------
  entry(id: string): FrameEntry {
    const f = this.frames.get(id);
    if (!f) throw new ChromobenchError(diag('E_NO_FRAME', `no frame "${id}"`, { valid: [...this.frames.keys()], ...(this.frames.size ? { fix: `cb.frame(${JSON.stringify([...this.frames.keys()][0])})` } : {}) }));
    return f;
  }

  /** The eval-start snapshot of a frame plus this eval's queued edits (DR-3). */
  state(id: string): FrameState {
    let s = this.states.get(id);
    if (!s) {
      const base = this.entry(id).log.committed;
      s = { base, draft: base };
      this.states.set(id, s);
    }
    return s;
  }

  frameExpr(id: string | null): string {
    return id === null || id === this.bound ? 'frame' : `cb.frame(${JSON.stringify(id)})`;
  }

  private frameId(id: unknown): string {
    if (typeof id !== 'string') throw new ChromobenchError(diag('E_ARG_TYPE', 'cb.frame(id) takes a frame id string', { valid: [...this.frames.keys()] }));
    this.entry(id);
    return id;
  }

  private frameView(id: string): unknown {
    const s = this.state(id);
    const f = this.entry(id);
    return { id, name: f.name ?? id, kind: s.base.kind, recipe: s.base };
  }

  noFrame(): never {
    const first = [...this.frames.keys()][0];
    throw new ChromobenchError(diag('E_NO_FRAME', 'this eval is not bound to a frame, so `frame` is undefined', {
      hint: 'pick a frame from cb.frames()', ...(first ? { fix: `cb.frame(${JSON.stringify(first)})` } : {}), valid: [...this.frames.keys()],
    }));
  }

  // ---- handles -------------------------------------------------------------------------------
  info(n: Node, frame: string | null, expr: string): HandleInfo {
    const isImg = n.info.kind === 'Image';
    const h: HandleInfo = isImg
      ? { id: n.id, kind: 'Image', domain: (n.info as { domain: Domain }).domain, op: n.op, frame, label: `[${(n.info as { domain: Domain }).domain} #${short(n.id)} ${n.op}]`, expr: expr.length > 100 ? 'h' : expr, width: (n.info as { width: number }).width, height: (n.info as { height: number }).height }
      : { id: n.id, kind: 'Value', op: n.op, frame, label: `[value #${short(n.id)} ${n.op}]`, expr: expr.length > 100 ? 'h' : expr, fields: n.info.kind === 'Value' ? n.info.fields.map((f) => f.name) : [] };
    this.exprs.set(n.id, h);
    return h;
  }

  node(id: string): Node {
    return this.graph.get(id) ?? (() => { throw new ChromobenchError(diag('E_NO_NODE', `unknown node ${short(id)}`)); })();
  }

  intern(op: string, inputs: string[], args: Record<string, unknown>, at: At): Node {
    const { node, warnings } = this.graph.intern(op, inputs, args);
    this.ops[op] = (this.ops[op] ?? 0) + 1;
    for (const w of warnings) this.warnings.push(at && at.eval === this.evalN ? { ...w, where: { line: at.line } } : w);
    return node;
  }

  // ---- vocabulary (host/print.ts) ------------------------------------------------------------
  /** Node ids in closure order (same order as Graph.closure). */
  closureIds(id: string): string[] {
    return closureIds(this, id);
  }

  /** The negative-to-viewed-print chain, mirroring compile() (cache-identity test). */
  printChain(dyes: string, r: FrameRecipe | null, opts: Record<string, unknown>, at: At): Node {
    return printChain(this, dyes, r, opts, at);
  }

  /** frame.print() of a recipe (the view.adapt node): receipts' previews. */
  printOf(r: FrameRecipe): Node {
    return printOf(this, r);
  }

  /** Units constants for docs. */
  static readonly DOMAIN_UNITS = Object.fromEntries(Object.entries(DOMAINS).map(([d, i]) => [d, i.unit]));
}

const EMPTY_DOCS: DocsProvider = {
  help: () => 'no reference loaded',
  docs: () => [],
};
