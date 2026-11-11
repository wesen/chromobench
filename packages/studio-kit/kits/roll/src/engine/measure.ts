// Reading a frame through any Engine (contract only, so it runs on MockEngine, RefEngine and the GPU engine):
// its source pixels at the analysis size, and its integrated paper exposure (the first print's measure,
// after apps/studio's host/first-print.ts, CHB-023).
import { compile, type Box, type Engine, type FrameRecipe, type Graph, type Node, type Vec3 } from '@chromobench/contract';
import { EXPOSURE_PIXELS } from './constants.ts';

export interface Pixels {
  rgb: Float32Array;
  w: number;
  h: number;
  /** pixels per source pixel */
  scale: number;
}

/** The source (camera-linear) at long side ≤ `long`, as interleaved RGB. */
export async function readSource(engine: Engine, g: Graph, r: FrameRecipe, long: number, signal?: AbortSignal): Promise<Pixels> {
  const n = g.intern('source.open', [], { source: r.source.sha256, encoding: r.source.decode.encoding }).node;
  engine.adopt(g.closure(n.id));
  const info = n.info as { width: number; height: number };
  const s = Math.min(1, long / Math.max(info.width, info.height));
  const res = await engine.evaluate(n, { scale: s >= 1 ? 'full' : Number(s.toFixed(6)), precision: 'preview', ...(signal ? { signal } : {}) });
  const data = await res.read();
  const c = res.info.channels;
  const N = res.width * res.height;
  const rgb = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = Number(data[i * c + Math.min(k, c - 1)]);
  return { rgb, w: res.width, h: res.height, scale: res.width / info.width };
}

/** log10 of the mean of 10^x per channel: the frame's integrated paper exposure (x clamped to [−3, 2]). */
export function integratedExposure(x: ArrayLike<number>, n: number, stride = 3): Vec3 {
  const T = [0, 0, 0];
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i * stride]!, b = x[i * stride + 1]!, c = x[i * stride + 2]!;
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;
    T[0]! += 10 ** Math.min(2, Math.max(-3, a));
    T[1]! += 10 ** Math.min(2, Math.max(-3, b));
    T[2]! += 10 ** Math.min(2, Math.max(-3, c));
    m++;
  }
  return T.map((t) => Math.log10(Math.max(t, 1e-12) / Math.max(m, 1))) as Vec3;
}

function lightsNode(r: FrameRecipe, g: Graph): Node {
  const top = compile(r, g);
  const def = g.closure(top.id).find((d) => d.op === 'print.lights');
  if (!def) throw new Error('no print.lights node in the display chain');
  return g.adopt([def])[0]!;
}

/**
 * The frame's integrated paper exposure (relative to the aim, log H) under recipe r: the paper exposure that
 * print.lights hands print.develop, over the image area (`area`, source px; default the central 80 %).
 */
export async function measureExposure(engine: Engine, g: Graph, r: FrameRecipe, o: { area?: Box | null; pixels?: number; signal?: AbortSignal } = {}): Promise<Vec3> {
  const n = lightsNode(r, g);
  engine.adopt(g.closure(n.id));
  const info = n.info as { width: number; height: number };
  const box = o.area ?? { x: Math.round(info.width * 0.1), y: Math.round(info.height * 0.1), w: Math.max(1, Math.round(info.width * 0.8)), h: Math.max(1, Math.round(info.height * 0.8)) };
  const scale = Math.min(1, Math.sqrt((o.pixels ?? EXPOSURE_PIXELS) / (box.w * box.h)));
  const res = await engine.evaluate(n, { scale: scale >= 1 ? 'full' : Math.max(1e-3, Number(scale.toFixed(4))), precision: 'preview', region: box, ...(o.signal ? { signal: o.signal } : {}) });
  return integratedExposure(await res.read(), res.width * res.height, res.info.channels);
}
