// His export settings (CHB-047, OUT-1): format, colour space, size, JPEG quality and the file name pattern, in his
// preferences (prefs.export: kept across sessions like Lightroom's export dialog, never undone — they are not an edit of
// a photo). At export they become the document's output.export (format, space, size, quality), so the file's document
// hash records them. Labels in his words; the checks an agent's values go through; the file names of an export.
import type { ExportSettings, ExportSize, OutputSpaceId } from '@chromobench/contract';

export type ExportFormat = ExportSettings['format'];
export type ExportSizeBy = ExportSize['by'];

export interface ExportPrefs {
  format: ExportFormat;
  space: OutputSpaceId;
  /** Original size, Long edge or Percentage */
  size: ExportSizeBy;
  /** the long edge in pixels (when size is 'long'; kept while another size is chosen) */
  longPx: number;
  /** the percentage of the original size (when size is 'percent') */
  pct: number;
  /** JPEG quality 1–100 */
  quality: number;
  /** the file name pattern: {name} the file's name (a frame of a strip adds its number), {n} the place in this export, {date} today */
  name: string;
}

/** His export settings with the studio's defaults filled in: JPEG, sRGB, original size, quality 90, "{name}". */
export const EXPORT_DEFAULTS: Readonly<ExportPrefs> = Object.freeze({ format: 'jpeg', space: 'srgb', size: 'original', longPx: 2048, pct: 50, quality: 90, name: '{name}' });

export const EXPORT_FORMATS: readonly { id: ExportFormat; label: string; ext: string; mime: string }[] = [
  { id: 'jpeg', label: 'JPEG', ext: 'jpg', mime: 'image/jpeg' },
  { id: 'tiff16', label: 'TIFF 16-bit', ext: 'tif', mime: 'image/tiff' },
  { id: 'png16', label: 'PNG 16-bit', ext: 'png', mime: 'image/png' },
  { id: 'png8', label: 'PNG 8-bit', ext: 'png', mime: 'image/png' },
];

export const EXPORT_SPACES: readonly { id: OutputSpaceId; label: string }[] = [
  { id: 'srgb', label: 'sRGB' },
  { id: 'display-p3', label: 'Display P3' },
  { id: 'adobe-rgb', label: 'Adobe RGB' },
  { id: 'prophoto', label: 'ProPhoto RGB' },
];

export const EXPORT_SIZES: readonly { id: ExportSizeBy; label: string }[] = [
  { id: 'original', label: 'Original size' },
  { id: 'long', label: 'Long edge' },
  { id: 'percent', label: 'Percentage' },
];

/** The prefs as the export takes them (defaults for anything missing). */
export function exportPrefsOf(s: unknown): ExportPrefs {
  const p = (s as { prefs?: { export?: Partial<ExportPrefs> } } | null | undefined)?.prefs?.export ?? {};
  return { ...EXPORT_DEFAULTS, ...p };
}

/** The contract's export size of his settings. */
export function exportSizeOf(p: Pick<ExportPrefs, 'size' | 'longPx' | 'pct'>): ExportSize {
  if (p.size === 'long') return { by: 'long', px: p.longPx };
  if (p.size === 'percent') return { by: 'percent', pct: p.pct };
  return { by: 'original' };
}

/** What the host's export takes. */
export type ExportSettingsOf = ExportPrefs;

/** What is wrong with a change of his export settings (an agent's, a typed number), in his words; null when fine. */
export function exportPrefsProblem(p: Partial<ExportPrefs>): string | null {
  if (p.format !== undefined && !EXPORT_FORMATS.some((f) => f.id === p.format)) return `Format must be one of ${EXPORT_FORMATS.map((f) => f.id).join(', ')}`;
  if (p.space !== undefined && !EXPORT_SPACES.some((f) => f.id === p.space)) return `Colour space must be one of ${EXPORT_SPACES.map((f) => f.id).join(', ')}`;
  if (p.size !== undefined && !EXPORT_SIZES.some((f) => f.id === p.size)) return "Size must be 'original', 'long' or 'percent'";
  if (p.longPx !== undefined && !(Number.isInteger(p.longPx) && p.longPx >= 16 && p.longPx <= 100000)) return 'Long edge must be a whole number of pixels from 16 to 100000';
  if (p.pct !== undefined && !(typeof p.pct === 'number' && p.pct >= 1 && p.pct <= 100)) return 'Percentage must be from 1 to 100';
  if (p.quality !== undefined && !(Number.isInteger(p.quality) && p.quality >= 1 && p.quality <= 100)) return 'JPEG quality must be a whole number from 1 to 100';
  if (p.name !== undefined && (typeof p.name !== 'string' || !p.name.trim())) return 'The file name must not be empty';
  return null;
}

/** One line of what an export with these settings writes ("JPEG · sRGB · long edge 2048 px · quality 90"). */
export function exportSummary(p: ExportPrefs): string {
  const f = EXPORT_FORMATS.find((x) => x.id === p.format)?.label ?? p.format;
  const sp = EXPORT_SPACES.find((x) => x.id === p.space)?.label ?? p.space;
  const size = p.size === 'long' ? `long edge ${p.longPx} px` : p.size === 'percent' ? `${p.pct} % of the original` : 'original size';
  return [f, sp, size, ...(p.format === 'jpeg' ? [`quality ${p.quality}`] : [])].join(' · ');
}

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * The file names of an export, in order: the pattern with {name} (the file's name without its extension; a frame of a
 * strip adds "-<its number>"), {n} (the place in this export, from 1) and {date} (YYYY-MM-DD), the format's extension,
 * characters a file system refuses replaced by "-", and " (2)", " (3)" … where two would be the same.
 */
export function exportFileNames(frames: readonly { name: string; strip?: { index: number } | undefined }[], p: Pick<ExportPrefs, 'name' | 'format'>, date: Date = new Date()): string[] {
  const ext = EXPORT_FORMATS.find((f) => f.id === p.format)?.ext ?? 'img';
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const seen = new Map<string, number>();
  return frames.map((f, i) => {
    const base = f.name.replace(/\.[^.]+$/, '') + (f.strip ? `-${f.strip.index}` : '');
    const stem = (p.name || '{name}').replace(/\{name\}/g, base).replace(/\{n\}/g, String(i + 1)).replace(/\{date\}/g, day).replace(ILLEGAL, '-').trim() || 'print';
    const k = (seen.get(stem.toLowerCase()) ?? 0) + 1;
    seen.set(stem.toLowerCase(), k);
    return `${stem}${k > 1 ? ` (${k})` : ''}.${ext}`;
  });
}

/** One frame's result in the Output panel (and the command's answer). */
export interface ExportResult {
  frame: string;
  file: string;
  ok: boolean;
  width?: number;
  height?: number;
  bytes?: number;
  bits?: number;
  ms?: number;
  /** of `ms`, the decode of the file at the export's size (0: the working image was that size) */
  decodeMs?: number;
  /** why it failed, in his words */
  error?: string;
}

/** The export in progress and the last one's results (ui.export, the view tier: shown, never kept). */
export interface ExportRun {
  running: boolean;
  /** 1-based place of the frame being exported, of `total` */
  at: number;
  total: number;
  /** the file being written */
  file: string;
  phase: string;
  tilesDone: number;
  tilesTotal: number;
  results: ExportResult[];
  cancelled?: boolean;
}

/** Bytes in his units: "18.4 MB", "640 KB". */
export function bytesText(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} bytes`;
}
