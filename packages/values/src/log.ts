// The document log (design §26): one history for every document a session edits. It replaces the shell store's
// patch history and the contract's EditLog. The log is an immutable value: every operation returns a new log.
//
//   documents  opened with their initial state and a kind (the kind names the rules: the contract's DOCUMENT_RULES
//              for a frame); the current state of each is the fold of its applied entries up to the cursor.
//   journal    entries in sequence order: a transaction addressed to one document, applied, pending or rejected,
//              with when, the author's reason and who approved it.
//   steps      what one undo reverts: the entries of one commit or one approval — one edit, or a batch across
//              several documents (one look over a roll). steps[0, cursor) are in effect.
//
// A commit after undo drops the steps that could have been redone (their entries leave the journal). Proposals are
// checked when proposed and stored pending with the inverses they had then; approving re-applies them and refuses
// a proposal whose recomputed inverses differ (E_STALE): what it would undo is no longer what its author saw. A
// batch is approved, rejected and undone as one. Undo and redo apply stored inverses and mutations exactly (the
// states they return to were valid when they were current), so they never fail and never skip.
import { fail } from './errors.ts';
import { diff } from './diff.ts';
import { document, getPath } from './doc.ts';
import { deepFreeze, equal, type JsonObject } from './json.ts';
import { applyMutation, set, type Mutation, type Validator } from './mutations.ts';
import {
  applyTransaction, invertTransaction, transaction, type Author, type Transaction, type TransactionInit, type TxOptions,
} from './transactions.ts';

/** The log's serialised format. */
export const LOG_VERSION = 1 as const;

/** Rules by document kind: the transaction options a document's commits are checked with. */
export type Rules = Readonly<Record<string, TxOptions<unknown, never>>>;

/** One transaction addressed to one document. */
export interface Edit {
  /** the document's id in the log */
  readonly doc: string;
  readonly tx: Transaction;
}

/** A document the batch builder left alone, and why (the rules refused its transaction, or the builder threw). */
export interface Skipped {
  readonly doc: string;
  readonly error: unknown;
}

/** One operation over several documents (a look over a roll, a sync, an agent's plan): committed or proposed as one. */
export interface Batch {
  readonly id: string;
  readonly label: string;
  readonly by: Author;
  readonly source: JsonObject;
  /** every transaction carries batch = id, this label and this author */
  readonly edits: readonly Edit[];
  readonly skipped: readonly Skipped[];
}

export interface LogEntry {
  /** journal position, from 1, never reused */
  readonly seq: number;
  readonly doc: string;
  /** status applied, pending or rejected; mutations in normal form; inverses as applied (pending: as proposed) */
  readonly tx: Transaction;
  readonly at: number;
  /** the author's one-line reason (an agent's proposal) */
  readonly why?: string;
  readonly approvedBy?: Author;
}

/** What one undo reverts. */
export interface Step {
  readonly seqs: readonly number[];
  readonly label: string;
  readonly batch?: string;
}

/** Who set a value, and from where. seq 0 is the document's opening. */
export interface Why {
  readonly seq: number;
  readonly doc: string;
  readonly by: Author;
  readonly source: JsonObject;
  readonly label: string;
  readonly tx?: string;
  readonly at: number;
  readonly approvedBy?: Author;
  /** the value at the path after this entry */
  readonly value: unknown;
}

export interface OpenOptions {
  /** names the rules (default 'plain': structure only) */
  kind?: string;
  /** who made the initial state (default 'auto': ingest) */
  by?: Author;
  source?: JsonObject;
}

interface DocRecord {
  readonly kind: string;
  readonly by: Author;
  readonly source: JsonObject;
  readonly at: number;
  readonly initial: object;
}

export interface LogData {
  readonly version: typeof LOG_VERSION;
  readonly docs: Readonly<Record<string, DocRecord>>;
  readonly entries: readonly LogEntry[];
  readonly steps: readonly Step[];
  readonly cursor: number;
  /** the next sequence number */
  readonly next: number;
}

