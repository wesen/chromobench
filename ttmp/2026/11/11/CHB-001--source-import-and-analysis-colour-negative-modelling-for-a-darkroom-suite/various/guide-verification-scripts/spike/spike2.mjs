// Spike 2: which failure leaves a runtime that cannot be disposed; double suspension under asyncify.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const deps = process.argv[2];
const imp = (p) => import(pathToFileURL(path.join(deps, 'node_modules', p, 'dist', 'index.mjs')).href);
const core = await imp('quickjs-emscripten-core');
const SYNC = (await imp('@jitl/quickjs-wasmfile-release-sync')).default;
const ASYNC = (await imp('@jitl/quickjs-wasmfile-release-asyncify')).default;
const cases = {
  plain: 'let x = {a:1}; x.a',
  interruptSync: 'while(true){}',
  interruptJob: '(async function(){ await null; while(true){} })()',
  oom: 'const a=[]; for(let i=0;i<1e8;i++) a.push({i}); a.length',
};
for (const [name, code] of Object.entries(cases)) {
  const QJS = await core.newQuickJSWASMModuleFromVariant(SYNC);
  const rt = QJS.newRuntime(); rt.setMemoryLimit(32 * 1024 * 1024);
  let deadline = Date.now() + 200; rt.setInterruptHandler(() => Date.now() > deadline);
  const vm = rt.newContext();
  const r = vm.evalCode(code);
  const h = r.error || r.value;
  if (!r.error && vm.typeof(h) === 'object') { rt.executePendingJobs(); }
  h.dispose();
  try { vm.dispose(); rt.dispose(); console.log(name, 'dispose ok'); } catch (e) { console.log(name, 'dispose FAILED'); }
}
{
  const QJSA = await core.newQuickJSAsyncWASMModuleFromVariant(ASYNC);
  const rt = QJSA.newRuntime(); const vm = rt.newContext();
  const fn = vm.newAsyncifiedFunction('slow', async (xH) => { const x = vm.getNumber(xH); await new Promise((r) => setTimeout(r, 20)); return vm.newNumber(x * 2); });
  vm.setProp(vm.global, 'slow', fn); fn.dispose();
  const p = vm.unwrapResult(await vm.evalCodeAsync('(async function(){ await null; return slow(5) })()'));
  const j1 = rt.executePendingJobs();
  console.log('first executePendingJobs returned', j1.error ? 'error' : j1.value, '| state', vm.getPromiseState(p).type);
  try { const r2 = await vm.evalCodeAsync('1+1'); console.log('second entry while suspended:', r2.error ? JSON.stringify(vm.dump(r2.error)) : vm.dump(r2.value)); } catch (e) { console.log('second entry while suspended threw:', String(e).split('\n')[0].slice(0, 200)); }
}
