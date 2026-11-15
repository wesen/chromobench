// Capture layers of the diagnostics journal (CHB-038) for what every page has: the console and the uncaught errors.
// Each takes the object it watches as an argument (headless code touches no globals) and returns a stop function.
//
//   captureConsole(journal, console);      // console.error / console.warn into the journal; the console still shows them
//   captureErrors(journal, window);        // 'error' and 'unhandledrejection' events
import { errorText, type Journal, type JournalLevel, type JournalSource, type JournalRow } from './journal.ts';

type ConsoleLike = { error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; info?: (...a: unknown[]) => void; log?: (...a: unknown[]) => void; debug?: (...a: unknown[]) => void };

/** The source a console message most likely comes from (the words it uses), else 'app'. */
export function guessSource(text: string): JournalSource {
  if (/webgpu|gpudevice|gpu adapter|wgsl|\[(compute|render)pipeline|\[texture|\[buffer|\[bindgroup/i.test(text)) return 'gpu';
  if (/worker/i.test(text)) return 'worker';
  if (/libraw|decode/i.test(text)) return 'decode';
  if (/service ?worker/i.test(text)) return 'sw';
  return 'app';
}

const argText = (a: unknown): string => {
  if (typeof a === 'string') return a;
  if (a instanceof Error || (a && typeof a === 'object' && 'message' in a)) return errorText(a);
  try {
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
};

/**
 * Wraps console.error and console.warn: each call becomes a journal event (the originals are still called), and the
 * journal's own events are mirrored to the original methods (journal.mirror), so the browser's console shows what
 * the journal records without the journal recording its own echo.
 */
export function captureConsole(journal: Journal, con: ConsoleLike): () => void {
  const orig = { error: con.error, warn: con.warn };
  let inside = false;
  const wrap = (level: JournalLevel, f: (...a: unknown[]) => void) =>
    function (this: unknown, ...a: unknown[]): void {
      if (!inside) {
        inside = true;
        try {
          const message = a.map(argText).join(' ');
          const err = a.find((x) => x instanceof Error);
          journal.add({ level, source: guessSource(message), message, ...(err ? { data: err } : a.length > 1 ? { data: a.slice(1) } : {}) }, { mirror: false });
        } finally {
          inside = false;
        }
      }
      f.apply(this ?? con, a);
    };
  con.error = wrap('error', orig.error);
  con.warn = wrap('warn', orig.warn);
  const mirrorWas = journal.mirror;
  journal.mirror = (r: JournalRow) => {
    const line = `[${r.source}${r.code ? ` ${r.code}` : ''}]${r.count > 1 ? ` ×${r.count}` : ''} ${r.message}`;
    if (r.level === 'error') orig.error.call(con, line, ...(r.data !== undefined ? [r.data] : []));
    else if (r.level === 'warn') orig.warn.call(con, line, ...(r.data !== undefined ? [r.data] : []));
    else (r.level === 'debug' ? (con.debug ?? con.log) : (con.info ?? con.log))?.call(con, line, ...(r.data !== undefined ? [r.data] : []));
  };
  return () => {
    con.error = orig.error;
    con.warn = orig.warn;
    journal.mirror = mirrorWas;
  };
}

type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Uncaught errors and unhandled promise rejections of a window (or a worker's global scope). */
export function captureErrors(journal: Journal, target: Listenable, o: { source?: JournalSource } = {}): () => void {
  const onError = (e: { message?: string; error?: unknown; filename?: string; lineno?: number; colno?: number }): void => {
    const message = e.error !== undefined ? errorText(e.error) : (e.message ?? 'error');
    journal.error(o.source ?? guessSource(message), `Uncaught: ${message}`, {
      code: 'UNCAUGHT',
      data: { ...(e.error !== undefined ? { error: e.error } : {}), ...(e.filename ? { at: `${e.filename}:${e.lineno ?? 0}:${e.colno ?? 0}` } : {}) },
    });
  };
  const onRejection = (e: { reason?: unknown }): void => {
    const message = errorText(e.reason);
    journal.error(o.source ?? guessSource(message), `Unhandled rejection: ${message}`, { code: 'UNHANDLED_REJECTION', data: { reason: e.reason } });
  };
  target.addEventListener('error', onError as unknown as EventListener);
  target.addEventListener('unhandledrejection', onRejection as unknown as EventListener);
  return () => {
    target.removeEventListener('error', onError as unknown as EventListener);
    target.removeEventListener('unhandledrejection', onRejection as unknown as EventListener);
  };
}
