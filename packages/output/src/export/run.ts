// Tiled full-resolution export (guide §5.9, stage 5; the CHB-005 "tiled-export driver" task): plan →
// tiles in row-major order → one band of tiles at a time → encoder → finalise. Engine-agnostic: it uses
// Engine.plan() when the engine has one (the GPU engine), `evaluateU16` when the engine packs 16-bit
// codes itself (GpuEngine: pack2x16unorm, 8 bytes per pixel read back), else evaluate() and quantises.
//
// Consistency is structural: the runner evaluates the one immutable NodeRef it was given; edits made
// meanwhile create new nodes. Cancellation: the signal is checked before every tile; the tile in flight
// finishes, the sink is aborted (no partial file) and the promise rejects with E_CANCELLED.
import {
  canonicalJSON, ChromobenchError, compile, sha256Hex, toDiagnostic,
  type Box, type CompileOptions, type Document, type Engine, type EvalTarget, type ExportSettings, type Graph, type ImageInfo, type Node, type NodeRef,
  type OutputSpaceId, type TilePlan,
} from '@chromobench/contract';
import { pngText, tiffDescription, type FileMeta } from '../encode/metadata.ts';
import { Png16Writer } from '../encode/png16.ts';
import { toU16 } from '../encode/quantise.ts';
import type { ByteSink } from '../encode/sinks.ts';
import { Tiff16Writer } from '../encode/tiff16.ts';
import { getSpace, pngColour } from '../spaces.ts';

export interface ExportProgress {
  phase: 'plan' | 'tiles' | 'finalise' | 'done';
  tilesDone: number;
  tilesTotal: number;
  bytesWritten: number;
  elapsedMs: number;
}

/** The file an export produced (the Value output.encode describes; CONTRACT-REQUESTS R2). */
export interface EncodedFile {
  name: string;
  format: ExportSettings['format'];
  mime: 'image/png' | 'image/tiff';
  bytes: number;
  width: number;
  height: number;
  bits: 8 | 16;
  space: OutputSpaceId;
  iccSha256: string;
  /** documentSha256 of the document the file was made from ('' when none was given). */
  documentSha256: string;
  /** The document JSON to save next to the file when settings.document is 'sidecar'. */
  sidecar?: { name: string; json: string };
}

export interface ExportRequest {
  /** An immutable display-rgb node (output.display or output.frame) compiled for `settings.space`. */
  node: NodeRef;
  settings: Pick<ExportSettings, 'format' | 'space' | 'scale' | 'dpi' | 'compression' | 'signal' | 'document'>;
  sink: ByteSink;
  name: string;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
  /** The document as JSON and its hash (documentPayload), for metadata and the sidecar. */
  document?: { json: string; sha256: string };
  rendering?: string;
  /** Tile size for engines without plan() (default 1024). */
  tile?: number;
}

/** What GpuEngine adds: 16-bit codes packed on the GPU. */
interface U16Engine {
  evaluateU16(ref: NodeRef, target: Omit<EvalTarget, 'precision'>): Promise<{ data: Uint16Array; width: number; height: number }>;
}
const hasU16 = (e: Engine): e is Engine & U16Engine => typeof (e as Partial<U16Engine>).evaluateU16 === 'function';

/** Tiles of the output grid. At full scale: the engine's plan (or a default grid); below: one pass. */
async function planOf(engine: Engine, node: NodeRef, info: ImageInfo, scale: number, tile: number): Promise<{ tiles: { core: Box }[]; outW: number; outH: number }> {
  if (scale < 1) {
    // a reduced-size export is small (a 100 MP frame at 0.25 is 6 MP): one pass at that scale, so the
    // engine's own resampling decides every output pixel
    return { tiles: [{ core: { x: 0, y: 0, w: info.width, h: info.height } }], outW: Math.max(1, Math.round(info.width * scale)), outH: Math.max(1, Math.round(info.height * scale)) };
  }
  let plan: Pick<TilePlan, 'tiles'> | null = null;
  if (engine.plan) plan = await engine.plan(node, { scale: 'full', precision: 'export' });
  if (!plan) {
    const tiles: { index: number; core: Box; read: Box }[] = [];
    const nx = Math.ceil(info.width / tile);
    for (let j = 0; j < Math.ceil(info.height / tile); j++) for (let i = 0; i < nx; i++) {
      const core = { x: i * tile, y: j * tile, w: Math.min(tile, info.width - i * tile), h: Math.min(tile, info.height - j * tile) };
      tiles.push({ index: j * nx + i, core, read: core });
    }
    plan = { tiles };
  }
  return { tiles: plan.tiles, outW: info.width, outH: info.height };
}

