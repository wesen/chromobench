// Host side of the DSL (guide §5.6–5.9; contract 1.0): the synchronous natives the prelude calls through
// `host(name, json)`. Everything here answers from session-local data — the registry, the session's graph, and the
// document log as it was when the eval started — so only `evaluate` (deferred) and the end-of-eval submission reach
// the engine and the host's log.
//
// This file keeps the per-eval state, the dispatcher, frames, views and node handles. The natives live by vocabulary
// area in host/ (CHB-032): calls.ts (op calls on handles), cuts.ts (frame views, cuts, what-ifs), edits.ts (the
// builders and frame.propose), show.ts (show, explain), named-looks.ts (cb.looks.*: looks as links), errors.ts (the prelude's
// traps); words.ts and types.ts hold the shared helpers and records. Each native is a function of the Host.
import {
  AREAS, ChromobenchError, CONTRACT_VERSION, DOMAINS, LOG10_2, LOGH_PER_POINT, diag, documentKind, readField, storedPath,
  type Compiled, type Diagnostic, type Document, type Domain, type Graph, type LinkContext, type Node,
} from '@chromobench/contract';
import { getPath as getPathOf, type Log, type LogEntry } from '@chromobench/values';
import type { QuickJSWASMModule } from 'quickjs-emscripten-core';
import { defineLookWith } from './cblook.ts';
import { describeMutation } from './describe.ts';
import type { DslHistory } from './history.ts';
import { callOp } from './host/calls.ts';
import { CUT_METHODS, cut, strip, withChange } from './host/cuts.ts';
import { build, propose, valueMethod } from './host/edits.ts';
import { immutable, immutableDoc, notAwaited, unknownMember } from './host/errors.ts';
import { lookFrameInfo, looksApply, looksBake, looksDiff, looksList, looksWhatIf, lookTargets } from './host/named-looks.ts';
import { explain, explainView, show } from './host/show.ts';
import type { At, DocsProvider, DslLinks, FrameEntry, FrameState, HandleInfo, LogLine, QueuedEdit, ShowRequest, View } from './host/types.ts';
import { dslOps, short, suggest } from './host/words.ts';

export type { DocsProvider, DslLinks, FrameEntry, HandleInfo, LogLine, QueuedEdit, ShowRequest, View } from './host/types.ts';
export { dslOps, HANDLE_MEMBERS, isDslOp, layerOps, suggest } from './host/words.ts';

const NO_LINK_DATA: DslLinks = Object.freeze({});

export class Host {
  readonly graph: Graph;
  /** @internal the frames the session may open (their sources and names) */
  readonly frames: Map<string, FrameEntry>;
  readonly history: DslHistory;
  /** @internal one compile per document version and link context, in this session's graph */
  private readonly compiled = new WeakMap<LinkContext, WeakMap<Document, Compiled>>();
  // per-eval state
  /** the log as it was when the eval started: every read of the eval is of it */
  log: Log;
  bound: string | null = null;
  evalN = 0;
  /** the eval's transaction id (`<prefix>-eval-<n>`): edits' provenance */
  evalId = '';
  states = new Map<string, FrameState>();
  views = new Map<string, View>();
  edits: QueuedEdit[] = [];
  /** the log entries this eval's workbench commands made (wb.run, wb.set) */
  wbEntries: LogEntry[] = [];
  /** the QuickJS module, for looks written as code (cb.looks.define) */
  qjs: QuickJSWASMModule | null = null;
  shows: ShowRequest[] = [];
  logs: LogLine[] = [];
  warnings: Diagnostic[] = [];
  ops: Record<string, number> = {};
  vocabulary: Record<string, number> = {};
  /** @internal host/edits.ts */
  editCounter = 0;
  private viewCounter = 0;
  /** @internal the handle of each node id seen in this session (host/calls.ts) */
  readonly exprs = new Map<string, HandleInfo>();
  docs: DocsProvider = EMPTY_DOCS;
  /** the shared data links resolve against (rolls, presets): the host's, read per call (CHB-037 P7) */
  linkSource: () => DslLinks = () => NO_LINK_DATA;
  private lastLinks: { data: DslLinks; ctx: LinkContext } | null = null;

