// The render queue: CraftKit's slots, epochs and live/bg lanes with CHB-009's RenderScheduler rules, per slot
// (vp:main:after, vp:main:before, thumb:<key>):
//
//   request(slot, r, pass):  gen = ++slot.gen; slot.waiting = { gen, r, pass }   latest wins: older waiting dropped
//                            if slot.inflight and its key ≠ key(r): abort it        superseded work
//   pump(slot):              one render in flight per slot; bg waits while a live slot is busy (live preempts bg)
//   on result:               present only if gen > slot.shownGen, else release (stale answers never step back)
//   thumbnails:              LRU of 400 by key(r)|max; hits draw at once; misses render on the bg lane
//
// Pure scheduling: no DOM. The viewport decides draft / screen / refine with chooseTarget().

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Lane, RenderBridge, RenderPass, Rendered, Rect } from './types.ts';

export interface RequestOpts {
  pass?: RenderPass;
  maxSide: number;
  region?: Rect;
  lane?: Lane;
  /** called with the result when it is the newest for its slot */
  present: (r: Rendered, info: { gen: number; pass: RenderPass; key: string; slot: string }) => void;
  onError?: (e: unknown) => void;
}

interface Waiting {
  gen: number;
  r: unknown;
  bridge: RenderBridge<any>;
  key: string;
  opts: RequestOpts;
}
interface Slot {
  id: string;
  gen: number;
  shownGen: number;
  lane: Lane;
  waiting: Waiting | null;
  inflight: { gen: number; key: string; ctl: AbortController; bridge: RenderBridge<any> } | null;
  shown: { r: Rendered; bridge: RenderBridge<any> } | null;
}

export interface QueueStats {
  requests: number;
  renders: number;
  presented: number;
  aborted: number;
  /** answers that came back stale and were released, not presented */
  dropped: number;
  errors: number;
  thumbHits: number;
  thumbMisses: number;
  evicted: number;
}

export class RenderQueue {
  readonly bridges: RenderBridge<any>[];
  private slots = new Map<string, Slot>();
  private waiters: (() => void)[] = [];
  readonly stats: QueueStats = { requests: 0, renders: 0, presented: 0, aborted: 0, dropped: 0, errors: 0, thumbHits: 0, thumbMisses: 0, evicted: 0 };
  /** thumbnail cache, LRU by key|max */
  readonly thumbs = new Map<string, { r: Rendered; bridge: RenderBridge<any> }>();
  thumbLimit: number;
  private readonly opts: { idle?: (f: () => void, key: string) => void; onError?: (e: unknown) => void; thumbLimit?: number };
  constructor(bridges: RenderBridge<any>[] = [], opts: { idle?: (f: () => void, key: string) => void; onError?: (e: unknown) => void; thumbLimit?: number } = {}) {
    this.opts = opts;
    this.bridges = bridges.slice();
    this.thumbLimit = opts.thumbLimit ?? 400;
  }
  add(b: RenderBridge<any>): void {
    this.bridges.push(b);
  }
  bridgeFor(x: unknown): RenderBridge<any> | null {
    if (x == null) return null;
    for (const b of this.bridges) if (b.isRenderable(x)) return b;
    return null;
  }
  keyOf(x: unknown): string | null {
    const b = this.bridgeFor(x);
    return b ? `${b.id}:${b.key(x)}` : null;
  }
  private slot(id: string, lane: Lane): Slot {
    let s = this.slots.get(id);
    if (!s) {
      s = { id, gen: 0, shownGen: 0, lane, waiting: null, inflight: null, shown: null };
      this.slots.set(id, s);
    }
    s.lane = lane;
    return s;
  }
  /** queue a render for a slot; returns its generation, or null when no bridge takes the renderable */
  request(slotId: string, r: unknown, o: RequestOpts): number | null {
    const bridge = this.bridgeFor(r);
    if (!bridge) return null;
    const lane = o.lane ?? 'live';
    const s = this.slot(slotId, lane);
    const pass = o.pass ?? 'screen';
    const g = o.region;
    const key = `${bridge.id}:${bridge.key(r)}|${pass}|${o.maxSide}|${g ? `${g.x},${g.y},${g.w},${g.h}` : ''}`;
    this.stats.requests++;
    const gen = ++s.gen;
    s.waiting = { gen, r, bridge, key, opts: { ...o, pass, lane } };
    if (s.inflight && s.inflight.key !== key) {
      s.inflight.ctl.abort();
      this.stats.aborted++;
    }
    this.pump(s);
    return gen;
  }
  private liveBusy(): boolean {
    for (const s of this.slots.values()) if (s.lane === 'live' && (s.inflight || s.waiting)) return true;
    return false;
  }
  private pump(s: Slot): void {
    if (s.inflight || !s.waiting) return this.checkIdle();
    const w = s.waiting;
    if (w.opts.lane === 'bg' && this.liveBusy()) {
      // live preempts background: try again when the page is idle (or when live work finishes)
      if (this.opts.idle) this.opts.idle(() => this.pump(s), 'render:' + s.id);
      return;
    }
    s.waiting = null;
    const ctl = new AbortController();
    s.inflight = { gen: w.gen, key: w.key, ctl, bridge: w.bridge };
    this.stats.renders++;
    let p: Promise<Rendered>;
    try {
      p = w.bridge.render(w.r, { slot: s.id, epoch: w.gen, lane: w.opts.lane!, pass: w.opts.pass!, maxSide: w.opts.maxSide, ...(w.opts.region ? { region: w.opts.region } : {}), signal: ctl.signal });
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      res => {
        s.inflight = null;
        if (ctl.signal.aborted || w.gen <= s.shownGen) {
          this.stats.dropped++;
          w.bridge.release?.(res);
        } else {
          const prev = s.shown;
          s.shownGen = w.gen;
          s.shown = { r: res, bridge: w.bridge };
          this.stats.presented++;
          try {
            w.opts.present(res, { gen: w.gen, pass: w.opts.pass!, key: w.key, slot: s.id });
          } catch (e) {
            (w.opts.onError || this.opts.onError || console.error)(e);
          }
          if (prev && prev.r !== res && !this.isCached(prev.r)) prev.bridge.release?.(prev.r);
        }
        this.after(s);
      },
      err => {
        s.inflight = null;
        if (!ctl.signal.aborted) {
          this.stats.errors++;
          (w.opts.onError || this.opts.onError || console.error)(err);
        }
        this.after(s);
      },
    );
  }
  private after(s: Slot): void {
    this.pump(s);
    // live work done: let waiting background slots go
    if (!this.liveBusy()) for (const x of this.slots.values()) if (x !== s && x.lane === 'bg' && x.waiting && !x.inflight) this.pump(x);
    this.checkIdle();
  }
  private isCached(r: Rendered): boolean {
    for (const v of this.thumbs.values()) if (v.r === r) return true;
    return false;
  }
  busy(slotId?: string): boolean {
    if (slotId) {
      const s = this.slots.get(slotId);
      return !!s && !!(s.inflight || s.waiting);
    }
    for (const s of this.slots.values()) if (s.inflight || s.waiting) return true;
    return false;
  }
  /** resolves when nothing is in flight or waiting */
  idle(): Promise<void> {
    if (!this.busy()) return Promise.resolve();
    return new Promise(r => this.waiters.push(r));
  }
  private checkIdle(): void {
    if (this.busy() || !this.waiters.length) return;
    for (const w of this.waiters.splice(0)) w();
  }
  /** the generation shown in a slot */
  shown(slotId: string): number {
    return this.slots.get(slotId)?.shownGen ?? 0;
  }
  cancel(slotId: string): void {
    const s = this.slots.get(slotId);
    if (!s) return;
    s.waiting = null;
    if (s.inflight) {
      s.inflight.ctl.abort();
      this.stats.aborted++;
    }
  }

