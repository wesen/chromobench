// Spike 4: Date intrinsic off; error line numbers after the wrap prefix; JSON round trip cost.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const deps = process.argv[2];
const imp = (p) => import(pathToFileURL(path.join(deps, 'node_modules', p, 'dist', 'index.mjs')).href);
const core = await imp('quickjs-emscripten-core');
const SYNC = (await imp('@jitl/quickjs-wasmfile-release-sync')).default;
const QJS = await core.newQuickJSWASMModuleFromVariant(SYNC);
{
  const rt = QJS.newRuntime(); const vm = rt.newContext({ intrinsics: { ...core.DefaultIntrinsics, Date: false } });
  const r = vm.evalCode('JSON.stringify({ Date: typeof Date, ok: 1 + 1 })');
  console.log('Date off:', r.error ? JSON.stringify(vm.dump(r.error)) : vm.dump(r.value)); (r.error || r.value).dispose(); vm.dispose(); rt.dispose();
}
{
  const rt = QJS.newRuntime(); const vm = rt.newContext();
  const body = 'const a = 1\nawait null\nconst b = a.x.y\nreturn b';
  const src = '(async function () {\n' + body + '\n})()';
  const p = vm.unwrapResult(vm.evalCode(src, 'agent.js'));
  rt.executePendingJobs();
  const st = vm.getPromiseState(p);
  console.log('error after await:', JSON.stringify(vm.dump(st.error)));
  st.error.dispose(); p.dispose(); vm.dispose(); rt.dispose();
}