export interface LogOptions {
  rules?: Rules;
  /** stamps entries (default Date.now) */
  now?: () => number;
}

/** Which pending entries approve and reject act on. An entry of a batch stands for its whole batch. */
export type Selector = number | readonly number[] | { readonly batch: string };

/** A target of the batch builder: a document, its id and (from a log) its rules. */
export interface Target<D extends object = object> {
  readonly doc: string;
  readonly value: D;
  readonly rules?: TxOptions<unknown, never>;
}

interface State {
  readonly opts: Required<LogOptions>;
  readonly docs: ReadonlyMap<string, DocRecord>;
  readonly values: ReadonlyMap<string, object>;
  readonly entries: readonly LogEntry[];
  readonly steps: readonly Step[];
  readonly cursor: number;
  readonly next: number;
}

const NO_RULES: TxOptions = Object.freeze({});
const isBatch = (x: Edit | Batch): x is Batch => Array.isArray((x as Batch).edits);
const freeze = <T>(x: T): T => deepFreeze<unknown>(x) as T;

export class Log {
  readonly #s: State;

  private constructor(s: State) {
    this.#s = s;
  }

  static create(opts: LogOptions = {}): Log {
    return new Log({ opts: { rules: opts.rules ?? {}, now: opts.now ?? Date.now }, docs: new Map(), values: new Map(), entries: [], steps: [], cursor: 0, next: 1 });
  }

  /**
   * A log from its serialised form. Every document is replayed from its initial state through the steps in effect,
   * and every stored mutation and inverse is checked against the replay (E_DOCUMENT when they disagree).
   */
  static load(data: LogData, opts: LogOptions = {}): Log {
    if ((data as { version?: unknown })?.version !== LOG_VERSION) {
      fail('E_DOCUMENT', `log version ${String((data as { version?: unknown })?.version)} is not ${LOG_VERSION}`, { hint: 'logs are not migrated' });
    }
    const docs = new Map<string, DocRecord>();
    const values = new Map<string, object>();
    for (const [id, r] of Object.entries(data.docs)) {
      const rec = freeze({ kind: r.kind, by: r.by, source: r.source, at: r.at, initial: document(structuredClone(r.initial)) });
      docs.set(id, rec);
      values.set(id, rec.initial);
    }
    const entries = freeze(structuredClone(data.entries) as LogEntry[]);
    const bySeq = new Map(entries.map((e) => [e.seq, e]));
    if (bySeq.size !== entries.length) fail('E_DOCUMENT', 'log: two entries share a sequence number');
    const steps = freeze(structuredClone(data.steps) as Step[]);
    if (!Number.isInteger(data.cursor) || data.cursor < 0 || data.cursor > steps.length) fail('E_DOCUMENT', `log: cursor ${data.cursor} is outside 0…${steps.length}`);
    const inSteps = new Set<number>();
    for (const [i, st] of steps.entries()) {
      for (const seq of st.seqs) {
        const e = bySeq.get(seq);
        if (!e || e.tx.status !== 'applied' || inSteps.has(seq)) fail('E_DOCUMENT', `log: step ${i} names entry ${seq}, which is not an applied entry of its own`);
        if (!docs.has(e.doc)) fail('E_DOCUMENT', `log: entry ${seq} edits "${e.doc}", which the log does not hold`);
        inSteps.add(seq);
        if (i >= data.cursor) continue;
        const r = applyTransaction(values.get(e.doc)!, { ...e.tx, inverses: [] });
        if (!equal(r.tx.mutations, e.tx.mutations) || !equal(r.tx.inverses, e.tx.inverses)) {
          fail('E_DOCUMENT', `log: entry ${seq} does not replay as stored (its document differs from the one it was applied to)`);
        }
        values.set(e.doc, r.doc);
      }
    }
    for (const e of entries) if (e.tx.status === 'applied' && !inSteps.has(e.seq)) fail('E_DOCUMENT', `log: applied entry ${e.seq} is in no step`);
    const next = Math.max(data.next, ...entries.map((e) => e.seq + 1), 1);
    return new Log({ opts: { rules: opts.rules ?? {}, now: opts.now ?? Date.now }, docs, values, entries, steps, cursor: data.cursor, next });
  }

