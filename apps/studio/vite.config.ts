import { defineConfig } from 'vite';

// React 19 through esbuild's automatic JSX runtime (no Fast Refresh plugin: @vitejs/plugin-react 6
// needs Vite 8, and the studio does not need hot component reload to be correct).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  server: { port: 4173, strictPort: true, fs: { allow: ['../..'] } },
  preview: { port: 4173, strictPort: true },
});
