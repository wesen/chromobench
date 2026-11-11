// Build the Studio: the shell and the app as plain ES modules (so diagnostics point at the app's own files and
// lines), the engine worker bundle, the wasm crates, the sample shoot, and index.html.
import fs from 'node:fs';
import path from 'node:path';
import { assembleEngine, WASM, OPENTYPE } from './engine/assemble.mjs';
import { md } from './tools-md.mjs';

const DIST = process.env.DIST || 'dist';
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
const copyDir = (from, to, filter = () => true) => {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const a = path.join(from, f), b = path.join(to, f);
    if (fs.statSync(a).isDirectory()) copyDir(a, b, filter); else if (filter(a)) fs.copyFileSync(a, b);
  }
};
copyDir('src/shell', path.join(DIST, 'shell'), f => f.endsWith('.js'));
copyDir('src/app', path.join(DIST, 'app'), f => f.endsWith('.js'));
copyDir('assets/photos', path.join(DIST, 'photos'));
if (process.env.TESTPAGES) copyDir('test/pages', path.join(DIST, 'test'));
// the docs, shown in the app under Help
fs.writeFileSync(path.join(DIST, 'app', 'docs.js'), '// generated from docs/*.md by build.mjs\nexport const DOCS = ' + JSON.stringify(Object.fromEntries(fs.readdirSync('docs').filter(f => f.endsWith('.md')).map(f => [f.replace(/\.md$/, ''), md(fs.readFileSync('docs/' + f, 'utf8'))]))) + ';\n');
fs.writeFileSync(path.join(DIST, 'engine.js'), fs.readFileSync(OPENTYPE, 'utf8') + '\n;\n' + assembleEngine());
for (const w of WASM) fs.copyFileSync(w, path.join(DIST, path.basename(w)));
const appCss = fs.readdirSync('src/app').filter(f => f.endsWith('.css')).sort((a, b) => (a === 'app.css' ? -1 : b === 'app.css' ? 1 : a.localeCompare(b)));
const css = fs.readFileSync('src/shell/shell.css', 'utf8') + '\n' + appCss.map(f => fs.readFileSync('src/app/' + f, 'utf8')).join('\n');
const html = `<title>CraftKit Studio</title>
<meta name="description" content="A first professional version of the CraftKit Shell: a photo and print studio (Library, Cull, Develop, Export, Prepress, Print Shop) running on the CraftKit engine.">
<style>
${css}
</style>
<div id="app" class="ck-app" data-gray="auto"><div class="ck-boot">Starting CraftKit Studio…</div></div>
<script>
// The app loads as ES modules (so diagnostics name the app's own files and lines). If modules cannot load here,
// the same code bundled into one classic script takes over.
(function () {
  var done = false;
  function bundle() { if (done) return; done = true; var b = document.createElement('script'); b.src = 'studio.bundle.js'; document.body.appendChild(b); }
  var m = document.createElement('script'); m.type = 'module'; m.src = 'app/main.js'; m.onerror = bundle;
  document.body.appendChild(m);
})();
</script>
`;
fs.writeFileSync(path.join(DIST, 'index.html'), html);
// the fallback bundle (one classic script), built from the same modules
import { execFileSync } from 'node:child_process';
{
  const args = [path.join(DIST, 'app/main.js'), '--bundle', '--format=iife', '--log-level=warning', '--outfile=' + path.join(DIST, 'studio.bundle.js')];
  const local = '/opt/npm-tools/node_modules/.bin/esbuild';
  try { if (fs.existsSync(local)) execFileSync(local, args, { stdio: 'inherit' }); else execFileSync('npx', ['--yes', 'esbuild@0.24.0', ...args], { stdio: 'inherit' }); }
  catch (e) { console.warn('no esbuild: the classic-script fallback bundle was not built (the ES modules still work)'); }
}
const files = [];
const walk = d => { for (const f of fs.readdirSync(d)) { const a = path.join(d, f); if (fs.statSync(a).isDirectory()) walk(a); else files.push(path.relative(DIST, a)); } };
walk(DIST);
const size = files.reduce((n, f) => n + fs.statSync(path.join(DIST, f)).size, 0);
console.log(`dist: ${files.length} files, ${(size / 1048576).toFixed(1)} MB`);
