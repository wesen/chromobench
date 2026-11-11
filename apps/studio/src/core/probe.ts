// Densitometer probe (guide §5.6): measure.densitometer requests with the same latest-wins rule as
// rendering. One request in flight, one waiting slot holding the newest; stale answers are dropped.
import { ChromobenchError, type Engine, type Graph, type NodeRef } from '@chromobench/contract';

export interface ProbeAt { x: number; y: number; r: number }

export interface ProbeReading {
  at: ProbeAt;
  /** Status density of the print (print-xyz) per channel. */
  D: [number, number, number];
  /** Visual density of the print. */
  visual: number | null;
  /** Dye amounts (film-dyes) under the probe. */
  dyes: [number, number, number] | null;
}

export interface ProbeTargets {
  printXyz: NodeRef;
  dyes: NodeRef | null;
}

/** Interns and measures one densitometer reading. */
export async function readProbe(engine: Engine, graph: Graph, t: ProbeTargets, at: ProbeAt, signal?: AbortSignal): Promise<ProbeReading> {
  const args = { at: { x: at.x, y: at.y }, aperture_px: Math.max(1, 2 * at.r + 1) };
  const pn = graph.intern('measure.densitometer', [t.printXyz.id], args).node;
  engine.adopt(graph.closure(pn.id));
  const pm = await engine.measure(pn, signal ? { signal, precision: 'preview' } : { precision: 'preview' });
  let dyes: ProbeReading['dyes'] = null;
  if (t.dyes) {
    const dn = graph.intern('measure.densitometer', [t.dyes.id], args).node;
    engine.adopt(graph.closure(dn.id));
    const dm = await engine.measure(dn, signal ? { signal, precision: 'preview' } : { precision: 'preview' });
    dyes = (dm.value['D'] as number[]).slice(0, 3) as [number, number, number];
  }
  return { at, D: (pm.value['D'] as number[]).slice(0, 3) as [number, number, number], visual: (pm.value['visual'] as number | undefined) ?? null, dyes };
}

/** Latest-wins runner for async jobs (probe readings, tool measurements). */
export class LatestWins<T> {
  private inflight: AbortController | null = null;
  private waiting: ((s: AbortSignal) => Promise<T>) | null = null;
  private seq = 0;
  private shown = 0;
  private readonly deliver: (v: T) => void;
  private readonly onError: (e: unknown) => void;
  private idleWaiters: (() => void)[] = [];

  constructor(deliver: (v: T) => void, onError: (e: unknown) => void = () => {}) {
    this.deliver = deliver;
    this.onError = onError;
  }

  run(job: (s: AbortSignal) => Promise<T>): void {
    this.waiting = job;
    this.inflight?.abort();
    queueMicrotask(() => void this.pump());
  }

  get busy(): boolean {
    return this.inflight !== null || this.waiting !== null;
  }

  idle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private async pump(): Promise<void> {
    if (this.inflight || !this.waiting) return this.settle();
    const job = this.waiting;
    this.waiting = null;
    const ctl = new AbortController();
    this.inflight = ctl;
    const n = ++this.seq;
    try {
      const v = await job(ctl.signal);
      if (!ctl.signal.aborted && n > this.shown) {
        this.shown = n;
        this.deliver(v);
      }
    } catch (e) {
      const cancelled = e instanceof ChromobenchError && e.code === 'E_CANCELLED';
      if (!cancelled && !ctl.signal.aborted) this.onError(e);
    } finally {
      this.inflight = null;
      if (this.waiting) void this.pump();
      else this.settle();
    }
  }

  private settle(): void {
    if (this.busy) return;
    const ws = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of ws) w();
  }
}
