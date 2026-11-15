// The diagnostics journal (CHB-038): what happened while the program ran, as structured events, for the person who
// has to find out why. One journal per page; every source (the console, the GPU devices, the engines, the worker,
// the decoder, the commands, the log, the service worker) writes into it through one capture layer each.
//
//   const j = new Journal({ session: 's1' });
//   j.error('gpu', 'Validation error in [ComputePipeline "pointwise"]', { code: 'GPU_VALIDATION' });
//   j.error('gpu', 'Validation error in [ComputePipeline "pointwise"]', { code: 'GPU_VALIDATION' });
//   j.rows()[0].count;      // 2: a repeated event is one row with its count, first and last time
//   j.explain();            // the summary and the last rows as text
//
// A ring of rows (default 3000, the least recently repeated go first) with dedupe and counts; subscribers; a tail
// (the last rows and every error) that a host persists so a report after a crash or a reload includes the previous
// session. Headless and dependency-free: no console, window or navigator here (the capture layers take them as
// arguments).
import type { Json } from '@chromobench/values';

export const JOURNAL_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type JournalLevel = (typeof JOURNAL_LEVELS)[number];
/** where an event comes from */
export const JOURNAL_SOURCES = ['gpu', 'engine', 'worker', 'decode', 'ui', 'command', 'store', 'agent', 'sw', 'app'] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

/** One event, as a capture layer writes it. */
export interface JournalEvent {
  level: JournalLevel;
  source: JournalSource;
  message: string;
  /** a stable code (GPU_VALIDATION, E_DEVICE_LOST, CK-T430) */
  code?: string;
  /** details as plain data (made JSON-safe and capped on the way in) */
  data?: unknown;
  /** the frame the event concerns */
  frame?: string;
  /** when (ms since the epoch; default the journal's clock) */
  t?: number;
}

/** One row of the journal: an event and its repeats. */
export interface JournalRow {
  /** the row's number in this journal (rows restored from an earlier session keep theirs, negated) */
  readonly id: number;
  readonly level: JournalLevel;
  readonly source: JournalSource;
  readonly message: string;
  readonly code?: string;
  /** the latest occurrence's details */
  readonly data?: Json;
  readonly frame?: string;
  /** how many times it happened */
  readonly count: number;
  readonly first: number;
  readonly last: number;
  /** the page session that recorded it */
  readonly session: string;
}

/** What a host persists (and a report includes): the tail of the journal. */
export interface JournalSnapshot {
  format: 'chromobench-journal';
  version: 1;
  session: string;
  saved: number;
  rows: JournalRow[];
}

export interface JournalFilter {
  /** the lowest level shown (default debug: all) */
  level?: JournalLevel;
  source?: JournalSource | readonly JournalSource[];
  /** 'this': only this page's session (default every session the journal holds) */
  session?: 'this' | 'all';
  /** the newest n rows */
  limit?: number;
  /** text in the message or the code */
  text?: string;
}

export interface JournalOptions {
  /** rows kept (default 3000) */
  capacity?: number;
  /** keep debug events (default false: they are dropped; ?debug turns them on) */
  debug?: boolean;
  now?: () => number;
  /** the page session's id (default a random one) */
  session?: string;
}

export interface JournalTotals {
  debug: number;
  info: number;
  warn: number;
  error: number;
}

const RANK: Record<JournalLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_MESSAGE = 2000;
const MAX_DATA = 8000;

/** A value as JSON for the journal: errors as { name, message, stack }, functions dropped, depth and length capped. */
export function journalData(v: unknown, depth = 0, seen: object[] = []): Json | undefined {
  if (v === undefined || typeof v === 'function' || typeof v === 'symbol') return undefined;
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > MAX_MESSAGE ? `${v.slice(0, MAX_MESSAGE)}…` : v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'bigint') return String(v);
  if (typeof v !== 'object') return String(v);
  if (depth > 6) return '[deep]';
  if (seen.includes(v)) return '[circular]';
  if (v instanceof Error) {
    const e = v as Error & { code?: unknown; diag?: unknown };
    const out: Record<string, Json> = { name: e.name, message: e.message };
    if (typeof e.code === 'string') out['code'] = e.code;
    if (e.stack) out['stack'] = e.stack.split('\n').slice(0, 12).join('\n');
    const d = journalData(e.diag, depth + 1, seen);
    if (d !== undefined) out['diag'] = d;
    return out;
  }
  if (ArrayBuffer.isView(v)) return `[${(v as { constructor: { name: string } }).constructor.name} ${(v as ArrayBufferView).byteLength} bytes]`;
  seen.push(v);
  let out: Json;
  if (Array.isArray(v)) out = v.slice(0, 50).map((x) => journalData(x, depth + 1, seen) ?? null);
  else {
    const r: Record<string, Json> = {};
    let n = 0;
    for (const k of Object.keys(v)) {
      if (n++ >= 60) {
        r['…'] = `${Object.keys(v).length - 60} more keys`;
        break;
      }
      const x = journalData((v as Record<string, unknown>)[k], depth + 1, seen);
      if (x !== undefined) r[k] = x;
    }
    out = r;
  }
  seen.pop();
  return out;
}

