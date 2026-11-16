// A frame's saved edit (CHB-037; replaces the saved EditLog): its document as it was opened, the transactions in
// effect in order, and the pending proposals. Saved under the frame's key (source SHA-256, mode, place on a strip)
// whenever its part of the log changes; on open the document is opened with the saved initial state and the
// transactions are committed again in order (each its own step, under the contract's rules), then the proposals are
// proposed again. So the History, `why` and Undo reach edits made before a reload.
//
// Hard cut-off (design D8): data saved by an earlier studio (EditLogs of recipes) is not read. The first start of
// this version clears the stores that held it, once, and says so (resetStorage).
import { transaction, type Author, type JsonObject, type Log, type Mutation, type Transaction } from '@chromobench/values';
import type { Document } from '@chromobench/contract';
import type { KV, KvStore } from './kv.ts';

export const FRAME_SAVE_FORMAT = 'chromobench-frame' as const;
export const FRAME_SAVE_VERSION = 3;

export interface SavedTx {
  id: string;
  label: string;
  by: Author;
  source: JsonObject;
  batch?: string;
  mutations: readonly Mutation[];
}

export interface FrameSave {
  format: typeof FRAME_SAVE_FORMAT;
  version: typeof FRAME_SAVE_VERSION;
  /** the document as the frame was opened (its first print) */
  initial: Document;
  /** the transactions in effect, oldest first */
  applied: SavedTx[];
  /** proposals waiting for approval */
  pending: (SavedTx & { why?: string })[];
}

const plainTx = (t: Transaction): SavedTx => ({
  id: t.id, label: t.label, by: t.by, source: t.source, ...(t.batch !== undefined ? { batch: t.batch } : {}), mutations: t.mutations,
});

/** What the log holds for one frame, as a save record. */
export function frameSave(log: Log, f: string): FrameSave {
  return {
    format: FRAME_SAVE_FORMAT,
    version: FRAME_SAVE_VERSION,
    initial: log.initial<Document>(f),
    applied: log.inEffect(f).map((e) => plainTx(e.tx)),
    pending: log.pending(f).map((e) => ({ ...plainTx(e.tx), ...(e.why !== undefined ? { why: e.why } : {}) })),
  };
}

export const isFrameSave = (x: unknown): x is FrameSave =>
  !!x && typeof x === 'object' && (x as FrameSave).format === FRAME_SAVE_FORMAT && (x as FrameSave).version === FRAME_SAVE_VERSION;

/** A saved transaction as a new transaction for the log (commit or propose it again). */
export const txOf = (s: SavedTx): Transaction =>
  transaction({ id: s.id, label: s.label, by: s.by, source: s.source, ...(s.batch !== undefined ? { batch: s.batch } : {}), mutations: s.mutations });

/**
 * Reopens a saved frame in a log: opens the initial document, commits the applied transactions one step each and
 * proposes the pending ones again. Throws (and the caller opens the frame fresh) when any of them no longer applies.
 */
export function restoreFrame(log: Log, f: string, s: FrameSave, o: { kind?: string } = {}): Log {
  return replayFrame(log.open(f, s.initial, { kind: o.kind ?? 'frame', by: 'auto', source: { kind: 'restore' } }), f, s);
}

/** The saved transactions of a frame whose document is open with its saved initial state: committed and proposed again. */
export function replayFrame(log: Log, f: string, s: FrameSave): Log {
  let next = log;
  for (const t of s.applied) next = next.commit({ doc: f, tx: txOf(t) });
  for (const p of s.pending) next = next.propose({ doc: f, tx: txOf(p) }, p.why !== undefined ? { why: p.why } : {});
  return next;
}

/**
 * The format of the studio's stored data; bumped when a hard cut-off makes older data unreadable. 4 (CHB-047, contract
 * 2.0): documents' output.export has size and quality instead of scale. 5 (CHB-048, contract 3.0): a camera file's
 * white balance lost its mode, so saved edits of the earlier format no longer validate.
 */
export const STORAGE_FORMAT = 5;
/** The stores that held data in the older formats (EditLogs of recipes, the workspace with recipes in it). */
const OLD_STORES: readonly KvStore[] = ['logs', 'workspace', 'snapshots', 'frames', 'rolls'];
export const STORAGE_RESET_MESSAGE =
  'The studio changed how it stores edits. The edits saved by the earlier version could not be carried over and were cleared: open your files again to print them.';

/**
 * The hard cut-off on storage: when the KV holds data of an earlier format, the stores that held it are cleared,
 * once. Returns true when something was cleared (the host says so, with STORAGE_RESET_MESSAGE).
 */
export async function resetStorage(kv: KV): Promise<boolean> {
  const fmt = await kv.get<number>('settings', 'storage-format').catch(() => undefined);
  if (fmt === STORAGE_FORMAT) return false;
  let had = false;
  for (const s of OLD_STORES) {
    const keys = await kv.keys(s).catch(() => [] as string[]);
    if (keys.length) had = true;
    for (const k of keys) await kv.delete(s, k).catch(() => undefined);
  }
  await kv.put('settings', 'storage-format', STORAGE_FORMAT);
  return had;
}
