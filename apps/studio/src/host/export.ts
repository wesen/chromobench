// Export (CHB-023, on CHB-011's packages/output; CHB-037: on documents; CHB-047: at the size he chooses). The
// committed document of a frame, links resolved, with his export settings (format, colour space, size, quality) is
// compiled for the export space (exportNode: the display cut) and evaluated tile by tile at export precision, then
// encoded (TIFF 16, PNG 16, PNG 8 or JPEG) with its ICC profile. The file carries the document's hash.
//
// Sizes (CHB-047): the studio computes on a working image (4000 px on the GPU engine, 640 px on the CPU engine) and a
// document's coordinates are pixels of it. An export at another size decodes the file again at that size
// (StudioEngine.openExport: the same decode, area-averaged there), maps the document onto it (contract scaleDocument)
// and renders that, so the file is the print the studio would show had it worked at that size; previews stay at the
// working size. The export image is let go when the export (or a batch of frames) ends.
import { EXPORT_FORMATS, exportFileNames, exportSizeOf, type ExportRequestOf, type ExportResult, type ExportSettingsOf } from '@chromobench/studio-kit';
import { Graph, scaleDocument, type Box, type Document, type Engine, type ExportSettings } from '@chromobench/contract';
import {
  documentPayload, exportFrame, exportNode, MemorySink, opfsSink, pickerAvailable, pickerSink,
  type ByteSink, type DirHandleLike, type EncodedFile, type ExportProgress,
} from '@chromobench/output';
import type { StudioEngine } from './studio-engine.ts';

/** The engine an export runs on: the studio's (StudioEngine: export images at other sizes), or one without them (the mock: the working size). */
export type ExportEngine = Engine & Partial<Pick<StudioEngine, 'openExport' | 'closeExport' | 'sizes' | 'graph'>>;

export interface ExportJob {
  engine: ExportEngine;
  /** The frame's graph (its working source is registered there). */
  graph: Graph;
  /** The frame's document, links resolved (Studio.resolved). */
  doc: Document;
  /** The file's hash (the working source's id). */
  sha: string;
  /** The file's name (LibRaw reads the format from it). */
  name: string;
  /** The file name of the export. */
  fileName: string;
  settings: ExportSettingsOf;
  sink: ByteSink;
  /** The export images of this batch (frames of one file share theirs). */
  sources: ExportSources;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}

export interface Exported extends EncodedFile {
  /** Milliseconds, from the decode at the export's size to the last byte. */
  ms: number;
  /** 'working': the working image was the export's size; else the long side the file was decoded at (0: its own size). */
  decoded: 'working' | number;
  /** Milliseconds spent decoding the file at the export's size (0 when the working image was used or the batch had it). */
  decodeMs: number;
}

/** The file decoded at an export's size, per file and size, for the frames of one batch; `close` lets them all go. */
export class ExportSources {
  private readonly open = new Map<string, Promise<{ id: string; width: number; height: number }>>();
  private readonly engine: ExportEngine;
  private readonly bytesOf: (sha: string) => Promise<Uint8Array | null>;
  constructor(engine: ExportEngine, bytesOf: (sha: string) => Promise<Uint8Array | null>) {
    this.engine = engine;
    this.bytesOf = bytesOf;
  }
  get(sha: string, name: string, long: number): Promise<{ id: string; width: number; height: number }> {
    const key = `${sha}|${long}`;
    let p = this.open.get(key);
    if (!p) {
      p = (async () => {
        const bytes = await this.bytesOf(sha);
        if (!bytes) throw new Error(`${name} is not at hand: open the file again to export it at this size`);
        const info = await this.engine.openExport!(sha, bytes, name, long);
        return { id: info.sha256, width: info.width, height: info.height };
      })();
      this.open.set(key, p);
    }
    return p;
  }
  /** Lets every export image of the batch go (their pixels and textures). */
  async close(): Promise<void> {
    for (const p of this.open.values()) {
      const s = await p.catch(() => null);
      if (s) this.engine.closeExport?.(s.id);
    }
    this.open.clear();
  }
}

