// A bug report (CHB-038) as files: what the photographer chose to send, in one zip the owner opens in the studio.
// Headless: the host gathers the parts (the environment, the pictures, the originals) and zips the files; this module
// decides what goes where, writes the manifest and the plain-text README, and reads a report back.
//
//   report.json                 the manifest: format, when, the app, the description, the parts, every file, the frames
//   README.txt                  a summary a person reads first
//   environment.json            app, browser, OS, screen, GPU adapter (info, limits, features), engine, layout, URL
//   journal.json, journal.txt   the diagnostics journal (rows with counts; this session and the kept earlier ones)
//   settings.json               the studio's preferences and the host's settings
//   frames/<id>/document.json   each open frame's document (format 3)          (part 'documents')
//   frames/<id>/history.json    its saved edit (initial, applied, pending) and the log's entries with authors and times
//   view.json                   the selection, the module, the view state
//   previews/<id>.png           each open frame's print, display cut, ≤ 1600 px (part 'pictures')
//   screenshot.png              the main viewer's picture as last presented
//   originals/<sha8>-<name>     the source files                                (part 'originals', off by default)
import type { Json } from '@chromobench/values';
import type { JournalRow, JournalSnapshot } from '@chromobench/shell';
import { rowText } from '@chromobench/shell';
import type { FrameSave } from '../../../src/bridge/saved.ts';

export const REPORT_FORMAT = 'chromobench-report' as const;
export const REPORT_VERSION = 1;

/** The parts a report can hold. environment, journal and settings are always in it; the rest are his choice. */
export type ReportPart = 'environment' | 'journal' | 'settings' | 'documents' | 'pictures' | 'originals';
export const ALWAYS: readonly ReportPart[] = ['environment', 'journal', 'settings'];
/** the choices of the dialog, their default, and what they mean in his words */
export const CHOICES: readonly { part: ReportPart; on: boolean; label: string; says: string }[] = [
  { part: 'documents', on: true, label: 'Your edits', says: 'What you did to each open photo, step by step, so the problem can be repeated. No pictures.' },
  { part: 'pictures', on: true, label: 'Small pictures', says: 'Each open photo as you see it now (at most 1600 pixels wide) and the picture in the viewer.' },
  { part: 'originals', on: false, label: 'The original files', says: 'Your photo and scan files themselves, so the problem can be repeated on them exactly. These are large.' },
];

/** One entry of the log as the report keeps it (the history in full: who, when, why, what). */
export interface ReportEntry {
  seq: number;
  at: number;
  by: string;
  label: string;
  status: string;
  why?: string;
  approvedBy?: string;
  batch?: string;
  mutations: readonly Json[];
}

/** One open frame, as the host gathered it. */
export interface ReportFrame {
  id: string;
  name: string;
  sha256: string;
  kind: 'negative-scan' | 'digital-raw';
  /** a frame of a strip: its place */
  strip?: { index: number; of: number };
  document: Json;
  save: FrameSave;
  entries: ReportEntry[];
  /** the print as PNG (part 'pictures') */
  preview?: Uint8Array;
  /** the source file (part 'originals') */
  original?: { name: string; bytes: Uint8Array };
  /** the source file's size in bytes (shown in the dialog) */
  bytes?: number;
}

export interface ReportInput {
  created: number;
  description: string;
  app: { version: string; commit: string };
  parts: readonly ReportPart[];
  environment: Json;
  journal: JournalSnapshot;
  settings: Json;
  view?: Json;
  frames: readonly ReportFrame[];
  screenshot?: Uint8Array;
}

export interface ManifestFrame {
  id: string;
  name: string;
  sha256: string;
  kind: string;
  strip?: { index: number; of: number };
  steps: number;
  document?: string;
  history?: string;
  preview?: string;
  original?: string;
}

export interface ReportManifest {
  format: typeof REPORT_FORMAT;
  version: typeof REPORT_VERSION;
  created: string;
  description: string;
  app: { version: string; commit: string };
  parts: ReportPart[];
  frames: ManifestFrame[];
  files: { path: string; bytes: number }[];
  summary: { errors: number; warnings: number; rows: number; sessions: number };
}

const enc = new TextEncoder();
const json = (v: unknown): Uint8Array => enc.encode(`${JSON.stringify(v, null, 1)}\n`);
const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'file';

