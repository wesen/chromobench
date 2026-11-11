// Testing helpers: a clock that runs frames only when told, a recording chrome, memory persistence, a fake render
// bridge (with a mutant mode that answers out of order) and a fake presenter.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Clock, IdleDeadline } from '../core/clock.ts';
import type { PresentImage, Presenter, RenderBridge, Rendered, RenderTarget, ViewTransform, Colours } from '../app/render/types.ts';

export { RecordingChrome } from '../app/chrome.ts';
export { memoryPersistence } from '../app/persist.ts';

export interface ManualClock extends Clock {
  /** run the queued frame callbacks (one frame) */
  tick(): number;
  /** advance time, running due timeouts */
  advance(ms: number): void;
  /** run queued idle callbacks */
  runIdle(): number;
  /** frames queued */
  readonly pendingFrames: number;
  t: number;
}

export function manualClock(start = 0): ManualClock {
  let frames: ((t: number) => void)[] = [];
  let idles: ((d: IdleDeadline) => void)[] = [];
  let timers: { at: number; cb: () => void; id: number }[] = [];
  let seq = 0;
  const c: ManualClock = {
    t: start,
    now: () => c.t,
    frame: cb => {
      frames.push(cb);
    },
    idle: cb => {
      idles.push(cb);
    },
    timeout: (cb, ms) => {
      const id = ++seq;
      timers.push({ at: c.t + ms, cb, id });
      return id;
    },
    clearTimeout: h => {
      timers = timers.filter(x => x.id !== h);
    },
    tick() {
      const f = frames;
      frames = [];
      for (const cb of f) cb(c.t);
      return f.length;
    },
    advance(ms) {
      const end = c.t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        c.t = next.at;
        next.cb();
      }
      c.t = end;
    },
    runIdle() {
      const f = idles;
      idles = [];
      for (const cb of f) cb({ timeRemaining: () => 50, didTimeout: true });
      return f.length;
    },
    get pendingFrames() {
      return frames.length;
    },
  };
  return c;
}

/** A renderable for the fake bridge: a procedural image identified by its fields. */
export interface FakeImage {
  fake: true;
  name: string;
  w?: number;
  h?: number;
  [k: string]: unknown;
}
export const fakeImage = (name: string, extra: Record<string, unknown> = {}): FakeImage => ({ fake: true, name, ...extra });

export interface FakeBridge extends RenderBridge<FakeImage> {
  calls: { r: FakeImage; t: RenderTarget }[];
  released: Rendered[];
  /** resolve pending renders: all, or one by index */
  resolve(i?: number): void;
  /** pending render promises */
  readonly pending: number;
}

/**
 * A render bridge that renders tiny images. `manual: true` keeps renders pending until resolve(); `reverse: true`
 * (the mutant) resolves later requests first and ignores aborts, to show the queue never presents stale answers.
 */
export function fakeBridge(o: { manual?: boolean; reverse?: boolean; ms?: number; id?: string } = {}): FakeBridge {
  const pend: { r: FakeImage; t: RenderTarget; done: (x: Rendered) => void; fail: (e: unknown) => void }[] = [];
  const make = (r: FakeImage, t: RenderTarget): Rendered => {
    const w = r.w ?? 600;
    const h = r.h ?? 400;
    const s = Math.min(1, t.maxSide / Math.max(w, h));
    const iw = Math.max(1, Math.round(w * s));
    const ih = Math.max(1, Math.round(h * s));
    const image: PresentImage = { width: iw, height: ih, channels: 3, data: new Float32Array(Math.min(iw * ih * 3, 3 * 16)), region: { x: 0, y: 0, w, h }, scale: s };
    return { image, srcW: w, srcH: h, ms: o.ms ?? 1 };
  };
  const b: FakeBridge = {
    id: o.id ?? 'fake',
    calls: [],
    released: [],
    isRenderable: (x): x is FakeImage => !!x && typeof x === 'object' && (x as FakeImage).fake === true,
    key: r => JSON.stringify(r),
    naturalSize: r => [r.w ?? 600, r.h ?? 400],
    render(r, t) {
      b.calls.push({ r, t });
      if (!o.manual && !o.reverse) return Promise.resolve(make(r, t));
      return new Promise((done, fail) => {
        pend.push({ r, t, done, fail });
        if (!o.reverse)
          t.signal.addEventListener('abort', () => {
            const i = pend.findIndex(p => p.t === t);
            if (i >= 0) pend.splice(i, 1);
            fail(new DOMException('aborted', 'AbortError'));
          });
      });
    },
    release(x) {
      b.released.push(x);
    },
    resolve(i?: number) {
      if (i === undefined) {
        const all = o.reverse ? pend.splice(0).reverse() : pend.splice(0);
        for (const p of all) p.done(make(p.r, p.t));
        return;
      }
      const p = pend.splice(i, 1)[0];
      if (p) p.done(make(p.r, p.t));
    },
    get pending() {
      return pend.length;
    },
    explain: r => `fake ${r.name}`,
  };
  return b;
}

/** A presenter that records what it was asked to show. */
export function fakePresenter(): Presenter & { images: (PresentImage | null)[][]; draws: ViewTransform[]; colours: Colours[] } {
  return {
    kind: '2d',
    colorSpace: 'srgb',
    images: [],
    draws: [],
    colours: [],
    setImages(main, before) {
      this.images.push([main, before]);
    },
    draw(view, colours) {
      this.draws.push(view);
      this.colours.push(colours);
    },
    async readDocPixel() {
      return null;
    },
    dispose() {},
  };
}
