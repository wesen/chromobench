// The page side of the DSL worker (protocol.ts): one DslWorkerClient is one DSL session (one QuickJS VM with
// its own `mem`) running in a Web Worker. It serves the worker's engine calls, sends the worker a copy of the page's
// document log when it changed, and makes the submission an eval made there again on the page's log, through the
// agent's one door (agentSubmit inside the host's change): the page's log and mode decide.
//
//   const dsl = await DslWorkerClient.create({ spawn: createDslWorker, engine, docs });
//   const r = await dsl.eval({ code: 'return 1', frame: 'f1' }, { signal });
//
// Host rules (CHB-008 guide §5.2): evals run one at a time in arrival order; one that waits more than busyMs
// for its turn returns E_BUSY. A deadline (the request's timeoutMs, default 30 s, at most 120 s) is enforced by
// the session itself; the client adds a backstop: on deadline + grace, or on cancellation that the VM does not
// honour within `graceMs` (2 s), the worker is terminated and respawned, and the next eval is told E_SESSION_RESET.
import {
  diag, toDiagnostic,
  type AgentMode, type ContextBlock, type Diagnostic, type Engine, type EvalRequest, type EvalResult, type SourceInfo,
} from '@chromobench/contract';
import { historyOf, type DslLimits, type DslLinks, type LogHost, type Submission } from '@chromobench/dsl';
import type { Log, LogEntry } from '@chromobench/values';
import type { DocsSnapshot, FromWorker, ImagePayload, ToWorker, WorkerLike } from './protocol.ts';

/** A frame the agent may open: its decoded source and display name (its document is the log's). */
export interface FrameView {
  info: SourceInfo;
  name?: string;
}

/**
 * What the agent works on (the studio's store, or memoryDocs): the document log, the photographer's mode, the one
 * way to change the log, a change signal, and the frames the agent may open.
 */
export interface AgentDocs extends LogHost {
  ids(): string[];
  /** the rolls and presets the frames' links resolve against (the studio: its state's `roll.rolls`, `looks.presets`) */
  links?(): DslLinks;
  get(id: string): FrameView | undefined;
  /** calls fn after every change of the log or the mode; returns the unsubscribe function */
  subscribe(fn: () => void): () => void;
}

/** AgentDocs over a log held in memory (tests, a session without a studio). */
export interface MemoryDocs extends AgentDocs {
  setMode(m: AgentMode): void;
}

