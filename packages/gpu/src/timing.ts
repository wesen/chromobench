// GPU timing (guide §5.2). A dispatch returns as soon as it is queued, so wall time is measured from
// submit to onSubmittedWorkDone. With 'timestamp-query' the timer also writes timestamps around each
// labelled compute pass (Chrome quantises them to 100 µs). Per-pass wall times obtained by stalling
// between passes show proportions only.

export interface Timing { label: string; ms: number; source: 'timestamp' | 'wall' }

const MAX_PASSES = 32;

export class GpuTimer {
  readonly timestamps: boolean;
  private qs: GPUQuerySet | null = null;
  private resolveBuf: GPUBuffer | null = null;
  private readBuf: GPUBuffer | null = null;
  private labels: string[] = [];
  readonly log: Timing[] = [];

  private readonly device: GPUDevice;
  constructor(device: GPUDevice) {
    this.device = device;
    this.timestamps = device.features.has('timestamp-query');
    if (this.timestamps) {
      this.qs = device.createQuerySet({ type: 'timestamp', count: 2 * MAX_PASSES });
      this.resolveBuf = device.createBuffer({ size: 16 * MAX_PASSES, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      this.readBuf = device.createBuffer({ size: 16 * MAX_PASSES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    }
  }

  /** A compute pass descriptor that records timestamps for `label` when available. */
  pass(label: string): GPUComputePassDescriptor {
    if (!this.qs || this.labels.length >= MAX_PASSES || this.readBuf?.mapState !== 'unmapped') return { label };
    const i = this.labels.length;
    this.labels.push(label);
    return { label, timestampWrites: { querySet: this.qs, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1 } };
  }

  /** Adds the resolve commands for the passes recorded since the last flush. */
  resolve(enc: GPUCommandEncoder): void {
    if (!this.qs || !this.labels.length) return;
    const n = this.labels.length;
    enc.resolveQuerySet(this.qs, 0, 2 * n, this.resolveBuf!, 0);
    enc.copyBufferToBuffer(this.resolveBuf!, 0, this.readBuf!, 0, 16 * n);
  }

  /** Reads the resolved timestamps (call after the submit that contained resolve()). */
  async flush(): Promise<Timing[]> {
    const labels = this.labels;
    this.labels = [];
    if (!this.readBuf || !labels.length) return [];
    await this.readBuf.mapAsync(GPUMapMode.READ, 0, 16 * labels.length);
    const t = new BigUint64Array(this.readBuf.getMappedRange(0, 16 * labels.length).slice(0));
    this.readBuf.unmap();
    const out = labels.map((label, i) => ({ label, ms: Number(t[2 * i + 1]! - t[2 * i]!) / 1e6, source: 'timestamp' as const }));
    this.log.push(...out);
    return out;
  }

  /** Wall time of submitted work: submit → onSubmittedWorkDone. */
  async wall(label: string, submit: () => void): Promise<Timing> {
    const t0 = performance.now();
    submit();
    await this.device.queue.onSubmittedWorkDone();
    const t = { label, ms: performance.now() - t0, source: 'wall' as const };
    this.log.push(t);
    return t;
  }

  destroy(): void {
    this.qs?.destroy();
    this.resolveBuf?.destroy();
    this.readBuf?.destroy();
  }
}
