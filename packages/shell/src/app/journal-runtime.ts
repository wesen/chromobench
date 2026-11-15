// The runtime's capture layer of the diagnostics journal (CHB-038): what a running program does, in the journal.
// A runtime started with `services.journal` (a Journal) records, until it is disposed:
//
//   command   every command run (its id, its arguments summarised)
//   store     every log entry committed (its label, author, the document), undo and redo, refusals;
//   agent     the agent's entries (proposals, approvals)
//   ui        the runtime's own diagnostics (a handler threw, a lambda threw, a refused transaction, …)
//   engine    renders (debug: viewport, pass, size, ms) and render errors
import type { LogEntry } from '@chromobench/values';
import { errorText, type Journal } from '../core/journal.ts';
import type { Diag } from '../core/diag.ts';
import type { WriteInfo } from '../core/store/types.ts';
import type { Runtime } from './runtime.ts';

/** the log entries a journal has seen, across the runtimes of one page (a layout switch adopts the log) */
const SEEN = new WeakMap<Journal, WeakSet<LogEntry>>();

const LEVEL: Record<Diag['level'], 'error' | 'warn' | 'info'> = { error: 'error', warning: 'warn', info: 'info' };

/** Starts recording a runtime into the journal; returns the stop function (the runtime calls it on dispose). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function journalRuntime(rt: Runtime<any>, journal: Journal): () => void {
  let seen = SEEN.get(journal);
  if (!seen) SEEN.set(journal, (seen = new WeakSet()));
  const known = seen;
  for (const e of rt.store.log.entries) known.add(e);
  const stops: (() => void)[] = [];
  stops.push(
    rt.diagnostics.on((d) => {
      if (!d.runtime) return;
      journal.add({ level: LEVEL[d.level], source: 'ui', code: d.code, message: d.message, ...(d.facts?.length ? { data: { facts: d.facts, ...(d.at ? { at: `${d.at.file}:${d.at.line}` } : {}) } } : {}) });
    }),
    rt.on('command', (id: string, args: unknown[]) => void journal.info('command', id, args.length ? { data: { args } } : {})),
    rt.on('rendered', (e: { viewport: string; ms: number; w: number; h: number; pass: string }) =>
      void journal.debug('engine', `rendered ${e.pass} in ${e.viewport}`, { data: { ms: Math.round(e.ms), size: `${e.w}×${e.h}` } }),
    ),
    rt.on('renderError', (e: { viewport: string; error: unknown }) => {
      const code = (e.error as { code?: unknown })?.code;
      journal.error('engine', `render failed in ${e.viewport}: ${errorText(e.error)}`, { ...(typeof code === 'string' ? { code } : {}), data: { error: e.error } });
    }),
    rt.store.on((_paths: unknown, info: WriteInfo) => {
      if (info.tier !== 'document' || info.preview) return;
      const fresh = rt.store.log.entries.filter((e) => !known.has(e));
      for (const e of fresh) known.add(e);
      if (info.undo || info.redo) {
        journal.info('store', `${info.undo ? 'Undo' : 'Redo'}${info.label ? ` ${info.label}` : ''}`);
        return;
      }
      // a frame restored from its save replays its steps: one row, not one per step
      if (typeof info.label === 'string' && info.label.startsWith('Restore ')) {
        if (fresh.length) journal.info('store', info.label, { data: { steps: fresh.length } });
        return;
      }
      for (const e of fresh) {
        const agent = e.tx.by === 'agent' || e.approvedBy === 'agent';
        const what = e.tx.status === 'pending' ? `Proposed: ${e.tx.label}` : e.tx.status === 'rejected' ? `Rejected: ${e.tx.label}` : e.approvedBy ? `Approved: ${e.tx.label}` : e.tx.label;
        journal.info(agent || e.tx.status !== 'applied' ? 'agent' : 'store', what, {
          frame: e.doc,
          data: { seq: e.seq, by: e.tx.by, status: e.tx.status, mutations: e.tx.mutations.length, ...(e.tx.batch ? { batch: e.tx.batch } : {}), ...(e.why ? { why: e.why } : {}) },
        });
      }
    }),
    rt.store.onRefused((e) => void journal.warn('store', `Refused: ${e.label}`, { code: (e.cause2 as { code?: string })?.code ?? 'REFUSED', data: { docs: e.docs, cause: e.cause2 } })),
  );
  return () => {
    for (const f of stops.splice(0)) f();
  };
}
