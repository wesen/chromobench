// The per-frame edit log (guide §5.8; DR-5 cursor over undo units, DR-6 gestures via preview,
// DR-7 proposals carry `expect`). The recipe state is the fold of the in-effect units.
// `by` is set by whoever calls the log: the UI passes 'user', ingest 'auto'; agent mutations
// enter only through propose(), which always records 'agent'. Sandboxed code never holds an EditLog.
import { ChromobenchError, diag, fail, type Diagnostic } from './errors.ts';
import { canonicalJSON, sha256Hex, type Graph } from './graph.ts';
import { applyMutation, currentValue, mutationPaths, type Author, type LoggedMutation, type Mutation } from './mutations.ts';
import { assertRecipe, getPath, migratePathV1, migrateRecipe } from './paths.ts';
import type { FrameRecipe } from './recipe.ts';

export type AgentMode = 'read-only' | 'ask' | 'auto';

export interface UndoUnit {
  tx: string;
  seqs: number[];
  label: string;
}

/** 2 since contract 0.3 (recipe version 2); version-1 logs are migrated on load (migrateEditLogData). */
export const EDIT_LOG_VERSION = 2 as const;

export interface EditLogData {
  version: 1 | typeof EDIT_LOG_VERSION;
  frame: string;
  /** The recipe frame.add created. */
  initial: FrameRecipe;
  /** Who created the frame (frame.add), for why(). */
  initialBy: Author;
  initialTs: number;
  /** Append-only journal: applied, pending and rejected entries. Never deleted from. */
  entries: LoggedMutation[];
  /** Applied units, in order. */
  units: UndoUnit[];
  /** units[0..cursor) are in effect. */
  cursor: number;
}

export interface Provenance {
  seq: number;
  by: Author;
  tx?: string;
  ts: number;
  op: Mutation['op'];
  path: string;
  value: unknown;
  approvedBy?: 'user';
}

export type LogEvent =
  | { type: 'apply'; unit: UndoUnit }
  | { type: 'undo' | 'redo'; cursor: number }
  | { type: 'propose'; entries: LoggedMutation[] }
  | { type: 'approve'; unit: UndoUnit }
  | { type: 'reject'; seqs: number[] }
  /** `mutation` is the first of `mutations` (contract 0.2 listeners); `mutations` is the whole overlay. */
  | { type: 'preview'; mutation: Mutation | null; mutations: Mutation[] }
  | { type: 'mode'; mode: AgentMode };

export interface EditLogOptions {
  mode?: AgentMode;
  now?: () => number;
  /** Lets mask.set adopt MaskSpecs for a full check. */
  graph?: Graph;
}

/** Which pending entries approve()/reject() act on: sequence numbers, or every pending entry of a batch. */
export type EntrySelector = readonly number[] | { batch: string };

/**
 * Migrates a persisted log to the current version: a version-1 log (contracts 0.1, 0.2) gets its initial and
 * frame.add recipes migrated (migrateRecipe), its set paths moved (scan.orientation → view.frame.orientation,
 * scan.crop → view.frame.crop) and its knee values renamed ('cam16-ucs' → 'oklch', which it always was).
 */
export function migrateEditLogData(data: EditLogData): EditLogData {
  if (data.version === EDIT_LOG_VERSION) return data;
  const d = structuredClone(data) as EditLogData;
  d.initial = migrateRecipe(d.initial as unknown as Record<string, unknown>);
  for (const e of d.entries) {
    const m = e.m as { op: string; path?: string; value?: unknown; expect?: unknown; recipe?: unknown };
    if (m.op === 'frame.add' && m.recipe) m.recipe = migrateRecipe(m.recipe as Record<string, unknown>);
    if (m.op !== 'set' || typeof m.path !== 'string') continue;
    m.path = migratePathV1(m.path);
    if (/^view\.output\.(display|export)\.knee(\.method)?$/.test(m.path)) {
      for (const k of ['value', 'expect'] as const) {
        const v = m[k];
        if (v === 'cam16-ucs') m[k] = 'oklch';
        else if (v && typeof v === 'object' && (v as { method?: unknown }).method === 'cam16-ucs') m[k] = { ...(v as object), method: 'oklch' };
      }
    }
  }
  d.version = EDIT_LOG_VERSION;
  return d;
}

