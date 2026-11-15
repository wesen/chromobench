// Export (CHB-023, on CHB-011's packages/output since the CHB-019 migration; CHB-037: on documents): the committed
// document of a frame, compiled for the export space (exportNode: the display cut), evaluated tile by tile at export
// precision and encoded as a 16-bit TIFF, a 16-bit PNG or an 8-bit PNG with its ICC profile (exportFrame). The file
// carries the document's hash (documentSha256) in its metadata. The file goes to the
// browser's save picker where there is one (Chrome, Edge), else it is downloaded. Sizes are the working image's
// (the engine's source); `?long=0` makes that the file's own size on the GPU.
import type { Document, Engine, ExportSettings, Graph, OutputSpaceId } from '@chromobench/contract';
import { documentPayload, exportFrame, exportNode, MemorySink, pickerAvailable, pickerSink, type ByteSink, type EncodedFile, type ExportProgress } from '@chromobench/output';

export type ExportFormat = Extract<ExportSettings['format'], 'tiff16' | 'png16' | 'png8'>;

export const EXPORT_FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'tiff16', label: 'TIFF 16-bit' },
  { id: 'png16', label: 'PNG 16-bit' },
  { id: 'png8', label: 'PNG 8-bit' },
];

export const EXPORT_SPACES: { id: OutputSpaceId; label: string }[] = [
  { id: 'srgb', label: 'sRGB' },
  { id: 'display-p3', label: 'Display P3' },
  { id: 'adobe-rgb', label: 'Adobe RGB' },
  { id: 'prophoto', label: 'ProPhoto RGB' },
];

export interface ExportJob {
  engine: Engine;
  graph: Graph;
  doc: Document;
  /** the scan's file name (the export is named after it) */
  name: string;
  format: ExportFormat;
  space: OutputSpaceId;
  /** 'picker' asks where to save (needs the click's user activation: call before any await); 'memory' keeps the bytes */
  to: 'picker' | 'memory';
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}

export interface Exported extends EncodedFile {
  /** the bytes, when exported to memory */
  data?: Uint8Array;
}

export function exportName(name: string, format: ExportFormat, space: OutputSpaceId): string {
  const base = name.replace(/\.[^.]+$/, '');
  return `${base}-print${space === 'srgb' ? '' : `-${space}`}.${format === 'tiff16' ? 'tif' : 'png'}`;
}

/** The document with the export's format and space (the rest of output.export as the document has it). */
function withExport(d: Document, format: ExportFormat, space: OutputSpaceId): Document {
  return { ...d, output: { ...d.output, export: { ...d.output.export, format, space } } };
}

export async function exportPrint(job: ExportJob): Promise<Exported> {
  const fileName = exportName(job.name, job.format, job.space);
  // the picker first: it needs the user activation of the click that started the export
  const mime = job.format === 'tiff16' ? 'image/tiff' : 'image/png';
  const sink: ByteSink = job.to === 'picker' && pickerAvailable()
    ? await pickerSink(fileName, [{ description: job.format === 'tiff16' ? 'TIFF image' : 'PNG image', accept: { [mime]: [job.format === 'tiff16' ? '.tif' : '.png'] } }])
    : new MemorySink();
  const d = withExport(job.doc, job.format, job.space);
  const node = exportNode(d, job.graph);
  job.engine.adopt(job.graph.closure(node.id));
  const ex = d.output.export;
  const file = await exportFrame(job.engine, {
    node,
    // the file's metadata names the document by its hash (documentSha256), as it named the recipe; the document
    // itself is saved with File ▸ Save Document
    settings: { format: job.format, space: job.space, scale: 'full', dpi: ex.dpi, compression: ex.compression, signal: ex.signal === 'none' ? 'none' : 'icc', document: 'none' },
    sink,
    name: fileName,
    document: documentPayload(job.doc),
    rendering: d.output.rendering,
    ...(job.signal ? { signal: job.signal } : {}),
    ...(job.onProgress ? { onProgress: job.onProgress } : {}),
  });
  if (sink instanceof MemorySink) {
    const data = sink.bytes();
    if (job.to === 'picker') download(new Blob([data as Uint8Array<ArrayBuffer>], { type: file.mime }), fileName);
    return { ...file, data };
  }
  return file;
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
