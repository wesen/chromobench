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
  ],
  webServer: {
    command: 'pnpm --filter @chromobench/studio exec vite --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
