// Shown images (guide §5.10; h.show, cb.compare): rendered after the eval on the host. Every image carries the
// numbers it shows: measure.stats over its region, the measure.patches table for darkroom pictures, the
// densitometer reading for an `at` option. Non-display domains go through a fixed transform:
// print-xyz through output.display with the frame document's rendering, everything else as greyscale.
import { DOMAINS, acceptsDomain, getOp, normaliseShape, type Box, type Document, type Graph, type ImageInfo, type Node, type Show } from '@chromobench/contract';
import type { ShowRequest } from '../host.ts';
import { burnNumber, encodePng } from './png.ts';
import { fmtNum } from './yaml.ts';

export const LOOK_LONG_SIDE = 750;
export const LOOK_MAX_SIDE = 1568;

export interface ShowEngine {
  graph: Graph;
  intern(op: string, inputs: string[], args: Record<string, unknown>): Node;
  evaluate(id: string, region: Box, scale: number): Promise<{ data: ArrayLike<number>; width: number; height: number; channels: number }>;
  measure(id: string): Promise<Record<string, unknown>>;
  doc(frame: string | null): Document | null;
}

interface Rendered {
  rgb: Uint8Array;
  width: number;
  height: number;
  numbers: Record<string, unknown>;
  node: Node;
  region: Box;
  scale: number;
}

function toRgb8(px: ArrayLike<number>, n: number, channels: number, info: ImageInfo, display: boolean): Uint8Array {
  const out = new Uint8Array(n * 3);
  const [lo, hi] = DOMAINS[info.domain].range;
  for (let i = 0; i < n; i++) {
    if (display) {
      for (let k = 0; k < 3; k++) out[i * 3 + k] = Math.round(255 * Math.min(1, Math.max(0, px[i * channels + Math.min(k, channels - 1)]!)));
    } else {
      let s = 0;
      const c = Math.min(3, channels);
      for (let k = 0; k < c; k++) s += px[i * channels + k]!;
      const g = Math.round(255 * Math.min(1, Math.max(0, (s / c - lo) / (hi - lo))));
      out.fill(g, i * 3, i * 3 + 3);
    }
  }
  return out;
}

function patchGrid(n: Node): { cols: number; rows: number } | null {
  if (n.op === 'darkroom.testStrip') {
    const steps = n.args['steps'] as number;
    return n.args['direction'] === 'vertical' ? { cols: steps, rows: 1 } : { cols: 1, rows: steps };
  }
  if (n.op === 'darkroom.ringAround') return { cols: 3, rows: 3 };
  return null;
}

async function renderOne(e: ShowEngine, id: string, req: ShowRequest, longSide: number): Promise<Rendered> {
  const node = e.graph.get(id)!;
  const info = node.info as ImageInfo;
  const full: Box = { x: 0, y: 0, w: info.width, h: info.height };
  const b = req.opts['box'] !== undefined ? (normaliseShape('box', req.opts['box']) as Box) : full;
  const region = b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= info.width && b.y + b.h <= info.height ? b : full;
  const scale = Math.min(1, longSide / Math.max(region.w, region.h));
  let shown = node;
  let display = info.domain === 'display-rgb';
  if (info.domain === 'print-xyz') {
    const d = e.doc(req.frame);
    shown = e.intern('output.display', [node.id], d ? { space: 'srgb', rendering: d.output.rendering, knee: d.output.display.knee.method } : { space: 'srgb' });
    display = true;
  }
  const img = await e.evaluate(shown.id, region, scale);
  const rgb = toRgb8(img.data, img.width * img.height, img.channels, info, display);
  const numbers: Record<string, unknown> = {};
  const isRegion = region !== full;
  const stats = e.intern('measure.stats', [node.id], isRegion ? { box: region } : {});
  Object.assign(numbers, await e.measure(stats.id));
  const grid = patchGrid(node);
  if (grid) {
    const p = e.intern('measure.patches', [node.id], grid);
    const cells = (await e.measure(p.id))['cells'] as Record<string, unknown>[];
    numbers['cells'] = cells.map((c) => ({ cell: c['cell'], D: c['D'] }));
  }
  if (req.opts['at'] !== undefined && acceptsDomain(getOp('measure.densitometer'), info.domain)) {
    const d = e.intern('measure.densitometer', [node.id], { at: req.opts['at'], aperture_px: 15 });
    numbers['at'] = { at: normaliseShape('point', req.opts['at']), ...(await e.measure(d.id)) };
  }
  return { rgb, width: img.width, height: img.height, numbers, node, region, scale };
}

export async function renderShow(e: ShowEngine, req: ShowRequest): Promise<Show> {
  const size = typeof req.opts['size'] === 'number' ? Math.min(LOOK_MAX_SIDE, Math.max(64, req.opts['size'] as number)) : LOOK_LONG_SIDE;
  const parts: Rendered[] = [];
  for (const id of req.ids) parts.push(await renderOne(e, id, req, req.ids.length > 1 ? size / 2 : size));
  let width: number;
  let height: number;
  let rgb: Uint8Array;
  if (parts.length === 1) {
    ({ width, height, rgb } = parts[0]!);
  } else {
    height = Math.min(...parts.map((p) => p.height));
    width = parts.reduce((s, p) => s + p.width, 0);
    rgb = new Uint8Array(width * height * 3);
    let x0 = 0;
    for (const p of parts) {
      for (let y = 0; y < height; y++) rgb.set(p.rgb.subarray(y * p.width * 3, (y + 1) * p.width * 3), (y * width + x0) * 3);
      x0 += p.width;
    }
  }
  burnNumber(width, height, rgb, req.n);
  const first = parts[0]!;
  const info = first.node.info as ImageInfo;
  const pxPer = fmtNum(1 / first.scale);
  const caption = parts.length === 1
    ? `${req.label} — ${req.frame ?? 'no frame'} ${info.domain} (${width}×${height}, 1 px = ${pxPer} source px)`
    : `${req.label} — left | right, ${info.domain} (${width}×${height})`;
  const numbers = parts.length === 1 ? first.numbers : { left: parts[0]!.numbers, right: parts[1]!.numbers };
  return {
    n: req.n, caption, node: first.node.id, domain: info.domain, region: first.region, scale: first.scale, numbers,
    image: { mime: 'image/png', width, height, bytes: encodePng(width, height, rgb) },
  };
}
