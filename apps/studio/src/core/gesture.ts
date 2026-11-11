// GestureController (guide §5.4, §5.7): turns input into mutations.
// - pointer drag: preview overlay (never logged), one `set` on release; Esc cancels;
// - keyboard / wheel bursts: previewed, committed as ONE `set` when no step has arrived on the same
//   control for `burstMs` (or when another control is touched, or on blur). The guide proposed one
//   `set` per step sharing a tx; the edit log makes each apply() its own undo unit, so a burst is
//   coalesced before logging instead: one undo step either way;
// - typed values, resets, selects: one `set` at once.
import { getPath, type EditLog, type Mutation } from '@chromobench/contract';
import { sameValue } from './controls.ts';

export interface GestureOptions {
  burstMs?: number;
  onError?: (e: unknown) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

interface Active {
  path: string;
  value: unknown;
  label: string;
  kind: 'drag' | 'burst';
}

export class GestureController {
  private active: Active | null = null;
  private timer: unknown = null;
  private readonly burstMs: number;
  private readonly onError: (e: unknown) => void;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly log: () => EditLog | null;
  /** Called whenever a gesture starts or ends (the scheduler uses it to choose draft passes). */
  onChange: (active: boolean) => void = () => {};

  constructor(log: () => EditLog | null, opts: GestureOptions = {}) {
    this.log = log;
    this.burstMs = opts.burstMs ?? 800;
    this.onError = opts.onError ?? ((e) => { throw e; });
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get isActive(): boolean {
    return this.active !== null;
  }

  get activePath(): string | null {
    return this.active?.path ?? null;
  }

  private previewOn(path: string, value: unknown, label: string, kind: Active['kind']): void {
    const log = this.log();
    if (!log) return;
    if (this.active && this.active.path !== path) this.commit();
    const was = this.active !== null;
    try {
      log.preview({ op: 'set', path, value });
    } catch (e) {
      this.onError(e);
      return;
    }
    this.active = { path, value, label, kind };
    if (!was) this.onChange(true);
  }

  /** A pointer drag moved: preview only. */
  drag(path: string, value: unknown, label: string): void {
    this.previewOn(path, value, label, 'drag');
  }

  /** A keyboard or wheel step: preview, and commit once the burst pauses. */
  step(path: string, value: unknown, label: string): void {
    this.previewOn(path, value, label, 'burst');
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.commit();
    }, this.burstMs);
  }

  /** Release: logs one `set` if the value differs from the committed state. */
  commit(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    const a = this.active;
    this.active = null;
    const log = this.log();
    if (!a || !log) return;
    try {
      if (sameValue(getPath(log.committed, a.path), a.value)) log.preview(null);
      else log.apply([{ op: 'set', path: a.path, value: a.value }], 'user', a.label);
    } catch (e) {
      log.preview(null);
      this.onError(e);
    }
    this.onChange(false);
  }

  /** Esc: drop the overlay, log nothing. */
  cancel(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (!this.active) return;
    this.active = null;
    this.log()?.preview(null);
    this.onChange(false);
  }

  /** One immediate `set` (typed value, reset, select, tool click). */
  set(path: string, value: unknown, label: string, tx?: string): void {
    this.commit();
    this.apply([{ op: 'set', path, value }], label, tx);
  }

  /** Several mutations as one transaction. */
  apply(ms: Mutation[], label: string, tx?: string): void {
    this.commit();
    const log = this.log();
    if (!log || ms.length === 0) return;
    const real = ms.filter((m) => m.op !== 'set' || !sameValue(getPath(log.committed, m.path), m.value));
    if (real.length === 0) return;
    try {
      log.apply(real, 'user', label, tx ? { tx } : {});
    } catch (e) {
      this.onError(e);
    }
  }
}
