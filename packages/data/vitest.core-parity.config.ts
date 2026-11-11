// Runs @chromobench/core's own test suite with its interim data provider replaced by the packs
// (spektrafilm@0.3.2+3bb2c2d + illustrative@1), without touching core:
//   pnpm --filter @chromobench/data test:core-parity
// Differences between the interim JSON and the packs are recorded in the CHB-004 diary; goldens are
// not edited to make this run green.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const shim = fileURLToPath(new URL('./test/core-parity/interim-shim.ts', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: { alias: [{ find: /^\.\/data\/interim\.ts$/, replacement: shim }] },
  test: { include: ['packages/core/test/**/*.test.ts'], environment: 'node' },
});
