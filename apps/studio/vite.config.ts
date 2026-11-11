import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 4173, strictPort: true, fs: { allow: ['../..'] } },
  preview: { port: 4173, strictPort: true },
});
