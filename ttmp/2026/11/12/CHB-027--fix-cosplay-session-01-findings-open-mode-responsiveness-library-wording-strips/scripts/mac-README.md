# Real GPU: the M1 Max (mimimi-2.local)

The headless test browser here only has SwiftShader (software WebGPU). The owner's MacBook Pro (Apple M1 Max,
Chrome, Metal WebGPU) is reachable from this machine and set up for remote driving:

- On the Mac, a Playwright **1.65.0** server (same version as the repo's `@playwright/test`):
  `cd /tmp/chromobench-pw && npx -y playwright@1.65.0 run-server --port 9333 --host 127.0.0.1` (running; log in
  `/tmp/chromobench-pw/server.log`).
- Here, an SSH tunnel (kept open by the orchestrator):
  `ssh -N -L 9333:127.0.0.1:9333 -R 4600:127.0.0.1:4600 -R 4711:127.0.0.1:4711 -R 4811:127.0.0.1:4811 mimimi-2.local`
  so the Mac's `localhost:4711` / `4811` / `4600` are this machine's preview servers (a secure context: WebGPU works).
- Connect (from a script under the repo; import from `@playwright/test`, not `playwright`):

```js
import { chromium } from '@playwright/test';
const browser = await chromium.connect('ws://127.0.0.1:9333/', {
  headers: { 'x-playwright-launch-options': JSON.stringify({ channel: 'chrome', headless: false }) },
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto('http://localhost:4811/?engine=gpu');   // your own preview port
```

  `scripts/mac-01-gpu-smoke.mjs` checks it: expect `"engine": "GPU · apple metal-3 · 4000 px"`.
  `setInputFiles` streams local files to the remote browser.

## Rules

- **One user at a time** (timings must not overlap): take the lock first, release it when done, always:
  `ssh mimimi-2.local 'mkdir /tmp/chromobench-pw/lock'` (fails while someone holds it; retry every 60 s) …
  `ssh mimimi-2.local 'rmdir /tmp/chromobench-pw/lock'`. Write who holds it:
  `ssh mimimi-2.local 'echo WS-B > /tmp/chromobench-pw/lock/owner'`.
- A Chrome window opens on the owner's screen; close your browser (`browser.close()`) at the end of each run.
- Only the CHB-026 test photos may be used, and only by streaming them through `setInputFiles`; never copy them
  to the Mac's disk.
- Port 4600 serves a build of `main` from **before** CHB-027 (commit 0b381c6): usable for "before" numbers on the
  real GPU.
