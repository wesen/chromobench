// CHB-025 reference: the shell demo (CraftKit's look on the lightroom/craftkit theme) in light and dark.
// Usage: node ref-shell-demo.mjs <outdir>   (shell demo dev server on BASE, default http://localhost:4186)
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:4186';
const b = await chromium.launch({ channel: 'chromium' });
for (const scheme of ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  await p.goto(BASE + '/demo/index.html?fresh');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${process.argv[2]}/ref-shell-demo-${scheme}.png` });
}
await b.close();
