// Diagnostics: what the builder and the runtime report, in the program's own words, with the program's own lines.
//
// Anatomy (CraftKit): a stable code and a message · where (the call site that created the thing, captured when the
// builder method ran, so it is the app's line and not the library's) · facts that state the competing facts, each
// with its own location · one concrete fix. The shape is a structural superset of the contract's Diagnostic
// (code, message, where, path, valid, hint, fix), so studio-kit can pass a Diag wherever the contract expects one.

export interface CallSite {
  url: string;
  file: string;
  line: number;
  col: number;
}

export type DiagLevel = 'error' | 'warning' | 'info';

export interface Diag {
  /** 'CK-B110', 'CB-R001', 'E_DOMAIN' */
  code: string;
  level: DiagLevel;
  /** CraftKit's title */
  message: string;
  /** the program's own line */
  at?: CallSite | null;
  /** the competing facts, each with its location */
  facts?: string[];
  /** one fix, computed from the receiver */
  fix?: string;
  /** contract fields */
  where?: { line: number; col?: number };
  path?: string;
  valid?: string[];
  hint?: string;
  /** reported while running (not by the build) */
  runtime?: boolean;
  /** 'shell', a kit or a pass */
  source?: string;
}

export type DiagExtra = Partial<Omit<Diag, 'code' | 'message'>>;

/** The one producer. Level defaults to error; `where` is filled from `at` for the contract's readers. */
export function diag(code: string, message: string, extra: DiagExtra = {}): Diag {
  const d: Diag = { code, level: extra.level ?? 'error', message };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && k !== 'level') (d as unknown as Record<string, unknown>)[k] = v;
  if (d.at && !d.where) d.where = { line: d.at.line, col: d.at.col };
  return d;
}

// ── call sites ────────────────────────────────────────────────────────────
// site() parses new Error().stack and returns the first frame outside the registered library roots. The shell
// registers its own src/ directory; studio-kit and kits call ck.libraryRoot(import.meta.url).
const ROOTS = new Set<string>();
const normRoot = (u: string): string => {
  let s = String(u).replace(/[?#].*$/, '');
  if (!s.endsWith('/')) s = s.slice(0, s.lastIndexOf('/') + 1);
  return stripScheme(s);
};
const stripScheme = (u: string): string => u.replace(/^file:\/\//, '').replace(/^https?:\/\/[^/]+(\/@fs)?/, '');

/** Register a library root: frames under it are skipped when looking for the program's line. */
export function libraryRoot(url: string): void {
  ROOTS.add(normRoot(url));
}
// the shell's own sources: packages/shell/src/
libraryRoot(new URL('..', import.meta.url).href);

const FRAME = /((?:https?|file):\/\/[^\s)]+?|\/[^\s)(]+?):(\d+):(\d+)/;
const isLib = (url: string): boolean => {
  const p = stripScheme(url.replace(/[?#].*$/, ''));
  for (const r of ROOTS) if (p.startsWith(r)) return true;
  return /\/node_modules\/|^node:|\(node:/.test(url);
};

/** The first stack frame outside the libraries: the line in the app that called the builder. */
export function site(skip = 0): CallSite | null {
  const stack = String(new Error().stack || '').split('\n').slice(1);
  const frames: { url: string; line: number; col: number }[] = [];
  for (const line of stack) {
    const m = line.match(FRAME);
    if (m) frames.push({ url: m[1]!, line: +m[2]!, col: +m[3]! });
  }
  const app = frames.filter(f => !isLib(f.url));
  const f = app[skip] || app[0];
  if (!f) return null;
  return { url: f.url.replace(/[?#].*$/, ''), file: shortFile(f.url), line: f.line, col: f.col };
}

export function shortFile(url: string): string {
  const u = String(url).replace(/[?#].*$/, '');
  return u.split('/').slice(-2).join('/');
}
export const where = (at: CallSite | null | undefined): string => (at ? `${at.file}:${at.line}:${at.col}` : 'unknown place');

export const FAMILIES: Record<string, string> = {
  I: 'Info',
  B: 'Bindings',
  K: 'Keys',
  D: 'Docking',
  L: 'Lambdas',
  M: 'Matching',
  T: 'Tools and transactions',
  S: 'Statecharts',
  V: 'Viewport and views',
  P: 'Performance',
  X: 'Fragments, kits and passes',
};
export const familyOf = (code: string): string => (code.startsWith('CK-') ? FAMILIES[code[3]!] ?? 'Other' : 'Other');

/** CraftKit's text form: head, location, facts, fix. */
export function formatDiag(d: Diag, opts: { at?: boolean } = {}): string {
  const head = `${d.code} ${d.level} · ${d.message}`;
  const loc = opts.at === false ? [] : [`  at ${where(d.at)}${d.runtime ? ' (runtime)' : ''}`];
  const body = (d.facts ?? []).map(l => '  ' + l);
  const fix = d.fix ? ['  fix: ' + d.fix] : [];
  return [head, ...loc, ...body, ...fix].join('\n');
}

/** A collector: the build fills one, the runtime appends to the same list. A repeated problem is reported once. */
export class Diagnostics {
  list: Diag[] = [];
  private listeners = new Set<(d: Diag) => void>();
  private seen = new Set<string>();
  add(d: Diag): Diag {
    const key = d.code + '|' + where(d.at) + '|' + d.message + '|' + (d.facts ?? []).join('|');
    if (this.seen.has(key)) return d;
    this.seen.add(key);
    this.list.push(d);
    for (const f of this.listeners) f(d);
    return d;
  }
  error(code: string, message: string, extra: DiagExtra = {}): Diag {
    return this.add(diag(code, message, { ...extra, level: 'error' }));
  }
  warn(code: string, message: string, extra: DiagExtra = {}): Diag {
    return this.add(diag(code, message, { ...extra, level: 'warning' }));
  }
  info(code: string, message: string, extra: DiagExtra = {}): Diag {
    return this.add(diag(code, message, { ...extra, level: 'info' }));
  }
  get errors(): Diag[] {
    return this.list.filter(d => d.level === 'error');
  }
  get warnings(): Diag[] {
    return this.list.filter(d => d.level === 'warning');
  }
  codes(): string[] {
    return this.list.map(d => d.code);
  }
  summary(): string {
    const e = this.errors.length;
    const w = this.warnings.length;
    return `${e ? '✕' : '✓'} ${e} error${e === 1 ? '' : 's'} · ${w} warning${w === 1 ? '' : 's'}`;
  }
  on(f: (d: Diag) => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  format(): string {
    return this.list.map(d => formatDiag(d)).join('\n\n');
  }
  [Symbol.iterator](): Iterator<Diag> {
    return this.list[Symbol.iterator]();
  }
}

/** Thrown by calls that cannot continue (a build error raised early, with its diagnostic attached). */
export class BuildError extends Error {
  readonly diagnostic: Diag;
  constructor(d: Diag) {
    super(formatDiag(d));
    this.diagnostic = d;
    this.name = 'BuildError';
  }
}
