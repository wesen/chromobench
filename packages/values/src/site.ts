// Call sites: where a value was built. site() parses `new Error().stack` and returns the first frame outside the
// registered library roots, so a builder records the line of the program that called it, not its own line (the
// technique of packages/shell/src/core/diag.ts). This package registers its own src/; a package that builds values
// for others (the contract's builders, the shell, a kit) calls libraryRoot(import.meta.url) once.

export interface CallSite {
  /** the frame's URL or path, without query or hash */
  url: string;
  /** the last two path segments: `test/coll.test.ts` */
  file: string;
  line: number;
  col: number;
}

const ROOTS = new Set<string>();
let capturing = true;

const stripScheme = (u: string): string => u.replace(/^file:\/\//, '').replace(/^https?:\/\/[^/]+(\/@fs)?/, '');
const normRoot = (u: string): string => {
  let s = String(u).replace(/[?#].*$/, '');
  if (!s.endsWith('/')) s = s.slice(0, s.lastIndexOf('/') + 1);
  return stripScheme(s);
};

/** Register a library root (a file URL inside it, or the directory): frames under it are skipped by site(). */
export function libraryRoot(url: string): void {
  ROOTS.add(normRoot(url));
}
libraryRoot(new URL('.', import.meta.url).href);

/** Turn call-site capture on or off (it costs one stack trace per builder call). Returns the previous setting. */
export function captureSites(on: boolean): boolean {
  const was = capturing;
  capturing = on;
  return was;
}

const FRAME = /((?:https?|file):\/\/[^\s)]+?|\/[^\s)(]+?):(\d+):(\d+)/;
const isLib = (url: string): boolean => {
  const p = stripScheme(url.replace(/[?#].*$/, ''));
  for (const r of ROOTS) if (p.startsWith(r)) return true;
  return /\/node_modules\/|^node:|\(node:/.test(url);
};

/** The first stack frame outside the library roots (`skip` more program frames), or null when capture is off. */
export function site(skip = 0): CallSite | null {
  if (!capturing) return null;
  const stack = String(new Error().stack || '').split('\n').slice(1);
  const app: { url: string; line: number; col: number }[] = [];
  for (const line of stack) {
    const m = line.match(FRAME);
    if (m && !isLib(m[1]!)) app.push({ url: m[1]!, line: +m[2]!, col: +m[3]! });
  }
  const f = app[skip] ?? app[0];
  if (!f) return null;
  const url = f.url.replace(/[?#].*$/, '');
  return { url, file: url.split('/').slice(-2).join('/'), line: f.line, col: f.col };
}

/** `file:line:col`, or 'unknown place'. */
export const where = (at: CallSite | null | undefined): string => (at ? `${at.file}:${at.line}:${at.col}` : 'unknown place');
