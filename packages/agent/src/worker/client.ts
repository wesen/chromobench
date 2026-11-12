// The page side of the DSL worker (protocol.ts): one DslWorkerClient is one DSL session (one QuickJS VM with
// its own `mem`) running in a Web Worker. It serves the worker's engine calls, keeps the worker's mirror logs
// current, and replays the session's proposals on the real EditLogs (EditLog.propose: the agent's only door).
//
//   const dsl = await DslWorkerClient.create({ spawn: createDslWorker, engine, frames: studioFrames(studio.frames) });
//   const r = await dsl.eval({ code: 'return 1', frame: 'f1' }, { signal });
//
// Host rules (CHB-008 guide §5.2): evals run one at a time in arrival order; one that waits more than busyMs
// for its turn returns E_BUSY. A deadline (the request's timeoutMs, default 30 s, at most 120 s) is enforced by
// the session itself; the client adds a backstop: on deadline + grace, or on cancellation that the VM does not
// honour within `graceMs` (2 s), the worker is terminated and respawned, and the next eval is told E_SESSION_RESET.
import {
  diag, toDiagnostic,
  type AgentMode, type ContextBlock, type Diagnostic, type EditLog, type Engine, type EvalRequest, type EvalResult,
  type LoggedMutation, type SourceInfo,
} from '@chromobench/contract';
import type { DslLimits } from '@chromobench/dsl';
import type { FrameSnapshot, FromWorker, ImagePayload, ProposalCall, ToWorker, WorkerLike } from './protocol.ts';

export interface FrameView {
  log: EditLog;
  info: SourceInfo;
  name?: string;
}

/** The open frames as the session sees them (studio-kit's Frames fits through studioFrames()). */
export interface FrameSource {
  ids(): string[];
  get(id: string): FrameView | undefined;
}

export interface DslWorkerOptions {
  spawn: () => WorkerLike;
  engine: Engine;
  frames: FrameSource;
  limits?: Partial<DslLimits>;
  /** Prefix of the edit-log transaction ids this session's evals propose under (unique per session). */
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
  return { yaml: `${lines.join('\n')}\n`, looks: [], warnings, context: EMPTY_CONTEXT(mode), mutations: [], error };
}

export class DslWorkerClient {
  readonly txPrefix: string;
  private worker!: WorkerLike;
  private ready!: Promise<void>;
  private seq = 0;
  private running: Running | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly calls = new Map<number, AbortController>();
  private readonly versions = new WeakMap<EditLog, number>();
  private readonly watched = new WeakSet<EditLog>();
  private sent = new Map<string, { log: EditLog; v: number }>();
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
    this.sent = new Map();
    let onReady!: () => void;
    this.ready = new Promise<void>((r) => (onReady = r));
    w.addEventListener('message', (e: MessageEvent) => {
      if (this.worker !== w) return; // a terminated worker's late messages
      const m = e.data as FromWorker;
      if (m.t === 'ready') onReady();
      else this.onMessage(m);
    });
    w.start?.();
    const init: ToWorker = { t: 'init', engine: { id: this.o.engine.id, caps: this.o.engine.capabilities() }, ...(this.o.limits ? { limits: this.o.limits } : {}) };
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
        return this.finish(r, this.replay(m.result, m.proposals));
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

  /** The proposals the session made on its mirror logs, made again on the real logs. */
  private replay(result: EvalResult, proposals: ProposalCall[]): EvalResult {
    if (!proposals.length) return result;
    const real: LoggedMutation[] = [];
    const warnings = [...result.warnings];
    const notes: string[] = [];
    for (const p of proposals) {
      const f = this.o.frames.get(p.frame);
      if (!f) {
        warnings.push(diag('CONFLICT', `frame ${p.frame} was closed during the eval; its edits were not submitted`));
        notes.push(`frame ${p.frame} was closed; edits not submitted`);
        continue;
      }
      const tx = `${this.txPrefix}-${p.meta.tx}`;
      try {
        real.push(...f.log.propose(p.ms, { ...p.meta, tx, label: p.meta.label ? p.meta.label.replace(p.meta.tx, tx) : `agent ${tx}` }));
      } catch (e) {
        const d = toDiagnostic(e);
        warnings.push(diag('CONFLICT', `edits for ${p.frame} were not submitted: ${d.code} ${d.message}`, d.hint ? { hint: d.hint } : {}));
        notes.push(`edits for ${p.frame} not submitted: ${d.code} ${d.message}`);
      }
    }
    const yaml = notes.length ? `${result.yaml.replace(/\n?$/, '\n')}host:\n${notes.map((n) => `  - ${JSON.stringify(n)}`).join('\n')}\n` : result.yaml;
    return { ...result, yaml, warnings, mutations: real };
  }

  private finish(r: Running, res: EvalResult): void {
    if (r.done) return;
    r.done = true;
    if (this.running === r) this.running = null;
    this.evals++;
    r.resolve(res);
  }

  /** Sends snapshots of frames whose log changed since the worker last saw them. */
  private syncFrames(): void {
    const set: Record<string, FrameSnapshot> = {};
    for (const id of this.o.frames.ids()) {
      const f = this.o.frames.get(id);
      if (!f) continue;
      this.watch(f.log);
      const v = this.versions.get(f.log) ?? 0;
      const last = this.sent.get(id);
      if (last && last.log === f.log && last.v === v) continue;
      set[id] = { data: f.log.toJSON(), mode: f.log.mode, source: f.info, ...(f.name !== undefined ? { name: f.name } : {}) };
      this.sent.set(id, { log: f.log, v });
    }
    if (Object.keys(set).length) this.post({ t: 'frames', set });
  }

  private watch(log: EditLog): void {
    if (this.watched.has(log)) return;
    this.watched.add(log);
    this.versions.set(log, 0);
    log.on((e) => {
      if (e.type !== 'preview') this.versions.set(log, (this.versions.get(log) ?? 0) + 1);
    });
  }

  /** Runs one eval in the worker; never rejects (failures come back as EvalResult.error). */
  eval(req: EvalRequest, o: EvalOptions = {}): Promise<EvalResult> {
    const queued = Date.now();
    const run = this.queue.then(() => this.runOne(req, o, queued));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private modeOf(frame: string | undefined): AgentMode {
    return (frame ? this.o.frames.get(frame)?.log.mode : undefined) ?? 'ask';
  }

  private async runOne(req: EvalRequest, o: EvalOptions, queued: number): Promise<EvalResult> {
    const mode = this.modeOf(req.frame);
    if (this.disposed) return hostResult(diag('E_SESSION', 'the DSL session is closed'), mode);
    if (Date.now() - queued > this.busyMs) return hostResult(diag('E_BUSY', `the session was busy for more than ${Math.round(this.busyMs / 1000)} s; this eval did not run`, { hint: 'run it again' }), mode);
    if (o.signal?.aborted) return hostResult(diag('E_CANCELLED', 'cancelled before it started'), mode);
    await this.ready;
    const note = this.resetNote; // a forced restart before this eval: say so in its result
    this.resetNote = null;
    this.syncFrames();
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
