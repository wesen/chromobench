// Spike 3: default globals and intrinsics.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const deps = process.argv[2];
const imp = (p) => import(pathToFileURL(path.join(deps, 'node_modules', p, 'dist', 'index.mjs')).href);
const core = await imp('quickjs-emscripten-core');
const SYNC = (await imp('@jitl/quickjs-wasmfile-release-sync')).default;
const QJS = await core.newQuickJSWASMModuleFromVariant(SYNC);
const probe = `JSON.stringify({console: typeof console, setTimeout: typeof setTimeout, require: typeof require, fetch: typeof fetch,
  importFn: (()=>{ try { return typeof import('x') } catch(e) { return 'throws ' + e.name } })(),
  Date: typeof Date, eval: typeof eval, Function: typeof Function, WebAssembly: typeof WebAssembly, globalKeys: Object.getOwnPropertyNames(globalThis).length })`;
for (const [name, opts] of [['default', {}], ['noDateNoEval', { intrinsics: { ...core.DefaultIntrinsics, Date: false, Eval: false } }]]) {
  const rt = QJS.newRuntime(); const vm = rt.newContext(opts);
  const r = vm.evalCode(probe);
  console.log(name, r.error ? 'error ' + JSON.stringify(vm.dump(r.error)) : vm.dump(r.value));
  (r.error || r.value).dispose(); vm.dispose(); rt.dispose();
}
{
  const rt = QJS.newRuntime(); const vm = rt.newContext();
  const r = vm.evalCode(`
    (function(seed){ let a = seed >>> 0; const rnd = function(){ a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      Object.defineProperty(Math, 'random', { value: rnd, writable: false, configurable: false }); })(42);
    Object.freeze(Math);
    let w; try { Math.random = () => 0; w = 'assign ignored'; } catch (e) { w = e.name; }
    JSON.stringify([Math.random(), Math.random(), w])`);
  console.log('seeded Math.random:', r.error ? JSON.stringify(vm.dump(r.error)) : vm.dump(r.value));
  (r.error || r.value).dispose(); vm.dispose(); rt.dispose();
}
