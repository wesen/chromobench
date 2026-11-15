// The agent's one door into the document log (design §26, plan P6a). The DSL reads documents from a values `Log`
// (the studio store's `rt.store.log`, or a log of its own in tests and transports) and submits the edits of an eval
// as one Submission: one frame's transaction as an Edit, several frames (or a named look) as a Batch from
// plan(…, { by: 'agent' }). The photographer's mode decides what the log does with it: ask → propose (pending until
// approved), auto → commit (one undo step), read-only → refused (E_READONLY). The log itself knows no modes.
//
// A submission carries, per document, the inverses its transaction had on the document the eval read. When the
// document changed under the eval (the photographer moved a slider while the agent measured), recomputing them on
// the current document gives different inverses: the agent worked from a stale view, so even in auto mode its edit
// waits for approval (stale) instead of overwriting the photographer's change.
import { fail, type AgentMode } from '@chromobench/contract';
import { equal, tryTransaction, type Batch, type Edit, type Log, type LogEntry, type Mutation } from '@chromobench/values';

/** The edits of one eval, as the session hands them to the host. Plain JSON (it crosses the worker boundary). */
export interface Submission {
  /** one frame: an edit; several frames or a named look: a batch from plan(…, { by: 'agent' }) */
  readonly x: Edit | Batch;
  /** the agent's reasons, joined */
  readonly why?: string;
  /** per document: the inverses of its transaction on the document the eval read */
  readonly read: Readonly<Record<string, readonly Mutation[]>>;
}

export interface Submitted {
  /** the log entries the submission made (pending or applied) */
  readonly entries: readonly LogEntry[];
  readonly how: 'proposed' | 'committed';
  /** documents that changed under the eval; in auto mode their edits were proposed instead of committed */
  readonly stale: readonly string[];
}

export const isBatch = (x: Edit | Batch): x is Batch => Array.isArray((x as Batch).edits);
export const editsOf = (x: Edit | Batch): readonly Edit[] => (isBatch(x) ? x.edits : [x]);

/** Applies a submission to a log by the mode. Throws what the log throws (E_READONLY, the rules, E_MUTATION). */
export function agentSubmit(log: Log, s: Submission, mode: AgentMode): Submitted & { log: Log } {
  if (mode === 'read-only') {
    fail('E_READONLY', 'the agent is read-only: its edits were not submitted', { hint: 'describe the change instead; the photographer can switch the mode' });
  }
  const edits = editsOf(s.x);
  const targets = log.targets(edits.map((e) => e.doc));
  const stale: string[] = [];
  edits.forEach((e, i) => {
    const r = tryTransaction(targets[i]!.value, { ...e.tx, inverses: [] }, targets[i]!.rules as never);
    if (r.ok && !equal(r.tx.inverses, s.read[e.doc] ?? r.tx.inverses)) stale.push(e.doc);
  });
  const commit = mode === 'auto' && stale.length === 0;
  const before = log.entries.at(-1)?.seq ?? 0;
  const after = commit ? log.commit(s.x, s.why ? { why: s.why } : {}) : log.propose(s.x, s.why ? { why: s.why } : {});
  return { log: after, entries: after.entries.filter((e) => e.seq > before), how: commit ? 'committed' : 'proposed', stale };
}

/** What the DSL session needs of its host: the log, the mode, and the door. */
export interface DslHistory {
  /** the log as it is now (read at the start of every eval) */
  log(): Log;
  /** the photographer's setting */
  mode(): AgentMode;
  /** submits an eval's edits by the mode (agentSubmit on the host's log) */
  submit(s: Submission): Submitted;
}

/** A host that holds the log (the studio store: `{ log: () => rt.store.log, change: (f) => rt.store.change(f), mode }`). */
export interface LogHost {
  log(): Log;
  mode(): AgentMode;
  /** replaces the log by f(log); throws what f throws */
  change(f: (log: Log) => Log): void;
}

/** The DSL history of a log host: submissions go through agentSubmit inside the host's change. */
export function historyOf(h: LogHost): DslHistory {
  return {
    log: () => h.log(),
    mode: () => h.mode(),
    submit: (s) => {
      let out: Submitted | undefined;
      h.change((l) => {
        const r = agentSubmit(l, s, h.mode());
        out = { entries: r.entries, how: r.how, stale: r.stale };
        return r.log;
      });
      return out ?? { entries: [], how: 'proposed', stale: [] };
    },
  };
}

/** A log held in memory (tests, a session without a studio): the photographer's operations go through change(). */
export interface MemoryHistory extends DslHistory, LogHost {
  setMode(m: AgentMode): void;
}

export function memoryHistory(initial: Log, mode: AgentMode = 'ask'): MemoryHistory {
  let log = initial;
  let m = mode;
  const host: LogHost = { log: () => log, mode: () => m, change: (f) => void (log = f(log)) };
  return { ...historyOf(host), change: host.change, setMode: (x) => void (m = x) };
}