  constructor(graph: Graph, frames: Map<string, FrameEntry>, history: DslHistory) {
    this.graph = graph;
    this.frames = frames;
    this.history = history;
    this.log = history.log();
  }

  /** the host's link data (rolls, presets) */
  linkData(): DslLinks {
    return this.linkSource();
  }
  /** the link context every compile of this session uses: the same object while the host's data is unchanged */
  links(): LinkContext {
    const data = this.linkSource();
    if (this.lastLinks?.data === data) return this.lastLinks.ctx;
    const ctx: LinkContext = { rolls: (id) => data.rolls?.[id], presets: (id) => data.presets?.[id] };
    this.lastLinks = { data, ctx };
    return ctx;
  }
  /** @internal the compiled documents under the current link context */
  compiledDocs(): WeakMap<Document, Compiled> {
    const ctx = this.links();
    let m = this.compiled.get(ctx);
    if (!m) this.compiled.set(ctx, (m = new WeakMap()));
    return m;
  }

  begin(evalN: number, evalId: string, frame: string | null): void {
    this.evalN = evalN;
    this.evalId = evalId;
    this.bound = frame;
    this.log = this.history.log();
    this.states = new Map();
    this.views = new Map();
    this.viewCounter = 0;
    this.edits = [];
    this.wbEntries = [];
    this.shows = [];
    this.logs = [];
    this.warnings = [];
    this.ops = {};
    this.vocabulary = {};
  }

  tables(): unknown {
    const ops: Record<string, { area: string; on: string; returns: string }> = {};
    for (const o of dslOps()) ops[o.name] = { area: o.area, on: o.on, returns: o.returns };
    return { areas: [...AREAS], ops, cuts: CUT_METHODS, units: { logHPerPoint: LOGH_PER_POINT, log10_2: LOG10_2 }, version: CONTRACT_VERSION };
  }

  /** The dispatcher. Returns `{ok}` or `{err}` as JSON; never throws. */
  dispatch(name: string, json: string): string {
    try {
      const arg = (JSON.parse(json) ?? {}) as Record<string, unknown>;
      return JSON.stringify({ ok: this.handle(name, arg) ?? null });
    } catch (e) {
      const d = e instanceof ChromobenchError ? e.diag : diag('E_INTERNAL', e instanceof Error ? `${e.message}` : String(e));
      return JSON.stringify({ err: d });
    }
  }

  private handle(name: string, a: Record<string, unknown>): unknown {
    const at = a['at'] as At;
    switch (name) {
      case 'tables': return this.tables();
      case 'call': return callOp(this, a['op'] as string, a['recv'] as HandleInfo, a['args'], at);
      case 'macro': return this.namespaceCalled(a['name'] as string, a['recv'] as HandleInfo);
      case 'frame': return this.frameInfo(a['id'] as string);
      case 'frameId': return this.frameId(a['id']);
      case 'frames': return this.frameIds().map((id) => ({ id, name: this.frameName(id), kind: documentKind(this.state(id).base) }));
      case 'mode': return this.history.mode();
      case 'noFrame': return this.noFrame();
      case 'doc': return this.view(String(a['view'])).doc;
      case 'get': return this.get(String(a['view']), a['path']);
      case 'cut': return cut(this, String(a['view']), String(a['name']), a['opts'], at);
      case 'with': return withChange(this, String(a['view']), a['change'], at);
      case 'explainView': return explainView(this, String(a['view']), at);
      case 'propose': return propose(this, a);
      case 'why': return this.why(String(a['frame']), a['path']);
      case 'pending': return this.pending(String(a['frame']));
      case 'build': return build(this, a);
      case 'value': return valueMethod(this, a);
      case 'show': return show(this, a['ids'] as string[], (a['frame'] as string | null) ?? null, (a['opts'] ?? {}) as Record<string, unknown>, at);
      case 'explain': return explain(this, a['id'] as string);
      case 'strip': return strip(this, a['name'] as 'testStrip' | 'ringAround', String(a['frame']), a['opts'], at);
      case 'looks.list': return looksList(this);
      case 'looks.targets': return lookTargets(this, a['to'], null).map((id) => lookFrameInfo(this, id));
      case 'looks.apply': return looksApply(this, a);
      case 'looks.whatIf': return looksWhatIf(this, a);
      case 'looks.diff': return looksDiff(this, a);
      case 'looks.bake': return looksBake(this, a);
      case 'looks.define': return looksDefine(this, String(a['src']));
      case 'help': return this.docs.help((a['name'] as string | null) ?? null);
      case 'docs': return this.docs.docs(a);
      case 'log': {
        this.logs.push({ level: String(a['level']), text: String(a['text']), ...(at && at.eval === this.evalN ? { line: at.line } : {}) });
        return null;
      }
      case 'unknown': return unknownMember(this, a);
      case 'notAwaited': return notAwaited(this, a['info'] as HandleInfo, (a['key'] as string | null) ?? null);
      case 'immutable': return immutable(this, a['info'] as HandleInfo | null, String(a['key']), a['value']);
      case 'immutableDoc': return immutableDoc(this, String(a['frame']), String(a['path']), a['value']);
      case 'argType': throw new ChromobenchError(diag('E_ARG_TYPE', `${String(a['what'])} must be ${String(a['expect'])}`));
      default: throw new ChromobenchError(diag('E_INTERNAL', `unknown native ${name}`));
    }
  }

