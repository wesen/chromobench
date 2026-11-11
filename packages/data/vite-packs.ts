// Vite plugin: serves packages/data/packs/ at /packs/ (dev server and preview) and copies it into the
// build output, so the browser can `openPack(fetchSource('/packs/'), id)`. Used by the studio and the
// GPU parity page.
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connect, Plugin } from 'vite';

const PACKS = fileURLToPath(new URL('./packs/', import.meta.url));

function* walk(dir: string, rel = ''): Generator<string> {
  for (const f of readdirSync(join(dir, rel))) {
    const r = rel ? `${rel}/${f}` : f;
    if (statSync(join(dir, r)).isDirectory()) yield* walk(dir, r);
    else yield r;
  }
}

export function packsPlugin(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0]!);
    if (!url.startsWith('/packs/')) return next();
    const file = normalize(join(PACKS, url.slice('/packs/'.length)));
    if (!file.startsWith(PACKS) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('content-type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'chromobench-packs',
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
    generateBundle() {
      for (const r of walk(PACKS)) this.emitFile({ type: 'asset', fileName: `packs/${r}`, source: readFileSync(join(PACKS, r)) });
    },
  };
}