const capData = (v: unknown): Json | undefined => {
  const d = journalData(v);
  if (d === undefined) return undefined;
  const s = JSON.stringify(d);
  return s.length > MAX_DATA ? `${s.slice(0, MAX_DATA)}…` : d;
};

/** An error or any thrown value as one line (its code first when it has one). */
export function errorText(e: unknown): string {
  const x = e as { code?: unknown; diag?: { message?: string }; message?: unknown } | null;
  const msg = x?.diag?.message ?? (typeof x?.message === 'string' ? x.message : String(e));
  return typeof x?.code === 'string' && !msg.startsWith(x.code) ? `${x.code}: ${msg}` : msg;
}

const stamp = (t: number): string => {
  const d = new Date(t);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

/** One row as a line of text: when, level, source, code, ×count, the frame, the message. */
export function rowText(r: JournalRow): string {
  const rep = r.count > 1 ? ` ×${r.count} (first ${stamp(r.first).slice(11)})` : '';
  return `${stamp(r.last)} ${r.level.toUpperCase().padEnd(5)} ${r.source}${r.code ? ` ${r.code}` : ''}${rep}${r.frame ? ` [${r.frame}]` : ''} ${r.message}`;
}

export class Journal {
  readonly session: string;
  readonly capacity: number;
  /** debug events are kept (?debug) */
  debugOn: boolean;
  /**
   * Called for each new row and for repeats at counts 10, 100, 1000, … (a console capture sets it to the console's
   * original methods, so the browser's console still shows what the journal records, without repeating it 1000 times).
   */
  mirror: ((r: JournalRow) => void) | null = null;
  private readonly now: () => number;
  /** rows by key, in order of their last occurrence (the oldest first: evicted first) */
  private readonly byKey = new Map<string, JournalRow>();
  private seq = 0;
  private readonly subs = new Set<(r: JournalRow | null) => void>();
  private readonly counts: JournalTotals = { debug: 0, info: 0, warn: 0, error: 0 };
  private seenErrors = 0;
  /** bumped on every change (cells compare it) */
  version = 0;

  constructor(o: JournalOptions = {}) {
    this.capacity = Math.max(10, o.capacity ?? 3000);
    this.debugOn = !!o.debug;
    this.now = o.now ?? (() => Date.now());
    this.session = o.session ?? Math.random().toString(36).slice(2, 10);
  }

  /** Records an event; returns its row (null for a debug event while debug is off). */
  add(e: JournalEvent, o: { mirror?: boolean } = {}): JournalRow | null {
    if (e.level === 'debug' && !this.debugOn) return null;
    const t = e.t ?? this.now();
    const message = e.message.length > MAX_MESSAGE ? `${e.message.slice(0, MAX_MESSAGE)}…` : e.message;
    const key = `${this.session}|${e.level}|${e.source}|${e.code ?? ''}|${e.frame ?? ''}|${message}`;
    const was = this.byKey.get(key);
    const data = e.data === undefined ? was?.data : capData(e.data);
    const row: JournalRow = Object.freeze({
      id: was?.id ?? ++this.seq,
      level: e.level,
      source: e.source,
      message,
      ...(e.code !== undefined ? { code: e.code } : {}),
      ...(data !== undefined ? { data } : {}),
      ...(e.frame !== undefined ? { frame: e.frame } : {}),
      count: (was?.count ?? 0) + 1,
      first: was?.first ?? t,
      last: t,
      session: this.session,
    });
    // a repeat moves to the end: the rows that stopped happening are the ones the ring lets go
    if (was) this.byKey.delete(key);
    this.byKey.set(key, row);
    while (this.byKey.size > this.capacity) this.byKey.delete(this.byKey.keys().next().value!);
    this.counts[e.level]++;
    this.version++;
    if (o.mirror !== false && this.mirror && (row.count === 1 || /^10+$/.test(String(row.count)))) {
      try {
        this.mirror(row);
      } catch {
        /* a mirror never breaks the journal */
      }
    }
    this.tell(row);
    return row;
  }
  debug(source: JournalSource, message: string, extra: Omit<JournalEvent, 'level' | 'source' | 'message'> = {}): JournalRow | null {
    return this.add({ ...extra, level: 'debug', source, message });
  }
  info(source: JournalSource, message: string, extra: Omit<JournalEvent, 'level' | 'source' | 'message'> = {}): JournalRow | null {
    return this.add({ ...extra, level: 'info', source, message });
  }
  warn(source: JournalSource, message: string, extra: Omit<JournalEvent, 'level' | 'source' | 'message'> = {}): JournalRow | null {
    return this.add({ ...extra, level: 'warn', source, message });
  }
  error(source: JournalSource, message: string, extra: Omit<JournalEvent, 'level' | 'source' | 'message'> = {}): JournalRow | null {
    return this.add({ ...extra, level: 'error', source, message });
  }

  /** The rows, oldest first (by their last occurrence), filtered. */
  rows(f: JournalFilter = {}): JournalRow[] {
    const min = RANK[f.level ?? 'debug'];
    const sources = f.source === undefined ? null : new Set(typeof f.source === 'string' ? [f.source] : f.source);
    const text = f.text?.toLowerCase();
    let out = [...this.byKey.values()].filter(
      (r) =>
        RANK[r.level] >= min &&
        (!sources || sources.has(r.source)) &&
        (f.session !== 'this' || r.session === this.session) &&
        (!text || r.message.toLowerCase().includes(text) || (r.code ?? '').toLowerCase().includes(text)),
    );
    if (f.limit !== undefined) out = out.slice(Math.max(0, out.length - f.limit));
    return out;
  }
  get size(): number {
    return this.byKey.size;
  }
  /** occurrences in this session by level (repeats counted; rows the ring let go still count) */
  totals(): JournalTotals {
    return { ...this.counts };
  }
  /** error occurrences since markSeen (the badge's number) */
  get unseenErrors(): number {
    return this.counts.error - this.seenErrors;
  }
  /** the person looked at the journal: the badge goes quiet until the next error */
  markSeen(): void {
    if (this.seenErrors === this.counts.error) return;
    this.seenErrors = this.counts.error;
    this.version++;
    this.tell(null);
  }

  /** fn(row) after every event; fn(null) after a clear, a restore or markSeen */
  subscribe(fn: (r: JournalRow | null) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  private tell(r: JournalRow | null): void {
    for (const f of [...this.subs]) {
      try {
        f(r);
      } catch {
        /* a subscriber never breaks the journal */
      }
    }
  }

  /** forgets every row (the totals of this session stay: they say what happened) */
  clear(): void {
    this.byKey.clear();
    this.seenErrors = this.counts.error;
    this.version++;
    this.tell(null);
  }

  /** the last `n` rows and every error row: what a host persists, and what survives a reload */
  tail(n = 500): JournalSnapshot {
    const all = [...this.byKey.values()];
    const keep = new Set(all.slice(Math.max(0, all.length - n)));
    return { format: 'chromobench-journal', version: 1, session: this.session, saved: this.now(), rows: all.filter((r) => keep.has(r) || r.level === 'error') };
  }
  toJSON(): JournalSnapshot {
    return { format: 'chromobench-journal', version: 1, session: this.session, saved: this.now(), rows: [...this.byKey.values()] };
  }

  /**
   * Puts the rows of an earlier session (a snapshot a host persisted) before this session's rows. Rows of this
   * session in the snapshot are skipped; ids are negated so they never collide with this session's.
   */
  restore(s: unknown): number {
    if (!isJournalSnapshot(s)) return 0;
    const old = s.rows.filter((r) => r.session !== this.session);
    const mine = [...this.byKey.entries()];
    this.byKey.clear();
    for (const r of old) {
      const row = Object.freeze({ ...r, id: -Math.abs(r.id) });
      this.byKey.set(`${r.session}|${r.level}|${r.source}|${r.code ?? ''}|${r.frame ?? ''}|${r.message}#${r.id}`, row);
    }
    for (const [k, r] of mine) this.byKey.set(k, r);
    while (this.byKey.size > this.capacity) this.byKey.delete(this.byKey.keys().next().value!);
    this.version++;
    this.tell(null);
    return old.length;
  }

  /** rows as text, one per line */
  text(f: JournalFilter = {}): string {
    return this.rows(f).map(rowText).join('\n');
  }

  /** what happened, in a few lines: the totals, the sessions, the errors and warnings, the last rows */
  explain(o: { last?: number } = {}): string {
    const t = this.counts;
    const rows = [...this.byKey.values()];
    const sessions = new Set(rows.map((r) => r.session));
    const problems = rows.filter((r) => RANK[r.level] >= RANK.warn);
    const head = [
      `journal · session ${this.session} · ${rows.length} rows${sessions.size > 1 ? ` (${sessions.size - 1} earlier session${sessions.size > 2 ? 's' : ''} kept)` : ''}${this.debugOn ? ' · debug on' : ''}`,
      `this session: ${t.error} error${t.error === 1 ? '' : 's'}, ${t.warn} warning${t.warn === 1 ? '' : 's'}, ${t.info} info${this.debugOn ? `, ${t.debug} debug` : ''}`,
    ];
    const prob = problems.length ? ['', `errors and warnings (${problems.length} rows):`, ...problems.slice(-20).map(rowText)] : [];
    const last = o.last ?? 15;
    return [...head, ...prob, '', `the last ${Math.min(last, rows.length)} rows:`, ...rows.slice(-last).map(rowText)].join('\n');
  }
}

export const isJournalSnapshot = (x: unknown): x is JournalSnapshot =>
  !!x && typeof x === 'object' && (x as JournalSnapshot).format === 'chromobench-journal' && (x as JournalSnapshot).version === 1 && Array.isArray((x as JournalSnapshot).rows);
