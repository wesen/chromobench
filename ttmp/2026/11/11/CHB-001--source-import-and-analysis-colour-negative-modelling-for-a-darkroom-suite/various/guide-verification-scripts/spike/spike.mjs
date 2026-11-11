// Spike: quickjs-emscripten 0.32.0 behaviours that CHB-007 depends on.
// Usage: node spike.mjs <deps-dir>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const deps = process.argv[2];
const imp = (p) => import(pathToFileURL(path.join(deps, 'node_modules', p, 'dist', 'index.mjs')).href);
const core = await imp('quickjs-emscripten-core');
const SYNC = (await imp('@jitl/quickjs-wasmfile-release-sync')).default;
const ASYNC = (await imp('@jitl/quickjs-wasmfile-release-asyncify')).default;
const { newQuickJSWASMModuleFromVariant, newQuickJSAsyncWASMModuleFromVariant, shouldInterruptAfterDeadline } = core;

const log = (...a) => console.log(...a);

// ---------- 1. sync variant: await on host deferred promises, pumped by the host
{
  const QJS = await newQuickJSWASMModuleFromVariant(SYNC);
  const rt = QJS.newRuntime();
  rt.setMemoryLimit(64 * 1024 * 1024);
  rt.setMaxStackSize(1024 * 1024);
  let deadline = 0;
  rt.setInterruptHandler(() => Date.now() > deadline);
  const vm = rt.newContext();
  let pending = 0;
  const evalFn = vm.newFunction('__evaluate', (idH) => {
    const id = vm.getNumber(idH);
    const d = vm.newPromise();
    pending++;
    setTimeout(() => { const v = vm.newNumber(id * 10); d.resolve(v); v.dispose(); d.dispose(); pending--; rt.executePendingJobs(); }, 5);
    return d.handle;
  });
  vm.setProp(vm.global, '__evaluate', evalFn); evalFn.dispose();
  const code = `(async function(){
    const a = await __evaluate(1);
    const b = await __evaluate(2);
    const [c, d] = await Promise.all([__evaluate(3), __evaluate(4)]);
    return {a, b, c, d};
  })()`;
  deadline = Date.now() + 2000;
  const res = vm.unwrapResult(vm.evalCode(code, 'agent.js'));
  // pump until settled
  const t0 = Date.now();
  while (vm.getPromiseState(res).type === 'pending' && Date.now() - t0 < 2000) { await new Promise((r) => setTimeout(r, 1)); rt.executePendingJobs(); }
  const st = vm.getPromiseState(res);
  log('1 sync deferred await:', st.type, st.type === 'fulfilled' ? JSON.stringify(vm.dump(st.value)) : '');
  if (st.value) st.value.dispose(); res.dispose();

  // ---------- 2. interrupt in sync part and inside a promise job
  deadline = Date.now() + 200;
  let r = vm.evalCode('while(true){}');
  log('2a interrupt sync:', r.error ? JSON.stringify(vm.dump(r.error)) : 'no error'); if (r.error) r.error.dispose(); else r.value.dispose();
  deadline = Date.now() + 200;
  r = vm.evalCode('(async function(){ await null; while(true){} })()');
  const p = vm.unwrapResult(r);
  const job = rt.executePendingJobs();
  const st2 = vm.getPromiseState(p);
  log('2b interrupt in job: executePendingJobs', job.error ? 'error ' + JSON.stringify(vm.dump(job.error)) : 'ok ' + job.value, '| promise', st2.type, st2.error ? JSON.stringify(vm.dump(st2.error)) : '');
  if (job.error) job.error.dispose(); if (st2.error) st2.error.dispose(); p.dispose();
  // can the VM still run promises after an interrupt in a job? (goja could not)
  deadline = Date.now() + 2000;
  const p3 = vm.unwrapResult(vm.evalCode('(async function(){ await null; return 7 })()'));
  rt.executePendingJobs();
  const s3 = vm.getPromiseState(p3);
  log('2c promises after interrupt:', s3.type, s3.value ? vm.dump(s3.value) : ''); if (s3.value) s3.value.dispose(); p3.dispose();

  // ---------- 3. memory limit
  deadline = Date.now() + 5000;
  r = vm.evalCode('const a=[]; for(let i=0;i<1e8;i++) a.push({i}); a.length');
  log('3 memory limit:', r.error ? JSON.stringify(vm.dump(r.error)).slice(0, 120) : 'no error'); if (r.error) r.error.dispose(); else r.value.dispose();

  // ---------- 5. proxy toPrimitive and 6. Function.prototype.toString
  deadline = Date.now() + 2000;
  r = vm.evalCode(`
    const h = new Proxy({}, { get(t, k) { if (k === Symbol.toPrimitive) return () => { const e = new Error('lazy'); e.name = 'E_NOT_AWAITED'; throw e; }; return undefined; } });
    let out = {};
    try { out.mul = h * 2; } catch (e) { out.mul = e.name; }
    try { out.cmp = h > 0.5; } catch (e) { out.cmp = e.name; }
    try { out.tmpl = \`\${h}\`; } catch (e) { out.tmpl = e.name; }
    const f = async (x, y) => { // the best point within 2 px
      return x };
    out.src = f.toString();
    out.mathRandomType = typeof Math.random;
    out.hasDate = typeof Date;
    out.stack = (function(){ try { null.x } catch (e) { return e.stack } })();
    JSON.stringify(out)`, 'agent.js');
  log('5/6 proxy, toString, stack:', r.error ? JSON.stringify(vm.dump(r.error)) : vm.dump(r.value)); if (r.error) r.error.dispose(); else r.value.dispose();
  try { vm.dispose(); rt.dispose(); log("dispose ok"); } catch (e) { log("dispose failed:", String(e).slice(0,160)); }
}

// ---------- 4. asyncify: asyncified host fn before and after an await
{
  const QJSA = await newQuickJSAsyncWASMModuleFromVariant(ASYNC);
  const rt = QJSA.newRuntime();
  const vm = rt.newContext();
  const fn = vm.newAsyncifiedFunction('slowDouble', async (xH) => { const x = vm.getNumber(xH); await new Promise((r) => setTimeout(r, 5)); return vm.newNumber(x * 2); });
  vm.setProp(vm.global, 'slowDouble', fn); fn.dispose();
  let r = await vm.evalCodeAsync('slowDouble(21)');
  log('4a asyncify in sync part:', r.error ? JSON.stringify(vm.dump(r.error)) : vm.dump(r.value)); if (r.error) r.error.dispose(); else r.value.dispose();
  try {
    r = await vm.evalCodeAsync('(async function(){ await null; return slowDouble(5) })()');
    const p = vm.unwrapResult(r);
    let job;
    try { job = rt.executePendingJobs(); } catch (e) { log('4b executePendingJobs threw:', String(e).slice(0, 200)); }
    await new Promise((res) => setTimeout(res, 50));
    try { rt.executePendingJobs(); } catch (e) {}
    const st = vm.getPromiseState(p);
    log('4b asyncify after await:', job && job.error ? 'job error ' + JSON.stringify(vm.dump(job.error)) : 'job ok', '| promise', st.type, st.type !== 'pending' ? JSON.stringify(vm.dump(st.value || st.error)) : '');
  } catch (e) { log('4b threw:', String(e).slice(0, 300)); }
}
