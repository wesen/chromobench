// The per-frame edit log, adapted minimally to contract 1.0 (phase 4 replaces it with the one document history,
// design §26). Every entry is a values Transaction of the four mutations, applied under the contract's rules; an undo
// unit is one transaction. `by` is set by whoever calls the log: the UI passes 'user', ingest 'auto'; agent
// transactions enter only through propose(), which always records 'agent'. Sandboxed code never holds an EditLog.
//
// A pending transaction is stale when its inverses, recomputed when it is approved, differ from the ones stored at
// the proposal (the P1 amendment's rule): what it would undo is no longer what the agent saw.
import {
  applyTransaction, canonicalJSON, canonicalPath, getPath, transaction,
  type Author, type JsonObject, type Mutation, type Transaction,
} from '@chromobench/values';
import type { Document } from './document.ts';
import { diag, fail, isChromobenchError, type Diagnostic } from './errors.ts';
import { sha256Hex } from './graph.ts';
import { assertDocument, DOCUMENT_RULES } from './validate.ts';

export type { Author } from '@chromobench/values';
export type AgentMode = 'read-only' | 'ask' | 'auto';

/** 3 since contract 1.0 (document format 3, transactions); older logs are refused (no migration). */
export const EDIT_LOG_VERSION = 3 as const;

export interface LogEntry {
  /** Per-frame monotonic sequence number, from 1. */
  seq: number;
  frame: string;
  /** The transaction: status applied, pending or rejected; mutations in normal form with their inverses. */
  tx: Transaction;
  ts: number;
  /** The agent's one-line reason, shown on the approval card. */
  why?: string;
  approvedBy?: 'user';
}

export interface EditLogData {
  version: typeof EDIT_LOG_VERSION;
  frame: string;
  /** The document frame.add created. */
  initial: Document;
  initialBy: Author;
  initialTs: number;
  /** Append-only journal: applied, pending and rejected transactions. */
  entries: LogEntry[];
  /** Applied entries (seqs), in order: the undo units. */
  units: number[];
  /** units[0..cursor) are in effect. */
  cursor: number;
}

export interface WhyEntry {
  seq: number;
  by: Author;
  tx?: string;
  ts: number;
  op: Mutation['op'] | 'frame.add';
  path: string;
  value: unknown;
  approvedBy?: 'user';
}

export type LogEvent =
  | { type: 'apply'; entry: LogEntry }
  | { type: 'undo' | 'redo'; cursor: number }
  | { type: 'propose'; entry: LogEntry }
  | { type: 'approve'; entries: LogEntry[] }
  | { type: 'reject'; seqs: number[] }
  | { type: 'preview'; mutations: Mutation[] }
  | { type: 'mode'; mode: AgentMode };

export interface EditLogOptions {
  mode?: AgentMode;
  now?: () => number;
}

/** Which pending entries approve()/reject() act on: sequence numbers, or every pending entry of a batch. */
export type EntrySelector = readonly number[] | { batch: string };

export interface TxMeta {
  tx?: string;
  label?: string;
  batch?: string;
  source?: JsonObject;
  why?: string;
}

export class EditLog {
  private data: EditLogData;
  private modeValue: AgentMode;
  private readonly now: () => number;
  private overlay: Mutation[] | null = null;
  private committedCache: Document | null = null;
  private stateCache: Document | null = null;
  private readonly listeners = new Set<(e: LogEvent) => void>();
  private txCounter = 0;

  constructor(data: EditLogData, opts: EditLogOptions = {}) {
    if ((data as { version: unknown }).version !== EDIT_LOG_VERSION) {
      fail('E_DOCUMENT', `edit log version ${String((data as { version: unknown }).version)} is not ${EDIT_LOG_VERSION}: logs of recipes are refused (contract 1.0, no migration)`);
    }
    assertDocument(data.initial);
    this.data = structuredClone(data);
    this.modeValue = opts.mode ?? 'ask';
    this.now = opts.now ?? Date.now;
  }

  /** A new log for a frame whose document frame.add created. */
  static create(initial: Document, opts: EditLogOptions & { by?: Author } = {}): EditLog {
    const now = opts.now ?? Date.now;
    return new EditLog({ version: EDIT_LOG_VERSION, frame: initial.frame, initial, initialBy: opts.by ?? 'auto', initialTs: now(), entries: [], units: [], cursor: 0 }, opts);
  }

  toJSON(): EditLogData {
    return structuredClone(this.data);
  }

  get frame(): string {
    return this.data.frame;
  }

  get mode(): AgentMode {
    return this.modeValue;
  }

