import { defineConfig } from '@playwright/test';

// Headless Chromium with WebGPU on SwiftShader (no GPU needed). The full Chromium build in
// new headless mode is selected with channel 'chromium'; the stripped headless shell has no WebGPU.
// STUDIO_PORT lets parallel worktrees run their own dev servers side by side.
const port = Number(process.env['STUDIO_PORT'] ?? 4173);

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
  ],
  webServer: {
    command: `pnpm --filter @chromobench/studio exec vite --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