  // ---- frames --------------------------------------------------------------------------------
  /** The frames this eval can open: registered with the session and held by the log. */
  frameIds(): string[] {
    return [...this.frames.keys()].filter((id) => this.log.has(id));
  }

  entry(id: string): FrameEntry {
    const f = this.frames.get(id);
    if (!f || !this.log.has(id)) {
      const valid = this.frameIds();
      throw new ChromobenchError(diag('E_NO_FRAME', `no frame "${id}"`, { valid, ...(valid.length ? { fix: `cb.frame(${JSON.stringify(valid[0])})` } : {}) }));
    }
    return f;
  }

  frameName(id: string): string {
    return this.entry(id).name ?? this.state(id).base.source.name ?? id;
  }

  /** The frame's document at the start of the eval, and the draft this eval's queued edits make (DR-3). */
  state(id: string): FrameState {
    let s = this.states.get(id);
    if (!s) {
      this.entry(id);
      const base = this.log.doc<Document>(id);
      s = { base, draft: base };
      this.states.set(id, s);
    }
    return s;
  }

  frameExpr(id: string | null): string {
    return id === null || id === this.bound ? 'frame' : `cb.frame(${JSON.stringify(id)})`;
  }

  private frameId(id: unknown): string {
    if (typeof id !== 'string') throw new ChromobenchError(diag('E_ARG_TYPE', 'cb.frame(id) takes a frame id string', { valid: this.frameIds() }));
    this.entry(id);
    return id;
  }

  private frameInfo(id: string): unknown {
    const s = this.state(id);
    return { id, name: this.frameName(id), kind: documentKind(s.base), view: `@${id}` };
  }

  noFrame(): never {
    const ids = this.frameIds();
    throw new ChromobenchError(diag('E_NO_FRAME', 'this eval is not bound to a frame, so `frame` is undefined', {
      hint: 'pick a frame from cb.frames()', ...(ids[0] ? { fix: `cb.frame(${JSON.stringify(ids[0])})` } : {}), valid: ids,
    }));
  }

  // ---- views ---------------------------------------------------------------------------------
  /** A view by key: `@<frame>` is the frame at the start of the eval; `~<n>` a what-if or a preview. */
  view(key: string): View {
    let v = this.views.get(key);
    if (!v && key.startsWith('@')) {
      const id = key.slice(1);
      v = { frame: id, doc: this.state(id).base, expr: this.frameExpr(id) };
      this.views.set(key, v);
    }
    if (!v) throw new ChromobenchError(diag('E_NO_FRAME', 'this view belongs to an earlier eval; views last one eval', { hint: 'keep the change on mem and apply it again: frame.with(mem.change)' }));
    return v;
  }

