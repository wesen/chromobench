// DslSession (guide §5.4): one QuickJS module, runtime and context per chat thread; `mem` lives in
// the context and survives between evals. The eval pump runs the agent's code, settles host
// promises (deferred, DR-2: the sync variant), and enforces the interrupt deadline (interpreter
// time) and the wall-clock deadline (time waiting on the engine).
//
// Contract 1.0: the session reads documents from the host's document log (DslHistory: the studio store's log, or a
// log of its own) as it is when an eval starts, compiles them with the one compiler into its graph, and submits the
// eval's edits at its end as one Submission (an Edit, or a Batch from plan(…, { by: 'agent' })): ask mode proposes,
// auto mode commits, read-only refuses. The engine is reached only through `evaluate`, with node closures shipped
// by `engine.adopt` (§3), so the VM can live in a Web Worker (packages/agent).
import { DefaultIntrinsics, newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import SYNC_VARIANT from '@jitl/quickjs-wasmfile-release-sync';
import {
  ChromobenchError, Graph, LOG_RULES, canonicalJSON, diag, documentKind, nodeId, readField, sha256Hex, toDiagnostic as contractDiag,
  type AgentMode, type Box, type ContextBlock, type Diagnostic, type Document, type Engine, type EvalRequest, type EvalResult,
  type ImageInfo, type NodeDef, type Show,
} from '@chromobench/contract';
import { equal, plan, transaction, tryTransaction, type Batch, type Edit, type Log, type LogEntry, type Mutation } from '@chromobench/values';
import { describeMutation, touched } from './describe.ts';
import type { DslHistory, Submission } from './history.ts';
import type { WbLayoutData, Workbench } from './workbench.ts';
import { Host, type DocsProvider, type DslLinks, type FrameEntry } from './host.ts';
import { PRELUDE } from './prelude/prelude.ts';
import { assemble } from './results/assemble.ts';
import { locate, toDiagnostic, topLevelNames, type GuestError } from './results/diagnostics.ts';
import { renderShow, type ShowEngine } from './results/show.ts';
import { docLine, params } from './results/yaml.ts';

export const WRAP_PREFIX = '(async function () {\n';
export const WRAP_SUFFIX = '\n})';

export interface DslLimits {
  memoryBytes: number;
  stackBytes: number;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  yamlChars: number;
  /** images per eval (h.show, cb.compare) */
  shows: number;
}

export const DEFAULT_LIMITS: DslLimits = Object.freeze({
  memoryBytes: 64 * 1024 * 1024, stackBytes: 1024 * 1024, defaultTimeoutMs: 30_000, maxTimeoutMs: 120_000, yamlChars: 9000, shows: 4,
});

/** A frame the session may open; its document is the log's (kind 'frame'). */
export type DslFrame = FrameEntry;

export interface DslSessionOptions {
  engine: Engine;
  /** the document log, the mode and the door for the agent's edits */
  history: DslHistory;
  frames?: Record<string, DslFrame>;
  limits?: Partial<DslLimits>;
  docs?: DocsProvider;
  /** the shared data a frame's links resolve against (rolls, presets), read per eval; looks are registered (CHB-037 P7) */
  links?: () => DslLinks;
  /** prefix of this session's transaction ids (`chat-eval-3`); unique per session in one log */
  txPrefix?: string;
  /** the studio as the agent's workbench (`wb`); without one, `wb.*` is E_WORKBENCH (CHB-037 P6b) */
  workbench?: Workbench;
}

/** Extra per-eval data for the harness (CHB-008 telemetry, §5.13). */
export interface EvalTrace {
  evalId: string;
  ms: number;
  resultChars: number;
  cut: boolean;
  ops: Record<string, number>;
  vocabulary: Record<string, number>;
  errors: string[];
  warnings: string[];
  shows: number;
  edits: number;
}

interface Pending {
  d: { handle: QuickJSHandle; resolve(h?: QuickJSHandle): void; dispose(): void };
  ac: AbortController;
  dead: boolean;
}

type Outcome =
  | { ok: true; value: unknown }
  | { ok: false; error: Diagnostic; fatal?: 'timeout' | 'memory' };

let modulePromise: Promise<QuickJSWASMModule> | null = null;
/** The QuickJS WASM module (sync release variant), loaded once per realm. */
export function loadQuickJS(): Promise<QuickJSWASMModule> {
  modulePromise ??= newQuickJSWASMModuleFromVariant(SYNC_VARIANT);
  return modulePromise;
}

/** One eval's submission, followed in later context blocks. */
interface Proposal {
  id: string;
  frames: string[];
  seqs: number[];
}

export class DslSession {
  readonly limits: DslLimits;
  readonly graph = new Graph();
  readonly host: Host;
  readonly traces: EvalTrace[] = [];
  private readonly engine: Engine;
  private readonly history: DslHistory;
  private readonly workbench: Workbench | null;
  private readonly frameEntries = new Map<string, FrameEntry>();
  private readonly txPrefix: string;
  private QJS!: QuickJSWASMModule;
  private rt!: QuickJSRuntime;
  private vm!: QuickJSContext;
  private hooks: Record<'begin' | 'run' | 'memInfo' | 'probe', QuickJSHandle> | null = null;
  private deadline = Infinity;
  private evalSeq = 0;
  private readonly pending = new Set<Pending>();
  private waker: (() => void) | null = null;
  private woken = false;
  private readonly sent = new Set<string>();
  private readonly sources = new Map<number, string>();
  private readonly topNames = new Set<string>();
  private readonly seenFns = new Map<string, string>();
  private readonly proposals: Proposal[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private restartNote: string | null = null;
  private disposed = false;
  private running = false;
  private cancelled = false;

  private constructor(opts: DslSessionOptions) {
    this.engine = opts.engine;
    this.history = opts.history;
    this.workbench = opts.workbench ?? null;
    this.txPrefix = opts.txPrefix ? `${opts.txPrefix}-` : '';
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
    this.host = new Host(this.graph, this.frameEntries, this.history);
    if (opts.docs) this.host.docs = opts.docs;
    if (opts.links) this.host.linkSource = opts.links;
    for (const [id, f] of Object.entries(opts.frames ?? {})) this.addFrame(id, f);
  }

  static async create(opts: DslSessionOptions): Promise<DslSession> {
    const s = new DslSession(opts);
    s.QJS = await loadQuickJS();
    s.host.qjs = s.QJS;
    s.initVm();
    return s;
  }

  /** Registers a frame (its decoded source, for the graph's source.open sizes); its document is the log's. */
  addFrame(id: string, f: DslFrame): void {
    this.graph.registerSource(f.source);
    this.frameEntries.set(id, { source: f.source, ...(f.name !== undefined ? { name: f.name } : {}) });
  }

  private initVm(): void {
    this.rt = this.QJS.newRuntime({ memoryLimitBytes: this.limits.memoryBytes, maxStackSizeBytes: this.limits.stackBytes });
    this.rt.setInterruptHandler(() => Date.now() > this.deadline);
    const vm = this.rt.newContext({ intrinsics: { ...DefaultIntrinsics, Date: false } });
    this.vm = vm;
    const hostFn = vm.newFunction('host', (nH, jH) => vm.newString(this.host.dispatch(vm.getString(nH), vm.getString(jH))));
    const evalFn = vm.newFunction('hostEval', (idH) => this.hostEval(vm.getString(idH)));
    const callFn = vm.newFunction('hostCall', (nH, jH) => this.hostCall(vm.getString(nH), vm.getString(jH)));
    this.deadline = Date.now() + 5000;
    const pre = vm.unwrapResult(vm.evalCode(PRELUDE, 'prelude.js'));
    const hooksH = vm.unwrapResult(vm.callFunction(pre, vm.undefined, hostFn, evalFn, callFn));
    pre.dispose();
    hostFn.dispose();
    evalFn.dispose();
    callFn.dispose();
    this.hooks = {
      begin: vm.getProp(hooksH, 'begin'), run: vm.getProp(hooksH, 'run'), memInfo: vm.getProp(hooksH, 'memInfo'), probe: vm.getProp(hooksH, 'probe'),
    };
    hooksH.dispose();
    this.deadline = Infinity;
  }

  private disposeVm(): void {
    for (const p of this.pending) this.kill(p);
    this.pending.clear();
    if (this.hooks) for (const h of Object.values(this.hooks)) if (h.alive) h.dispose();
    this.hooks = null;
    this.vm.dispose();
    this.rt.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeVm();
  }

  /**
   * Stops the running eval (CHB-008: Stop in the chat, MCP cancellation): the interrupt handler fires at the
   * next check, pending engine calls are aborted, and the eval ends with E_CANCELLED; its edits are dropped.
   * Returns false when no eval is running.
   */
  interrupt(): boolean {
    if (!this.running) return false;
    this.cancelled = true;
    this.deadline = 0;
    for (const p of this.pending) p.ac.abort();
    this.wake();
    return true;
  }

  /** Runs one eval. Evals of one session run one at a time, in order. */
  eval(req: EvalRequest): Promise<EvalResult> {
    const run = this.queue.then(() => this.runEval(req));
    this.queue = run.catch(() => undefined);
    return run;
  }

  // ---- host promises -------------------------------------------------------------------------
  private hostEval(id: string): QuickJSHandle {
    return this.deferred((signal) => this.work(id, signal));
  }

  /** A workbench call (`wb.*`, cb.looks.define): answered by the page, so deferred like a measurement. */
  private hostCall(name: string, json: string): QuickJSHandle {
    return this.deferred(() => this.workbenchCall(name, json));
  }

  private async workbenchCall(name: string, json: string): Promise<string> {
    try {
      const a = (JSON.parse(json) ?? {}) as Record<string, unknown>;
      return JSON.stringify({ ok: (await this.wbAnswer(name, a)) ?? null });
    } catch (e) {
      return JSON.stringify({ err: contractDiag(e) });
    }
  }

  private async wbAnswer(name: string, a: Record<string, unknown>): Promise<unknown> {
    const h = this.host;
    h.vocabulary[name] = (h.vocabulary[name] ?? 0) + 1;
    const wb = this.workbench;
    if (name === 'wb.defineLook') return wb?.defineLook ? await wb.defineLook(String(a['src'])) : a['local'];
    if (!wb) {
      throw new ChromobenchError(diag('E_WORKBENCH', 'this session has no workbench: the studio is not attached', { hint: 'frames, cuts, edits and looks work without it; wb.* needs the studio (the chat, the bridge or window.chromobench.eval)' }));
    }
    const actor = { eval: h.evalId, ...(typeof a['why'] === 'string' ? { why: a['why'] } : {}) };
    switch (name) {
      case 'wb.commands': {
        const all = await wb.commands();
        const f = a['filter'];
        if (f === null || f === undefined) return all;
        if (typeof f !== 'string') throw new ChromobenchError(diag('E_ARG_TYPE', 'wb.commands(filter) takes a string: part of an id or a label', { fix: "wb.commands('layer.')" }));
        const q = f.toLowerCase();
        return all.filter((c) => c.id.toLowerCase().includes(q) || c.label.toLowerCase().includes(q));
      }
      case 'wb.run':
      case 'wb.set': {
        const r = name === 'wb.run' ? await wb.run(String(a['id']), (a['args'] as unknown[]) ?? [], actor) : await wb.set(String(a['path']), a['value'], actor);
        h.wbEntries.push(...r.entries);
        return r;
      }
      case 'wb.selectors': return wb.selectors();
      case 'wb.state': return wb.state(String(a['name']), (a['args'] as unknown[]) ?? []);
      case 'wb.screen': return wb.screen(typeof a['module'] === 'string' ? { module: a['module'] } : {});
      case 'wb.layouts': return wb.layouts();
      case 'wb.diagnostics': {
        if (!wb.diagnostics) throw new ChromobenchError(diag('E_WORKBENCH', 'this studio has no diagnostics journal', { hint: 'the studio page has one; a headless studio without the diagnostics service does not' }));
        const o: { level?: string; source?: string; limit?: number; text?: string } = {};
        if (typeof a['level'] === 'string') o.level = a['level'];
        if (typeof a['source'] === 'string') o.source = a['source'];
        if (typeof a['limit'] === 'number') o.limit = a['limit'];
        if (typeof a['text'] === 'string') o.text = a['text'];
        return wb.diagnostics(o);
      }
      case 'wb.build': return wb.build(a['layout'] as WbLayoutData);
      case 'wb.use': {
        if (this.history.mode() === 'read-only') throw new ChromobenchError(diag('E_READONLY', 'the agent is read-only: wb.layouts.use cannot propose a layout', { hint: 'describe the layout instead; the photographer can switch the mode' }));
        return wb.use(a['layout'] as WbLayoutData, actor);
      }
      default: throw new ChromobenchError(diag('E_INTERNAL', `unknown workbench call ${name}`));
    }
  }

  /** A guest promise settled by host work (a measurement, a workbench call); the pump waits for it. */
  private deferred(work: (signal: AbortSignal) => Promise<string>): QuickJSHandle {
    const d = this.vm.newPromise();
    const p: Pending = { d, ac: new AbortController(), dead: false };
    this.pending.add(p);
    work(p.ac.signal)
      .then((json) => {
        if (p.dead) return;
        const s = this.vm.newString(json);
        d.resolve(s);
        s.dispose();
      })
      .finally(() => {
        if (!p.dead) {
          this.pending.delete(p);
          d.dispose();
        }
        this.wake();
      });
    return d.handle;
  }

  private kill(p: Pending): void {
    p.dead = true;
    p.ac.abort();
    p.d.dispose();
  }

  private wake(): void {
    if (this.waker) this.waker();
    else this.woken = true;
  }

  private nextSettlement(): Promise<boolean> {
    if (this.woken) {
      this.woken = false;
      return Promise.resolve(true);
    }
    return new Promise((res) => {
      const t = setTimeout(() => {
        this.waker = null;
        res(false);
      }, Math.max(0, this.deadline - Date.now()));
      this.waker = () => {
        clearTimeout(t);
        this.waker = null;
        res(true);
      };
    });
  }

  /** Ships the node's not-yet-sent definitions to the engine (closure shipping, §3). */
  ship(id: string): void {
    const defs: NodeDef[] = [];
    const seen = new Set<string>();
    const visit = (nid: string): void => {
      if (seen.has(nid) || this.sent.has(nid)) return;
      seen.add(nid);
      const n = this.graph.get(nid);
      if (!n) throw new ChromobenchError(diag('E_NO_NODE', `unknown node ${nid.slice(0, 12)}`));
      for (const i of n.inputs) visit(i);
      defs.push({ op: n.op, inputs: [...n.inputs], args: n.args });
    };
    visit(id);
    if (defs.length) this.engine.adopt(defs);
    for (const d of defs) this.sent.add(nodeId(d));
  }

  private async work(id: string, signal: AbortSignal): Promise<string> {
    try {
      const n = this.graph.get(id);
      if (!n) throw new ChromobenchError(diag('E_NO_NODE', `unknown node ${id.slice(0, 12)}`));
      if (n.info.kind === 'Image') {
        const i = n.info as ImageInfo;
        return JSON.stringify({ ok: { node: `#${id.slice(0, 4)}`, op: n.op, domain: i.domain, width: i.width, height: i.height, channels: i.channels, note: 'an image summary: pixels never enter the DSL; use .measure.stats(), .measure.patches() or .show()' } });
      }
      this.ship(id);
      const m = await this.engine.measure(n, { signal });
      return JSON.stringify({ ok: m.value });
    } catch (e) {
      return JSON.stringify({ err: contractDiag(e) });
    }
  }

  // ---- the pump ------------------------------------------------------------------------------
  private dumpError(h: QuickJSHandle): GuestError {
    const v = this.vm.dump(h) as Record<string, unknown> | string;
    h.dispose();
    if (typeof v === 'object' && v !== null) return { name: String(v['name'] ?? 'Error'), message: String(v['message'] ?? ''), stack: String(v['stack'] ?? '') };
    return { name: 'Error', message: String(v) };
  }

  private failure(e: GuestError, n: number): Outcome {
    const d = toDiagnostic(e, n, this.topNames);
    return { ok: false, error: d, ...(d.code === 'E_TIMEOUT' ? { fatal: 'timeout' as const } : d.code === 'E_MEMORY' ? { fatal: 'memory' as const } : {}) };
  }

  private async pump(code: string, n: number): Promise<Outcome> {
    const vm = this.vm;
    const fnR = vm.evalCode(WRAP_PREFIX + code + WRAP_SUFFIX, `eval-${n}.js`);
    if (fnR.error) return this.failure(this.dumpError(fnR.error), n);
    const pR = vm.callFunction(this.hooks!.run, vm.undefined, fnR.value);
    fnR.value.dispose();
    if (pR.error) return this.failure(this.dumpError(pR.error), n);
    const p = pR.value;
    try {
      for (;;) {
        const jobs = this.rt.executePendingJobs();
        let jobErr: GuestError | null = null;
        if (jobs.error) jobErr = this.dumpError(jobs.error);
        const st = vm.getPromiseState(p);
        if (st.type === 'fulfilled') {
          const env = JSON.parse(vm.getString(st.value)) as { ok: boolean; value?: unknown; error?: GuestError };
          st.value.dispose();
          if (env.ok) return { ok: true, value: env.value };
          return this.failure(env.error!, n);
        }
        if (st.type === 'rejected') return this.failure(this.dumpError(st.error), n);
        if (Date.now() > this.deadline) return this.failure({ name: 'InternalError', message: 'interrupted' }, n);
        if (jobErr && (/interrupted|out of memory/.test(jobErr.message))) return this.failure(jobErr, n);
        if (this.pending.size === 0) {
          return { ok: false, error: diag('E_STALLED', 'the eval is waiting on something that never settles', { hint: 'only measurements can be awaited; there are no timers or events' }) };
        }
        if (!(await this.nextSettlement())) return this.failure({ name: 'InternalError', message: 'interrupted' }, n);
      }
    } finally {
      p.dispose();
    }
  }

  /** After a timeout or OOM: is the VM still able to run promises? (goja-cv probePromises) */
  private probe(): boolean {
    try {
      this.deadline = Date.now() + 1000;
      const r = this.vm.callFunction(this.hooks!.probe, this.vm.undefined);
      if (r.error) {
        r.error.dispose();
        return false;
      }
      const j = this.rt.executePendingJobs();
      if (j.error) j.error.dispose();
      const st = this.vm.getPromiseState(r.value);
      const ok = st.type === 'fulfilled';
      if (st.type === 'fulfilled') st.value.dispose();
      else if (st.type === 'rejected') st.error.dispose();
      r.value.dispose();
      return ok;
    } catch {
      return false;
    }
  }

  private restart(): void {
    try {
      this.disposeVm();
    } catch {
      // a VM that hit its limits may not dispose cleanly; drop it
    }
    this.sent.clear();
    this.seenFns.clear();
    this.initVm();
    this.restartNote = 'the DSL session was restarted; mem was lost';
  }

  // ---- one eval ------------------------------------------------------------------------------
  private async runEval(req: EvalRequest): Promise<EvalResult> {
    if (this.disposed) throw new ChromobenchError(diag('E_SESSION', 'the DSL session is disposed'));
    const t0 = performance.now();
    this.evalSeq += 1;
    const n = this.evalSeq;
    const evalId = `${this.txPrefix}eval-${n}`;
    this.sources.set(n, req.code);
    this.sources.delete(n - 50);
    const frame = req.frame ?? null;
    this.host.begin(n, evalId, frame);
    this.running = true;
    this.cancelled = false;
    let outcome: Outcome;
    if (frame !== null && !this.host.frameIds().includes(frame)) {
      outcome = { ok: false, error: diag('E_NO_FRAME', `no frame "${frame}"`, { valid: this.host.frameIds() }) };
    } else {
      const docText = frame ? canonicalJSON(this.host.state(frame).base) : '';
      const seed = parseInt(sha256Hex(docText + req.code).slice(0, 8), 16) | 0;
      this.deadline = Date.now() + 1000;
      const fH = frame === null ? this.vm.null : this.vm.newString(frame);
      const sH = this.vm.newNumber(seed);
      const b = this.vm.callFunction(this.hooks!.begin, this.vm.undefined, fH, sH);
      if (frame !== null) fH.dispose();
      sH.dispose();
      if (b.error) b.error.dispose();
      else b.value.dispose();
      this.deadline = this.cancelled ? 0 : Date.now() + Math.min(req.timeoutMs ?? this.limits.defaultTimeoutMs, this.limits.maxTimeoutMs);
      outcome = await this.pump(req.code, n);
    }
    this.running = false;
    if (this.cancelled && !outcome.ok) outcome = { ok: false, error: diag('E_CANCELLED', 'the eval was stopped before it finished', { hint: 'nothing it asked to change was submitted; mem is intact' }), ...(outcome.fatal ? { fatal: outcome.fatal } : {}) };
    this.cancelled = false;
    const warnings: Diagnostic[] = [...this.host.warnings];
    // host work still in flight: the agent did not await it
    if (this.pending.size > 0) {
      warnings.push(diag('UNHANDLED', `${this.pending.size} measurement(s) or wb call(s) were started but not awaited; they were cancelled`, { hint: 'await every measurement and every wb call you need' }));
      for (const p of [...this.pending]) this.kill(p);
      this.pending.clear();
    }
    this.woken = false;
    for (const nm of topLevelNames(req.code)) this.topNames.add(nm);
    if (!outcome.ok && outcome.fatal) {
      if (!this.probe()) this.restart();
    }
    // edits: submitted together at the end of a successful eval (DR-3)
    const edits = this.host.edits;
    const submitted = outcome.ok && edits.length ? this.submit(evalId, warnings) : { transactions: [], lines: [] };
    const editLines = submitted.lines;
    // the commands the agent ran made entries of their own (wb.run, wb.set): they belong to this eval too
    const transactions = [...submitted.transactions, ...this.host.wbEntries];
    if (!outcome.ok && edits.length) {
      warnings.push(diag('EDITS_DROPPED', `the eval failed, so its edits were not submitted: ${edits.map((e) => e.id).join(', ')}`, { hint: 'fix the error and run the edits again' }));
    }
    const changed = outcome.ok ? [...new Set(edits.flatMap((e) => e.mutations.map(touched)))] : [];
    // images: at most `shows`, in creation order
    const shows: Show[] = [];
    const reqs = this.host.shows;
    if (reqs.length > this.limits.shows) {
      const extra = reqs.slice(this.limits.shows);
      warnings.push(diag('SHOWS', `${reqs.length} images were shown; only the first ${this.limits.shows} are delivered. Dropped: ${extra.map((l) => `image ${l.n}${l.line !== undefined ? ` (line ${l.line})` : ''}`).join(', ')}`));
    }
    const se = this.showEngine();
    for (const r of reqs.slice(0, this.limits.shows)) {
      try {
        shows.push(await renderShow(se, r));
      } catch (e) {
        const d = contractDiag(e);
        warnings.push(diag('SHOWS', `image ${r.n} could not be rendered: ${d.code} ${d.message}`));
      }
    }
    const context = this.context(frame, changed);
    let errorWhere: string | undefined;
    let error: Diagnostic | undefined;
    if (!outcome.ok) {
      error = outcome.error;
      if (this.restartNote) {
        error = { ...error, hint: `${error.hint ? `${error.hint}; ` : ''}${this.restartNote}` };
        this.restartNote = null;
      }
      if (error.where) {
        const loc = { line: error.where.line };
        const src = this.sources.get(n)?.split('\n')[loc.line - 1];
        errorWhere = `line ${loc.line}${src !== undefined ? `: ${src.trim()}` : ''}`;
      }
    }
    const consoleLines = this.host.logs.map((l) => `${l.line !== undefined ? `line ${l.line}: ` : ''}${l.level !== 'log' ? `[${l.level}] ` : ''}${l.text}`);
    const { yaml, cut } = assemble({
      ...(outcome.ok ? { value: outcome.value } : {}),
      ...(error ? { error } : {}),
      ...(errorWhere ? { errorWhere } : {}),
      edits: editLines, shown: shows, console: consoleLines, warnings, context, cap: this.limits.yamlChars,
    });
    const ms = Math.round(performance.now() - t0);
    const allWarnings = cut ? [...warnings, diag('CUT', 'the returned value was cut')] : warnings;
    this.traces.push({
      evalId, ms, resultChars: yaml.length, cut, ops: { ...this.host.ops }, vocabulary: { ...this.host.vocabulary },
      errors: error ? [error.code] : [], warnings: allWarnings.map((w) => w.code), shows: shows.length, edits: edits.length,
    });
    return { yaml, shows, warnings: allWarnings, context, transactions, ...(error ? { error } : {}), trace: { ms, ops: { ...this.host.ops } } };
  }

  /**
   * The eval's queued edits as one submission: per frame one transaction of its mutations in order; one frame is an
   * Edit, several frames (or a named look) a Batch from plan(…, { by: 'agent' }).
   */
  private submit(evalId: string, warnings: Diagnostic[]): { transactions: LogEntry[]; lines: string[] } {
    const edits = this.host.edits;
    const frames = [...new Set(edits.map((e) => e.frame))];
    const of = (f: string, k: 'mutations' | 'inverses'): Mutation[] => edits.filter((e) => e.frame === f).flatMap((e) => e[k]);
    const why = [...new Set(edits.map((e) => e.why).filter((w): w is string => !!w))].join('; ');
    const looks = [...new Set(edits.map((e) => e.look).filter((l): l is string => !!l))];
    const label = edits.find((e) => e.label)?.label ?? `agent ${evalId}`;
    const source = { kind: 'agent', eval: evalId, ...(why ? { why } : {}), ...(looks.length ? { looks } : {}) };
    let x: Edit | Batch;
    if (frames.length === 1 && !looks.length) {
      x = { doc: frames[0]!, tx: transaction({ id: evalId, label, by: 'agent', source, mutations: of(frames[0]!, 'mutations') }) };
    } else {
      x = plan(this.host.log.targets<Document>(frames), (_d, id) => of(id, 'mutations'), { id: evalId, label, by: 'agent', source });
      for (const s of x.skipped) warnings.push(diag('CONFLICT', `the edits for ${s.doc} were left out: ${contractDiag(s.error).message}`));
    }
    const sub: Submission = { x, ...(why ? { why } : {}), read: Object.fromEntries(frames.map((f) => [f, of(f, 'inverses')])) };
    let status = 'not submitted';
    let transactions: LogEntry[] = [];
    try {
      const r = this.history.submit(sub);
      transactions = [...r.entries];
      status = r.how === 'committed' ? 'applied' : 'pending';
      if (r.stale.length) {
        warnings.push(diag('CONFLICT', `${r.stale.join(', ')} changed while the eval ran: the edits wait for the photographer's approval`, { hint: 'the next context block says what they decided' }));
      }
      if (transactions.length) this.proposals.push({ id: evalId, frames, seqs: transactions.map((e) => e.seq) });
    } catch (e) {
      const d = contractDiag(e);
      warnings.push(diag('CONFLICT', `the edits were not submitted: ${d.code} ${d.message}`, d.hint ? { hint: d.hint } : {}));
    }
    const lines = edits.map((q) => `${q.id} ${status}: ${q.mutations.map((m, i) => describeMutation(m, q.inverses[i])).join('; ')}${q.why ? `; why: ${q.why}` : ''}`);
    return { transactions, lines };
  }

  private showEngine(): ShowEngine {
    return {
      graph: this.graph,
      intern: (op, inputs, args) => this.graph.intern(op, inputs, args).node,
      evaluate: async (id: string, region: Box, scale: number) => {
        this.ship(id);
        const n = this.graph.get(id)!;
        const r = await this.engine.evaluate(n, { scale, region, precision: 'preview' });
        return { data: await r.read(), width: r.width, height: r.height, channels: r.info.channels };
      },
      measure: async (id: string) => {
        this.ship(id);
        return (await this.engine.measure(this.graph.get(id)!)).value;
      },
      doc: (f) => (f && this.host.log.has(f) ? this.host.state(f).base : null),
    };
  }

  // ---- the context block ---------------------------------------------------------------------
  private memInfo(): { key: string; kind: string; src?: string; label?: string; n?: number }[] {
    this.deadline = Date.now() + 1000;
    try {
      const r = this.vm.callFunction(this.hooks!.memInfo, this.vm.undefined);
      if (r.error) {
        r.error.dispose();
        return [];
      }
      const s = this.vm.getString(r.value);
      r.value.dispose();
      return JSON.parse(s);
    } finally {
      this.deadline = Infinity;
    }
  }

  /** What became of a submission: pending (or stale), approved, applied, rejected or undone. */
  private proposalStatus(p: Proposal, log: Log): string {
    const es = p.seqs.map((s) => log.entry(s)).filter((e): e is LogEntry => !!e);
    if (!es.length) return 'undone';
    if (es.every((e) => e.tx.status === 'rejected')) return 'rejected';
    if (es.every((e) => e.tx.status === 'applied')) {
      const live = new Set(log.inEffect().map((e) => e.seq));
      if (!es.every((e) => live.has(e.seq))) return 'undone';
      return es.some((e) => e.approvedBy) ? 'approved' : 'applied';
    }
    for (const e of es.filter((x) => x.tx.status === 'pending')) {
      const rules = LOG_RULES[log.kind(e.doc)];
      const r = tryTransaction(log.doc(e.doc), { ...e.tx, inverses: [] }, (rules ?? {}) as never);
      if (!r.ok) return `stale, not applied (it no longer applies to ${e.doc}: ${contractDiag(r.error).message})`;
      const i = r.tx.inverses.findIndex((m, k) => !equal(m, e.tx.inverses[k]));
      if (i >= 0) return `stale, not applied (the photographer changed ${touched(e.tx.mutations[i]!)})`;
    }
    return 'pending';
  }

  private context(frame: string | null, changed: string[]): ContextBlock {
    let frameLine: string | undefined;
    const mode: AgentMode = this.history.mode();
    const log = this.history.log();
    if (frame && this.host.frameIds().includes(frame)) {
      const d = this.host.state(frame).base;
      const name = this.host.frameName(frame);
      const stock = String(readField(d, d.stages.scan ? 'stages.scan.medium.stock' : 'stages.film.medium.stock', this.host.links()) ?? 'roll');
      const paper = String(readField(d, 'stages.darkroom.medium.paper', this.host.links()) ?? 'roll');
      frameLine = `${name !== frame ? `${frame} (${name})` : frame} · ${documentKind(d)} · ${stock} → ${paper} · mode ${mode}`;
    }
    const mem = this.memInfo();
    const memLine = mem.map((m) => `${m.key} (${m.kind === 'handle' ? m.label : m.kind === 'array' ? `array of ${m.n}` : m.kind})`);
    const functions: string[] = [];
    const newFunctions: string[] = [];
    for (const m of mem) {
      if (m.kind !== 'function' || m.src === undefined) continue;
      const sig = `mem.${m.key}(${params(m.src)})`;
      functions.push(sig);
      if (this.seenFns.get(m.key) !== m.src) {
        const doc = docLine(m.src);
        newFunctions.push(doc ? `${sig}: ${doc}` : sig);
        this.seenFns.set(m.key, m.src);
      }
    }
    const proposals = this.proposals.filter((p) => !frame || p.frames.includes(frame)).slice(-5).map((p) => `${p.id} ${this.proposalStatus(p, log)}`);
    return { ...(frameLine ? { frame: frameLine } : {}), mode, changed, proposals, mem: memLine, functions, newFunctions };
  }

  /** Where an error points, for tests and transports. */
  static locate = locate;
}
