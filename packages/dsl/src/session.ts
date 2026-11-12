// DslSession (guide §5.4): one QuickJS module, runtime and context per chat thread; `mem` lives in
// the context and survives between evals. The eval pump runs the agent's code, settles host
// promises (deferred, DR-2: the sync variant), and enforces the interrupt deadline (interpreter
// time) and the wall-clock deadline (time waiting on the engine).
//
// v0 runs the VM on the calling thread. Everything the VM touches synchronously is session-local
// (registry, graph, recipe snapshot); the engine is reached only through `evaluate`, with node
// closures shipped by `engine.adopt` (§3), so moving the VM into a Web Worker is a transport change.
import { DefaultIntrinsics, newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import SYNC_VARIANT from '@jitl/quickjs-wasmfile-release-sync';
import {
  ChromobenchError, Graph, diag, nodeId, sha256Hex, toDiagnostic as contractDiag,
  type AgentMode, type Box, type ContextBlock, type Diagnostic, type EditLog, type Engine, type EvalRequest, type EvalResult,
  type FrameRecipe, type ImageInfo, type LoggedMutation, type Look, type NodeDef, type SourceInfo,
} from '@chromobench/contract';
import { Host, type DocsProvider, type LooksProvider, type FrameEntry, type QueuedEdit } from './host.ts';
import { PRELUDE } from './prelude/prelude.ts';
import { assemble, describeMutation } from './results/assemble.ts';
import { locate, toDiagnostic, topLevelNames, type GuestError } from './results/diagnostics.ts';
import { renderLook, type LookEngine } from './results/looks.ts';
import { docLine, params } from './results/yaml.ts';

export const WRAP_PREFIX = '(async function () {\n';
export const WRAP_SUFFIX = '\n})';

export interface DslLimits {
  memoryBytes: number;
  stackBytes: number;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  yamlChars: number;
  looks: number;
}

export const DEFAULT_LIMITS: DslLimits = Object.freeze({
  memoryBytes: 64 * 1024 * 1024, stackBytes: 1024 * 1024, defaultTimeoutMs: 30_000, maxTimeoutMs: 120_000, yamlChars: 9000, looks: 4,
});

export interface DslFrame {
  log: EditLog;
  /** The decoded source, so the session's graph can infer source.open sizes. */
  source: SourceInfo;
  /** Untrusted display name (printed quoted). */
  name?: string;
}

export interface DslSessionOptions {
  engine: Engine;
  frames?: Record<string, DslFrame>;
  limits?: Partial<DslLimits>;
  docs?: DocsProvider;
  /** cb.looks.* (CHB-021): the studio's looks registry */
  looks?: LooksProvider;
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
  looks: number;
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

interface Proposal {
  tx: string;
  frame: string;
  seqs: number[];
}

export class DslSession {
  readonly limits: DslLimits;
  readonly graph = new Graph();
  readonly host: Host;
  readonly traces: EvalTrace[] = [];
  private readonly engine: Engine;
  private readonly frameEntries = new Map<string, FrameEntry>();
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
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
    this.host = new Host(this.graph, this.frameEntries);
    if (opts.docs) this.host.docs = opts.docs;
    if (opts.looks) this.host.looksProvider = opts.looks;
    for (const [id, f] of Object.entries(opts.frames ?? {})) this.addFrame(id, f);
  }

  static async create(opts: DslSessionOptions): Promise<DslSession> {
    const s = new DslSession(opts);
    s.QJS = await loadQuickJS();
    s.initVm();
    return s;
  }

  addFrame(id: string, f: DslFrame): void {
    this.graph.registerSource(f.source);
    this.frameEntries.set(id, { log: f.log, ...(f.name !== undefined ? { name: f.name } : {}) });
  }

  private initVm(): void {
    this.rt = this.QJS.newRuntime({ memoryLimitBytes: this.limits.memoryBytes, maxStackSizeBytes: this.limits.stackBytes });
    this.rt.setInterruptHandler(() => Date.now() > this.deadline);
    const vm = this.rt.newContext({ intrinsics: { ...DefaultIntrinsics, Date: false } });
    this.vm = vm;
    const hostFn = vm.newFunction('host', (nH, jH) => vm.newString(this.host.dispatch(vm.getString(nH), vm.getString(jH))));
    const evalFn = vm.newFunction('hostEval', (idH) => this.hostEval(vm.getString(idH)));
    this.deadline = Date.now() + 5000;
    const pre = vm.unwrapResult(vm.evalCode(PRELUDE, 'prelude.js'));
    const hooksH = vm.unwrapResult(vm.callFunction(pre, vm.undefined, hostFn, evalFn));
    pre.dispose();
    hostFn.dispose();
    evalFn.dispose();
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
    const d = this.vm.newPromise();
    const p: Pending = { d, ac: new AbortController(), dead: false };
    this.pending.add(p);
    this.work(id, p.ac.signal)
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
        return JSON.stringify({ ok: { node: `#${id.slice(0, 4)}`, op: n.op, domain: i.domain, width: i.width, height: i.height, channels: i.channels, note: 'an image summary: pixels never enter the DSL; use .measure.stats(), .measure.patches() or .look()' } });
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
    const evalId = `eval-${n}`;
    this.sources.set(n, req.code);
    this.sources.delete(n - 50);
    const frame = req.frame ?? null;
    this.host.begin(n, frame);
    this.running = true;
    this.cancelled = false;
    let outcome: Outcome;
    if (frame !== null && !this.frameEntries.has(frame)) {
      outcome = { ok: false, error: diag('E_NO_FRAME', `no frame "${frame}"`, { valid: [...this.frameEntries.keys()] }) };
    } else {
      const stateHash = frame ? this.frameEntries.get(frame)!.log.stateHash : '';
      const seed = parseInt(sha256Hex(stateHash + req.code).slice(0, 8), 16) | 0;
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
      warnings.push(diag('UNHANDLED', `${this.pending.size} measurement(s) were started but not awaited; they were cancelled`, { hint: 'await every measurement you need' }));
      for (const p of [...this.pending]) this.kill(p);
      this.pending.clear();
    }
    this.woken = false;
    for (const nm of topLevelNames(req.code)) this.topNames.add(nm);
    if (!outcome.ok && outcome.fatal) {
      if (!this.probe()) this.restart();
    }
    // edits: submitted together at the end of a successful eval (DR-3)
    const mutations: LoggedMutation[] = [];
    const editLines: string[] = [];
    const changed: string[] = [];
    const edits = this.host.edits;
    if (outcome.ok && edits.length) {
      const byFrame = new Map<string, QueuedEdit[]>();
      for (const e of edits) byFrame.set(e.frame, [...(byFrame.get(e.frame) ?? []), e]);
      for (const [fid, qs] of byFrame) {
        const log = this.frameEntries.get(fid)!.log;
        const ms = qs.flatMap((q) => q.mutations);
        const why = qs.map((q) => q.why).filter((w): w is string => !!w).join('; ');
        try {
          const batch = qs.find((q) => q.batch)?.batch;
          const entries = log.propose(ms, { tx: evalId, ...(why ? { why } : {}), label: `agent ${evalId}`, ...(batch ? { batch } : {}) });
          mutations.push(...entries);
          this.proposals.push({ tx: evalId, frame: fid, seqs: entries.map((e) => e.seq) });
          let k = 0;
          for (const q of qs) {
            const mine = entries.slice(k, k + q.mutations.length);
            k += q.mutations.length;
            const status = mine[0]?.status ?? 'pending';
            editLines.push(`${q.id} ${status}: ${q.mutations.map((m, i) => describeMutation(m as never, q.was[i])).join('; ')}${q.why ? `; why: ${q.why}` : ''}`);
          }
        } catch (e) {
          const d = contractDiag(e);
          warnings.push(diag('CONFLICT', `edits for ${fid} were not submitted: ${d.code} ${d.message}`));
        }
      }
      for (const e of edits) for (const m of e.mutations) changed.push(m.op === 'set' ? m.path : m.op === 'exposure.add' ? `print.exposures.${m.exposure.id}` : m.op === 'exposure.remove' ? `print.exposures.${m.id}` : m.op === 'mask.set' ? `masks.${m.id}` : m.op);
    } else if (edits.length) {
      warnings.push(diag('EDITS_DROPPED', `the eval failed, so its edits were not submitted: ${edits.map((e) => e.id).join(', ')}`, { hint: 'fix the error and run the edits again' }));
    }
    // looks: at most four, in creation order
    const looks: Look[] = [];
    const reqs = this.host.looks;
    if (reqs.length > this.limits.looks) {
      const extra = reqs.slice(this.limits.looks);
      warnings.push(diag('LOOKS', `${reqs.length} looks were made; only the first ${this.limits.looks} are delivered. Dropped: ${extra.map((l) => `look ${l.n}${l.line !== undefined ? ` (line ${l.line})` : ''}`).join(', ')}`));
    }
    const le = this.lookEngine();
    for (const r of reqs.slice(0, this.limits.looks)) {
      try {
        looks.push(await renderLook(le, r));
      } catch (e) {
        const d = contractDiag(e);
        warnings.push(diag('LOOKS', `look ${r.n} could not be rendered: ${d.code} ${d.message}`));
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
      edits: editLines, looks, console: consoleLines, warnings, context, cap: this.limits.yamlChars,
    });
    const ms = Math.round(performance.now() - t0);
    const allWarnings = cut ? [...warnings, diag('CUT', 'the returned value was cut')] : warnings;
    this.traces.push({
      evalId, ms, resultChars: yaml.length, cut, ops: { ...this.host.ops }, vocabulary: { ...this.host.vocabulary },
      errors: error ? [error.code] : [], warnings: allWarnings.map((w) => w.code), looks: looks.length, edits: edits.length,
    });
    return { yaml, looks, warnings: allWarnings, context, mutations, ...(error ? { error } : {}), trace: { ms, ops: { ...this.host.ops } } };
  }

  private lookEngine(): LookEngine {
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
      recipe: (f) => (f ? this.host.state(f).base : null),
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

  private proposalStatus(p: Proposal): string {
    const log = this.frameEntries.get(p.frame)?.log;
    if (!log) return 'unknown';
    const es = p.seqs.map((s) => log.entries[s - 1]!).filter(Boolean);
    if (es.every((e) => e.status === 'rejected')) return 'rejected';
    if (es.every((e) => e.status === 'applied')) return es.some((e) => e.approvedBy) ? 'approved' : 'applied';
    const r = log.committed;
    const stale = es.find((e) => e.status === 'pending' && e.m.op === 'set' && e.m.expect !== undefined && JSON.stringify(getAt(r, e.m.path)) !== JSON.stringify(e.m.expect));
    if (stale && stale.m.op === 'set') return `stale, not applied (the photographer changed ${stale.m.path})`;
    return 'pending';
  }

  private context(frame: string | null, changed: string[]): ContextBlock {
    let frameLine: string | undefined;
    let mode: AgentMode = 'ask';
    if (frame && this.frameEntries.has(frame)) {
      const f = this.frameEntries.get(frame)!;
      const r: FrameRecipe = f.log.committed;
      mode = f.log.mode;
      const stock = r.scan?.stock ?? r.capture?.stock ?? '?';
      frameLine = `${f.name && f.name !== frame ? `${frame} (${f.name})` : frame} · ${r.kind} · ${stock} → ${r.print.paper} · mode ${mode}`;
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
    const proposals = this.proposals.filter((p) => !frame || p.frame === frame).slice(-5).map((p) => `${p.tx} ${this.proposalStatus(p)}`);
    return { ...(frameLine ? { frame: frameLine } : {}), mode, changed: [...new Set(changed)], proposals, mem: memLine, functions, newFunctions };
  }

  /** Where an error points, for tests and transports. */
  static locate = locate;
}

function getAt(r: unknown, path: string): unknown {
  let cur: unknown = r;
  for (const seg of path.split('.')) {
    if (Array.isArray(cur)) cur = cur.find((e) => e && typeof e === 'object' && (e as { id?: string }).id === seg);
    else if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[seg];
    else return undefined;
  }
  return cur;
}