  addView(v: View): { key: string; frame: string; kind: string; expr: string } {
    const key = `~${++this.viewCounter}`;
    this.views.set(key, v);
    return { key, frame: v.frame, kind: documentKind(v.doc), expr: v.expr };
  }

  private get(key: string, path: unknown): unknown {
    const v = this.view(key);
    if (typeof path !== 'string') throw new ChromobenchError(diag('E_ARG_TYPE', 'frame.get(path) takes a document path', { fix: `${v.expr}.get('main.params.time_s')` }));
    // a field of a linked medium (a frame on a roll) reads through the link, as the compiler sees it (CHB-037 P6b)
    if (storedPath(v.doc, path) !== path) return readField(v.doc, path, this.links());
    return getPathOrFix(v, path);
  }

  private why(frame: string, path: unknown): unknown {
    if (typeof path !== 'string') throw new ChromobenchError(diag('E_ARG_TYPE', 'frame.why(path) takes a document path', { fix: "frame.why('main.params.time_s')" }));
    const v = this.view(`@${frame}`);
    getPathOrFix(v, path);
    const w = this.log.why(frame, path);
    return { by: w.by, label: w.label, value: w.value, ...(w.approvedBy ? { approvedBy: w.approvedBy } : {}), source: w.source, seq: w.seq };
  }

  private pending(frame: string): unknown {
    this.entry(frame);
    return this.log.pending(frame).map((e) => ({
      seq: e.seq, tx: e.tx.id, label: e.tx.label, by: e.tx.by, ...(e.why ? { why: e.why } : {}),
      changes: e.tx.mutations.map((m, i) => describeMutation(m, e.tx.inverses[i])),
    }));
  }

  private namespaceCalled(area: string, recv: HandleInfo): never {
    const ops = dslOps().filter((o) => o.area === area);
    const fx = this.frameExpr(recv.frame);
    if (area === 'print' && recv.domain === 'film-dyes') {
      throw new ChromobenchError(diag('E_UNKNOWN_METHOD', `${recv.expr}.print is a namespace of ops, not a print`, {
        hint: 'the print of a frame is its print cut; a what-if print is the document with a change', fix: `${fx}.with(set('main.params.time_s', 12)).print()`,
        valid: ops.map((o) => o.name),
      }));
    }
    throw new ChromobenchError(diag('E_UNKNOWN_METHOD', `${recv.expr}.${area} is a namespace, not a method`, {
      hint: `call one of its ops, e.g. ${recv.expr}.${area}.${ops[0]?.name.split('.')[1] ?? '…'}({…})`, valid: ops.map((o) => o.name),
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

  /** Units constants for docs. */
  static readonly DOMAIN_UNITS = Object.fromEntries(Object.entries(DOMAINS).map(([d, i]) => [d, i.unit]));
}

/** getPath with a did-you-mean on the failing segment. */
function getPathOrFix(v: View, path: string): unknown {
  try {
    return getPathOf(v.doc, path);
  } catch (e) {
    if (!(e instanceof Error) || !('diag' in e)) throw e;
    const d = { ...(e as { diag: Diagnostic }).diag };
    const bad = /no "([^"]+)"/.exec(d.message)?.[1];
    const g = bad && d.valid ? suggest(bad, d.valid) : undefined;
    if (bad && g) {
      d.hint = `did you mean ${g}?`;
      d.fix = `${v.expr}.get('${path.split('.').map((s) => (s === bad ? g : s)).join('.')}')`;
    }
    throw new ChromobenchError(d);
  }
}


/** cb.looks.define(src): an agent-written look, registered in this realm at once (the page registers it too). */
function looksDefine(h: Host, src: string): unknown {
  if (!h.qjs) throw new ChromobenchError(diag('E_INTERNAL', 'the sandbox for looks is not loaded'));
  h.vocabulary['cb.looks'] = (h.vocabulary['cb.looks'] ?? 0) + 1;
  const d = defineLookWith(h.qjs, src, { file: `look-${h.evalId}.cblook.js` });
  return { name: d.name, version: d.version, label: d.label, stages: [...d.stages], params: Object.keys(d.params) };
}

const EMPTY_DOCS: DocsProvider = {
  help: () => 'no reference loaded',
  docs: () => [],
};