const cancelled = (): ChromobenchError => new ChromobenchError({ code: 'E_CANCELLED', message: 'export cancelled' });

interface Encoder { writeRows(rgb16: Uint16Array, rows: number): Promise<void>; finish(): Promise<void> }

async function openEncoder(req: ExportRequest, w: number, h: number): Promise<{ enc: Encoder; mime: EncodedFile['mime']; bits: 8 | 16; iccSha256: string }> {
  const s = req.settings;
  const space = getSpace(s.space);
  const meta: FileMeta = { space: space.label, ...(req.rendering ? { rendering: req.rendering } : {}), ...(req.document ? { documentSha256: req.document.sha256 } : {}), ...(req.document && s.document === 'embedded' ? { documentJson: req.document.json } : {}) };
  if (s.format === 'tiff16') {
    const description = tiffDescription(meta);
    const enc = await Tiff16Writer.open(req.sink, {
      width: w, height: h, compression: s.compression, dpi: s.dpi, software: 'chromobench',
      ...(s.signal !== 'none' ? { icc: space.icc } : {}), ...(description ? { description } : {}),
    });
    return { enc, mime: 'image/tiff', bits: 16, iccSha256: s.signal !== 'none' ? space.iccSha256 : '' };
  }
  if (s.format === 'png16' || s.format === 'png8') {
    const colour = pngColour(space, s.signal);
    const enc = await Png16Writer.open(req.sink, { width: w, height: h, bits: s.format === 'png8' ? 8 : 16, colour, dpi: s.dpi, text: pngText(meta) });
    return { enc, mime: 'image/png', bits: s.format === 'png8' ? 8 : 16, iccSha256: colour.icc ? space.iccSha256 : '' };
  }
  throw new ChromobenchError({ code: 'E_NOT_IMPLEMENTED', message: `export format ${s.format} is not implemented`, hint: 'JPEG needs an OffscreenCanvas encoder (8 bits); use png8, png16 or tiff16', valid: ['tiff16', 'png16', 'png8'] });
}

/**
 * Exports `req.node` through `engine` into `req.sink` and returns the file's description. Rejects with
 * E_CANCELLED when the signal fires (after the tile in flight), with the original diagnostic and the
 * phase/tile in the message on failure; in both cases the sink is aborted first.
 */
