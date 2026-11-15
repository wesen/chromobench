// The one batch builder (design §26, §27): looks, rolls, sync and the agent all make their cross-document edits with
// `plan(targets, (doc) => transaction)`. Every transaction of the batch carries its id, label and author, so the
// log approves, rejects and undoes it as one. With rules on a target (log.targets(ids) supplies them), a
// transaction the rules refuse is not an edit of the batch but a `skipped` entry with the reason, and so is a target
// whose builder threw; a builder returning null or no mutations leaves its document alone.
import { fail } from './errors.ts';
import { deepFreeze, type JsonObject } from './json.ts';
import type { Batch, Edit, Skipped, Target } from './log.ts';
import type { Mutation } from './mutations.ts';
import { transaction, tryTransaction, type Author, type Transaction } from './transactions.ts';

export interface PlanMeta {
  /** the batch id (the same in every document's log entries) */
  id: string;
  label: string;
  by: Author;
  source?: JsonObject;
}

/** What a builder returns for one document: a transaction, its mutations, or nothing to do. */
export type Planned = Transaction | readonly Mutation[] | null | undefined;

const isTransaction = (x: Planned): x is Transaction => !!x && !Array.isArray(x) && Array.isArray((x as Transaction).mutations);

export function plan<D extends object>(targets: Iterable<Target<D>>, build: (value: D, doc: string) => Planned, meta: PlanMeta): Batch {
  const source = meta.source ?? {};
  const edits: Edit[] = [];
  const skipped: Skipped[] = [];
  for (const t of targets) {
    let out: Planned;
    try {
      out = build(t.value, t.doc);
    } catch (error) {
      skipped.push({ doc: t.doc, error });
      continue;
    }
    if (isTransaction(out) && out.by !== meta.by) fail('E_MUTATION', `plan ${meta.id}: the transaction for "${t.doc}" is by ${out.by}, the batch by ${meta.by}`);
    const mutations = isTransaction(out) ? out.mutations : out ?? [];
    if (!mutations.length) continue;
    const tx = transaction({
      id: isTransaction(out) ? out.id : `${meta.id}:${t.doc}`,
      label: meta.label,
      by: meta.by,
      source: isTransaction(out) ? out.source : source,
      batch: meta.id,
      mutations,
    });
    if (t.rules) {
      const r = tryTransaction<object>(t.value, tx, t.rules as never);
      if (!r.ok) {
        skipped.push({ doc: t.doc, error: r.error });
        continue;
      }
    }
    edits.push({ doc: t.doc, tx });
  }
  return deepFreeze<unknown>({ id: meta.id, label: meta.label, by: meta.by, source, edits, skipped: Object.freeze(skipped) }) as Batch;
}
