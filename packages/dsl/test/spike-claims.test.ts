// Task cg16: the four claims the guide writer's diary flagged, each settled by a test.
// These run against quickjs-emscripten 0.32.0 directly, not through the DSL session, so a
// library upgrade that changes the behaviour fails here first.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newQuickJSAsyncWASMModuleFromVariant, newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten-core';
import SYNC from '@jitl/quickjs-wasmfile-release-sync';
import ASYNC from '@jitl/quickjs-wasmfile-release-asyncify';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const dumpAndDispose = (vm: QuickJSContext, h: QuickJSHandle): unknown => {
  const v = vm.dump(h);
  h.dispose();
  return v;
};

describe('cg16 claim 1: an asyncified call after an await', () => {
  it('does complete, but only after the host waits and pumps a second time', async () => {
    const QJSA = await newQuickJSAsyncWASMModuleFromVariant(ASYNC);
    const rt = QJSA.newRuntime();
    const vm = rt.newContext();
    const fn = vm.newAsyncifiedFunction('slowDouble', async (xH) => {
      const x = vm.getNumber(xH);
      await sleep(5);
      return vm.newNumber(x * 2);
    });
    vm.setProp(vm.global, 'slowDouble', fn);
    fn.dispose();
    const r = await vm.evalCodeAsync('(async function(){ await null; return slowDouble(5) })()');
    const p = vm.unwrapResult(r);
    const first = rt.executePendingJobs();
    // The first pump returns while the asyncified call is still suspended: the promise is pending
    // and the pump gives the host no signal of when the job will finish.
    expect(first.error).toBeUndefined();
    expect(vm.getPromiseState(p).type).toBe('pending');
    await sleep(50);
    rt.executePendingJobs();
    const st = vm.getPromiseState(p);
    expect(st.type).toBe('fulfilled');
    if (st.type === 'fulfilled') expect(dumpAndDispose(vm, st.value)).toBe(10);
    p.dispose();
  });
});

describe('cg16 claim 2: import() in a default sync context', () => {
  it('rejects (no module loader is installed); it does not throw synchronously', async () => {
    const QJS = await newQuickJSWASMModuleFromVariant(SYNC);
    const rt = QJS.newRuntime();
    const vm = rt.newContext();
    const r = vm.evalCode(`(() => { try { const p = import('x'); return { sync: 'no throw', isPromise: p instanceof Promise, p } } catch (e) { return { sync: 'throws ' + e.name } } })()`);
    const obj = vm.unwrapResult(r);
    const sync = vm.getProp(obj, 'sync');
    expect(dumpAndDispose(vm, sync)).toBe('no throw');
    const p = vm.getProp(obj, 'p');
    rt.executePendingJobs();
    const st = vm.getPromiseState(p);
    expect(st.type).toBe('rejected');
    if (st.type !== 'rejected') return;
    const err = dumpAndDispose(vm, st.error) as { name: string; message: string };
    expect(err.name).toMatch(/Error/);
    expect(err.message).toMatch(/x/);
    p.dispose();
    obj.dispose();
    vm.dispose();
    rt.dispose();
  });
});

describe('cg16 claim 3: the out-of-memory limit', () => {
  const alloc = 'const a=[]; for(let i=0;i<1e8;i++) a.push({i}); a.length';
  for (const mib of [32, 64]) {
    it(`a ${mib} MiB limit turns a runaway allocation into InternalError: out of memory, and the runtime disposes`, async () => {
      const QJS = await newQuickJSWASMModuleFromVariant(SYNC);
      const rt = QJS.newRuntime({ memoryLimitBytes: mib * 1024 * 1024 });
      const deadline = Date.now() + 20_000;
      rt.setInterruptHandler(() => Date.now() > deadline);
      const vm = rt.newContext();
      const r = vm.evalCode(alloc);
      expect(r.error).toBeDefined();
      const e = dumpAndDispose(vm, r.error!) as { name: string; message: string };
      expect(`${e.name}: ${e.message}`).toBe('InternalError: out of memory');
      vm.dispose();
      expect(() => rt.dispose()).not.toThrow();
    }, 30_000);
  }
});

describe('cg16 claim 4: Filmbench WRITE_RE', () => {
  it('matches lab.write/remove/export/useAsScene (the regex the guide describes as the write detector)', () => {
    const src = readFileSync(new URL('../../../ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/01-inline.js', import.meta.url), 'utf8');
    const line = src.split('\n').find((l) => /WRITE_RE\s*=/.test(l));
    expect(line, 'WRITE_RE definition').toBeDefined();
    const m = /WRITE_RE\s*=\s*\/(.+)\/([a-z]*)\s*;?/.exec(line!)!;
    const re = new RegExp(m[1]!, m[2]);
    for (const call of ['lab.write(', 'lab.remove(', 'lab.export(', 'lab.useAsScene(']) expect(re.test(call), call).toBe(true);
    // Any indirection defeats it, as the guide says (§2.2).
    expect(re.test('lab["wr" + "ite"]("x")')).toBe(false);
  });
});
