// Pack the Studio for the user: the source (shell, app, engine bridge, docs, tests, build scripts), the engine files
// it is assembled from, and a prebuilt dist/ that runs from any static server.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const OUT = process.argv[2] || '/tmp/claude-0/-home-claude/67f1174e-8841-5d00-8f38-259a6c609c2c/scratchpad/craftkit-studio-v1.zip';
const STAGE = '/tmp/claude-0/-home-claude/67f1174e-8841-5d00-8f38-259a6c609c2c/scratchpad/pack/craftkit-studio';
fs.rmSync(path.dirname(STAGE), { recursive: true, force: true });
const cp = (a, b) => { fs.mkdirSync(path.dirname(path.join(STAGE, b)), { recursive: true }); fs.cpSync(a, path.join(STAGE, b), { recursive: true, filter: s => !/node_modules|\/dist-|\.DS_Store/.test(s) }); };
for (const d of ['src', 'docs', 'test', 'engine', 'assets/photos', 'dist']) cp(d, d);
for (const f of ['build.mjs', 'pack.mjs', 'tools-md.mjs', 'tools-publish-list.mjs']) cp(f, f);
// the engine files the worker bundle is assembled from (CraftKit Workbench)
for (const f of ['ck-filters.js', 'ck-catalog.js', 'ck-runtime.js', 'ck-engine.js', 'ck-ops-image.js', 'ck-ops-vector.js', 'ck-ops-more.js', 'ck-present.js', 'ck-gpu.js']) cp('../wb/' + f, 'vendor/wb/' + f);
for (const f of ['ck_light.wasm', 'ck_photo.wasm', 'ck_vector.wasm', 'opentype.min.js']) cp('../wb/dist/' + f, 'vendor/wb/dist/' + f);
fs.writeFileSync(path.join(STAGE, 'vendor/README.txt'), 'The CraftKit engine files the worker bundle is built from (engine/assemble.mjs reads ../wb/; point it at vendor/wb/ to build from this folder).\n');
fs.rmSync(OUT, { force: true });
execFileSync('zip', ['-qr', OUT, 'craftkit-studio'], { cwd: path.dirname(STAGE) });
console.log(OUT, (fs.statSync(OUT).size / 1048576).toFixed(1) + ' MB');
