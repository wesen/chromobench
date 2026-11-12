import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
    // Property and golden tests run several seconds each; under load (parallel agents, CI) the 5 s default times
    // out on correct code. Failures show as wrong values, not as slowness, so a wider budget hides nothing.
    testTimeout: 30_000,
  },
});
