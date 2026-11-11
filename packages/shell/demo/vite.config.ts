import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Serves packages/shell, so the demo at /demo/ imports /src/... and the test fixture directly.
const root = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig({
  root,
  server: { port: Number(process.env['SHELL_DEMO_PORT'] ?? 4186), strictPort: true },
});
