// The law kernels' reference for the parity page (CHB-037 P3): contract 1.0's law ops in f64 — the contract's
// per-pixel formulas (pixel.ts: lightH, mixPixel, maskCombine) and core's functions (the mask rasterisers, Gaussian
// taps, the density mask, retouch(), clarity(), the seconds ratio and a flash's physics) — on inputs from a base
// engine. With the GPU engine itself as the base, every node before a law op is the GPU's own export, so only the law
// kernels differ (CHB-022 compared retouch.heal that way). The chain end to end is compared with core's RefEngine.
import { DOMAINS, getOp, lightH, maskCombine, mixPixel, type Domain, type Engine, type Graph, type ImageInfo, type LightSample, type Node } from '@chromobench/contract';
import {
  clarity, claritySigma, clearExposure, combineRatio, DEFAULT_CONVENTIONS, densityMaskSigma, ellipseAt, featherSigma, flashExposure, fullGrid, gaussianBlur1,
  gridCentres, linearAt, luminanceAt, maskDensityPolar, paintMask, PhysicsEnv, retouch, whiteAt, type PhysicsData, type Spot, type Stroke, type UpNode,
} from '@chromobench/core';
import { combineArgs } from '../engine/light.ts';

export interface Img64 { w: number; h: number; c: number; data: Float64Array }

/** The ops this reference computes itself (contract 1.0's new and changed ops). */
export const LAW_OPS: ReadonlySet<string> = new Set([
  'print.combine', 'print.densityMask', 'composite.mix', 'heal', 'clone', 'clarity',
  'mask.linear', 'mask.ellipse', 'mask.luminance', 'mask.paint', 'mask.constant', 'mask.combine', 'mask.feather', 'mask.invert',
]);

/** Every node from an engine (core's RefEngine: the reference end to end), at full resolution, f64, memoised. */
export class EngineReference {
  protected readonly memo = new Map<string, Promise<Img64>>();
  protected readonly g: Graph;
  protected readonly base: Pick<Engine, 'adopt' | 'evaluate'>;

  constructor(g: Graph, base: Pick<Engine, 'adopt' | 'evaluate'>) {
    this.g = g;
    this.base = base;
  }

  /** A node's image at full resolution, interleaved, f64. */
  image(id: string): Promise<Img64> {
    let p = this.memo.get(id);
    if (!p) {
      p = this.compute(this.g.get(id)!);
      this.memo.set(id, p);
    }
    return p;
  }

  /** The node's image sampled on the engines' grid for an output of w × h (nearest: pixel ⌊(p + ½)·W / w⌋). */
  async sampled(id: string, w: number, h: number): Promise<Img64> {
    const f = await this.image(id);
    const out = new Float64Array(w * h * f.c);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = Math.floor(((x + 0.5) * f.w) / w), sy = Math.floor(((y + 0.5) * f.h) / h);
      for (let k = 0; k < f.c; k++) out[(y * w + x) * f.c + k] = f.data[(sy * f.w + sx) * f.c + k]!;
    }
    return { w, h, c: f.c, data: out };
  }

  protected async fromBase(n: Node): Promise<Img64> {
    const info = n.info as ImageInfo;
    this.base.adopt(this.g.closure(n.id));
    const d = await (await this.base.evaluate(n, { scale: 'full', precision: 'export' })).read();
    return { w: info.width, h: info.height, c: info.channels, data: Float64Array.from(d) };
  }

  protected compute(n: Node): Promise<Img64> {
    return this.fromBase(n);
  }
}

/** The law ops in f64 on a base engine's images of everything before them (the GPU's own: the kernels alone). */
export class LawReference extends EngineReference {
  private readonly env: PhysicsEnv;

  constructor(g: Graph, base: Pick<Engine, 'adopt' | 'evaluate'>, data: PhysicsData) {
    super(g, base);
    this.env = new PhysicsEnv(data, DEFAULT_CONVENTIONS);
  }

