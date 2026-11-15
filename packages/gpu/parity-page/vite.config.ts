import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { packsPlugin } from '../../data/vite-packs.ts';

// Serves the parity page with root packages/gpu, so /src/... and /kernels/... resolve, and allows
// reading the shared fixtures at the repo root.
const root = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig({
  root,
  plugins: [packsPlugin()],
  server: {
    port: Number(process.env['GPU_PARITY_PORT'] ?? 4185), strictPort: true, fs: { allow: [fileURLToPath(new URL('../../..', import.meta.url))] },
    // transform the page's module graph when the server starts, not when the first workers ask for it at once (P3b)
    warmup: { clientFiles: ['./src/parity/page.ts'] },
  },
});
