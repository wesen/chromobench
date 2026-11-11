import { defineConfig } from '@playwright/test';

// Headless Chromium with WebGPU on SwiftShader (no GPU needed). The full Chromium build in
// new headless mode is selected with channel 'chromium'; the stripped headless shell has no WebGPU.
// STUDIO_PORT lets parallel worktrees run their own dev servers side by side.
const port = Number(process.env['STUDIO_PORT'] ?? 4173);
const shellPort = Number(process.env['SHELL_DEMO_PORT'] ?? 4186);
const kitPort = Number(process.env['STUDIO_KIT_PORT'] ?? 4187);

export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/**/*.spec.ts', 'tools/wgsl-check/**/*.spec.ts'],
  // Agent worktrees live under <root>/.claude/; anchor the ignore at this root so a run from
  // inside a worktree still finds its own tests.
  testIgnore: ['**/node_modules/**', `${import.meta.dirname}/.claude/**`],
  timeout: 60_000,
  reporter: [['list']],
  projects: [
    {
      name: 'chromium-webgpu',
      use: {
        browserName: 'chromium',
        channel: 'chromium',
        baseURL: `http://localhost:${port}`,
        launchOptions: {
          args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'],
        },
      },
    },
    {
      // CHB-005 GPU parity page (packages/gpu/parity-page), its own server and port
      name: 'gpu-parity',
      testDir: 'packages/gpu/test/browser',
      testMatch: ['**/*.spec.ts'],
      timeout: 180_000,
      use: {
        browserName: 'chromium',
        channel: 'chromium',
        baseURL: 'http://localhost:4185',
        launchOptions: {
          args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'],
        },
      },
    },
    {
      // CHB-018 shell demo (packages/shell/demo), its own server and port
      name: 'shell-demo',
      testDir: 'packages/shell/test/browser',
      testMatch: ['**/*.spec.ts'],
      use: { browserName: 'chromium', channel: 'chromium', baseURL: `http://localhost:${shellPort}` },
    },
    {
      // CHB-019 studio-kit dev host (packages/studio-kit/demo): the variants on MockEngine, its own server and port
      name: 'studio-kit',
      testDir: 'packages/studio-kit/test/browser',
      testMatch: ['**/*.spec.ts'],
      use: { browserName: 'chromium', channel: 'chromium', baseURL: `http://localhost:${kitPort}` },
    },
  ],
  webServer: [
    {
      command: `pnpm --filter @chromobench/studio exec vite --port ${port} --strictPort`,
      port,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @chromobench/gpu exec vite --config parity-page/vite.config.ts --port 4185 --strictPort',
      port: 4185,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @chromobench/shell exec vite --config demo/vite.config.ts --port ${shellPort} --strictPort`,
      port: shellPort,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @chromobench/studio-kit exec vite --config demo/vite.config.ts --port ${kitPort} --strictPort`,
      port: kitPort,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});
