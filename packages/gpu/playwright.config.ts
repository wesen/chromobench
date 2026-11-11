import { defineConfig } from '@playwright/test';

// GPU parity tests in headless Chromium on SwiftShader (guide §8 "How to run"). A separate port from
// the studio's 4173 so parallel worktrees do not reuse each other's servers.
const port = Number(process.env['GPU_PARITY_PORT'] ?? 4185);
export default defineConfig({
  testDir: './test/browser',
  testMatch: ['**/*.spec.ts'],
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  projects: [
    {
      name: 'gpu-parity',
      use: {
        browserName: 'chromium',
        channel: 'chromium',
        baseURL: `http://localhost:${port}`,
        launchOptions: { args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'] },
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite --config parity-page/vite.config.ts --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
