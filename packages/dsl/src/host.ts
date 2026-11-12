// Host side of the DSL (guide §5.6–5.9): the synchronous natives the prelude calls through
// `host(name, json)`. Everything here answers from session-local data (registry, graph, recipe
// snapshot); only `evaluate` (deferred) and the end-of-eval submission reach the engine/edit log.
import {
  AREAS, ChromobenchError, DOMAINS, LOG10_2, LOGH_PER_POINT, CONTRACT_VERSION, allOps, applyMutation, canonicalJSON, closest,
  cut, diag, FRAME_ACCESSORS, formatValue, getOp, getPath, nodeArgs, PRINT_OPTIONS, recipeBackedArgs, settablePaths,
  type Diagnostic, type Domain, type EditLog, type FrameRecipe, type Graph, type Mutation, type Node, type OpDef,
} from '@chromobench/contract';

export interface HandleInfo {
  id: string;
  kind: 'Image' | 'Value';
  domain?: Domain;
  op: string;
  frame: string | null;
  label: string;
  expr: string;
  width?: number;
  height?: number;
  fields?: string[];
}

export interface FrameEntry {
  log: EditLog;
  name?: string;
}

export interface QueuedEdit {
  id: string;
  frame: string;
  mutations: Mutation[];
  was: unknown[];
  why?: string;
  line?: number;
}

export interface LookRequest {
  n: number;
  ids: string[];
  frame: string | null;
  label: string;
  opts: Record<string, unknown>;
  line?: number;
  key: string;
}

export interface LogLine {
  level: string;
  text: string;
  line?: number;
}

interface FrameState {
  base: FrameRecipe;
  draft: FrameRecipe;
}

type At = { eval: number; line: number } | null;

// The frame vocabulary (accessors, print() options, cut) is the contract's (contract 0.3, vocab.ts), shared with
// packages/studio-kit's viewer handles so viewer and agent name the same node for the same words.
export { PRINT_OPTIONS };
const ACCESSORS = FRAME_ACCESSORS;

export const HANDLE_MEMBERS = ['look', 'explain', 'id', 'domain', 'kind', 'width', 'height'];

/** did-you-mean: the contract's closest(), plus a prefix rule (time → time_s). */
export function suggest(name: string, cands: readonly string[]): string | undefined {
  return closest(name, cands) ?? cands.find((c) => c.startsWith(name) && name.length >= 3) ?? cands.find((c) => name.startsWith(c) && c.length >= 3);
}

const short = (id: string): string => id.slice(0, 4);

export function isDslOp(o: OpDef): boolean {
  return !o.internal && o.dsl !== false;
}

export function dslOps(): OpDef[] {
  return allOps().filter(isDslOp);
}

/** Formats a fix like `frame.edit({ 'print.enlarger.time_s': 12 })`. */
export function editFix(frameExpr: string, path: string, value: unknown): string {
  return `${frameExpr}.edit({ '${path}': ${formatValue(value)} })`;
}