  /** core's upstream walk from a node's receiver (self excluded). */
  private up(n: Node) {
    return (name: string): UpNode | undefined => {
      let id: string | undefined = getOp(n.op).on === 'none' ? undefined : n.inputs[0];
      while (id) {
        const m = this.g.get(id);
        if (!m) return undefined;
        if (m.op === name) return { op: m.op, args: m.args, id: m.id, inputs: m.inputs };
        id = getOp(m.op).on === 'none' ? undefined : m.inputs[0];
      }
      return undefined;
    };
  }

  protected override async compute(n: Node): Promise<Img64> {
    const info = n.info as ImageInfo;
    const a = n.args as Record<string, unknown>;
    if (!LAW_OPS.has(n.op)) return this.fromBase(n);
    const W = info.width, H = info.height;
    const one = (f: (i: number) => number): Img64 => {
      const data = new Float64Array(W * H);
      for (let i = 0; i < W * H; i++) data[i] = f(i);
      return { w: W, h: H, c: 1, data };
    };
    const coord = (f: (X: number, Y: number) => number): Img64 => {
      const { xs, ys } = gridCentres(fullGrid(W, H));
      return one((i) => f(xs[i % W]!, ys[Math.floor(i / W)]!));
    };
    const recv = (): Promise<Img64> => this.image(n.inputs[0]!);
    switch (n.op) {
      case 'mask.linear': return coord((X, Y) => linearAt(X, Y, a['from'] as { x: number; y: number }, a['to'] as { x: number; y: number }));
      case 'mask.ellipse': return coord((X, Y) => ellipseAt(X, Y, a['box'] as { x: number; y: number; w: number; h: number }, a['angle_deg'] as number));
      case 'mask.constant': return one(() => a['value'] as number);
      case 'mask.paint': return { w: W, h: H, c: 1, data: paintMask(a['strokes'] as readonly Stroke[], fullGrid(W, H)) };
      case 'mask.luminance': {
        const r = await recv();
        const [lo, hi] = DOMAINS[(this.g.get(n.inputs[0]!)!.info as ImageInfo).domain as Domain].range;
        const ch = (i: number, k: number) => r.data[i * r.c + Math.min(k, r.c - 1)]!;
        return one((i) => luminanceAt(((ch(i, 0) + ch(i, 1) + ch(i, 2)) / 3 - lo) / (hi - lo), a['above'] as number, a['below'] as number, a['softness'] as number));
      }
      case 'mask.combine': {
        const [v, c] = [await recv(), await this.image(a['other'] as string)];
        return one((i) => maskCombine(a['mode'] as 'add' | 'subtract' | 'intersect', v.data[i * v.c]!, c.data[i * c.c]!, a['amount'] as number));
      }
      case 'mask.feather': {
        const r = await recv();
        return { w: W, h: H, c: 1, data: gaussianBlur1(one((i) => r.data[i * r.c]!).data, W, H, featherSigma(a['radius_px'] as number)) };
      }
      case 'mask.invert': {
        const r = await recv();
        return one((i) => 1 - r.data[i * r.c]!);
      }
      case 'print.densityMask': {
        const r = await recv();
        const clear = clearExposure({ up: this.up(n), env: this.env });
        const pd = new Float64Array(W * H * 3);
        for (let i = 0; i < W * H; i++) for (let k = 0; k < 3; k++) pd[i * 3 + k] = clear[k]! - r.data[i * r.c + Math.min(k, r.c - 1)]!;
        const gamma = a['gamma'] as number;
        if (gamma === 0) return one(() => 0);
        return { w: W, h: H, c: 1, data: maskDensityPolar(pd, W, H, 3, gamma, densityMaskSigma(a['radius_um'] as number, info.umPerPx.film), a['polarity'] === 'same' ? 'same' : 'positive') };
      }
      case 'print.combine': return this.combine(n);
      case 'composite.mix': {
        const [back, top] = [await recv(), await this.image(a['top'] as string)];
        const m = a['mask'] === undefined ? null : await this.image(a['mask'] as string);
        const amount = a['amount'] as number;
        const data = new Float64Array(back.data.length);
        for (let i = 0; i < W * H; i++) {
          const k = amount * (m ? m.data[i * m.c]! : 1);
          for (let q = 0; q < back.c; q++) data[i * back.c + q] = mixPixel(back.data[i * back.c + q]!, top.data[i * top.c + q]!, k);
        }
        return { w: W, h: H, c: back.c, data };
      }
      case 'heal': case 'clone': {
        const r = await recv();
        return { ...r, data: retouch(r.data, W, H, r.c, a['spots'] as readonly Spot[], n.op, info.domain === 'scanner-density' ? 'log' : 'linear') };
      }
      case 'clarity': {
        const r = await recv();
        const Yw = whiteAt({ up: this.up(n), env: this.env })[1];
        return { ...r, data: clarity(r.data, W, H, r.c, a['strength'] as number, claritySigma(a['radius_mm'] as number, info.umPerPx.paper), Yw) };
      }
      default: throw new Error(`LawReference: ${n.op}`);
    }
  }