  // ── thumbnails ──
  peekThumb(r: unknown, max: number): Rendered | null {
    const b = this.bridgeFor(r);
    if (!b) return null;
    const k = `${b.id}:${b.key(r)}|${max}`;
    const hit = this.thumbs.get(k);
    if (!hit) return null;
    this.thumbs.delete(k);
    this.thumbs.set(k, hit);
    return hit.r;
  }
  /** a thumbnail: a hit draws at once (returns true); a miss renders on the bg lane, then caches and presents */
  thumb(r: unknown, max: number, present: (x: Rendered) => void, slotId?: string): boolean {
    const b = this.bridgeFor(r);
    if (!b) return false;
    const k = `${b.id}:${b.key(r)}|${max}`;
    const hit = this.peekThumb(r, max);
    if (hit) {
      this.stats.thumbHits++;
      present(hit);
      return true;
    }
    this.stats.thumbMisses++;
    this.request(slotId ?? 'thumb:' + k, r, {
      lane: 'bg',
      pass: 'screen',
      maxSide: max,
      present: res => {
        this.thumbs.set(k, { r: res, bridge: b });
        while (this.thumbs.size > this.thumbLimit) {
          const [oldK, old] = this.thumbs.entries().next().value as [string, { r: Rendered; bridge: RenderBridge<any> }];
          this.thumbs.delete(oldK);
          this.stats.evicted++;
          old.bridge.release?.(old.r);
        }
        present(res);
      },
    });
    return false;
  }
  dispose(): void {
    for (const s of this.slots.values()) {
      s.waiting = null;
      s.inflight?.ctl.abort();
      if (s.shown) s.shown.bridge.release?.(s.shown.r);
    }
    for (const v of this.thumbs.values()) v.bridge.release?.(v.r);
    this.thumbs.clear();
    this.slots.clear();
  }
}

/** ≈0.5 MP drafts; adapted towards ≈30 ms by the viewport */
export const DRAFT_PIXELS = 500_000;

/**
 * Which pass and size a viewport asks for.
 *   previewing and this view's key changed → draft (≈0.5 MP of the source's aspect)
 *   otherwise screen: shown size × dpr, rounded up to 128, capped by the source
 *   zoomed at or past 1:1 → refine the visible region
 */
export function chooseTarget(o: { previewing: boolean; shownW: number; shownH: number; dpr: number; srcW?: number | undefined; srcH?: number | undefined; zoom?: number | 'fit' | 'fill' | undefined; draftPixels?: number; maxSide?: number }): { pass: RenderPass; maxSide: number } {
  const srcLong = o.srcW && o.srcH ? Math.max(o.srcW, o.srcH) : 0;
  const aspect = o.srcW && o.srcH ? Math.max(o.srcW, o.srcH) / Math.min(o.srcW, o.srcH) : 1.5;
  const cap = srcLong || o.maxSide || 2048;
  if (o.previewing) {
    const px = o.draftPixels ?? DRAFT_PIXELS;
    // long side of an image with `px` pixels at this aspect
    const long = Math.round(Math.sqrt(px * aspect));
    return { pass: 'draft', maxSide: Math.max(64, Math.min(cap, long)) };
  }
  const need = Math.ceil(Math.max(o.shownW, o.shownH) * o.dpr);
  const screen = Math.max(64, Math.min(cap, Math.ceil(need / 128) * 128));
  if (typeof o.zoom === 'number' && o.zoom >= 1) return { pass: 'refine', maxSide: cap };
  return { pass: 'screen', maxSide: screen };
}
