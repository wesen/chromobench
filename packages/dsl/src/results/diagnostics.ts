// Guest errors → Diagnostics, with lines mapped back to the agent's code (guide §5.9 "where an
// error points"). The agent's code is wrapped as `(async function () {\n…\n})` in `eval-N.js`, so
// agent line L is source line L + 1.
import type { Diagnostic } from '@chromobench/contract';

export interface GuestError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  hint?: string;
  fix?: string;
  valid?: string[];
  path?: string;
}

const SANDBOX_NAMES = new Set(['fetch', 'require', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'process', 'window', 'document', 'localStorage', 'indexedDB', 'navigator', 'Deno', 'Bun', 'self', 'module', 'exports']);
const TIMER_NAMES = new Set(['setTimeout', 'setInterval', 'setImmediate', 'requestAnimationFrame', 'queueMicrotask', 'clearTimeout', 'clearInterval']);
export const SANDBOX_HINT = 'the DSL has no network, files, modules or timers; reach frames with cb.frame(id) and numbers with h.measure.*';

export interface Located {
  eval: number;
  line: number;
  col?: number;
}

/** The innermost agent frame of a QuickJS stack ("at f (eval-3.js:4:14)"). */
export function locate(stack: string | undefined): Located | null {
  const m = /eval-(\d+)\.js:(\d+)(?::(\d+))?/.exec(stack ?? '');
  if (!m) return null;
  return { eval: Number(m[1]), line: Number(m[2]) - 1, ...(m[3] ? { col: Number(m[3]) } : {}) };
}

export function toDiagnostic(e: GuestError, evalN: number, topLevelNames: ReadonlySet<string>): Diagnostic {
  const loc = locate(e.stack);
  const where = loc ? { where: { line: loc.line, ...(loc.col !== undefined ? { col: loc.col } : {}) } } : {};
  const older = loc && loc.eval !== evalN ? ` (in code from eval ${loc.eval}, line ${loc.line})` : '';
  if (e.code && /^[A-Z][A-Z_]+$/.test(e.code)) {
    return {
      code: e.code, message: e.message + older, ...where,
      ...(e.path !== undefined ? { path: e.path } : {}), ...(e.hint !== undefined ? { hint: e.hint } : {}),
      ...(e.fix !== undefined ? { fix: e.fix } : {}), ...(e.valid !== undefined ? { valid: e.valid } : {}),
    };
  }
  if (e.name === 'InternalError' && /interrupted/.test(e.message)) {
    return { code: 'E_TIMEOUT', message: 'the eval ran past its deadline and was interrupted', hint: 'mem is intact; split the work or measure less per eval', ...where };
  }
  if (/out of memory/.test(e.message)) {
    return { code: 'E_MEMORY', message: 'the eval exceeded the sandbox memory limit', hint: 'build fewer values in JS; measurements return compact numbers', ...where };
  }
  if (/could not load module/i.test(e.message)) {
    return { code: 'E_SANDBOX', message: `modules cannot be loaded: ${e.message}`, hint: SANDBOX_HINT, ...where };
  }
  if (e.name === 'ReferenceError') {
    const m = /'?([A-Za-z_$][\w$]*)'? is not defined/.exec(e.message);
    const name = m?.[1] ?? '';
    if (SANDBOX_NAMES.has(name)) return { code: 'E_SANDBOX', message: `${name} does not exist in the DSL`, hint: SANDBOX_HINT, ...where };
    if (TIMER_NAMES.has(name)) return { code: 'ReferenceError', message: e.message + older, hint: 'there are no timers; `await` waits only on measurements', ...where };
    if (topLevelNames.has(name)) {
      return { code: 'ReferenceError', message: e.message + older, hint: 'top-level const/let do not survive between evals; keep values on mem', fix: `mem.${name}`, ...where };
    }
    return { code: 'ReferenceError', message: e.message + older, hint: 'keep values between evals on mem; the globals are cb, frame, units, mem and console', ...where };
  }
  return { code: e.name || 'Error', message: e.message + older, ...where };
}

/** Top-level `const`/`let`/`function` names of an eval's code (for the mem hint). */
export function topLevelNames(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/^(?:const|let|var|function|async function)\s+([A-Za-z_$][\w$]*)/gm)) out.push(m[1]!);
  return out;
}