export class Host {
  readonly graph: Graph;
  private readonly frames: Map<string, FrameEntry>;
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
  private editCounter = 0;
  private readonly exprs = new Map<string, HandleInfo>();
  docs: DocsProvider = EMPTY_DOCS;

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
      case 'call': return this.call(a['op'] as string, a['recv'] as HandleInfo, a['args'], a['at'] as At);
      case 'macro': return this.macro(a['name'] as string, a['recv'] as HandleInfo, a['opts'], a['at'] as At);
      case 'vocab': return this.vocab(a['name'] as string, a['frame'] as string, a['opts'], a['at'] as At);
      case 'frame': return this.frameView(a['id'] as string);
      case 'frameId': return this.frameId(a['id']);
      case 'frames': return [...this.frames.entries()].map(([id, f]) => ({ id, name: f.name ?? id, kind: f.log.committed.kind, mode: f.log.mode }));
      case 'mode': return a['frame'] ? this.entry(a['frame'] as string).log.mode : null;
      case 'noFrame': return this.noFrame();
      case 'look': return this.look(a['ids'] as string[], (a['frame'] as string | null) ?? null, (a['opts'] ?? {}) as Record<string, unknown>, a['at'] as At);
      case 'explain': return this.explain(a['id'] as string);
      case 'why': return this.entry(a['frame'] as string).log.formatWhy(String(a['path']));
      case 'pending': return this.entry(a['frame'] as string).log.pending().map((e) => ({ seq: e.seq, tx: e.tx, m: e.m, ...(e.why ? { why: e.why } : {}) }));
      case 'edit': return this.edit(a);
      case 'help': return this.docs.help((a['name'] as string | null) ?? null);
      case 'docs': return this.docs.docs(a);
      case 'log': {
        const at = a['at'] as At;
        this.logs.push({ level: String(a['level']), text: String(a['text']), ...(at && at.eval === this.evalN ? { line: at.line } : {}) });
        return null;
      }
      case 'unknown': return this.unknown(a);
      case 'notAwaited': return this.notAwaited(a['info'] as HandleInfo, (a['key'] as string | null) ?? null);
      case 'immutable': return this.immutable(a['info'] as HandleInfo | null, String(a['key']), a['value']);
      case 'immutableRecipe': return this.immutableRecipe(String(a['frame']), String(a['path']), a['value']);
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

