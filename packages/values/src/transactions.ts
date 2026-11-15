// Transactions (design §26): a list of mutations with their inverses, a label, an author, a source, an optional
// batch id and a status. A transaction applies atomically: every mutation in order, or none (documents are
// immutable, so a failure simply returns nothing). The applied transaction holds the mutations in normal form and
// `inverses[i]`, the exact inverse of `mutations[i]`; undo applies the inverses from the last to the first.
import { fail } from './errors.ts';
import type { JsonObject } from './json.ts';
import { applyMutation, type ApplyOptions, type Mutation } from './mutations.ts';

export type Author = 'user' | 'agent' | 'auto';
export type TxStatus = 'applied' | 'pending' | 'rejected';

export interface Transaction {
  readonly id: string;
  readonly label: string;
  readonly by: Author;
  /** where it came from: `{ kind: 'gesture', control: … }`, `{ kind: 'look', name, version }`, an agent turn… */
  readonly source: JsonObject;
  /** a cross-document operation it belongs to (one look over a roll): the same id in every document's log */
  readonly batch?: string;
  readonly status: TxStatus;
  readonly mutations: readonly Mutation[];
  /** inverses[i] undoes mutations[i]; empty until the transaction is applied */
  readonly inverses: readonly Mutation[];
}

export interface TransactionInit {
  id: string;
  label: string;
  by: Author;
  source?: JsonObject;
  batch?: string;
  status?: TxStatus;
  mutations: readonly Mutation[];
}

/** A new transaction (pending, no inverses yet). */
export function transaction(init: TransactionInit): Transaction {
  return Object.freeze({
    id: init.id,
    label: init.label,
    by: init.by,
    source: init.source ?? {},
    ...(init.batch === undefined ? {} : { batch: init.batch }),
    status: init.status ?? 'pending',
    mutations: Object.freeze(init.mutations.slice()),
    inverses: Object.freeze([]),
  });
}

export interface TxOptions<W = unknown, D extends object = object> extends ApplyOptions<W, D> {
  /** checked once on the final document (rules a transaction may break in between: "exactly one main") */
  validateTransaction?: (c: { before: D; after: D; tx: Transaction }) => readonly W[] | void;
}

export interface TxApplied<D extends object, W = unknown> {
  readonly doc: D;
  /** status 'applied', mutations in normal form, inverses filled */
  readonly tx: Transaction;
  readonly warnings: readonly W[];
}

export type TxResult<D extends object, W = unknown> =
  | ({ readonly ok: true } & TxApplied<D, W>)
  /** index: the failing mutation (mutations.length when validateTransaction refused) */
  | { readonly ok: false; readonly error: unknown; readonly index: number };

/** Apply a transaction atomically. Throws the first error (the document is untouched: nothing is returned). */
export function applyTransaction<D extends object, W = unknown>(doc: D, tx: Transaction, opts: TxOptions<W, D> = {}): TxApplied<D, W> {
  const r = tryTransaction(doc, tx, opts);
  if (!r.ok) throw r.error;
  return r;
}

/** Apply a transaction atomically, reporting a failure instead of throwing it. */
export function tryTransaction<D extends object, W = unknown>(doc: D, tx: Transaction, opts: TxOptions<W, D> = {}): TxResult<D, W> {
  let cur = doc;
  const mutations: Mutation[] = [];
  const inverses: Mutation[] = [];
  const warnings: W[] = [];
  let i = 0;
  try {
    for (; i < tx.mutations.length; i++) {
      const a = applyMutation(cur, tx.mutations[i]!, opts);
      cur = a.doc;
      mutations.push(a.mutation);
      inverses.push(a.inverse);
      warnings.push(...a.warnings);
    }
    const applied: Transaction = Object.freeze({ ...tx, status: 'applied' as const, mutations: Object.freeze(mutations), inverses: Object.freeze(inverses) });
    const w = opts.validateTransaction?.({ before: doc, after: cur, tx: applied });
    if (w) warnings.push(...w);
    return { ok: true, doc: cur, tx: applied, warnings };
  } catch (error) {
    return { ok: false, error, index: i };
  }
}

/**
 * The transaction that undoes an applied one: the inverses from last to first, whose own inverses are the original
 * mutations. Pending; id, label, author and source default to the original's (id `undo:<id>`).
 */
export function invertTransaction(tx: Transaction, init: Partial<Omit<TransactionInit, 'mutations'>> = {}): Transaction {
  if (tx.inverses.length !== tx.mutations.length) {
    fail('E_MUTATION', `transaction ${tx.id} has no inverses: apply it first`);
  }
  return Object.freeze({
    id: init.id ?? `undo:${tx.id}`,
    label: init.label ?? tx.label,
    by: init.by ?? tx.by,
    source: init.source ?? tx.source,
    ...((init.batch ?? tx.batch) === undefined ? {} : { batch: (init.batch ?? tx.batch)! }),
    status: init.status ?? 'pending',
    mutations: Object.freeze(tx.inverses.slice().reverse()),
    inverses: Object.freeze(tx.mutations.slice().reverse()),
  });
}

/** Undo an applied transaction on the document it produced. */
export function revertTransaction<D extends object, W = unknown>(doc: D, tx: Transaction, opts: TxOptions<W, D> = {}): TxApplied<D, W> {
  return applyTransaction(doc, invertTransaction(tx), opts);
}
