// The clock the scheduler runs on. The browser's is requestAnimationFrame/requestIdleCallback; tests use
// manualClock() from '@chromobench/shell/testing', which runs frames only when told.

export interface IdleDeadline {
  timeRemaining(): number;
  didTimeout: boolean;
}

export interface Clock {
  now(): number;
  /** run cb on the next frame */
  frame(cb: (t: number) => void): void;
  /** run cb when the page is idle */
  idle(cb: (d: IdleDeadline) => void): void;
  timeout(cb: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

/** requestAnimationFrame and requestIdleCallback where they exist, timers elsewhere (Node). */
export function browserClock(): Clock {
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: (t: number) => void) => number;
    requestIdleCallback?: (cb: (d: IdleDeadline) => void) => number;
    performance?: { now(): number };
  };
  const now = (): number => (g.performance ? g.performance.now() : Date.now());
  return {
    now,
    frame: cb => {
      if (typeof g.requestAnimationFrame === 'function') g.requestAnimationFrame(cb);
      else setTimeout(() => cb(now()), 16);
    },
    idle: cb => {
      if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(cb);
      else setTimeout(() => cb({ timeRemaining: () => 8, didTimeout: false }), 30);
    },
    timeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}
