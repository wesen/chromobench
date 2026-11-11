import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Serves packages/studio-kit, so the dev host at /demo/ imports /src, /variants and the M1 fixture directly.
const root = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig({
  root,
  server: { port: Number(process.env['STUDIO_KIT_PORT'] ?? 4187), strictPort: true },
});
