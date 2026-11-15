// Residency (CHB-041): the GPU textures the engine keeps between renders, per frame (a source: its full-size texture
// and its proxies, the source sampled on a render's grid), and which it lets go first when memory runs short.
//
//   get(key) / put(frame, key, tex)   a texture kept for a frame; every use marks the frame and the texture used
//   lease(key) … unlease(key)          a render holds it between taking it and submitting (never evicted then, unless all)
//   pin(frames)                        the frames on screen (the viewer's, the thumbnails being drawn): evicted last
//   evict(need)                        frames not pinned, least recently used first, until `need` bytes are free;
//                                      { all: true } (the recovery after E_GPU_OOM) then pinned and leased ones too
//
// A texture let go is handed to `letGo` (the pool's discard: out of the budget now, destroyed when no GPU work is in
// flight), so a render that still binds one stays valid. A frame comes back by uploading again.
//
// PROXIES_KEPT is a rule, not a measurement: a window resize or a draft size makes new grids; the newest few are what
// the viewer and its drafts ask for again.

export interface ResidentStats {
  /** bytes kept, and of them in pinned frames */
  bytes: number;
  pinnedBytes: number;
  /** textures and frames kept */
  textures: number;
  frames: number;
}

interface Item { key: string; frame: string; tex: GPUTexture; bytes: number; used: number; leases: number; proxy: boolean }

export class Residency {
  /** proxies kept per frame, newest first (CHB-041 rule: the thumbnail, the draft and the screen grid, plus one) */
  static readonly PROXIES_KEPT = 4;
  private readonly items = new Map<string, Item>();
  private readonly frameUsed = new Map<string, number>();
  private pinned: ReadonlySet<string> = new Set();
  private clock = 0;
  private readonly letGo: (tex: GPUTexture) => void;

  constructor(letGo: (tex: GPUTexture) => void) {
    this.letGo = letGo;
  }

  /** The texture kept under `key`, marked used (and its frame), or null. */
  get(key: string): GPUTexture | null {
    const it = this.items.get(key);
    if (!it) return null;
    it.used = ++this.clock;
    this.frameUsed.set(it.frame, it.used);
    return it.tex;
  }

  /**
   * Keeps `tex` for `frame` under `key` (a texture already there is let go). A proxy: beyond PROXIES_KEPT, or beyond
   * `cap` bytes of the frame's proxies together (the full-size texture's bytes: proxies never hold more than it would),
   * the oldest other proxies go.
   */
  put(frame: string, key: string, tex: GPUTexture, bytes: number, o: { proxy?: boolean; cap?: number } = {}): void {
    const old = this.items.get(key);
    if (old && old.tex !== tex) this.drop(old);
    const used = ++this.clock;
    this.items.set(key, { key, frame, tex, bytes, used, leases: old?.leases ?? 0, proxy: !!o.proxy });
    this.frameUsed.set(frame, used);
    if (o.proxy) {
      const proxies = [...this.items.values()].filter((i) => i.frame === frame && i.proxy && i.leases === 0 && i.key !== key).sort((a, b) => b.used - a.used);
      for (const p of proxies.slice(Residency.PROXIES_KEPT - 1)) this.drop(p);
      let total = bytes + proxies.slice(0, Residency.PROXIES_KEPT - 1).reduce((s, p) => s + p.bytes, 0);
      for (const p of proxies.slice(0, Residency.PROXIES_KEPT - 1).reverse()) {
        if (o.cap === undefined || total <= o.cap) break;
        this.drop(p);
        total -= p.bytes;
      }
    }
  }

  lease(key: string): void {
    const it = this.items.get(key);
    if (it) it.leases++;
  }
  unlease(key: string): void {
    const it = this.items.get(key);
    if (it && it.leases > 0) it.leases--;
  }

  /** The frames on screen: their textures go last. */
  pin(frames: Iterable<string>): void {
    this.pinned = new Set(frames);
  }
  get pinnedFrames(): ReadonlySet<string> {
    return this.pinned;
  }

  /**
   * Lets go of textures until `need` bytes are freed (Infinity: all that may go): frames not pinned, least recently
   * used first, none leased; with `all`, then the pinned frames' and the leased ones too (a render that binds one keeps
   * it valid: letGo destroys after the work in flight). Returns the bytes freed and the frames touched.
   */
  evict(need: number, o: { all?: boolean } = {}): { bytes: number; frames: string[] } {
    const order = [...this.items.values()].sort((a, b) => {
      const pa = this.pinned.has(a.frame) ? 1 : 0, pb = this.pinned.has(b.frame) ? 1 : 0;
      if (pa !== pb) return pa - pb;
      const fa = this.frameUsed.get(a.frame) ?? 0, fb = this.frameUsed.get(b.frame) ?? 0;
      return fa !== fb ? fa - fb : a.used - b.used;
    });
    let bytes = 0;
    const frames = new Set<string>();
    for (const it of order) {
      if (bytes >= need) break;
      if (!o.all && (it.leases > 0 || this.pinned.has(it.frame))) continue;
      this.drop(it);
      bytes += it.bytes;
      frames.add(it.frame);
    }
    return { bytes, frames: [...frames] };
  }