export interface ApproveOptions {
  /** "Apply anyway": skip the E_STALE check (the UI asks the photographer first). */
  force?: boolean;
}

export class EditLog {
  private data: EditLogData;
  private modeValue: AgentMode;
  private readonly now: () => number;
  private readonly graph: Graph | undefined;
  private overlay: Mutation[] | null = null;
  private committedCache: FrameRecipe | null = null;
  private stateCache: FrameRecipe | null = null;
  private readonly listeners = new Set<(e: LogEvent) => void>();
  private txCounter = 0;

  constructor(data: EditLogData, opts: EditLogOptions = {}) {
    // Logs persisted under contracts 0.1 / 0.2 (version 1) are migrated to version 2 first.
    const migrated = migrateEditLogData(data);
    assertRecipe(migrated.initial);
    this.data = migrated === data ? structuredClone(data) : migrated;
    this.modeValue = opts.mode ?? 'ask';
    this.now = opts.now ?? Date.now;
    this.graph = opts.graph;
  }

  /** A new log for a frame whose recipe frame.add created. */
  static create(initial: FrameRecipe, opts: EditLogOptions & { by?: Author } = {}): EditLog {
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

  get units(): readonly UndoUnit[] {
    return this.data.units;
  }

  get entries(): readonly LoggedMutation[] {
    return this.data.entries;
  }

  canUndo(): boolean {
    return this.data.cursor > 0;
  }

  canRedo(): boolean {
    return this.data.cursor < this.data.units.length;
  }

  private entry(seq: number): LoggedMutation {
    return this.data.entries[seq - 1] ?? fail('E_MUTATION', `no entry ${seq}`);
  }

  /** Entries in effect, in order. */
  inEffect(): LoggedMutation[] {
    return this.data.units.slice(0, this.data.cursor).flatMap((u) => u.seqs.map((s) => this.entry(s)));
  }

  /** fold(initial, units[0..cursor)), without the preview overlay. */
  get committed(): FrameRecipe {
    if (!this.committedCache) {
      let r = this.data.initial;
      for (const e of this.inEffect()) r = applyMutation(r, e.m).recipe;
      this.committedCache = r;
    }
    return this.committedCache;
  }

  /** The committed state with the transient preview overlay applied last (what the viewer renders). */
  get state(): FrameRecipe {
    if (!this.overlay) return this.committed;
    if (!this.stateCache) this.stateCache = this.overlay.reduce((r, m) => applyMutation(r, m).recipe, this.committed);
    return this.stateCache;
  }

  /** sha256(canonicalJSON(committed state)). The preview never changes it. */
  get stateHash(): string {
    return sha256Hex(canonicalJSON(this.committed));
  }

  /** sha256 over the in-effect mutations without timestamps. */
  get logHash(): string {
    return sha256Hex(canonicalJSON(this.inEffect().map((e) => ({ m: e.m, by: e.by, approvedBy: e.approvedBy ?? null }))));
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

  /** Validates a sequence of mutations against the current state; returns the normalised mutations. */
  private check(ms: readonly Mutation[], base: FrameRecipe): { ms: Mutation[]; warnings: Diagnostic[] } {
    let r = base;
    const out: Mutation[] = [];
    const warnings: Diagnostic[] = [];
    for (const m of ms) {
      const res = applyMutation(r, m, this.graph ? { graph: this.graph } : {});
      r = res.recipe;
      warnings.push(...res.warnings);
      out.push(m.op === 'set' ? { ...m, value: res.value } : m);
    }
    return { ms: out, warnings };
  }

  private append(m: Mutation, by: Author, status: LoggedMutation['status'], tx: string, why?: string, batch?: string): LoggedMutation {
    const e: LoggedMutation = {
      seq: this.data.entries.length + 1, frame: this.data.frame, m, by, tx, ...(batch !== undefined ? { batch } : {}), ts: this.now(), status, ...(why !== undefined ? { why } : {}),
    };
    this.data.entries.push(e);
    return e;
  }

  private pushUnit(u: UndoUnit): void {
    this.data.units.length = this.data.cursor; // drop the redo tail; its entries stay in the journal
    this.data.units.push(u);
    this.data.cursor = this.data.units.length;
    this.invalidate();
  }

  private nextTx(): string {
    this.txCounter += 1;
    return `g${this.data.entries.length + 1}-${this.txCounter}`;
  }

  /**
   * Applies mutations as one undo unit (a gesture, a transaction). Validates all first: on any
   * failure nothing is appended and the ChromobenchError is thrown. Clears the preview overlay.
   */
  apply(ms: readonly Mutation[], by: Exclude<Author, 'agent'>, label: string, opts: { tx?: string; batch?: string } = {}): UndoUnit & { warnings: Diagnostic[] } {
    if ((by as Author) === 'agent') fail('E_READONLY', 'agent mutations enter through propose()');
    const { ms: norm, warnings } = this.check(ms, this.committed);
    const tx = opts.tx ?? this.nextTx();
    const seqs = norm.map((m) => this.append(m, by, 'applied', tx, undefined, opts.batch).seq);
    const unit: UndoUnit = { tx, seqs, label };
    this.overlay = null;
    this.pushUnit(unit);
    this.emit({ type: 'apply', unit });
    return { ...unit, warnings };
  }

  /** Agent mutations. read-only: E_READONLY; ask: pending; auto: applied at once as one unit. */
  propose(ms: readonly Mutation[], meta: { tx: string; why?: string; label?: string; batch?: string }): LoggedMutation[] {
    if (this.modeValue === 'read-only') fail('E_READONLY', 'the agent is read-only for this frame', { hint: 'the photographer can switch the agent to ask mode' });
    const base = this.committed;
    const { ms: norm } = this.check(ms, base);
    let r = base;
    const withExpect = norm.map((m) => {
      const out: Mutation = m.op === 'set' ? { ...m, expect: m.expect !== undefined ? m.expect : structuredClone(currentValue(r, m.path)) } : m;
      r = applyMutation(r, m).recipe;
      return out;
    });
    if (this.modeValue === 'ask') {
      const entries = withExpect.map((m) => this.append(m, 'agent', 'pending', meta.tx, meta.why, meta.batch));
      this.emit({ type: 'propose', entries });
      return entries;
    }
    const entries = withExpect.map((m) => this.append(m, 'agent', 'applied', meta.tx, meta.why, meta.batch));
    const unit: UndoUnit = { tx: meta.tx, seqs: entries.map((e) => e.seq), label: meta.label ?? `agent ${meta.tx}` };
    this.pushUnit(unit);
    this.emit({ type: 'apply', unit });
    return entries;
  }

  pending(): LoggedMutation[] {
    return this.data.entries.filter((e) => e.status === 'pending');
  }

  /**
   * Approves pending entries as one unit. Re-validates each and compares `expect` with the current
   * value (DR-7): on any problem returns the diagnostics (E_STALE, …) and applies nothing.
   */
  approve(which: EntrySelector, opts: ApproveOptions = {}): UndoUnit | Diagnostic[] {
    const seqs = this.select(which);
    if (seqs.length === 0 && !Array.isArray(which)) return [diag('E_MUTATION', `no pending entries in batch ${(which as { batch: string }).batch}`)];
    const diags: Diagnostic[] = [];
    const entries = [...seqs].sort((a, b) => a - b).map((s) => this.data.entries[s - 1]);
    let r = this.committed;
    for (const [i, e] of entries.entries()) {
      if (!e || e.status !== 'pending') {
        diags.push(diag('E_MUTATION', `entry ${seqs[i]} is not pending`));
        continue;
      }
      if (e.m.op === 'set' && e.m.expect !== undefined && !opts.force) {
        const cur = getPath(r, e.m.path);
        if (canonicalJSON(cur) !== canonicalJSON(e.m.expect)) {
          diags.push(diag('E_STALE', `${e.m.path} changed since the proposal: expected ${canonicalJSON(e.m.expect)}, now ${canonicalJSON(cur)}`, {
            path: e.m.path, hint: 'apply anyway or reject', fix: canonicalJSON(e.m.value),
          }));
          continue;
        }
      }
      try {
        r = applyMutation(r, e.m, this.graph ? { graph: this.graph } : {}).recipe;
      } catch (err) {
        if (err instanceof ChromobenchError) diags.push(err.diag);
        else throw err;
      }
    }
    if (diags.length) return diags;
    const ok = entries as LoggedMutation[];
    for (const e of ok) {
      e.status = 'applied';
      e.approvedBy = 'user';
    }
    const unit: UndoUnit = { tx: ok[0]?.tx ?? this.nextTx(), seqs: ok.map((e) => e.seq), label: `approved ${ok[0]?.tx ?? ''}`.trim() };
    this.pushUnit(unit);
    this.emit({ type: 'approve', unit });
    return unit;
  }

  /** Sequence numbers of a selector: the given ones, or every pending entry of the batch, in order. */
  private select(which: EntrySelector): number[] {
    if (Array.isArray(which)) return [...(which as readonly number[])];
    const b = (which as { batch: string }).batch;
    return this.data.entries.filter((e) => e.status === 'pending' && e.batch === b).map((e) => e.seq);
  }

  reject(which: EntrySelector): void {
    const seqs = this.select(which);
    for (const s of seqs) {
      const e = this.data.entries[s - 1];
      if (e && e.status === 'pending') e.status = 'rejected';
    }
    this.emit({ type: 'reject', seqs: [...seqs] });
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

  /**
   * Transient overlay for drags: applied last by `state` (in order), never logged, never hashed. One mutation
   * or several (a gesture that moves two paths at once; contract 0.3); null or [] clears.
   */
  preview(m: Mutation | readonly Mutation[] | null): void {
    const ms = m === null ? [] : Array.isArray(m) ? [...(m as readonly Mutation[])] : [m as Mutation];
    ms.reduce((r, x) => applyMutation(r, x).recipe, this.committed); // validate; throws on an invalid preview
    this.overlay = ms.length ? ms : null;
    this.stateCache = null;
    this.emit({ type: 'preview', mutation: ms[0] ?? null, mutations: ms });
  }

  /** In-effect entries that wrote `path`, an ancestor or a descendant; the initial value first. */
  why(path: string): Provenance[] {
    const out: Provenance[] = [{ seq: 0, by: this.data.initialBy, ts: this.data.initialTs, op: 'frame.add', path, value: getPath(this.data.initial, path) }];
    const related = (p: string): boolean => p === '' || p === path || path.startsWith(`${p}.`) || p.startsWith(`${path}.`);
    for (const e of this.inEffect()) {
      for (const p of mutationPaths(e.m)) {
        if (!related(p)) continue;
        const value = e.m.op === 'set' ? e.m.value : e.m.op === 'frame.add' ? getPath(e.m.recipe, path) : e.m.op === 'exposure.add' ? e.m.exposure : e.m.op === 'mask.set' ? e.m.mask : null;
        out.push({ seq: e.seq, by: e.by, ...(e.tx !== undefined ? { tx: e.tx } : {}), ts: e.ts, op: e.m.op, path: p || path, value, ...(e.approvedBy ? { approvedBy: e.approvedBy } : {}) });
      }
    }
    return out;
  }

  /** why() as text, ending with the effective value. */
  formatWhy(path: string): string {
    const lines = this.why(path).map((p) => {
      const who = p.seq === 0 ? `(frame.add by ${p.by})` : `by ${p.by}${p.tx ? `  tx ${p.tx}` : ''}${p.approvedBy ? '  approved' : ''}  seq ${p.seq}`;
      return `  ${(p.seq === 0 ? 'initial' : p.op).padEnd(10)} ${canonicalJSON(p.value).padEnd(28)} ${who}`;
    });
    lines.push(`  ${'effective'.padEnd(10)} ${canonicalJSON(getPath(this.committed, path))}`);
    return `why('${path}')\n${lines.join('\n')}`;
  }
}
