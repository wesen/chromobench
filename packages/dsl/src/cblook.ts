// Looks written as code (*.cblook.js; design §31, CHB-037 P7): a look function by the photographer or the agent,
// evaluated in its own QuickJS sandbox, never in the page. The file calls `defineLook({...})` once with the same
// fields as the contract's LookDef — name, version, label, group, doc, params (ArgSpecs), stages, kinds — and a
// `fn(params, input)` that returns `{ stacks: { <stage>: { order, items } }, masks? }` of plain entries. The sandbox
// has no clock, no randomness and no host calls, so the function is pure; it runs under a time and memory limit at
// every compile that expands its link, like a built-in look. Registered in the contract by name and version, a
// document stores only `{ look, version }`.
//
//   await defineLookSource(`defineLook({ name: 'my-warm', version: 1, label: 'My warm', group: 'Mine', doc: '',
//     params: { w: { type: 'number', unit: 'point', min: 0, max: 10, default: 4, doc: 'warmth' } }, stages: ['darkroom'],
//     fn: (p) => ({ stacks: { darkroom: { order: ['f'], items: { f: { kind: 'layer', op: 'filter', … } } } } }) })`)
import { Coll, isPlainObject, type Json } from '@chromobench/values';
import { allLooks, ChromobenchError, defineLook, diag, STAGE_NAMES, type LookDef, type LookOutput, type StageName } from '@chromobench/contract';
import type { QuickJSWASMModule } from 'quickjs-emscripten-core';
import { loadQuickJS } from './session.ts';

export interface LookSourceOptions {
  /** the file name, for errors */
  file?: string;
  /** per call of the look function (default 200 ms) */
  timeoutMs?: number;
  /** of the sandbox (default 16 MB) */
  memoryBytes?: number;
  /** a look already registered under the same name and version: refuse it (default) or keep the registered one */
  existing?: 'fail' | 'keep';
}

const SETUP = `
'use strict';
delete globalThis.Date;
Math.random = () => { throw new Error('a look function is pure: Math.random is not available'); };
let __look = null;
globalThis.defineLook = (def) => {
  if (__look) throw new Error('a .cblook.js file defines one look');
  if (!def || typeof def !== 'object' || typeof def.fn !== 'function') throw new Error('defineLook({ name, version, label, params, stages, fn })');
  __look = def;
};
globalThis.__meta = () => { const { fn, ...rest } = __look ?? {}; return JSON.stringify(rest); };
globalThis.__call = (s) => { const a = JSON.parse(s); return JSON.stringify(__look.fn(a.params, a.input)); };
`;

const fail = (message: string, file: string): never => {
  throw new ChromobenchError(diag('E_LINK', `${file}: ${message}`));
};

/** Evaluates a look file in a sandbox of its own and registers its look function (name and version). */
export async function defineLookSource(src: string, o: LookSourceOptions = {}): Promise<LookDef> {
  return defineLookWith(await loadQuickJS(), src, o);
}

/**
 * defineLookSource on a loaded QuickJS module (synchronous: the DSL's cb.looks.define). With `existing: 'keep'` a look
 * already registered under the same name and version is returned instead of refused (the page registering a look the
 * agent's sandbox, in the same realm, registered first).
 */
export function defineLookWith(QJS: QuickJSWASMModule, src: string, o: LookSourceOptions = {}): LookDef {
  const file = o.file ?? 'look.cblook.js';
  const rt = QJS.newRuntime({ memoryLimitBytes: o.memoryBytes ?? 16 * 1024 * 1024, maxStackSizeBytes: 512 * 1024 });
  let deadline = Infinity;
  rt.setInterruptHandler(() => Date.now() > deadline);
  const vm = rt.newContext();
  const run = (code: string, name: string): void => {
    const r = vm.evalCode(code, name);
    if (r.error) {
      const e = vm.dump(r.error);
      r.error.dispose();
      fail(String((e as { message?: string })?.message ?? e), file);
    }
    (r as { value: { dispose(): void } }).value.dispose();
  };
  run(SETUP, 'setup.js');
  deadline = Date.now() + (o.timeoutMs ?? 200) * 5;
  run(src, file);
  deadline = Infinity;
  const call = (fn: string, arg?: string): string => {
    const f = vm.getProp(vm.global, fn);
    const a = arg !== undefined ? vm.newString(arg) : undefined;
    deadline = Date.now() + (o.timeoutMs ?? 200);
    const r = a ? vm.callFunction(f, vm.undefined, a) : vm.callFunction(f, vm.undefined);
    deadline = Infinity;
    f.dispose();
    a?.dispose();
    if (r.error) {
      const e = vm.dump(r.error);
      r.error.dispose();
      return fail(String((e as { message?: string })?.message ?? e), file);
    }
    const s = vm.getString(r.value);
    r.value.dispose();
    return s;
  };
  const meta = JSON.parse(call('__meta')) as Partial<LookDef>;
  if (typeof meta.name !== 'string' || typeof meta.version !== 'number') fail('defineLook needs a name and a version', file);
  const stages = (meta.stages ?? []) as StageName[];
  if (o.existing === 'keep') {
    const had = allLooks().find((l) => l.name === meta.name && l.version === meta.version);
    if (had) return had;
  }
  return defineLook({
    name: meta.name!, version: meta.version!, label: meta.label ?? meta.name!, group: meta.group ?? 'Mine', doc: meta.doc ?? '',
    params: meta.params ?? {}, stages, ...(meta.kinds ? { kinds: meta.kinds } : {}),
    fn: (params, input) => {
      const out = JSON.parse(call('__call', JSON.stringify({ params, input: { kind: input.kind, facts: input.facts as Json, doc: input.doc as unknown as Json, size: input.size } }))) as LookOutput;
      if (!isPlainObject(out) || !isPlainObject(out.stacks)) fail('the look function returns { stacks: { <stage>: { order, items } } }', file);
      for (const [s, c] of Object.entries(out.stacks)) {
        if (!STAGE_NAMES.includes(s as StageName) || !stages.includes(s as StageName)) fail(`the look gives entries for ${s}, which it does not declare in stages`, file);
        const p = Coll.problem(c);
        if (p) fail(`stacks.${s}: ${p}`, file);
      }
      if (out.masks !== undefined && Coll.problem(out.masks)) fail(`masks: ${Coll.problem(out.masks)}`, file);
      return out;
    },
  });
}