  #with(patch: Partial<State>): Log {
    return new Log({ ...this.#s, ...patch });
  }

  // ── documents ──

  /** The document ids, in the order they were opened. */
  ids(): string[] {
    return [...this.#s.docs.keys()];
  }
  has(id: string): boolean {
    return this.#s.docs.has(id);
  }
  /** The current state of a document. */
  doc<D extends object = object>(id: string): D {
    return (this.#s.values.get(id) ?? fail('E_DOCUMENT', `the log holds no document "${id}"`, { valid: this.ids() })) as D;
  }
  initial<D extends object = object>(id: string): D {
    return this.#rec(id).initial as D;
  }
  kind(id: string): string {
    return this.#rec(id).kind;
  }
  #rec(id: string): DocRecord {
    return this.#s.docs.get(id) ?? fail('E_DOCUMENT', `the log holds no document "${id}"`, { valid: this.ids() });
  }
  #rules(id: string): TxOptions {
    const kind = this.#rec(id).kind;
    if (kind === 'plain') return NO_RULES;
    return (this.#s.opts.rules[kind] as TxOptions | undefined) ?? fail('E_DOCUMENT', `no rules for documents of kind "${kind}"`, { valid: ['plain', ...Object.keys(this.#s.opts.rules)] });
  }

  /** Add a document. Its state now is its initial state; opening is not a step (it cannot be undone). */
  open(id: string, doc: object, o: OpenOptions = {}): Log {
    if (this.#s.docs.has(id)) fail('E_DOCUMENT', `the log already holds a document "${id}"`);
    const kind = o.kind ?? 'plain';
    if (kind !== 'plain' && !this.#s.opts.rules[kind]) fail('E_DOCUMENT', `no rules for documents of kind "${kind}"`, { valid: ['plain', ...Object.keys(this.#s.opts.rules)] });
    const initial = document(doc);
    const rec: DocRecord = freeze({ kind, by: o.by ?? 'auto', source: o.source ?? {}, at: this.#s.opts.now(), initial });
    return this.#with({ docs: new Map(this.#s.docs).set(id, rec), values: new Map(this.#s.values).set(id, initial) });
  }

  /**
   * Add the top-level fields of `fields` that a document lacks, to its initial state and to its state now. Not a
   * step (nothing to undo; the fields were not there to change). A program that declares more state than the one
   * that made the log adopts the log this way: View ▸ Layout from a layout without the roll kit to one with it
   * (CHB-037 P9). Fields the document has, now or initially, stay as they are.
   */
  withFields(id: string, fields: object): Log {
    const rec = this.#rec(id);
    const now = this.#s.values.get(id) as Record<string, unknown>;
    const add = Object.entries(fields).filter(([k, v]) => v !== undefined && !(k in now) && !(k in rec.initial));
    if (!add.length) return this;
    const extra = Object.fromEntries(add);
    const initial = document({ ...extra, ...rec.initial });
    const value = document({ ...extra, ...now });
    return this.#with({ docs: new Map(this.#s.docs).set(id, freeze({ ...rec, initial })), values: new Map(this.#s.values).set(id, value) });
  }

  /** Remove a document with its entries; steps left empty go (the other documents' history is untouched). */
  close(id: string): Log {
    this.#rec(id);
    const docs = new Map(this.#s.docs);
    docs.delete(id);
    const values = new Map(this.#s.values);
    values.delete(id);
    const mine = new Set(this.#s.entries.filter((e) => e.doc === id).map((e) => e.seq));
    let cursor = 0;
    const steps: Step[] = [];
    this.#s.steps.forEach((st, i) => {
      const seqs = st.seqs.filter((s) => !mine.has(s));
      if (!seqs.length) return;
      steps.push(seqs.length === st.seqs.length ? st : freeze({ ...st, seqs }));
      if (i < this.#s.cursor) cursor++;
    });
    return this.#with({ docs, values, entries: this.#s.entries.filter((e) => !mine.has(e.seq)), steps, cursor });
  }

  /** The documents as batch-builder targets, with their rules (default: every document). */
  targets<D extends object = object>(ids: readonly string[] = this.ids()): Target<D>[] {
    return ids.map((doc) => ({ doc, value: this.doc<D>(doc), rules: this.#rules(doc) }));
  }

  /** A draft of a document: preview without logging; commit its net change with log.commit(draft.edit(…)). */
  draft<D extends object = object>(id: string): Draft<D> {
    return Draft.of(id, this.doc<D>(id), this.#rules(id).validate as Validator<unknown, D> | undefined);
  }

  // ── the journal ──

  /** Every entry, in sequence order. */
  get entries(): readonly LogEntry[] {
    return this.#s.entries;
  }
  entry(seq: number): LogEntry | undefined {
    const es = this.#s.entries;
    let lo = 0;
    let hi = es.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = es[mid]!.seq;
      if (s === seq) return es[mid];
      if (s < seq) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }
  /** The newest entry of the journal. */
  get last(): LogEntry | undefined {
    return this.#s.entries.at(-1);
  }
  get steps(): readonly Step[] {
    return this.#s.steps;
  }
  get cursor(): number {
    return this.#s.cursor;
  }
  /** The applied entries in effect, in the order they were applied (optionally of one document). */
  inEffect(doc?: string): LogEntry[] {
    const out: LogEntry[] = [];
    for (const st of this.#s.steps.slice(0, this.#s.cursor)) for (const s of st.seqs) out.push(this.entry(s)!);
    return doc === undefined ? out : out.filter((e) => e.doc === doc);
  }
  pending(doc?: string): LogEntry[] {
    return this.#s.entries.filter((e) => e.tx.status === 'pending' && (doc === undefined || e.doc === doc));
  }
  get canUndo(): boolean {
    return this.#s.cursor > 0;
  }
  get canRedo(): boolean {
    return this.#s.cursor < this.#s.steps.length;
  }
  /** The step undo would revert. */
  get undoStep(): Step | null {
    return this.#s.steps[this.#s.cursor - 1] ?? null;
  }
  /** The step redo would apply again. */
  get redoStep(): Step | null {
    return this.#s.steps[this.#s.cursor] ?? null;
  }
  /** The documents a step changes. */
  docsOf(step: Step): string[] {
    return [...new Set(step.seqs.map((s) => this.entry(s)!.doc))];
  }

  // ── edits ──

  #applyAll(edits: readonly Edit[], values: Map<string, object>): Transaction[] {
    return edits.map((e) => {
      const r = applyTransaction(values.get(e.doc) ?? this.doc(e.doc), e.tx, this.#rules(e.doc));
      values.set(e.doc, r.doc);
      return r.tx;
    });
  }

  /** Entries of the redo tail leave the journal; the new step goes on at the cursor. */
  #pushStep(step: Step, entries: readonly LogEntry[], values: ReadonlyMap<string, object>): Log {
    const dropped = new Set(this.#s.steps.slice(this.#s.cursor).flatMap((st) => st.seqs));
    const steps = [...this.#s.steps.slice(0, this.#s.cursor), freeze(step)];
    return this.#with({ entries: entries.filter((e) => !dropped.has(e.seq)), steps, cursor: steps.length, values });
  }

  /**
   * Apply an edit or a batch as one step (all or nothing across its documents). Throws what the rules throw. A
   * transaction without mutations is no edit; nothing to commit returns this log.
   * `merge`: fold it into the newest step as the net change, when that step is at the cursor and changes the same
   * documents once each (nudges of one control); a net change of nothing removes the step.
   * `why`: the author's one-line reason, kept on the entries as a proposal keeps it (an agent's edit in auto mode).
   */
  commit(x: Edit | Batch, o: { merge?: boolean; why?: string } = {}): Log {
    const edits = (isBatch(x) ? x.edits : [x]).filter((e) => e.tx.mutations.length > 0);
    if (!edits.length) return this;
    if (isBatch(x)) for (const e of edits) if (e.tx.batch !== x.id) fail('E_MUTATION', `transaction ${e.tx.id} is not in batch ${x.id}`);
    const values = new Map(this.#s.values);
    const applied = this.#applyAll(edits, values);
    const label = isBatch(x) ? x.label : edits[0]!.tx.label;
    const batch = isBatch(x) ? x.id : edits[0]!.tx.batch;
    if (o.merge) {
      const merged = this.#merge(edits, values, label);
      if (merged) return merged;
    }
    const at = this.#s.opts.now();
    const added = applied.map((tx, i) => freeze<LogEntry>({ seq: this.#s.next + i, doc: edits[i]!.doc, tx, at, ...(o.why === undefined ? {} : { why: o.why }) }));
    const step: Step = { seqs: added.map((e) => e.seq), label, ...(batch === undefined ? {} : { batch }) };
    return this.#pushStep(step, [...this.#s.entries, ...added], values).#with({ next: this.#s.next + added.length });
  }

  #merge(edits: readonly Edit[], after: ReadonlyMap<string, object>, label: string): Log | null {
    const st = this.undoStep;
    if (!st || this.canRedo) return null;
    const old = st.seqs.map((s) => this.entry(s)!);
    const docs = edits.map((e) => e.doc);
    if (new Set(docs).size !== docs.length || old.length !== docs.length || !old.every((e) => docs.includes(e.doc))) return null;
    const values = new Map(this.#s.values);
    const at = this.#s.opts.now();
    const replaced = new Map<number, LogEntry>();
    for (const e of old) {
      const before = applyTransaction(this.doc(e.doc), invertTransaction(e.tx)).doc;
      const mutations = diff(before, after.get(e.doc)!);
      const r = applyTransaction(before, { ...e.tx, label, mutations, inverses: [] }, this.#rules(e.doc));
      values.set(e.doc, r.doc);
      if (mutations.length) replaced.set(e.seq, freeze({ ...e, tx: r.tx, at }));
    }
    const steps = this.#s.steps.slice(0, -1);
    if (!replaced.size) {
      const gone = new Set(st.seqs);
      return this.#with({ values, steps, cursor: steps.length, entries: this.#s.entries.filter((e) => !gone.has(e.seq)) });
    }
    const kept = st.seqs.filter((s) => replaced.has(s));
    const gone = new Set(st.seqs.filter((s) => !replaced.has(s)));
    const entries = this.#s.entries.filter((e) => !gone.has(e.seq)).map((e) => replaced.get(e.seq) ?? e);
    steps.push(freeze({ ...st, seqs: kept, label }));
    return this.#with({ values, steps, cursor: steps.length, entries });
  }

  /**
   * Record an edit or a batch as pending (an agent's proposal in ask mode). It is checked now, on the current
   * documents, and stored with the inverses it has now; the documents do not change.
   */
  propose(x: Edit | Batch, o: { why?: string } = {}): Log {
    const edits = (isBatch(x) ? x.edits : [x]).filter((e) => e.tx.mutations.length > 0);
    if (!edits.length) return this;
    if (isBatch(x)) for (const e of edits) if (e.tx.batch !== x.id) fail('E_MUTATION', `transaction ${e.tx.id} is not in batch ${x.id}`);
    const checked = this.#applyAll(edits, new Map(this.#s.values));
    const at = this.#s.opts.now();
    const added = checked.map((tx, i) => freeze<LogEntry>({
      seq: this.#s.next + i, doc: edits[i]!.doc, tx: { ...tx, status: 'pending' }, at, ...(o.why === undefined ? {} : { why: o.why }),
    }));
    return this.#with({ entries: [...this.#s.entries, ...added], next: this.#s.next + added.length });
  }

  #select(sel: Selector): LogEntry[] {
    const seqs = typeof sel === 'number' ? [sel] : Array.isArray(sel) ? (sel as readonly number[]) : null;
    const batches = new Set<string>();
    const picked = new Set<number>();
    if (seqs) {
      for (const s of seqs) {
        const e = this.entry(s);
        if (!e) fail('E_MUTATION', `the log has no entry ${s}`);
        if (e.tx.status !== 'pending') fail('E_MUTATION', `entry ${s} is ${e.tx.status}, not pending`);
        picked.add(s);
        if (e.tx.batch !== undefined) batches.add(e.tx.batch);
      }
    } else batches.add((sel as { batch: string }).batch);
    for (const e of this.#s.entries) if (e.tx.status === 'pending' && e.tx.batch !== undefined && batches.has(e.tx.batch)) picked.add(e.seq);
    if (!picked.size) fail('E_MUTATION', 'nothing pending to select');
    return this.#s.entries.filter((e) => picked.has(e.seq));
  }

  /**
   * Apply pending entries as one step, in sequence order. Each is applied again on the current document; when its
   * inverses differ from those it was proposed with it is stale and nothing is applied (E_STALE), unless `force`.
   */
  approve(sel: Selector, o: { by?: Author; force?: boolean } = {}): Log {
    const picked = this.#select(sel);
    const values = new Map(this.#s.values);
    const done = new Map<number, LogEntry>();
    for (const e of picked) {
      const r = applyTransaction(values.get(e.doc) ?? this.doc(e.doc), { ...e.tx, inverses: [] }, this.#rules(e.doc));
      if (!o.force && !equal(r.tx.inverses, e.tx.inverses)) {
        fail('E_STALE', `transaction ${e.tx.id} (entry ${e.seq}) is stale: "${e.doc}" changed under it since it was proposed`, { hint: 'reject it, or approve with force' });
      }
      values.set(e.doc, r.doc);
      done.set(e.seq, freeze({ ...e, tx: r.tx, approvedBy: o.by ?? 'user' }));
    }
    const first = picked[0]!;
    const step: Step = { seqs: picked.map((e) => e.seq), label: first.tx.label, ...(first.tx.batch === undefined ? {} : { batch: first.tx.batch }) };
    return this.#pushStep(step, this.#s.entries.map((e) => done.get(e.seq) ?? e), values);
  }

  /** Mark pending entries rejected (they stay in the journal). */
  reject(sel: Selector): Log {
    const picked = new Set(this.#select(sel).map((e) => e.seq));
    return this.#with({ entries: this.#s.entries.map((e) => (picked.has(e.seq) ? freeze({ ...e, tx: { ...e.tx, status: 'rejected' as const } }) : e)) });
  }

  /** Revert the step before the cursor (nothing to undo: this log). */
  undo(): Log {
    const st = this.undoStep;
    if (!st) return this;
    const values = new Map(this.#s.values);
    for (const s of [...st.seqs].reverse()) {
      const e = this.entry(s)!;
      values.set(e.doc, applyTransaction(values.get(e.doc)!, invertTransaction(e.tx)).doc);
    }
    return this.#with({ values, cursor: this.#s.cursor - 1 });
  }

  /** Apply the step at the cursor again (nothing to redo: this log). */
  redo(): Log {
    const st = this.redoStep;
    if (!st) return this;
    const values = new Map(this.#s.values);
    for (const s of st.seqs) {
      const e = this.entry(s)!;
      values.set(e.doc, applyTransaction(values.get(e.doc)!, e.tx).doc);
    }
    return this.#with({ values, cursor: this.#s.cursor + 1 });
  }

  // ── provenance ──

  /** Every entry in effect that changed the value at `path` of a document, the opening first. */
  trail(doc: string, path: string): Why[] {
    const rec = this.#rec(doc);
    let d = rec.initial;
    const out: Why[] = [{ seq: 0, doc, by: rec.by, source: rec.source, label: 'open', at: rec.at, value: getPath(d, path) }];
    for (const e of this.inEffect(doc)) {
      const next = applyTransaction(d, e.tx).doc;
      const value = getPath(next, path);
      if (!equal(value, getPath(d, path))) {
        out.push({
          seq: e.seq, doc, by: e.tx.by, source: e.tx.source, label: e.tx.label, tx: e.tx.id, at: e.at, value,
          ...(e.approvedBy === undefined ? {} : { approvedBy: e.approvedBy }),
        });
      }
      d = next;
    }
    return out;
  }

  /** Who set the value at `path` last, and from where (the opening when no entry in effect changed it). */
  why(doc: string, path: string): Why {
    return this.trail(doc, path).at(-1)!;
  }

  // ── serialisation ──

  toJSON(): LogData {
    return {
      version: LOG_VERSION,
      docs: Object.fromEntries(this.#s.docs),
      entries: this.#s.entries,
      steps: this.#s.steps,
      cursor: this.#s.cursor,
      next: this.#s.next,
    };
  }
}

/**
 * A draft of one document (design §26: gestures preview without logging and commit one transaction): the state a
 * viewer renders while a slider moves, and, on release, the net change from where it started as one edit.
 */
export class Draft<D extends object = object> {
  /** the document's id */
  readonly doc: string;
  /** the document when the draft started */
  readonly base: D;
  /** the document with the draft's changes */
  readonly value: D;
  readonly #validate: Validator<unknown, D> | undefined;
  #net: Mutation[] | null = null;

  private constructor(doc: string, base: D, value: D, validate: Validator<unknown, D> | undefined) {
    this.doc = doc;
    this.base = base;
    this.value = value;
    this.#validate = validate;
  }

  /** A draft of a document outside a log (validate: the per-mutation rule, if any). */
  static of<D extends object>(doc: string, base: D, validate?: Validator<unknown, D>): Draft<D> {
    return new Draft(doc, base, base, validate);
  }

  /** Apply mutations to the draft (each checked; the per-mutation rule of the document's kind applies). */
  apply(...ms: Mutation[]): Draft<D> {
    let d = this.value;
    for (const m of ms) d = applyMutation(d, m, this.#validate ? { validate: this.#validate } : {}).doc;
    return new Draft(this.doc, this.base, d, this.#validate);
  }
  set(path: string, value: unknown): Draft<D> {
    return this.apply(set(path, value));
  }
  /** Replace the draft's document by any function of it (checked when the net change is taken). */
  update(f: (d: D) => D): Draft<D> {
    return new Draft(this.doc, this.base, f(this.value), this.#validate);
  }
  /** Back to where it started. */
  reset(): Draft<D> {
    return new Draft(this.doc, this.base, this.base, this.#validate);
  }
  /** The net change from base to value, in normal form. */
  mutations(): readonly Mutation[] {
    this.#net ??= freeze(diff(this.base, this.value));
    return this.#net;
  }
  get changed(): boolean {
    return this.value !== this.base && this.mutations().length > 0;
  }
  /** The net change as one edit of the document. */
  edit(meta: Omit<TransactionInit, 'mutations' | 'by'> & { by?: Author }): Edit {
    return freeze({ doc: this.doc, tx: transaction({ ...meta, by: meta.by ?? 'user', mutations: this.mutations() }) });
  }
}