export async function exportFrame(engine: Engine, req: ExportRequest): Promise<EncodedFile> {
  const t0 = performance.now();
  const info = req.node.info as ImageInfo;
  if (info.kind !== 'Image' || info.domain !== 'display-rgb') throw new ChromobenchError({ code: 'E_DOMAIN', message: `export needs a display-rgb image node, not ${info.domain}`, hint: 'compile the document with displaySpace = the export space (exportNode)' });
  const s = req.settings;
  const scale = s.scale === 'full' ? 1 : s.scale;
  let phase: ExportProgress['phase'] = 'plan';
  let tilesDone = 0;
  let tilesTotal = 0;
  let tileAt = -1;
  const progress = () => req.onProgress?.({ phase, tilesDone, tilesTotal, bytesWritten: req.sink.size, elapsedMs: performance.now() - t0 });
  try {
    if (req.signal?.aborted) throw cancelled();
    progress();
    const { tiles, outW, outH } = await planOf(engine, req.node, info, scale, req.tile ?? 1024);
    tilesTotal = tiles.length;
    const { enc, mime, bits, iccSha256 } = await openEncoder(req, outW, outH);
    phase = 'tiles';
    progress();
    // one band = all tiles sharing a row of the plan (row-major); its rows go to the encoder when complete
    const bands = new Map<number, { core: Box }[]>();
    for (const t of tiles) bands.set(t.core.y, [...(bands.get(t.core.y) ?? []), t]);
    for (const [y0, band] of [...bands].sort((a, b) => a[0] - b[0])) {
      const bh = scale < 1 ? outH : band[0]!.core.h;
      const rows = new Uint16Array(outW * bh * 3);
      for (const t of band.sort((a, b) => a.core.x - b.core.x)) {
        if (req.signal?.aborted) throw cancelled();
        tileAt = tiles.indexOf(t);
        const target = { scale: scale < 1 ? scale : ('full' as const), region: t.core, ...(req.signal ? { signal: req.signal } : {}) };
        let data: Uint16Array;
        let tw: number;
        let th: number;
        if (hasU16(engine)) {
          const r = await engine.evaluateU16(req.node, target);
          ({ data, width: tw, height: th } = r);
        } else {
          const r = await engine.evaluate(req.node, { ...target, precision: 'export' });
          tw = r.width;
          th = r.height;
          data = toU16(await r.read(), r.info.channels, tw, th);
        }
        const ox = scale < 1 ? 0 : t.core.x;
        for (let r = 0; r < th; r++) rows.set(data.subarray(r * tw * 3, (r + 1) * tw * 3), (r * outW + ox) * 3);
        tilesDone++;
        progress();
      }
      void y0;
      await enc.writeRows(rows, bh);
    }
    tileAt = -1;
    phase = 'finalise';
    progress();
    await enc.finish();
    await req.sink.close();
    phase = 'done';
    progress();
    const documentSha256 = req.document?.sha256 ?? '';
    return {
      name: req.name, format: s.format, mime, bytes: req.sink.size, width: outW, height: outH, bits, space: s.space, iccSha256, documentSha256,
      ...(req.document && s.document === 'sidecar' ? { sidecar: { name: sidecarName(req.name), json: req.document.json } } : {}),
    };
  } catch (e) {
    await req.sink.abort().catch(() => undefined);
    const d = toDiagnostic(e);
    if (d.code === 'E_CANCELLED') throw new ChromobenchError({ ...d, message: `export cancelled after ${tilesDone} of ${tilesTotal} tiles` });
    throw new ChromobenchError({ ...d, message: `export failed in ${phase}${tileAt >= 0 ? ` (tile ${tileAt})` : ''}: ${d.message}` });
  }
}

/** The sidecar's name beside an exported file: `frame_0042.png` → `frame_0042.chromobench.json`. */
export const sidecarName = (file: string): string => `${file.replace(/\.[^.]+$/, '')}.chromobench.json`;

/** SHA-256 (hex) of a document's canonical JSON: the identity of the edit an exported file was made from. */
export function documentSha256(doc: Document): string {
  return sha256Hex(new TextEncoder().encode(canonicalJSON(doc)));
}

/** A document as an export carries it: its canonical JSON and its hash (ExportRequest.document). */
export function documentPayload(doc: Document): { json: string; sha256: string } {
  const json = canonicalJSON(doc);
  return { json, sha256: sha256Hex(new TextEncoder().encode(json)) };
}

/**
 * The export node of a document: the one compiler with the export space as the display space, and the export knee
 * in place of the display knee (compile reads output.display.knee). The node is the display cut: output.display, then
 * the document geometry (output.frame).
 */
export function exportNode(doc: Document, g: Graph, opts: Omit<CompileOptions, 'displaySpace'> = {}): Node {
  const ex = doc.output.export;
  const top = compile(doc, g, { ...opts, displaySpace: ex.space }).display;
  if (ex.knee.method === doc.output.display.knee.method) return top;
  const display = g.get(top.inputs[0]!);
  if (!display || display.op !== 'output.display') return top;
  const d2 = g.intern('output.display', [...display.inputs], { ...display.args, knee: ex.knee.method }).node;
  return g.intern(top.op, [d2.id], top.args).node;
}