/** The document with his export settings (the rest of output.export as the document has it). */
export function withExport(d: Document, s: ExportSettingsOf): Document {
  return { ...d, output: { ...d.output, export: { ...d.output.export, format: s.format, space: s.space, size: exportSizeOf(s), quality: s.quality } } };
}

/**
 * The long side to decode the file at for `size` (0 = its own size), or null when the working image is that size.
 * `out` is the frame's output at the working size (crop, orientation); `working` and `full` the working image's and
 * the file's sizes.
 */
export function exportLong(size: ExportSettings['size'], out: { width: number; height: number }, working: { width: number; height: number }, full: { width: number; height: number }): number | null {
  const S0 = Math.max(working.width, working.height), F = Math.max(full.width, full.height), O0 = Math.max(out.width, out.height);
  let L: number;
  if (size.by === 'original') L = F;
  else if (size.by === 'long') L = Math.min(F, Math.round((S0 * size.px) / Math.max(1, O0)));
  else L = Math.max(1, Math.round((F * size.pct) / 100));
  if (L === S0) return null;
  return L >= F ? 0 : L;
}

/** A crop whose long side is `px` (the long-edge size is the number he typed), kept inside the source. */
function exactLong(c: Box, px: number, W: number, H: number): Box {
  const wide = c.w >= c.h;
  const have = wide ? c.w : c.h;
  if (have === px || Math.abs(have - px) > 2) return c;
  if (wide) {
    const w = Math.min(px, W);
    return { ...c, x: Math.max(0, Math.min(c.x, W - w)), w };
  }
  const h = Math.min(px, H);
  return { ...c, y: Math.max(0, Math.min(c.y, H - h)), h };
}

export async function exportPrint(job: ExportJob): Promise<Exported> {
  const t0 = performance.now();
  const s = job.settings;
  let d = withExport(job.doc, s);
  let g = job.graph;
  let node = exportNode(d, g);
  const sizes = job.engine.sizes && job.engine.openExport ? job.engine.sizes(job.sha) : null;
  const out0 = node.info as { width: number; height: number };
  const long = sizes ? exportLong(exportSizeOf(s), out0, sizes.working, sizes.full) : null;
  let decodeMs = 0;
  if (sizes && long !== null) {
    const td = performance.now();
    const src = await job.sources.get(job.sha, job.name, long);
    decodeMs = performance.now() - td;
    const kx = src.width / sizes.working.width, ky = src.height / sizes.working.height;
    let scaled = scaleDocument(d, kx, ky);
    scaled = { ...scaled, source: { ...scaled.source, sha256: src.id } };
    const size = exportSizeOf(s);
    if (size.by === 'long' && scaled.geometry.crop) scaled = { ...scaled, geometry: { ...scaled.geometry, crop: exactLong(scaled.geometry.crop, size.px, src.width, src.height) } };
    g = new Graph();
    g.registerSource(job.engine.graph!.source(src.id)!);
    d = scaled;
    node = exportNode(d, g);
  }
  job.engine.adopt(g.closure(node.id));
  const ex = d.output.export;
  const file = await exportFrame(job.engine, {
    node,
    // the file's metadata names the document by its hash (documentSha256): the frame's document with these export
    // settings, in the working image's pixels (the document he edits; File ▸ Save Document saves it)
    settings: { format: s.format, space: s.space, quality: s.quality, dpi: ex.dpi, compression: ex.compression, signal: ex.signal === 'none' ? 'none' : 'icc', document: 'none' },
    sink: job.sink,
    name: job.fileName,
    document: documentPayload(withExport(job.doc, s)),
    rendering: d.output.rendering,
    ...(job.signal ? { signal: job.signal } : {}),
    ...(job.onProgress ? { onProgress: job.onProgress } : {}),
  });
  return { ...file, ms: performance.now() - t0, decoded: long === null ? 'working' : long, decodeMs };
}

