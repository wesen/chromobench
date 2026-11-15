// The worker side of the DSL session (protocol.ts): a DslSession on an engine proxy and a copy of the page's log.
//
//   // dsl.worker.ts
//   serveDsl(self as unknown as Endpoint);
//
// The proxy engine forwards adopt/measure/evaluate to the page; open/prepare are not reachable from the DSL. The
// copy of the log is loaded from the page's snapshot (Log.load replays and checks it); the session submits to it
// through the same door as the page (agentSubmit), and the submission goes back with the result for the page to
// make on its own log.
import {
  ChromobenchError, LOG_RULES, diag, toDiagnostic,
  type AgentMode, type Engine, type EngineCaps, type EngineId, type EvalTarget, type ImageResult, type Measurement,
  type MeasureSpec, type NodeDef, type NodeRef, type SourceInfo,
} from '@chromobench/contract';
import { agentSubmit, DslSession, docsProvider, type DslHistory, type Submission } from '@chromobench/dsl';
import { Log } from '@chromobench/values';
import type { DocsSnapshot, Endpoint, FromWorker, ImagePayload, ToWorker } from './protocol.ts';

/** The worker's copy of the page's log; a submission is applied to it and kept for the page. */
class MirrorHistory implements DslHistory {
  private current = Log.create({ rules: LOG_RULES });
  private m: AgentMode = 'ask';
  submission: Submission | null = null;
  log(): Log {
    return this.current;
  }
  mode(): AgentMode {
    return this.m;
  }
  load(s: DocsSnapshot): void {
    this.current = Log.load(s.log, { rules: LOG_RULES });
    this.m = s.mode;
  }
  submit(s: Submission): ReturnType<DslHistory['submit']> {
    const r = agentSubmit(this.current, s, this.m);
    this.current = r.log;
    this.submission = structuredClone(s);
    return { entries: r.entries, how: r.how, stale: r.stale };
  }
}

class ProxyEngine implements Engine {
  private calls = 0;
  private readonly waiting = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void }>();
  readonly id: EngineId;
  private readonly caps: EngineCaps;
  private readonly send: (m: FromWorker) => void;
  constructor(id: EngineId, caps: EngineCaps, send: (m: FromWorker) => void) {
    this.id = id;
    this.caps = caps;
    this.send = send;
  }

  capabilities(): EngineCaps {
    return this.caps;
  }
  open(): Promise<SourceInfo> {
    return Promise.reject(new ChromobenchError(diag('E_NOT_IMPLEMENTED', 'sources are opened by the page, not by the DSL')));
  }
  adopt(defs: readonly NodeDef[]): void {
    this.send({ t: 'adopt', defs: defs.map((d) => ({ op: d.op, inputs: [...d.inputs], args: d.args })) });
  }
  prepare(): Promise<void> {
    return Promise.resolve();
  }
  dispose(): void {
    for (const w of this.waiting.values()) w.reject(new ChromobenchError(diag('E_CANCELLED', 'the DSL worker is shutting down')));
    this.waiting.clear();
  }

  private call<T>(signal: AbortSignal | undefined, msg: (call: number) => FromWorker): Promise<T> {
    if (signal?.aborted) return Promise.reject(new ChromobenchError(diag('E_CANCELLED', 'cancelled')));
    const call = ++this.calls;
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        if (!this.waiting.delete(call)) return;
        this.send({ t: 'engine.cancel', call });
        reject(new ChromobenchError(diag('E_CANCELLED', 'cancelled')));
      };
      this.waiting.set(call, {
        resolve: (v) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(v as T);
        },
        reject: (e) => {
          signal?.removeEventListener('abort', onAbort);
          reject(e);
        },
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      this.send(msg(call));
    });
  }

  reply(call: number, ok: unknown, err: unknown): void {
    const w = this.waiting.get(call);
    if (!w) return;
    this.waiting.delete(call);
    if (err) w.reject(new ChromobenchError(err as never));
    else w.resolve(ok);
  }

  measure(node: NodeRef, spec: MeasureSpec = {}): Promise<Measurement> {
    const { signal, ...rest } = spec;
    return this.call(signal, (call) => ({ t: 'engine', call, method: 'measure', node: { id: node.id, info: node.info }, spec: rest }));
  }

  async evaluate(node: NodeRef, target: EvalTarget): Promise<ImageResult> {
    const { signal, ...rest } = target;
    const p = await this.call<ImagePayload>(signal, (call) => ({ t: 'engine', call, method: 'evaluate', node: { id: node.id, info: node.info }, target: rest }));
    const { data, ...meta } = p;
    return { ...meta, read: () => Promise.resolve(data) } as ImageResult;
  }
}

/** Serves one DslSession on an endpoint (the worker's global scope, or a MessagePort in tests). Returns a stop function. */
export function serveDsl(ep: Endpoint): () => void {
  let session: DslSession | null = null;
  let engine: ProxyEngine | null = null;
  let booting: Promise<void> | null = null;
  const history = new MirrorHistory();
  const frames = new Map<string, string>();
  const send = (m: FromWorker, transfer?: Transferable[]): void => ep.postMessage(m, transfer);
  let current: number | null = null;
  const queue: ToWorker[] = [];

  const handle = async (m: ToWorker): Promise<void> => {
    switch (m.t) {
      case 'init': {
        engine = new ProxyEngine(m.engine.id, m.engine.caps, send);
        booting = DslSession.create({ engine, history, docs: docsProvider(), ...(m.limits ? { limits: m.limits } : {}), ...(m.txPrefix ? { txPrefix: m.txPrefix } : {}) }).then((s) => {
          session = s;
          send({ t: 'ready' });
        });
        return;
      }
      case 'engine.reply':
        engine?.reply(m.call, m.ok, m.err);
        return;
      case 'interrupt':
        if (current === m.id) session?.interrupt();
        return;
      default:
        break;
    }
    // frames and evals keep their order behind the boot
    queue.push(m);
    if (queue.length > 1) return;
    while (queue.length) {
      const x = queue[0]!;
      try {
        await booting;
        await run(x);
      } finally {
        queue.shift();
      }
    }
  };

  const run = async (m: ToWorker): Promise<void> => {
    const s = session!;
    if (m.t === 'docs') {
      history.load(m.snapshot);
      for (const [id, f] of Object.entries(m.snapshot.frames)) {
        const key = `${f.source.sha256}|${f.name ?? ''}`;
        if (frames.get(id) === key) continue;
        s.addFrame(id, { source: f.source, ...(f.name !== undefined ? { name: f.name } : {}) });
        frames.set(id, key);
      }
      return;
    }
    if (m.t !== 'eval') return;
    current = m.id;
    history.submission = null;
    try {
      const result = await s.eval(m.req);
      const transfer = [...new Set(result.looks.map((l) => l.image.bytes.buffer))].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);
      send({ t: 'result', id: m.id, result, ...(history.submission ? { submission: history.submission } : {}) }, transfer);
    } catch (e) {
      send({ t: 'failed', id: m.id, error: toDiagnostic(e) });
    } finally {
      current = null;
      history.submission = null;
    }
  };

  const onMessage = (e: MessageEvent): void => void handle(e.data as ToWorker);
  ep.addEventListener('message', onMessage);
  ep.start?.();
  return () => {
    ep.removeEventListener?.('message', onMessage);
    engine?.dispose();
    (session as DslSession | null)?.dispose();
  };
}
