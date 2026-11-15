import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { packsPlugin } from '../../packages/data/vite-packs.ts';

/**
 * Writes dist/precache.json (CHB-023): every built file the service worker should hold for an offline
 * start (public/sw.js reads it on install). Data packs are left out: the worker caches /packs/ on first
 * use in its own cache.
 */
function precachePlugin(): Plugin {
  let outDir = 'dist';
  const walk = (dir: string, rel = ''): string[] => readdirSync(join(dir, rel)).flatMap((f) => {
    const r = rel ? `${rel}/${f}` : f;
    return statSync(join(dir, r)).isDirectory() ? walk(dir, r) : [r];
  });
  return {
    name: 'chromobench-precache',
    apply: 'build',
    configResolved: (c) => void (outDir = c.build.outDir.startsWith('/') ? c.build.outDir : join(c.root, c.build.outDir)),
    closeBundle() {
      const files = walk(outDir).filter((f) => !f.startsWith('packs/') && f !== 'precache.json' && !f.endsWith('.map'));
      writeFileSync(join(outDir, 'precache.json'), JSON.stringify(['/', ...files.filter((f) => f !== 'index.html').map((f) => `/${f}`)], null, 1));
    },
  };
}

// The studio is plain TypeScript on the shell and studio-kit (CHB-019; no JSX since the React UI was removed).
// Workers are ES modules (LibRaw and the GPU table builders import code dynamically).
/** the commit the build is made from (CHB-038: problem reports name it), '+dirty' with local changes */
function commit(): string {
  try {
    const head = execSync('git rev-parse --short HEAD', { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return `${head}${dirty ? '+dirty' : ''}`;
  } catch {
    return 'unknown';
  }
}
const version = (JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }).version;

export default defineConfig({
  plugins: [packsPlugin(), precachePlugin()],
  define: { __CHROMOBENCH_VERSION__: JSON.stringify(version), __CHROMOBENCH_COMMIT__: JSON.stringify(commit()) },
  worker: { format: 'es' },
  // LibRaw's module locates libraw.wasm beside itself; the host passes the URL explicitly (?url), and
  // keeping the package out of the pre-bundle keeps that path valid in the dev server too.
  // The same holds for QuickJS (the DSL worker, CHB-008): its module loads emscripten-module.wasm beside itself.
  optimizeDeps: { exclude: ['@colorhythm/libraw-wasm', '@jitl/quickjs-wasmfile-release-sync'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { port: 4173, strictPort: true, fs: { allow: ['../..'] } },
  preview: { port: 4173, strictPort: true },
});
