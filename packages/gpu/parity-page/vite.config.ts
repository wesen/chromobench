import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Serves the parity page with root packages/gpu, so /src/... and /kernels/... resolve, and allows
// reading the shared fixtures at the repo root.
const root = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig({
  root,
  server: { port: Number(process.env['GPU_PARITY_PORT'] ?? 4185), strictPort: true, fs: { allow: [fileURLToPath(new URL('../../..', import.meta.url))] } },
});
