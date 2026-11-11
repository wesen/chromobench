// Diagnostics: what the builder and the runtime report, in the program's own words, with the program's own lines.
//
// Anatomy: a stable code and a title · where (the call site that created the thing, captured when the builder
// method ran, so it is the app's line and not the library's) · lines that state the competing facts, each with its
// own location · one concrete fix.

const LIB = /\/shell\//;

// The first stack frame outside the shell library: the line in the app that called the builder.
export function site(skip = 0) {
  const stack = String(new Error().stack || '').split('\n').slice(1);
  const frames = [];
  for (const line of stack) {
    const m = line.match(/((?:https?|file):\/\/[^\s)]+?|\/[^\s)(]+?):(\d+):(\d+)/);
    if (m) frames.push({ url: m[1], line: +m[2], col: +m[3] });
  }
  const app = frames.filter(f => !LIB.test(f.url));
  const f = app[skip] || app[0] || frames[frames.length - 1];
  if (!f) return null;
  return { url: f.url, file: shortFile(f.url), line: f.line, col: f.col };
}
export function shortFile(url) {
  const u = String(url).replace(/[?#].*$/, '');
  const i = u.indexOf('/app/');
  if (i >= 0) return u.slice(i + 1);
  const j = u.indexOf('/shell/');
  if (j >= 0) return u.slice(j + 1);
  return u.split('/').slice(-2).join('/');
}
export const where = at => (at ? `${at.file}:${at.line}:${at.col}` : 'unknown place');

export const FAMILIES = {
  I: 'Info', B: 'Bindings', K: 'Keys', D: 'Docking', L: 'Lambdas', M: 'Matching',
  T: 'Tools and transactions', S: 'Statecharts', V: 'Viewport and views', P: 'Performance', X: 'Plugins',
};

export class Diagnostic {
  constructor({ code, level = 'error', title, at = null, lines = [], fix = null, runtime = false, data = null }) {
    Object.assign(this, { code: code.startsWith('CK-') ? code : 'CK-' + code, level, title, at, lines, fix, runtime, data });
  }
  get family() { return FAMILIES[this.code[3]] || 'Other'; }
  format() {
    const head = `${this.code} ${this.level} · ${this.title}`;
    const loc = `  at ${where(this.at)}${this.runtime ? ' (runtime)' : ''}`;
    const body = this.lines.map(l => '  ' + l);
    const fix = this.fix ? ['  fix: ' + this.fix] : [];
    return [head, loc, ...body, ...fix].join('\n');
  }
  toJSON() { return { code: this.code, level: this.level, title: this.title, at: this.at && where(this.at), lines: this.lines, fix: this.fix, runtime: this.runtime }; }
}

// A collector; the build fills one, the runtime appends to the same list (dev builds only).
export class Diagnostics {
  constructor() { this.list = []; this.listeners = new Set(); this.seen = new Set(); }
  add(d) {
    const dd = d instanceof Diagnostic ? d : new Diagnostic(d);
    const key = dd.code + '|' + where(dd.at) + '|' + dd.lines.join('|');
    if (this.seen.has(key)) return dd;      // a runtime problem that repeats every frame is reported once
    this.seen.add(key);
    this.list.push(dd);
    for (const f of this.listeners) f(dd);
    return dd;
  }
  error(o) { return this.add(Object.assign({ level: 'error' }, o)); }
  warn(o) { return this.add(Object.assign({ level: 'warning' }, o)); }
  info(o) { return this.add(Object.assign({ level: 'info' }, o)); }
  get errors() { return this.list.filter(d => d.level === 'error'); }
  get warnings() { return this.list.filter(d => d.level === 'warning'); }
  summary() { const e = this.errors.length, w = this.warnings.length; return `${e ? '✕' : '✓'} ${e} error${e === 1 ? '' : 's'} · ${w} warning${w === 1 ? '' : 's'}`; }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  forEach(f) { this.list.forEach(f); }
  [Symbol.iterator]() { return this.list[Symbol.iterator](); }
}

// thrown by ck.* calls that cannot continue (a build error raised early, with its diagnostic attached)
export class BuildError extends Error {
  constructor(diag) { super(diag.format()); this.diagnostic = diag; this.name = 'BuildError'; }
}
