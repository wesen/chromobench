// The journal across reloads (CHB-038): the tail of the journal (the last rows and every error) is kept in the
// studio's KV, so a report made after a crash or a reload includes what happened before it. Restored at start (the
// earlier sessions' rows come first), saved a second after the journal changes, and when the host flushes (the page
// is hidden or closed).
import type { Journal } from '@chromobench/shell';
import type { KV } from '../../../src/bridge/kv.ts';

/** where the tail is kept (the KV's 'settings' store) */
export const JOURNAL_KEY = 'diagnostics-journal';

export interface KeptJournal {
  /** the rows of earlier sessions restored at start */
  readonly restored: number;
  /** saves now (the page is being hidden) */
  flush(): Promise<void>;
  stop(): void;
}

/** Restores the earlier sessions' tail into the journal and keeps saving its tail. */
export async function keepJournal(journal: Journal, kv: KV, o: { delayMs?: number; tail?: number } = {}): Promise<KeptJournal> {
  const restored = journal.restore(await kv.get<unknown>('settings', JOURNAL_KEY).catch(() => undefined));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saved = -1;
  const save = async (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (journal.version === saved) return;
    saved = journal.version;
    await kv.put('settings', JOURNAL_KEY, journal.tail(o.tail ?? 500)).catch(() => undefined);
  };
  const off = journal.subscribe(() => {
    if (!timer) timer = setTimeout(() => void save(), o.delayMs ?? 1000);
  });
  // what happened before this start is saved as this session's too (a crash right after start keeps it)
  await save();
  return {
    restored,
    flush: save,
    stop: () => {
      off();
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