/** What a batch export needs from the studio. */
export interface BatchDeps {
  engine: ExportEngine;
  /** an open frame: its file's hash and name, its place on a strip, its graph */
  frame(id: string): { sha: string; name: string; strip?: { index: number } | undefined; graph: Graph } | undefined;
  /** a frame's document, links resolved */
  doc(id: string): Document | undefined;
  /** a frame's file read again (null when it is not at hand) */
  bytes(id: string): Promise<Uint8Array | null>;
  /** an error in his words */
  explain(e: unknown): string;
  /** after each file: its description, and the bytes when it was exported to memory */
  onFile?(x: Exported, data: Uint8Array | null): void;
}

const isAbort = (e: unknown): boolean => (e as Error)?.name === 'AbortError' || /E_CANCELLED/.test(String((e as Error)?.message ?? e));

/**
 * The export of frames with his settings (StudioHost.exportFrames, CHB-047): where to first — one file: the save
 * dialog; several: a folder; without those (or for an agent without a click): downloads; 'memory': nothing written —
 * then one frame after another, the export images of a file shared by its frames and let go at the end. One result
 * per frame; a failure does not stop the others; Cancel stops after the part in flight (no partial file is left).
 */
export async function exportBatch(deps: BatchDeps, req: ExportRequestOf): Promise<ExportResult[]> {
  const ids = req.frames.filter((id) => deps.frame(id) && deps.doc(id));
  const frames = ids.map((id) => ({ id, f: deps.frame(id)! }));
  const names = exportFileNames(frames.map((x) => ({ name: x.f.name, strip: x.f.strip })), req.settings);
  const fmt = EXPORT_FORMATS.find((f) => f.id === req.settings.format)!;
  // where to: before any other await (the pickers need the click's user activation)
  let dir: DirHandleLike | null = null;
  let single: ByteSink | null = null;
  if (req.to === 'files' && frames.length) {
    const w = globalThis as { showDirectoryPicker?: (o: unknown) => Promise<DirHandleLike> };
    try {
      if (frames.length > 1 && w.showDirectoryPicker) dir = await w.showDirectoryPicker({ id: 'exports', mode: 'readwrite' });
      else if (frames.length === 1 && pickerAvailable()) single = await pickerSink(names[0]!, [{ description: `${fmt.label} image`, accept: { [fmt.mime]: [`.${fmt.ext}`] } }]);
    } catch (e) {
      // he closed the dialog: nothing is exported
      if (isAbort(e)) return [];
      // no activation (an agent's run) or no permission: downloads instead
    }
  }
  const sources = new ExportSources(deps.engine, async (sha) => {
    const x = frames.find((y) => y.f.sha === sha);
    return x ? deps.bytes(x.id) : null;
  });
  const results: ExportResult[] = [];
  try {
    for (let i = 0; i < frames.length; i++) {
      if (req.signal.aborted) break;
      const { id, f } = frames[i]!;
      const file = names[i]!;
      req.onProgress({ at: i + 1, total: frames.length, file, phase: 'plan', tilesDone: 0, tilesTotal: 0, results: [...results] });
      const sink: ByteSink = single ?? (dir ? await opfsSink(file, { root: dir, sync: false }) : new MemorySink());
      try {
        const x = await exportPrint({
          engine: deps.engine, graph: f.graph, doc: deps.doc(id)!, sha: f.sha, name: f.name, fileName: file, settings: req.settings, sink, sources, signal: req.signal,
          onProgress: (p) => req.onProgress({ at: i + 1, total: frames.length, file, phase: p.phase, tilesDone: p.tilesDone, tilesTotal: p.tilesTotal, results: [...results] }),
        });
        const data = sink instanceof MemorySink ? sink.bytes() : null;
        if (data && req.to === 'files') download(new Blob([data as Uint8Array<ArrayBuffer>], { type: x.mime }), file);
        deps.onFile?.(x, data);
        results.push({ frame: id, file, ok: true, width: x.width, height: x.height, bytes: x.bytes, bits: x.bits, ms: Math.round(x.ms), decodeMs: Math.round(x.decodeMs) });
      } catch (e) {
        if (isAbort(e)) break;
        results.push({ frame: id, file, ok: false, error: deps.explain(e) });
      }
    }
  } finally {
    await sources.close();
  }
  return results;
}

/** Hands a blob to the browser as a download. */
export function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
