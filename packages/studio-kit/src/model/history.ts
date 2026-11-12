// Moved from apps/studio/src/core/history.ts (CHB-009) for CHB-019 (the original was deleted in the apps/studio migration).
// History (guide §5.8): a view of the frame's edit log. Applied units in order with the undo cursor,
// pending agent transactions, rejected entries, and labels in darkroom words from the registry.
import { applyMutation, canonicalJSON, getPath, type Author, type EditLog, type FrameRecipe, type LoggedMutation, type Mutation, type Provenance } from '@chromobench/contract';
import type { ControlModel } from './controls.ts';
import { formatSeconds, formatStops } from './units.ts';

export interface Change {
  seq: number;
  text: string;
}

export interface HistoryGroup {
  tx: string;
  index: number;
  by: Author;
  ts: number;
  label: string;
  changes: Change[];
  inEffect: boolean;
  approved: boolean;
}

export interface PendingGroup {
  tx: string;
  why?: string;
  /** the cross-frame batch the entries belong to (LoggedMutation.batch, contract 0.3) */
  batch?: string;
  seqs: number[];
  changes: Change[];
}

export const WHO: Record<Author, string> = { user: 'You', agent: 'Agent', auto: 'Auto' };

export type ModelLookup = (path: string) => ControlModel | undefined;

/** Finds the control model for a path, including exposure fields and probes. */
export function lookupFor(models: readonly ControlModel[]): ModelLookup {
  const by = new Map(models.map((m) => [m.path, m]));
  return (p) => by.get(p);
}

function short(v: unknown): string {
  const s = canonicalJSON(v);
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
}

/** One line for a mutation: "Yellow 52.5 → 62.5 CC", "Printer lights (0, 0, 0) → (+2, −4, +2) pt". */
export function describe(m: Mutation, before: FrameRecipe, lookup: ModelLookup): string {
  switch (m.op) {
    case 'set': {
      const model = lookup(m.path);
      const old = getPath(before, m.path);
      if (model) {
        const a = model.format(old);
        const b = model.format(m.value);
        const ma = /^(.*) (\S+)$/.exec(a);
        const mb = /^(.*) (\S+)$/.exec(b);
        // a shared unit is written once (Time 10.0 → 12.6 s); names (Kodak Portra Endura) are not units
        const numeric = model.type !== 'string' && model.type !== 'enum';
        const text = numeric && ma && mb && ma[2] === mb[2] ? `${model.label} ${ma[1]} → ${b}` : `${model.label} ${a} → ${b}`;
        const aside = model.aside && model.storageUnit === 's' ? ` (${formatStops(Math.log2((m.value as number) / (old as number)))} st)` : '';
        return text + aside;
      }
      const ex = /^print\.exposures\.([^.]+)\.(\w+)$/.exec(m.path);
      if (ex) {
        if (ex[2] === 'time_s' && typeof m.value === 'number') return `Exposure ${ex[1]} time → ${formatSeconds(m.value)} s`;
        if (ex[2] === 'stops' && typeof m.value === 'number') return `Exposure ${ex[1]} ${formatStops(m.value)} st`;
        return `Exposure ${ex[1]} ${ex[2]} → ${short(m.value)}`;
      }
      if (m.path.startsWith('probes.')) return `Probe ${m.path.slice(7)} at ${short(m.value)}`;
      return `${m.path} ${short(old)} → ${short(m.value)}`;
    }
    case 'exposure.add': return `Add ${m.exposure.kind} ${m.exposure.id}`;
    case 'exposure.remove': return `Remove exposure ${m.id}`;
    case 'mask.set': return `Mask ${m.id} (${m.mask.nodes.length} nodes)`;
    case 'frame.add': return 'Frame added';
  }
}

/** Applied units (in effect and the redo tail) with labels, oldest first. */
export function historyGroups(log: EditLog, lookup: ModelLookup): HistoryGroup[] {
  const data = log.toJSON();
  let r = data.initial;
  const out: HistoryGroup[] = [];
  data.units.forEach((u, index) => {
    const changes: Change[] = [];
    let by: Author = 'user';
    let ts = 0;
    let approved = false;
    for (const seq of u.seqs) {
      const e = data.entries[seq - 1]!;
      by = e.by;
      ts = e.ts;
      approved ||= e.approvedBy === 'user';
      changes.push({ seq, text: describe(e.m, r, lookup) });
      try {
        r = applyMutation(r, e.m).recipe;
      } catch {
        // an entry that no longer applies (beyond the cursor after a branch) is shown, not folded
      }
    }
    out.push({ tx: u.tx, index, by, ts, label: u.label, changes, inEffect: index < data.cursor, approved });
  });
  return out;
}

/** Pending agent entries grouped by transaction, described against the committed state. */
export function pendingGroups(log: EditLog, lookup: ModelLookup): PendingGroup[] {
  const by = new Map<string, LoggedMutation[]>();
  for (const e of log.pending()) by.set(e.tx ?? '', [...(by.get(e.tx ?? '') ?? []), e]);
  return [...by].map(([tx, es]) => ({
    tx,
    ...(es[0]?.why ? { why: es[0].why } : {}),
    ...(es[0]?.batch ? { batch: es[0].batch } : {}),
    seqs: es.map((e) => e.seq),
    changes: es.map((e) => ({ seq: e.seq, text: describe(e.m, log.committed, lookup) })),
  }));
}

export function rejectedEntries(log: EditLog, lookup: ModelLookup): (Change & { tx: string })[] {
  return log.entries.filter((e) => e.status === 'rejected').map((e) => ({ seq: e.seq, tx: e.tx ?? '', text: describe(e.m, log.committed, lookup) }));
}

/** Moves the undo cursor to `target` (several undos or redos at once). */
export function moveCursor(log: EditLog, target: number): void {
  while (log.cursor > target && log.undo());
  while (log.cursor < target && log.redo());
}

/** "Why is Yellow 62.5 CC?" rows from why(path), plus pending proposals on the path. */
export interface WhyRow { when: string; who: string; text: string; note: string }

export function whyRows(log: EditLog, path: string, lookup: ModelLookup): { title: string; rows: WhyRow[]; now: string } {
  const model = lookup(path);
  const fmt = (v: unknown): string => (model ? model.format(v) : short(v));
  const time = (ts: number): string => new Date(ts).toTimeString().slice(0, 5);
  const prov: Provenance[] = log.why(path);
  const rows: WhyRow[] = [];
  let prev: unknown;
  for (const p of prov) {
    if (p.seq === 0) {
      rows.push({ when: 'default', who: WHO[p.by], text: fmt(p.value), note: 'frame.add' });
    } else {
      const v = p.path === path ? p.value : getPath(log.committed, path);
      rows.push({ when: time(p.ts), who: WHO[p.by], text: `${fmt(prev)} → ${fmt(v)}`, note: `${p.tx ? `tx ${p.tx}` : ''}${p.approvedBy ? ' · approved' : ''}` });
    }
    prev = p.seq === 0 ? p.value : p.path === path ? p.value : prev;
  }
  for (const e of log.pending()) {
    if (e.m.op === 'set' && e.m.path === path) rows.push({ when: time(e.ts), who: WHO[e.by], text: `${fmt(getPath(log.committed, path))} → ${fmt(e.m.value)}`, note: `tx ${e.tx ?? ''} · pending` });
  }
  return { title: `Why is ${model?.label ?? path} ${fmt(getPath(log.committed, path))}?`, rows, now: fmt(getPath(log.committed, path)) };
}