/** chromobench-report-2026-11-15-1432-a1b2c3.zip */
export function reportName(created: number, short: string): string {
  const d = new Date(created);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `chromobench-report-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${safe(short).slice(0, 8)}.zip`;
}

/** what a part costs, in his words ("2.4 MB") */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

const problems = (rows: readonly JournalRow[]) => ({
  errors: rows.filter((r) => r.level === 'error').reduce((s, r) => s + r.count, 0),
  warnings: rows.filter((r) => r.level === 'warn').reduce((s, r) => s + r.count, 0),
});

/** The report's files (path, bytes), the manifest first. Only the chosen parts are in it. */
export function reportFiles(input: ReportInput): { files: [string, Uint8Array][]; manifest: ReportManifest } {
  const parts = new Set<ReportPart>([...ALWAYS, ...input.parts]);
  const out: [string, Uint8Array][] = [];
  const frames: ManifestFrame[] = [];
  out.push(['environment.json', json(input.environment)]);
  out.push(['journal.json', json(input.journal)]);
  out.push(['journal.txt', enc.encode(`${input.journal.rows.map(rowText).join('\n')}\n`)]);
  out.push(['settings.json', json(input.settings)]);
  if (parts.has('documents') && input.view !== undefined) out.push(['view.json', json(input.view)]);
  if (parts.has('pictures') && input.screenshot) out.push(['screenshot.png', input.screenshot]);
  for (const f of input.frames) {
    const m: ManifestFrame = { id: f.id, name: f.name, sha256: f.sha256, kind: f.kind, ...(f.strip ? { strip: f.strip } : {}), steps: f.entries.filter((e) => e.status === 'applied').length };
    const dir = `frames/${safe(f.id)}`;
    if (parts.has('documents')) {
      out.push([(m.document = `${dir}/document.json`), json(f.document)]);
      out.push([(m.history = `${dir}/history.json`), json({ save: f.save, entries: f.entries })]);
    }
    if (parts.has('pictures') && f.preview) out.push([(m.preview = `previews/${safe(f.id)}.png`), f.preview]);
    if (parts.has('originals') && f.original) {
      const path = `originals/${f.sha256.slice(0, 8)}-${safe(f.original.name)}`;
      // a strip's frames share one file
      if (!out.some(([p]) => p === path)) out.push([path, f.original.bytes]);
      m.original = path;
    }
    frames.push(m);
  }
  const sessions = new Set(input.journal.rows.map((r) => r.session)).size;
  const manifest: ReportManifest = {
    format: REPORT_FORMAT,
    version: REPORT_VERSION,
    created: new Date(input.created).toISOString(),
    description: input.description,
    app: input.app,
    parts: [...parts],
    frames,
    files: out.map(([path, b]) => ({ path, bytes: b.byteLength })),
    summary: { ...problems(input.journal.rows), rows: input.journal.rows.length, sessions },
  };
  const readme = enc.encode(readmeText(manifest, input));
  return { files: [['report.json', json(manifest)], ['README.txt', readme], ...out], manifest };
}

