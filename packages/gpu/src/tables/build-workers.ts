// f64 worker pool (guide §5.4, accel.js Pool 3620–3696): min(8, cores) module workers, one shared
// queue of node ranges (512 nodes for the solve, 2,048 otherwise), urgent jobs at the front, results
// transferred. A shared queue matters because nodes are not equally hard (textbook §4.6).
import type { SolveInputs, SpectralInputs, Table } from './inputs.ts';
import type { WorkerJob, WorkerReply } from './table-worker.ts';

interface Pending { inp: SolveInputs | SpectralInputs; q0: number; q1: number; done: (r: WorkerReply) => void }

export class WorkerPool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: Pending[] = [];
  private readonly inflight = new Map<number, Pending>();
  private nextId = 1;
  /** Per-range timings (ms), for the benchmark. */
  readonly rangeMs: number[] = [];

  constructor(size = Math.min(8, typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4), makeWorker = defaultWorker) {
    for (let i = 0; i < size; i++) {
      const w = makeWorker();
      w.onmessage = (e: MessageEvent<WorkerReply>) => this.onReply(w, e.data);
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  get size(): number { return this.workers.length; }

  private onReply(w: Worker, r: WorkerReply): void {
    const p = this.inflight.get(r.id);
    this.inflight.delete(r.id);
    this.rangeMs.push(r.ms);
    this.idle.push(w);
    p?.done(r);
    this.pump();
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const p = this.queue.shift()!;
      const id = this.nextId++;
      this.inflight.set(id, p);
      const job: WorkerJob = { id, inp: p.inp, q0: p.q0, q1: p.q1 };
      w.postMessage(job);
    }
  }

  /** Builds a whole table; `urgent` puts its ranges at the front of the shared queue. */
  build(inp: SolveInputs | SpectralInputs, { urgent = false, chunk }: { urgent?: boolean; chunk?: number } = {}): Promise<Table> {
    const total = inp.N ** 3;
    const step = chunk ?? (inp.kind === 'solve' ? 512 : 2048);
    const out = new Float32Array(total * 4);
    const ranges: Pending[] = [];
    return new Promise<Table>((resolve, reject) => {
      let left = Math.ceil(total / step);
      let failed = false;
      for (let q0 = 0; q0 < total; q0 += step) {
        ranges.push({
          inp, q0, q1: Math.min(total, q0 + step),
          done: (r) => {
            if (failed) return;
            if (r.error || !r.data) {
              failed = true;
              reject(new Error(`table worker: ${r.error ?? 'no data'}`));
              return;
            }
            out.set(r.data, 4 * r.q0);
            if (--left === 0) resolve({ N: inp.N, range: inp.range, data: out });
          },
        });
      }
      if (urgent) this.queue.unshift(...ranges);
      else this.queue.push(...ranges);
      this.pump();
    });
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.idle.length = 0;
  }
}

function defaultWorker(): Worker {
  return new Worker(new URL('./table-worker.ts', import.meta.url), { type: 'module' });
}