  /** Host only: the photographer changes the mode. */
  setMode(mode: AgentMode): void {
    this.modeValue = mode;
    this.emit({ type: 'mode', mode });
  }

  get cursor(): number {
    return this.data.cursor;
  }

  get entries(): readonly LogEntry[] {
    return this.data.entries;
  }

  canUndo(): boolean {
    return this.data.cursor > 0;
  }

  canRedo(): boolean {
    return this.data.cursor < this.data.units.length;
  }

  private entry(seq: number): LogEntry {
    return this.data.entries[seq - 1] ?? fail('E_MUTATION', `no entry ${seq}`);
  }

  /** Applied entries in effect, in order. */
  inEffect(): LogEntry[] {
    return this.data.units.slice(0, this.data.cursor).map((s) => this.entry(s));
  }

  /** The fold of the in-effect transactions over the initial document (no preview). */
  get committed(): Document {
    if (!this.committedCache) {
      let d = this.data.initial;
      for (const e of this.inEffect()) d = applyTransaction(d, e.tx, DOCUMENT_RULES).doc;
      this.committedCache = d;
    }
    return this.committedCache;
  }

  /** The committed document with the transient preview applied last (what the viewer renders). */
  get state(): Document {
    if (!this.overlay) return this.committed;
    this.stateCache ??= applyTransaction(this.committed, transaction({ id: 'preview', label: 'preview', by: 'user', mutations: this.overlay }), DOCUMENT_RULES).doc;
    return this.stateCache;
  }

  /** sha256(canonicalJSON(committed document)). The preview never changes it. */
  get stateHash(): string {
    return sha256Hex(canonicalJSON(this.committed));
  }

  /** sha256 over the in-effect transactions without timestamps. */
  get logHash(): string {
    return sha256Hex(canonicalJSON(this.inEffect().map((e) => ({ m: e.tx.mutations, by: e.tx.by, approvedBy: e.approvedBy ?? null }))));
  }

  private invalidate(): void {
    this.committedCache = null;
    this.stateCache = null;
  }