  private noFrame(): never {
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

  private node(id: string): Node {
    return this.graph.get(id) ?? (() => { throw new ChromobenchError(diag('E_NO_NODE', `unknown node ${short(id)}`)); })();
  }

  private intern(op: string, inputs: string[], args: Record<string, unknown>, at: At): Node {
    const { node, warnings } = this.graph.intern(op, inputs, args);
    this.ops[op] = (this.ops[op] ?? 0) + 1;
    for (const w of warnings) this.warnings.push(at && at.eval === this.evalN ? { ...w, where: { line: at.line } } : w);
    return node;
  }

  /** Literal options: node handles only where the op takes a node; nothing else may be a handle. */
  private unmarshal(op: OpDef, raw: unknown, recvExpr: string): Record<string, unknown> {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ChromobenchError(diag('E_ARG_TYPE', `${op.name} takes one options object`, { fix: `${recvExpr}.${op.name}({ … })`, valid: Object.keys(op.args) }));
    }
    const nodeArgNames = new Set(nodeArgs(op));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (nodeArgNames.has(k)) {
        const one = (x: unknown): unknown => (x && typeof x === 'object' && '__node' in x ? (x as { __node: string }).__node : x);
        out[k] = Array.isArray(v) ? v.map(one) : one(v);
        continue;
      }
      out[k] = this.literal(op.name, k, v);
    }
    return out;
  }

  private literal(where: string, key: string, v: unknown): unknown {
    if (v && typeof v === 'object') {
      if ('__node' in v) {
        const h = this.exprs.get((v as { __node: string }).__node);
        const field = h?.fields?.[0];
        throw new ChromobenchError(diag('E_ARG_TYPE', `${where}: option "${key}" got a node; options are literal values`, {
          hint: 'await the measurement first and pass the number',
          fix: h ? `(await ${h.expr})${field ? `.${field}` : ''}` : '(await …).…', path: `${where}.${key}`,
        }));
      }
      if ('__fn' in v || '__look' in v) throw new ChromobenchError(diag('E_ARG_TYPE', `${where}: option "${key}" must be a literal value`, { path: `${where}.${key}` }));
      if ('__num' in v) return Number((v as { __num: string }).__num);
      if (Array.isArray(v)) return v.map((x) => this.literal(where, key, x));
      return Object.fromEntries(Object.entries(v).map(([a, b]) => [a, this.literal(where, key, b)]));
    }
    return v;
  }

  private recipeOf(frame: string | null): FrameRecipe | null {
    return frame ? this.state(frame).base : null;
  }

  private call(opName: string, recv: HandleInfo, rawArgs: unknown, at: At): HandleInfo {
    const op = getOp(opName);
    if (!isDslOp(op)) throw this.unknownMethodErr(recv, op.area, opName.slice(op.area.length + 1));
    const args = this.unmarshal(op, rawArgs, recv.expr);
    const r = this.recipeOf(recv.frame);
    if (r) {
      for (const { arg, path } of recipeBackedArgs(op)) {
        if (arg in args) continue;
        const v = getPath(r, path);
        if (v !== undefined && v !== null) args[arg] = v;
      }
    }
    const callText = `${recv.expr}.${opName}(${Object.keys(rawArgs as object).length ? formatValue(rawArgs) : ''})`;
    try {
      const n = this.intern(opName, [recv.id], args, at);
      return this.info(n, recv.frame, callText);
    } catch (e) {
      throw this.rewrite(e, op, recv, rawArgs as Record<string, unknown>);
    }
  }

  /** Re-targets contract fixes at the agent's own receiver (E_DOMAIN, E_UNKNOWN_OPTION). */
  private rewrite(e: unknown, op: OpDef, recv: HandleInfo, raw: Record<string, unknown>): unknown {
    if (!(e instanceof ChromobenchError)) return e;
    const d = { ...e.diag };
    const fx = this.frameExpr(recv.frame);
    if (d.code === 'E_DOMAIN' && recv.domain) {
      const macroOpt = Object.entries(PRINT_OPTIONS).find(([, [o]]) => o === op.name && op.name !== 'print.expose');
      if (recv.domain === 'film-dyes' && macroOpt) {
        const argVal = raw[macroOpt[1][1]];
        d.fix = `${fx}.negative().print(${argVal !== undefined ? formatValue({ [macroOpt[0]]: argVal }) : '{ … }'})`;
        d.hint = `${op.name} works on paper exposure (paper-logH); from a negative, set it through print({ ${macroOpt[0]} })`;
      } else {
        const acc = ACCESSORS.find((x) => op.domainIn === 'any' || (Array.isArray(op.domainIn) ? op.domainIn.includes(x.domain) : op.domainIn === x.domain));
        if (acc) d.fix = `${fx}.${acc.name}().${op.name}(${Object.keys(raw).length ? formatValue(raw) : ''})`;
        else if (op.domainIn === 'paper-logH') d.fix = `${fx}.negative().print.expose().${op.name}(${Object.keys(raw).length ? formatValue(raw) : ''})`;
      }
      return new ChromobenchError(d);
    }
    if ((d.code === 'E_UNKNOWN_OPTION' || d.code === 'E_ARG_RANGE') && d.fix && d.fix.startsWith(`${op.name}(`)) {
      d.fix = `${recv.expr}.${d.fix}`;
      return new ChromobenchError(d);
    }
    if (d.code === 'E_UNKNOWN_OPTION' && !d.fix) {
      const k = Object.keys(raw).find((x) => !(x in op.args));
      const guess = k ? suggest(k, Object.keys(op.args)) : undefined;
      if (k && guess) {
        const fixed = Object.fromEntries(Object.entries(raw).map(([a, b]) => [a === k ? guess : a, b]));
        d.hint = `did you mean ${guess}?`;
        d.fix = `${recv.expr}.${op.name}(${formatValue(fixed)})`;
      }
      return new ChromobenchError(d);
    }
    return e;
  }

  // ---- vocabulary ----------------------------------------------------------------------------
  /** The node of a frame's compiled chain with the given op (the last one in the closure). */
  private cut(r: FrameRecipe, op: string): Node {
    return cut(r, this.graph, op);
  }

  /** Node ids in closure order (same order as Graph.closure). */
  closureIds(id: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const visit = (nid: string): void => {
      if (seen.has(nid)) return;
      seen.add(nid);
      for (const i of this.node(nid).inputs) visit(i);
      out.push(nid);
    };
    visit(id);
    return out;
  }

  /** The negative-to-viewed-print chain, mirroring compile() (cache-identity test). */
  printChain(dyes: string, r: FrameRecipe | null, opts: Record<string, unknown>, at: At): Node {
    const p = r?.print;
    const e = p?.enlarger;
    const pick = <T>(k: string, fromRecipe: T | undefined): T | undefined => (k in opts ? (opts[k] as T) : fromRecipe);
    const filtration = pick('filtration', e?.filtration);
    const exposeArgs = (time_s: unknown, filt: unknown): Record<string, unknown> => {
      const a: Record<string, unknown> = {};
      const set = (k: string, v: unknown): void => { if (v !== undefined && v !== null) a[k] = v; };
      set('paper', pick('paper', p?.paper));
      set('mode', e?.mode);
      set('lamp', e?.lamp);
      set('filtration', filt);
      set('time_s', time_s);
      set('fstop', pick('fstop', e?.fstop));
      set('magnification', e?.magnification);
      return a;
    };
    const time = pick('time_s', e?.time_s);
    let x = this.intern('print.expose', [dyes], exposeArgs(time, filtration), at).id;
    const extra = (p?.exposures ?? []).filter((ex) => ex.enabled);
    if (r && p && e && extra.length > 0) {
      const t0 = (time as number | undefined) ?? e.time_s;
      const exposures: string[] = [];
      const masks: string[] = [];
      const modes: string[] = [];
      for (const ex of extra) {
        const t = ex.time_s ?? (ex.stops === null ? t0 : ex.kind === 'dodge' ? t0 * (1 - 2 ** -ex.stops) : t0 * (2 ** ex.stops - 1));
        exposures.push(this.intern('print.expose', [dyes], exposeArgs(Math.max(t, 0.1), ex.filtration ?? filtration), at).id);
        const spec = ex.mask ? r.masks[ex.mask] : undefined;
        const maskNodes = spec ? this.graph.adopt(spec.nodes) : [];
        masks.push(maskNodes.length ? maskNodes[maskNodes.length - 1]!.id : this.intern('mask.luminance', [x], { above: 0, below: 1, softness: 0 }, at).id);
        modes.push(ex.kind === 'dodge' ? 'subtract' : 'add');
      }
      x = this.intern('print.combine', [x], { exposures, masks, modes }, at).id;
    }
    const lights = pick('lights', p?.lights.logH);
    x = this.intern('print.lights', [x], lights !== undefined ? { logH: lights } : {}, at).id;
    const preflash = pick('preflash', p?.preflash) as number | undefined;
    if (preflash !== undefined && (typeof preflash !== 'number' || preflash !== 0)) x = this.intern('print.preflash', [x], { amount: preflash }, at).id;
    const develop: Record<string, unknown> = {};
    const paper = pick('paper', p?.paper);
    const grade = pick('grade', p?.grade);
    if (paper !== undefined) develop['paper'] = paper;
    if (grade !== undefined) develop['grade'] = grade;
    const pd = this.intern('print.develop', [x], develop, at).id;
    const ill = pick('illuminant', r?.view.illuminant);
    let v = this.intern('view.reflect', [pd], ill !== undefined ? { illuminant: ill } : {}, at).id;
    const rendering = r?.view.output.rendering ?? 'scan-of-print';
    const flare = 'flare' in opts ? opts['flare'] : rendering === 'scan-of-print' ? 0 : r?.view.flare;
    v = this.intern('view.flare', [v], flare !== undefined ? { flare } : { flare: 0 }, at).id;
    return this.intern('view.adapt', [v], r ? { to: r.view.output.white } : {}, at);
  }

  private printOpts(raw: unknown, expr: string): Record<string, unknown> {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ChromobenchError(diag('E_ARG_TYPE', 'print() takes one options object', { fix: `${expr}.print({ time_s: 12 })`, valid: Object.keys(PRINT_OPTIONS) }));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!(k in PRINT_OPTIONS)) {
        // redirects of the owning args (lights: points → logH)
        for (const [opt, [opName, arg]] of Object.entries(PRINT_OPTIONS)) {
          const r = getOp(opName).args[arg]?.redirects?.[k];
          if (r) {
            const conv = r.scale !== undefined ? (Array.isArray(v) ? v.map((x) => Number((Number(x) * r.scale!).toPrecision(12))) : Number((Number(v) * r.scale).toPrecision(12))) : v;
            const fixed = { ...(raw as Record<string, unknown>) };
            delete fixed[k];
            fixed[opt] = conv;
            throw new ChromobenchError(diag('E_UNKNOWN_OPTION', `print() has no option "${k}"; use "${opt}"`, { hint: r.hint, fix: `${expr}.print(${formatValue(fixed)})`, valid: Object.keys(PRINT_OPTIONS) }));
          }
        }
        const guess = suggest(k, Object.keys(PRINT_OPTIONS));
        const fixed = guess ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([a, b]) => [a === k ? guess : a, b])) : undefined;
        throw new ChromobenchError(diag('E_UNKNOWN_OPTION', `print() has no option "${k}"`, {
          ...(guess ? { hint: `did you mean ${guess}?`, fix: `${expr}.print(${formatValue(fixed)})` } : {}), valid: Object.keys(PRINT_OPTIONS),
        }));
      }
      out[k] = this.literal('print', k, v);
    }
    return out;
  }

  /** Runs printChain and re-targets binder errors at the macro option that caused them. */
  private printMacro(dyes: HandleInfo, raw: unknown, expr: string, at: At, exprOut: string): HandleInfo {
    const opts = this.printOpts(raw, expr);
    try {
      const n = this.printChain(dyes.id, this.recipeOf(dyes.frame), opts, at);
      return this.info(n, dyes.frame, exprOut);
    } catch (e) {
      if (!(e instanceof ChromobenchError)) throw e;
      const d = { ...e.diag };
      const opt = Object.entries(PRINT_OPTIONS).find(([, [o, a]]) => d.path === `${o}.${a}`);
      if (opt) {
        d.path = `print.${opt[0]}`;
        if (d.fix !== undefined && d.code === 'E_ARG_RANGE') {
          const fixed = { ...(raw as Record<string, unknown>), [opt[0]]: '__FIX__' };
          d.fix = `${expr}.print(${formatValue(fixed).replace('"__FIX__"', d.fix)})`;
        }
      }
      throw new ChromobenchError(d);
    }
  }

  private macro(name: string, recv: HandleInfo, raw: unknown, at: At): HandleInfo {
    if (name !== 'print') throw new ChromobenchError(diag('E_UNKNOWN_METHOD', `${recv.expr}.${name} is a namespace, not a method`, { hint: `call one of its ops, e.g. ${recv.expr}.${name}.${dslOps().find((o) => o.area === name)?.name.split('.')[1] ?? '…'}({…})`, valid: dslOps().filter((o) => o.area === name).map((o) => o.name) }));
    this.vocabulary['neg.print'] = (this.vocabulary['neg.print'] ?? 0) + 1;
    if (recv.domain !== 'film-dyes') {
      throw new ChromobenchError(diag('E_DOMAIN', `print() takes a negative (film-dyes); this handle is ${recv.domain}`, {
        hint: 'print from frame.negative() or another film-dyes handle', fix: `${this.frameExpr(recv.frame)}.negative().print(${raw && Object.keys(raw).length ? formatValue(raw) : ''})`,
      }));
    }
    const out = `${recv.expr}.print(${raw && Object.keys(raw).length ? formatValue(raw) : ''})`;
    return this.printMacro(recv, raw, recv.expr, at, out);
  }

  private vocab(name: string, frame: string, raw: unknown, at: At): HandleInfo {
    this.vocabulary[name] = (this.vocabulary[name] ?? 0) + 1;
    const s = this.state(frame);
    const fx = this.frameExpr(frame);
    const neg = (): HandleInfo => this.info(this.cut(s.base, 'invert.dyes'), frame, `${fx}.negative()`);
    switch (name) {
      case 'source': return this.info(this.cut(s.base, 'source.open'), frame, `${fx}.source()`);
      case 'scan': {
        const dyes = this.cut(s.base, 'invert.dyes');
        return this.info(this.node(dyes.inputs[0]!), frame, `${fx}.scan()`);
      }
      case 'negative': return neg();
      case 'display': return this.info(this.cut(s.base, 'output.frame'), frame, `${fx}.display()`);
      case 'print': {
        const empty = !raw || Object.keys(raw).length === 0;
        if (empty) return this.info(this.cut(s.base, 'view.adapt'), frame, `${fx}.print()`);
        return this.printMacro(neg(), raw, fx, at, `${fx}.print(${formatValue(raw)})`);
      }
      case 'testStrip': case 'ringAround': {
        const op = `darkroom.${name}`;
        const n = neg();
        const args = this.unmarshal(getOp(op), raw, n.expr);
        try {
          return this.info(this.intern(op, [n.id], args, at), frame, `cb.${name}(${fx}${Object.keys(args).length ? `, ${formatValue(args)}` : ''})`);
        } catch (e) {
          throw this.rewrite(e, getOp(op), n, raw as Record<string, unknown>);
        }
      }
      default: throw new ChromobenchError(diag('E_INTERNAL', `unknown vocabulary ${name}`));
    }
  }

  /** frame.print() of a recipe (the view.adapt node): receipts' previews. */
  printOf(r: FrameRecipe): Node {
    return this.cut(r, 'view.adapt');
  }

  // ---- looks ---------------------------------------------------------------------------------
  private look(ids: string[], frame: string | null, opts: Record<string, unknown>, at: At): { look: number; caption: string } {
    for (const id of ids) {
      const n = this.node(id);
      if (n.info.kind !== 'Image') throw new ChromobenchError(diag('E_WRONG_KIND', 'look() shows images; a measurement is numbers: await it and return it'));
    }
    const label = typeof opts['label'] === 'string' ? (opts['label'] as string) : ids.length > 1 ? 'compare' : this.node(ids[0]!).op;
    const key = canonicalJSON({ ids, opts });
    const dup = this.looks.find((l) => l.key === key);
    if (dup) return { look: dup.n, caption: dup.label };
    const n = this.looks.length + 1;
    this.looks.push({ n, ids, frame, label, opts, key, ...(at && at.eval === this.evalN ? { line: at.line } : {}) });
    return { look: n, caption: label };
  }

  private explain(id: string): string {
    return this.closureIds(id).map((nid) => {
      const n = this.node(nid);
      const args = Object.entries(n.args).filter(([, v]) => !(typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)));
      const dom = n.info.kind === 'Image' ? ` → ${(n.info as { domain: string }).domain}` : ' → value';
      return `#${short(nid)} ${n.op}(${args.length ? formatValue(Object.fromEntries(args)) : ''})${dom}`;
    }).join('\n');
  }

  // ---- edits (DR-3) --------------------------------------------------------------------------
  private edit(a: Record<string, unknown>): unknown {
    const frame = String(a['frame']);
    const log = this.entry(frame).log;
    const fx = this.frameExpr(frame);
    if (log.mode === 'read-only') {
      throw new ChromobenchError(diag('E_READONLY', 'the agent is read-only for this frame: frame.edit cannot propose changes', { hint: 'describe the change instead; the photographer can switch the mode' }));
    }
    const kind = String(a['kind']);
    const why = typeof a['why'] === 'string' ? (a['why'] as string) : undefined;
    const ms: Mutation[] = [];
    if (kind === 'set') {
      const ch = a['changes'];
      if (!ch || typeof ch !== 'object' || Array.isArray(ch) || Object.keys(ch).length === 0) {
        throw new ChromobenchError(diag('E_ARG_TYPE', 'frame.edit takes an object of recipe paths', { fix: `${fx}.edit({ 'print.enlarger.time_s': 12 })` }));
      }
      for (const [path, v] of Object.entries(ch as Record<string, unknown>)) ms.push({ op: 'set', path, value: this.literal('frame.edit', path, v) });
    } else if (kind === 'exposure.add') {
      const ex = { ...((a['exposure'] ?? {}) as Record<string, unknown>) };
      const m = ex['mask'];
      if (m && typeof m === 'object' && '__node' in m) {
        const id = String(ex['id']);
        ms.push({ op: 'mask.set', id, mask: { version: 1, nodes: this.graph.closure((m as { __node: string }).__node) } });
        ex['mask'] = id;
      }
      ms.push({ op: 'exposure.add', exposure: this.literal('frame.edit.exposure.add', 'exposure', ex) as never });
    } else if (kind === 'exposure.remove') {
      ms.push({ op: 'exposure.remove', id: String(a['id']) });
    } else if (kind === 'mask.set') {
      const m = a['mask'];
      if (!m || typeof m !== 'object' || !('__node' in m)) throw new ChromobenchError(diag('E_ARG_TYPE', 'frame.edit.mask.set(id, mask) needs a mask handle', { hint: 'build one with h.mask.*' }));
      ms.push({ op: 'mask.set', id: String(a['id']), mask: { version: 1, nodes: this.graph.closure((m as { __node: string }).__node) } });
    }
    const s = this.state(frame);
    let r = s.draft;
    const out: Mutation[] = [];
    const was: unknown[] = [];
    for (const m of ms) {
      try {
        const res = applyMutation(r, m, { graph: this.graph });
        was.push(m.op === 'set' ? getPath(r, m.path) : undefined);
        out.push(m.op === 'set' ? { ...m, value: res.value } : m);
        r = res.recipe;
        for (const w of res.warnings) this.warnings.push(a['at'] && (a['at'] as { eval: number }).eval === this.evalN ? { ...w, where: { line: (a['at'] as { line: number }).line } } : w);
      } catch (e) {
        if (e instanceof ChromobenchError && e.diag.code === 'E_PATH' && m.op === 'set') {
          const guess = suggest(m.path, settablePaths());
          const d = { ...e.diag };
          if (guess && !guess.includes('*')) d.fix = editFix(fx, guess, m.value);
          throw new ChromobenchError(d);
        }
        throw e;
      }
    }
    s.draft = r;
    this.editCounter += 1;
    const at = a['at'] as At;
    const q: QueuedEdit = { id: `e${this.editCounter}`, frame, mutations: out, was, ...(why !== undefined ? { why } : {}), ...(at && at.eval === this.evalN ? { line: at.line } : {}) };
    this.edits.push(q);
    this.vocabulary['frame.edit'] = (this.vocabulary['frame.edit'] ?? 0) + 1;
    const preview = this.info(this.printOf(r), frame, `${fx}.print() after ${q.id}`);
    preview.expr = 'receipt.preview';
    return {
      id: q.id, status: 'queued', mutations: out, preview,
      note: log.mode === 'ask' ? 'submitted when this eval ends; ask mode: waits for the photographer' : 'submitted when this eval ends; auto mode: applied at once',
    };
  }

  // ---- structured errors ---------------------------------------------------------------------
  private unknownMethodErr(info: HandleInfo, area: string | null, key: string): ChromobenchError {
    if (area) {
      const all = dslOps().filter((o) => o.area === area);
      const ok = all.filter((o) => info.domain && (o.domainIn === 'any' || (Array.isArray(o.domainIn) ? o.domainIn.includes(info.domain) : o.domainIn === info.domain)));
      const names = (ok.length ? ok : all).map((o) => o.name.slice(area.length + 1));
      const guess = suggest(key, names);
      return new ChromobenchError(diag('E_UNKNOWN_METHOD', `${area}.${key} is not an op`, {
        ...(guess ? { hint: `Did you mean "${guess}"?`, fix: `${info.expr}.${area}.${guess}(…)` } : {}), valid: names.map((n) => `${area}.${n}`),
      }));
    }
    const ops = dslOps().filter((o) => o.on !== 'none' && info.domain && (o.domainIn === 'any' || (Array.isArray(o.domainIn) ? o.domainIn.includes(info.domain) : o.domainIn === info.domain)));
    const areas = [...new Set(ops.map((o) => o.area))];
    if (info.domain === 'film-dyes' && !areas.includes('print')) areas.push('print');
    const valid = [...areas, ...HANDLE_MEMBERS];
    const guess = suggest(key, valid);
    return new ChromobenchError(diag('E_UNKNOWN_METHOD', `a ${info.domain ?? info.kind} handle has no member "${key}"`, {
      ...(guess ? { hint: `Did you mean "${guess}"?`, fix: `${info.expr}.${guess}${HANDLE_MEMBERS.includes(guess) && guess !== 'look' && guess !== 'explain' ? '' : '(…)'}` } : {}), valid,
    }));
  }

  private unknown(a: Record<string, unknown>): never {
    const where = String(a['where']);
    const key = String(a['key']);
    if (where === 'handle') throw this.unknownMethodErr(a['info'] as HandleInfo, null, key);
    if (where === 'namespace') throw this.unknownMethodErr(a['info'] as HandleInfo, String(a['area']), key);
    const valid = ((a['valid'] ?? []) as string[]).filter((k) => k !== 'toString');
    const guess = suggest(key, valid);
    throw new ChromobenchError(diag('E_UNKNOWN_METHOD', `${where} has no member "${key}"`, {
      ...(guess ? { hint: `Did you mean "${guess}"?`, fix: `${where}.${guess}` } : {}), valid,
    }));
  }

  private notAwaited(info: HandleInfo, key: string | null): never {
    if (info.kind === 'Image') {
      throw new ChromobenchError(diag('E_NOT_AWAITED', `${info.op}() is an image node; it has no number value`, {
        hint: 'images never become numbers; measure them', fix: `(await ${info.expr}.measure.stats()).mean`, path: info.label,
      }));
    }
    const field = key ?? info.fields?.[0];
    throw new ChromobenchError(diag('E_NOT_AWAITED', key ? `${info.op}() is a lazy node: read .${key} after awaiting it.` : `${info.op}() is a lazy node: await it before using it as a number.`, {
      path: `${info.label} → ✗ ${key ?? '(value)'}`,
      hint: 'Nothing has been computed yet; awaiting the node evaluates it.',
      fix: `(await ${info.expr})${field ? `.${field}` : ''}`,
      ...(info.fields?.length ? { valid: info.fields } : {}),
    }));
  }

  private immutable(info: HandleInfo | null, key: string, value: unknown): never {
    const leaf = key.split('.').pop()!;
    const exact = settablePaths().filter((p) => !p.includes('*') && (p === key || p.endsWith(`.${leaf}`)));
    const path = exact[0];
    const fx = this.frameExpr(info?.frame ?? this.bound);
    throw new ChromobenchError(diag('E_IMMUTABLE', `${info ? info.label : key.split('.')[0]} is immutable: assigning ${key} changes nothing`, {
      hint: 'handles are what-ifs; change the recipe with frame.edit, or build a new node with literal options',
      ...(path && value !== undefined ? { fix: editFix(fx, path, value) } : {}),
      ...(exact.length > 1 ? { valid: exact } : {}),
    }));
  }

  private immutableRecipe(frame: string, path: string, value: unknown): never {
    const fx = this.frameExpr(frame);
    throw new ChromobenchError(diag('E_IMMUTABLE', `frame.recipe is a read-only snapshot: assigning ${path} changes nothing`, {
      hint: 'propose the change with frame.edit; the photographer approves it in ask mode',
      ...(value !== undefined ? { fix: editFix(fx, path, value) } : {}),
    }));
  }

  /** Units constants for docs. */
  static readonly DOMAIN_UNITS = Object.fromEntries(Object.entries(DOMAINS).map(([d, i]) => [d, i.unit]));
}

export interface DocsProvider {
  help(name: string | null): unknown;
  docs(a: Record<string, unknown>): unknown;
}

const EMPTY_DOCS: DocsProvider = {
  help: () => 'no reference loaded',
  docs: () => [],
};