/** The README: what happened, what is inside, how to open it. Plain text for a person. */
export function readmeText(m: ReportManifest, input: Pick<ReportInput, 'journal' | 'environment'>): string {
  const env = (input.environment ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const gpu = env['gpu'] as { engine?: { name?: string } | null } | undefined;
  const errs = input.journal.rows.filter((r) => r.level === 'error' || r.level === 'warn').slice(-30);
  const lines = [
    'Chromobench problem report',
    '==========================',
    '',
    `Made ${m.created} with Chromobench ${m.app.version} (${m.app.commit}).`,
    '',
    'What happened, in the photographer\'s words:',
    m.description.trim() ? m.description.trim().split('\n').map((l) => `  ${l}`).join('\n') : '  (nothing written)',
    '',
    `Browser: ${String(env['browser']?.['userAgent'] ?? 'unknown')}`,
    `Engine: ${String(env['engine']?.['label'] ?? 'unknown')}`,
    `Graphics: ${gpu?.engine?.name ?? 'no WebGPU device for the engine'}`,
    '',
    `Journal: ${m.summary.errors} errors and ${m.summary.warnings} warnings in ${m.summary.rows} rows (${m.summary.sessions} session${m.summary.sessions === 1 ? '' : 's'}).`,
    ...(errs.length ? ['', 'Errors and warnings (newest last):', ...errs.map((r) => `  ${rowText(r)}`)] : []),
    '',
    `Inside: ${m.parts.join(', ')}.`,
    ...m.frames.map((f) => `  ${f.name}: ${f.steps} step${f.steps === 1 ? '' : 's'}${f.preview ? ', picture' : ''}${f.original ? ', original file' : ''}`),
    '',
    'To look at it: open the studio, File ▸ Open Report…, and choose this file (or drop it on the studio).',
    'Nothing in this file was sent anywhere by the studio: it goes where you send it.',
    '',
  ];
  return lines.join('\n');
}

export type ReportFrameRead = Omit<ManifestFrame, 'document' | 'history' | 'preview' | 'original'> & {
  document: Json | null;
  save: FrameSave | null;
  entries: ReportEntry[];
  preview: Uint8Array | null;
  original: Uint8Array | null;
  /** the original's file name (without the report's sha prefix) */
  file: string | null;
};

/** A report read back: the manifest and its parts. */
export interface Report {
  manifest: ReportManifest;
  environment: Json;
  journal: JournalSnapshot | null;
  settings: Json;
  view: Json | null;
  /** each frame: its manifest entry's facts, its document and history, its picture and original file (bytes, or null) */
  frames: ReportFrameRead[];
  screenshot: Uint8Array | null;
  readme: string;
}

const dec = new TextDecoder();
const parse = (b: Uint8Array | undefined): Json | null => {
  if (!b) return null;
  try {
    return JSON.parse(dec.decode(b)) as Json;
  } catch {
    return null;
  }
};

/** Reads a report from its files (the unzipped entries); throws a plain message when it is not one. */
export function readReport(files: ReadonlyMap<string, Uint8Array>): Report {
  const m = parse(files.get('report.json')) as ReportManifest | null;
  if (!m || m.format !== REPORT_FORMAT) throw new Error('This file is not a Chromobench problem report (it has no report.json).');
  if (m.version !== REPORT_VERSION) throw new Error(`This report was made by another version of the studio (report version ${String(m.version)}).`);
  const frames = m.frames.map((f): ReportFrameRead => {
    const h = parse(files.get(f.history ?? '')) as { save?: FrameSave; entries?: ReportEntry[] } | null;
    const { document: dp, history: _h, preview: pp, original: op, ...facts } = f;
    return {
      ...facts,
      file: op ? op.replace(/^originals\/[0-9a-f]{8}-/, '') : null,
      document: dp ? parse(files.get(dp)) : null,
      save: h?.save ?? null,
      entries: h?.entries ?? [],
      preview: (pp && files.get(pp)) || null,
      original: (op && files.get(op)) || null,
    };
  });
  return {
    manifest: m,
    environment: parse(files.get('environment.json')),
    journal: parse(files.get('journal.json')) as JournalSnapshot | null,
    settings: parse(files.get('settings.json')),
    view: parse(files.get('view.json')),
    frames,
    screenshot: files.get('screenshot.png') ?? null,
    readme: files.get('README.txt') ? dec.decode(files.get('README.txt')) : '',
  };
}

/** The one-paragraph summary of "Copy summary": what he pastes into a message. */
export function summaryText(o: { app: { version: string; commit: string }; environment: Json; journal: { rows: readonly JournalRow[] } }, last = 8): string {
  const env = (o.environment ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const gpu = env['gpu'] as { engine?: { name?: string } | null } | undefined;
  const p = problems(o.journal.rows);
  const rows = o.journal.rows.filter((r) => r.level === 'error' || r.level === 'warn').slice(-last);
  return [
    `Chromobench ${o.app.version} (${o.app.commit}) · ${String(env['browser']?.['summary'] ?? env['browser']?.['userAgent'] ?? '')}`,
    `Engine: ${String(env['engine']?.['label'] ?? '?')} · Graphics: ${gpu?.engine?.name ?? 'none'}`,
    `${p.errors} errors, ${p.warnings} warnings.`,
    ...rows.map(rowText),
  ].join('\n');
}