  private emit(e: LogEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  on(fn: (e: LogEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private nextTx(): string {
    this.txCounter += 1;
    return `g${this.data.entries.length + 1}-${this.txCounter}`;
  }

  private tx(ms: readonly Mutation[], by: Author, meta: TxMeta): Transaction {
    return transaction({
      id: meta.tx ?? this.nextTx(), label: meta.label ?? (by === 'agent' ? `agent ${meta.tx ?? ''}`.trim() : 'edit'), by,
      source: meta.source ?? { kind: by }, ...(meta.batch !== undefined ? { batch: meta.batch } : {}), mutations: ms,
    });
  }

  private append(tx: Transaction, why?: string): LogEntry {
    const e: LogEntry = { seq: this.data.entries.length + 1, frame: this.data.frame, tx, ts: this.now(), ...(why !== undefined ? { why } : {}) };
    this.data.entries.push(e);
    return e;
  }

  private pushUnit(seq: number): void {
    this.data.units.length = this.data.cursor; // drop the redo tail; its entries stay in the journal
    this.data.units.push(seq);
    this.data.cursor = this.data.units.length;
    this.invalidate();
  }

  /**
   * Applies mutations as one transaction (a gesture, an edit). On any failure nothing is appended and the error is
   * thrown. Clears the preview.
   */
  apply(ms: readonly Mutation[], by: Exclude<Author, 'agent'>, label: string, meta: TxMeta = {}): LogEntry & { warnings: readonly Diagnostic[] } {
    if ((by as Author) === 'agent') fail('E_READONLY', 'agent transactions enter through propose()');
    const r = applyTransaction(this.committed, this.tx(ms, by, { ...meta, label }), DOCUMENT_RULES);
    const e = this.append(r.tx);
    this.overlay = null;
    this.pushUnit(e.seq);
    this.emit({ type: 'apply', entry: e });
    return { ...e, warnings: r.warnings };
  }

  /** Agent transactions. read-only: E_READONLY; ask: pending; auto: applied at once. */
  propose(ms: readonly Mutation[], meta: TxMeta & { tx: string }): LogEntry {
    if (this.modeValue === 'read-only') fail('E_READONLY', 'the agent is read-only for this frame', { hint: 'the photographer can switch the agent to ask mode' });
    const r = applyTransaction(this.committed, this.tx(ms, 'agent', meta), DOCUMENT_RULES);
    if (this.modeValue === 'ask') {
      const e = this.append({ ...r.tx, status: 'pending' }, meta.why);
      this.emit({ type: 'propose', entry: e });
      return e;
    }
    const e = this.append(r.tx, meta.why);
    this.pushUnit(e.seq);
    this.emit({ type: 'apply', entry: e });
    return e;
  }

  pending(): LogEntry[] {
    return this.data.entries.filter((e) => e.tx.status === 'pending');
  }

  private select(which: EntrySelector): number[] {
    if (Array.isArray(which)) return [...(which as readonly number[])].sort((a, b) => a - b);
    const b = (which as { batch: string }).batch;
    return this.data.entries.filter((e) => e.tx.status === 'pending' && e.tx.batch === b).map((e) => e.seq);
  }

  /**
   * Approves pending transactions, in order. Each is re-applied on the current document; when its inverses differ
   * from the proposal's it is stale (E_STALE) unless `force`. On any problem nothing is applied.
   */
  approve(which: EntrySelector, opts: { force?: boolean } = {}): LogEntry[] | Diagnostic[] {
    const seqs = this.select(which);
    if (seqs.length === 0) return [diag('E_MUTATION', 'nothing pending to approve')];
    const diags: Diagnostic[] = [];
    let d = this.committed;
    const applied: Transaction[] = [];
    for (const s of seqs) {
      const e = this.data.entries[s - 1];
      if (!e || e.tx.status !== 'pending') {
        diags.push(diag('E_MUTATION', `entry ${s} is not pending`));
        continue;
      }
      try {
        const r = applyTransaction(d, { ...e.tx, inverses: [] }, DOCUMENT_RULES);
        if (!opts.force && canonicalJSON(r.tx.inverses) !== canonicalJSON(e.tx.inverses)) {
          diags.push(diag('E_STALE', `transaction ${e.tx.id} is stale: the document changed under it since the proposal`, { hint: 'apply anyway (force) or reject' }));
          continue;
        }
        d = r.doc;
        applied.push(r.tx);
      } catch (err) {
        if (isChromobenchError(err)) diags.push(err.diag as Diagnostic);
        else throw err;
      }
    }
    if (diags.length) return diags;
    const out = seqs.map((s, i) => {
      const e = this.data.entries[s - 1]!;
      e.tx = applied[i]!;
      e.approvedBy = 'user';
      this.pushUnit(s);
      return e;
    });
    this.emit({ type: 'approve', entries: out });
    return out;
  }

  reject(which: EntrySelector): void {
    const seqs = this.select(which);
    for (const s of seqs) {
      const e = this.data.entries[s - 1];
      if (e && e.tx.status === 'pending') e.tx = { ...e.tx, status: 'rejected' };
    }
    this.emit({ type: 'reject', seqs });
  }

  undo(): boolean {
    if (!this.canUndo()) return false;
    this.data.cursor -= 1;
    this.invalidate();
    this.emit({ type: 'undo', cursor: this.data.cursor });
    return true;
  }

  redo(): boolean {
    if (!this.canRedo()) return false;
    this.data.cursor += 1;
    this.invalidate();
    this.emit({ type: 'redo', cursor: this.data.cursor });
    return true;
  }

  /** Transient overlay for drags: applied last by `state`, never logged, never hashed; null or [] clears. */
  preview(ms: readonly Mutation[] | null): void {
    const list = ms === null ? [] : [...ms];
    if (list.length) applyTransaction(this.committed, transaction({ id: 'preview', label: 'preview', by: 'user', mutations: list }), DOCUMENT_RULES);
    this.overlay = list.length ? list : null;
    this.stateCache = null;
    this.emit({ type: 'preview', mutations: list });
  }

  /** In-effect mutations that wrote `path`, an ancestor or a descendant (paths are id-anchored); the initial value first. */
  why(path: string): WhyEntry[] {
    const doc = this.committed;
    let canon = path;
    try {
      canon = canonicalPath(doc, path);
    } catch {
      // a path that no longer resolves still matches what wrote it
    }
    const out: WhyEntry[] = [{ seq: 0, by: this.data.initialBy, ts: this.data.initialTs, op: 'frame.add', path: canon, value: getPath(this.data.initial, path) }];
    const related = (p: string): boolean => p === canon || canon.startsWith(`${p}.`) || p.startsWith(`${canon}.`);
    for (const e of this.inEffect()) {
      for (const m of e.tx.mutations) {
        const p = m.op === 'set' ? m.path : m.op === 'insert' ? `${m.id}` : m.id;
        if (!related(p)) continue;
        const value = m.op === 'set' ? m.value : m.op === 'insert' ? m.item : null;
        out.push({ seq: e.seq, by: e.tx.by, tx: e.tx.id, ts: e.ts, op: m.op, path: p, value, ...(e.approvedBy ? { approvedBy: e.approvedBy } : {}) });
      }
    }
    return out;
  }
}