  private async combine(n: Node): Promise<Img64> {
    const c = combineArgs(n.args);
    const main = this.g.get(n.inputs[0]!)!;
    const x = await this.image(main.id);
    const W = x.w, H = x.h;
    const img = async (id: string | undefined) => (id === undefined ? null : this.image(id));
    const ratio = (id: string) => combineRatio(main.op === 'print.expose' ? main.args : undefined, this.g.get(id)?.op === 'print.expose' ? this.g.get(id)!.args : undefined);
    const ctx = { up: this.up(n), env: this.env, node: (id: string): UpNode | undefined => this.g.get(id) as UpNode | undefined };
    const mainMask = await img(c.mainMask);
    const terms = await Promise.all(c.terms.map(async (t) => ({
      t, r: ratio(t.image), m: await img(t.mask),
      flash: t.role === 'flash-base' || t.role === 'flash-open' ? flashExposure(ctx, t.image, t.role) : null,
      x: t.role === 'burn' || t.role === 'dodge' ? await img(t.image) : null,
    })));
    const dens = await Promise.all(c.densities.map(async (d) => ({ d, img: (await img(d.image))!, m: await img(d.mask) })));
    const filt = await Promise.all(c.filters.map(async (f) => ({ f, m: await img(f.mask) })));
    const pre = await Promise.all(c.preflash.map(async (p) => ({ p, m: await img(p.mask) })));
    const cov = (m: Img64 | null, i: number) => (m ? m.data[i * m.c]! : 1);
    const out = new Float64Array(W * H * 3);
    const o = [0, 0, 0];
    for (let i = 0; i < W * H; i++) {
      const s: LightSample = {
        xMain: x.data.subarray(i * x.c, i * x.c + 3), wMain: c.mainAmount * cov(mainMask, i),
        terms: terms.map(({ t, r, m, flash, x: tx }) => ({ role: t.role, x: flash ?? tx!.data.subarray(i * tx!.c, i * tx!.c + 3), w: t.amount * cov(m, i) * r })),
        densities: dens.map(({ d, img: di, m }) => ({ d: di.data[i * di.c]!, w: d.amount * cov(m, i) })),
        filters: filt.map(({ f, m }) => ({ logH: f.logH, w: f.amount * cov(m, i) })),
        preflash: pre.map(({ p, m }) => ({ fraction: p.fraction, w: p.amount * cov(m, i) })),
      };
      lightH(s, o);
      out[3 * i] = o[0]!; out[3 * i + 1] = o[1]!; out[3 * i + 2] = o[2]!;
    }
    return { w: W, h: H, c: 3, data: out };
  }
}