  /** Lets go of every texture of a frame (its source was forgotten or closed); returns the bytes. */
  forget(frame: string): number {
    let bytes = 0;
    for (const it of [...this.items.values()]) if (it.frame === frame) {
      this.drop(it);
      bytes += it.bytes;
    }
    this.frameUsed.delete(frame);
    return bytes;
  }

  /** Lets go of everything (letGo: false when the device is gone and the textures with it). */
  clear(letGo = true): void {
    if (letGo) for (const it of this.items.values()) this.letGo(it.tex);
    this.items.clear();
    this.frameUsed.clear();
  }

  stats(): ResidentStats {
    let bytes = 0, pinnedBytes = 0;
    const frames = new Set<string>();
    for (const it of this.items.values()) {
      bytes += it.bytes;
      if (this.pinned.has(it.frame)) pinnedBytes += it.bytes;
      frames.add(it.frame);
    }
    return { bytes, pinnedBytes, textures: this.items.size, frames: frames.size };
  }

  /** The keys kept for a frame (tests). */
  keysOf(frame: string): string[] {
    return [...this.items.values()].filter((i) => i.frame === frame).map((i) => i.key);
  }

  private drop(it: Item): void {
    this.items.delete(it.key);
    this.letGo(it.tex);
  }
}

/**
 * The source sampled on a render's grid (CHB-041): output pixel p reads frame pixel region.xy + ⌊(p + ½)·(region.wh /
 * out.wh)⌋, computed in f32 as kernels/pointwise.wgsl does (`fp`), so a chain reading this proxy at p (srcOnGrid) reads
 * exactly the texel it would read from the full-size source. A thumbnail or a screen-size preview then needs a texture
 * of its own size, not the frame's.
 */
export interface Sampled { w: number; h: number; c: number; data?: Float32Array; u16?: Uint16Array; samples?: number; max?: number }

/** Frame coordinates the shader reads for output columns (or rows) 0…n−1: f32 arithmetic, like `fp` in pointwise.wgsl. */
export function gridCoords(origin: number, span: number, n: number, limit: number): Int32Array {
  const z = Math.fround(span / n);
  const out = new Int32Array(n);
  // (p + 0.5) is exact in f32; the product of two f32 values is exact in f64, so one fround is f32's correctly rounded product
  for (let p = 0; p < n; p++) out[p] = Math.min(limit - 1, origin + Math.floor(Math.fround((p + 0.5) * z)));
  return out;
}

export function sampleSource(img: Sampled, region: { x: number; y: number; w: number; h: number }, outW: number, outH: number): Sampled {
  const xs = gridCoords(region.x, region.w, outW, img.w);
  const ys = gridCoords(region.y, region.h, outH, img.h);
  if (img.u16) {
    const s = img.samples ?? 3;
    const src = img.u16;
    const out = new Uint16Array(outW * outH * s);
    for (let y = 0; y < outH; y++) {
      const row = ys[y]! * img.w;
      let o = y * outW * s;
      for (let x = 0; x < outW; x++, o += s) {
        const i = (row + xs[x]!) * s;
        for (let k = 0; k < s; k++) out[o + k] = src[i + k]!;
      }
    }
    return { w: outW, h: outH, c: img.c, u16: out, samples: s, ...(img.max !== undefined ? { max: img.max } : {}) };
  }
  const c = img.c;
  const src = img.data!;
  const out = new Float32Array(outW * outH * c);
  for (let y = 0; y < outH; y++) {
    const row = ys[y]! * img.w;
    let o = y * outW * c;
    if (c === 3) {
      for (let x = 0; x < outW; x++, o += 3) {
        const i = (row + xs[x]!) * 3;
        out[o] = src[i]!;
        out[o + 1] = src[i + 1]!;
        out[o + 2] = src[i + 2]!;
      }
    } else {
      for (let x = 0; x < outW; x++, o += c) {
        const i = (row + xs[x]!) * c;
        for (let k = 0; k < c; k++) out[o + k] = src[i + k]!;
      }
    }
  }
  return { w: outW, h: outH, c, data: out };
}
