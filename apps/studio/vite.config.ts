import { readdirSync, statSync, writeFileSync } from 'node:fs';
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

// React 19 through esbuild's automatic JSX runtime (no Fast Refresh plugin: @vitejs/plugin-react 6
// needs Vite 8, and the studio does not need hot component reload to be correct).
// Workers are ES modules (LibRaw and the GPU table builders import code dynamically).
export default defineConfig({
  plugins: [packsPlugin(), precachePlugin()],
  esbuild: { jsx: 'automatic' },
  worker: { format: 'es' },
  // LibRaw's module locates libraw.wasm beside itself; the host passes the URL explicitly (?url), and
  // keeping the package out of the pre-bundle keeps that path valid in the dev server too.
  optimizeDeps: { exclude: ['@colorhythm/libraw-wasm'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { port: 4173, strictPort: true, fs: { allow: ['../..'] } },
  preview: { port: 4173, strictPort: true },
});