export function memoryDocs(o: { log: Log; frames: Record<string, FrameView>; mode?: AgentMode }): MemoryDocs {
  let log = o.log;
  let mode: AgentMode = o.mode ?? 'ask';
  const frames = new Map(Object.entries(o.frames));
  const subs = new Set<() => void>();
  const tell = (): void => {
    for (const f of [...subs]) f();
  };
  return {
    ids: () => [...frames.keys()].filter((id) => log.has(id)),
    get: (id) => frames.get(id),
    log: () => log,
    mode: () => mode,
    change: (f) => {
      log = f(log);
      tell();
    },
    setMode: (m) => {
      mode = m;
      tell();
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}

export interface DslWorkerOptions {
  spawn: () => WorkerLike;
  engine: Engine;
  docs: AgentDocs;
  limits?: Partial<DslLimits>;
  /** Prefix of the transaction ids this session's evals submit under (unique per session in one log). */
  txPrefix?: string;
  graceMs?: number;
  busyMs?: number;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
}

export interface EvalOptions {
  signal?: AbortSignal;
}

interface Running {
  id: number;
  resolve(r: EvalResult): void;
  done: boolean;
}

const EMPTY_CONTEXT = (mode: AgentMode): ContextBlock => ({ mode, changed: [], proposals: [], mem: [], functions: [], newFunctions: [] });

/** An EvalResult for an eval the host ended itself (busy, forced stop, dead worker). */
export function hostResult(error: Diagnostic, mode: AgentMode = 'ask', warnings: Diagnostic[] = []): EvalResult {
  const lines = [`error: ${error.code}`, `message: ${JSON.stringify(error.message)}`];
  if (error.hint) lines.push(`hint: ${JSON.stringify(error.hint)}`);
  return { yaml: `${lines.join('\n')}\n`, shows: [], warnings, context: EMPTY_CONTEXT(mode), transactions: [], error };
}

export class DslWorkerClient {
  readonly txPrefix: string;
  private worker!: WorkerLike;
  private ready!: Promise<void>;
  private seq = 0;
  private running: Running | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly calls = new Map<number, AbortController>();
  private sent: { log: Log; mode: AgentMode; frames: string; links: DslLinks | undefined } | null = null;
  private resetNote: Diagnostic | null = null;
  private disposed = false;
  private readonly graceMs: number;
  private readonly busyMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;
  /** evals answered so far, for status lines */
  evals = 0;

  private readonly o: DslWorkerOptions;

  private constructor(o: DslWorkerOptions) {
    this.o = o;
    this.txPrefix = o.txPrefix ?? 'dsl';
    this.graceMs = o.graceMs ?? 2000;
    this.busyMs = o.busyMs ?? 10_000;
    this.defaultTimeoutMs = o.defaultTimeoutMs ?? o.limits?.defaultTimeoutMs ?? 30_000;
    this.maxTimeoutMs = o.maxTimeoutMs ?? o.limits?.maxTimeoutMs ?? 120_000;
  }

  static async create(o: DslWorkerOptions): Promise<DslWorkerClient> {
    const c = new DslWorkerClient(o);
    c.boot();
    await c.ready;
    return c;
  }

  private boot(): void {
    const w = this.o.spawn();
    this.worker = w;
    this.sent = null;
    let onReady!: () => void;
    this.ready = new Promise<void>((r) => (onReady = r));
    w.addEventListener('message', (e: MessageEvent) => {
      if (this.worker !== w) return; // a terminated worker's late messages
      const m = e.data as FromWorker;
      if (m.t === 'ready') onReady();
      else this.onMessage(m);
    });
    w.start?.();
    const init: ToWorker = { t: 'init', engine: { id: this.o.engine.id, caps: this.o.engine.capabilities() }, ...(this.o.limits ? { limits: this.o.limits } : {}), txPrefix: this.txPrefix };
    w.postMessage(init);
  }

  private post(m: ToWorker, transfer?: Transferable[]): void {
    this.worker.postMessage(m, transfer);
  }

  private onMessage(m: FromWorker): void {
    switch (m.t) {
      case 'adopt':
        try {
          this.o.engine.adopt(m.defs);
        } catch {
          // the engine reports the problem again when the node is evaluated
        }
        return;
      case 'engine':
        void this.serve(m);
        return;
      case 'engine.cancel':
        this.calls.get(m.call)?.abort();
        this.calls.delete(m.call);
        return;
      case 'result':
      case 'failed': {
        const r = this.running;
        if (!r || r.id !== m.id || r.done) return;
        if (m.t === 'failed') return this.finish(r, hostResult(m.error));
        return this.finish(r, this.replay(m.result, m.submission));
      }
      default:
        return;
    }
  }

  private async serve(m: Extract<FromWorker, { t: 'engine' }>): Promise<void> {
    const ac = new AbortController();
    this.calls.set(m.call, ac);
    const w = this.worker;
    try {
      if (m.method === 'measure') {
        const r = await this.o.engine.measure(m.node, { ...m.spec, signal: ac.signal });
        if (w === this.worker) this.post({ t: 'engine.reply', call: m.call, ok: { node: r.node, value: r.value, warnings: r.warnings, ...(r.preview ? { preview: true } : {}) } });
      } else {
        const r = await this.o.engine.evaluate(m.node, { ...m.target, signal: ac.signal });
        const data = (await r.read()).slice(); // a copy: the engine's cache keeps its own array
        const p: ImagePayload = { node: r.node, info: r.info, scale: r.scale, region: r.region, width: r.width, height: r.height, format: r.format, data, warnings: r.warnings, ...(r.preview ? { preview: true } : {}) };
        if (w === this.worker) this.post({ t: 'engine.reply', call: m.call, ok: p }, [data.buffer as ArrayBuffer]);
      }
    } catch (e) {
      if (w === this.worker) this.post({ t: 'engine.reply', call: m.call, err: toDiagnostic(e) });
    } finally {
      this.calls.delete(m.call);
    }
  }

  /** The submission the session made on the worker's copy, made again on the page's log (the page decides). */
  private replay(result: EvalResult, sub: Submission | undefined): EvalResult {
    if (!sub) return result;
    const warnings = [...result.warnings];
    const notes: string[] = [];
    let entries: readonly LogEntry[] = [];
    try {
      const r = historyOf(this.o.docs).submit(sub);
      entries = r.entries;
      const said = new Set(result.transactions.map((e) => e.tx.status));
      if (r.stale.length && !said.has('pending')) {
        warnings.push(diag('CONFLICT', `${r.stale.join(', ')} changed while the eval ran: the edits wait for the photographer's approval`));
        notes.push(`${r.stale.join(', ')} changed while the eval ran: the edits wait for approval`);
      }
    } catch (e) {
      const d = toDiagnostic(e);
      warnings.push(diag('CONFLICT', `the edits were not submitted: ${d.code} ${d.message}`, d.hint ? { hint: d.hint } : {}));
      notes.push(`edits not submitted: ${d.code} ${d.message}`);
    }
    const yaml = notes.length ? `${result.yaml.replace(/\n?$/, '\n')}host:\n${notes.map((n) => `  - ${JSON.stringify(n)}`).join('\n')}\n` : result.yaml;
    return { ...result, yaml, warnings, transactions: [...entries] };
  }

  private finish(r: Running, res: EvalResult): void {
    if (r.done) return;
    r.done = true;
    if (this.running === r) this.running = null;
    this.evals++;
    r.resolve(res);
  }

  /** Sends the worker a copy of the documents when the log, the mode or the frames changed since it last saw them. */
  private syncDocs(): void {
    const d = this.o.docs;
    const log = d.log();
    const mode = d.mode();
    const frames: DocsSnapshot['frames'] = {};
    for (const id of d.ids()) {
      const f = d.get(id);
      if (f) frames[id] = { source: f.info, ...(f.name !== undefined ? { name: f.name } : {}) };
    }
    const key = JSON.stringify(Object.entries(frames).map(([id, f]) => [id, f.source.sha256, f.name ?? '']));
    const links = d.links?.();
    if (this.sent && this.sent.log === log && this.sent.mode === mode && this.sent.frames === key && this.sent.links === links) return;
    this.post({ t: 'docs', snapshot: { log: log.toJSON(), mode, frames, ...(links ? { links } : {}) } });
    this.sent = { log, mode, frames: key, links };
  }

  /** Runs one eval in the worker; never rejects (failures come back as EvalResult.error). */
  eval(req: EvalRequest, o: EvalOptions = {}): Promise<EvalResult> {
    const queued = Date.now();
    const run = this.queue.then(() => this.runOne(req, o, queued));
    this.queue = run.catch(() => undefined);
    return run;
  }


  private async runOne(req: EvalRequest, o: EvalOptions, queued: number): Promise<EvalResult> {
    const mode = this.o.docs.mode();
    if (this.disposed) return hostResult(diag('E_SESSION', 'the DSL session is closed'), mode);
    if (Date.now() - queued > this.busyMs) return hostResult(diag('E_BUSY', `the session was busy for more than ${Math.round(this.busyMs / 1000)} s; this eval did not run`, { hint: 'run it again' }), mode);
    if (o.signal?.aborted) return hostResult(diag('E_CANCELLED', 'cancelled before it started'), mode);
    await this.ready;
    const note = this.resetNote; // a forced restart before this eval: say so in its result
    this.resetNote = null;
    this.syncDocs();
    const id = ++this.seq;
    const timeoutMs = Math.min(Math.max(1, req.timeoutMs ?? this.defaultTimeoutMs), this.maxTimeoutMs);
    let resolve!: (r: EvalResult) => void;
    const done = new Promise<EvalResult>((r) => (resolve = r));
    const r: Running = { id, resolve, done: false };
    this.running = r;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const force = (code: 'E_TIMEOUT' | 'E_CANCELLED'): void => {
      if (r.done) return;
      this.kill();
      const msg = code === 'E_TIMEOUT' ? 'the eval ran past its deadline and did not stop; the session was restarted' : 'the eval was stopped by force; the session was restarted';
      this.finish(r, hostResult(diag(code, msg, { hint: 'values in mem are lost; nothing the eval asked to change was submitted' }), mode));
    };
    const stop = (code: 'E_TIMEOUT' | 'E_CANCELLED'): void => {
      if (r.done) return;
      this.post({ t: 'interrupt', id });
      timers.push(setTimeout(() => force(code), this.graceMs));
    };
    const onAbort = (): void => stop('E_CANCELLED');
    o.signal?.addEventListener('abort', onAbort, { once: true });
    // the session enforces timeoutMs itself; this is the backstop for a VM that does not come back
    timers.push(setTimeout(() => stop('E_TIMEOUT'), timeoutMs + this.graceMs));
    const sendReq: EvalRequest = { ...req, timeoutMs };
    this.post({ t: 'eval', id, req: sendReq });
    let res = await done;
    for (const t of timers) clearTimeout(t);
    o.signal?.removeEventListener('abort', onAbort);
    if (note) res = { ...res, warnings: [note, ...res.warnings] };
    return res;
  }

  /** Terminates the worker and starts a fresh one; the next eval is told that mem was lost. */
  private kill(): void {
    for (const ac of this.calls.values()) ac.abort();
    this.calls.clear();
    try {
      this.worker.terminate();
    } catch {
      // already gone
    }
    this.resetNote = diag('E_SESSION_RESET', 'the previous eval was stopped by force; values in mem are lost', { hint: 'load your helpers into mem again' });
    if (!this.disposed) this.boot();
  }

  /** Stops the running eval (Stop in the chat): the VM is interrupted, the worker terminated if it does not stop. */
  interrupt(): void {
    const r = this.running;
    if (r && !r.done) this.post({ t: 'interrupt', id: r.id });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const ac of this.calls.values()) ac.abort();
    this.calls.clear();
    const r = this.running;
    if (r) this.finish(r, hostResult(diag('E_SESSION', 'the DSL session was closed')));
    try {
      this.worker.terminate();
    } catch {
      // already gone
    }
  }
}
