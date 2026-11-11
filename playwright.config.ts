import { defineConfig } from '@playwright/test';

// Headless Chromium with WebGPU on SwiftShader (no GPU needed). The full Chromium build in
// new headless mode is selected with channel 'chromium'; the stripped headless shell has no WebGPU.
export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/**/*.spec.ts', 'tools/wgsl-check/**/*.spec.ts'],
  testIgnore: ['**/node_modules/**', '.claude/**'],
  timeout: 60_000,
  reporter: [['list']],
  projects: [
    {
      name: 'chromium-webgpu',
      use: {
        browserName: 'chromium',
        channel: 'chromium',
        baseURL: 'http://localhost:4173',
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
  ],
  webServer: [
    {
      command: 'pnpm --filter @chromobench/studio exec vite --port 4173 --strictPort',
      port: 4173,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @chromobench/gpu exec vite --config parity-page/vite.config.ts --port 4185 --strictPort',
      port: 4185,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});
