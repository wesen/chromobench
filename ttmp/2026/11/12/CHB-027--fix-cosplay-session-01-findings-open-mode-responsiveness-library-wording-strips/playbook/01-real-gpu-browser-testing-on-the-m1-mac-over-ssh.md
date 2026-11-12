---
Title: Real-GPU browser testing on the M1 Mac over SSH
Ticket: CHB-027
Status: active
Topics:
    - ui
    - performance
    - testing
DocType: playbook
Intent: long-term
Owners: []
RelatedFiles:
    - Path: /home/manuel/code/wesen/chromobench/ttmp/2026/11/12/CHB-027--fix-cosplay-session-01-findings-open-mode-responsiveness-library-wording-strips/scripts/mac-01-gpu-smoke.mjs
      Note: Connects to the Mac's Chrome and checks the WebGPU adapter and engine label
    - Path: /home/manuel/code/wesen/chromobench/ttmp/2026/11/12/CHB-027--fix-cosplay-session-01-findings-open-mode-responsiveness-library-wording-strips/scripts/mac-02-open-and-drag.mjs
      Note: Measured session (open a file, drag Time) with main-thread stall probe; --local for SwiftShader
    - Path: /home/manuel/code/wesen/chromobench/ttmp/2026/11/12/CHB-027--fix-cosplay-session-01-findings-open-mode-responsiveness-library-wording-strips/scripts/mac-README.md
      Note: Short version for agents, with the lock protocol
    - Path: /home/manuel/code/wesen/chromobench/playwright.config.ts
      Note: The headless test projects run WebGPU on SwiftShader
ExternalSources: []
Summary: "Drive Google Chrome on the owner's M1 Max (Metal WebGPU) from the Linux development machine: a Playwright run-server on the Mac, an SSH tunnel both ways, a lock for exclusive measurement runs."
LastUpdated: 2026-11-12T15:50:00-05:00
WhatFor: "Measuring and debugging WebGPU behaviour on real GPU hardware from scripts and agents on the Linux box."
WhenToUse: "Any GPU timing, any WebGPU bug that might be a SwiftShader artifact, any check of what the photographer's machine will do."
---

# Real-GPU browser testing on the M1 Mac over SSH

The Linux development machine has no usable GPU for Chrome: the repository's Playwright projects run WebGPU on
SwiftShader (`--use-webgpu-adapter=swiftshader` in `playwright.config.ts`), a CPU implementation of Vulkan. It is
correct enough for conformance tests and far too slow for timing (a GPU-engine slider drag did not finish in 20
minutes in CHB-027 WS-B). The owner's MacBook Pro (Apple M1 Max, macOS 15.7, Google Chrome 157) runs WebGPU on Metal.
This playbook makes that Chrome drivable from scripts and agents on the Linux machine.

## Architecture

```
Linux box (repo, agents, preview servers)                 mimimi-2.local (M1 Max)
─────────────────────────────────────────                 ───────────────────────
node script ── ws://127.0.0.1:9333 ──[ssh -L 9333]──────▶ playwright run-server :9333
                                                              │ launches
vite preview :4600/:4711/:4811 ◀──[ssh -R 46xx/47xx/48xx]── Google Chrome (channel 'chrome', headed)
                                                              loads http://localhost:4811/  (secure context)
```

Three facts decide this shape:

1. **WebGPU needs a secure context.** `navigator.gpu` exists only on `https:` or `localhost`. Opening
   `http://<linux-box>:4811` on the Mac yields the CPU fallback silently. The reverse tunnel (`-R`) makes the Linux
   preview server appear on the Mac as `localhost`, which is secure.
2. **Raw CDP does not work with this pair of versions.** `chromium.connectOverCDP('http://127.0.0.1:9222')` against
   Chrome 157 started with `--remote-debugging-port=9222` fails in Playwright 1.65 with
   `Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.`
3. **A Playwright server of the client's exact version does.** `npx playwright@1.65.0 run-server` on the Mac
   accepts `chromium.connect(...)` from the Linux client and launches the Mac's installed Chrome with the launch
   options the client sends in the `x-playwright-launch-options` header.

## Setup (once per Mac session)

On the Mac (over SSH is fine while the owner is logged in at the console; Node is in `/opt/homebrew/bin`):

```bash
ssh mimimi-2.local 'export PATH=/opt/homebrew/bin:$PATH; mkdir -p /tmp/chromobench-pw; cd /tmp/chromobench-pw;
  nohup npx -y playwright@1.65.0 run-server --port 9333 --host 127.0.0.1 > server.log 2>&1 &'
ssh mimimi-2.local 'tail -1 /tmp/chromobench-pw/server.log'     # Listening on ws://127.0.0.1:9333/
```

On the Linux box, keep one tunnel open (in the background for the whole session):

```bash
ssh -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -N \
  -L 9333:127.0.0.1:9333 \
  -R 4600:127.0.0.1:4600 -R 4711:127.0.0.1:4711 -R 4811:127.0.0.1:4811 \
  mimimi-2.local
```

Add one `-R` per preview port that a script will load. The version pin matters: the server must match
`node -e "console.log(require('@playwright/test/package.json').version)"` in the repository (1.65.0 today).

## Connecting

```js
import { chromium } from '@playwright/test';   // the repo has @playwright/test, not 'playwright'
const browser = await chromium.connect('ws://127.0.0.1:9333/', {
  headers: { 'x-playwright-launch-options': JSON.stringify({ channel: 'chrome', headless: false }) },
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto('http://localhost:4811/?engine=gpu');
// … always: await browser.close();  (the server closes that Chrome)
```

`channel: 'chrome'` uses the installed Google Chrome rather than Playwright's Chromium build; `headless: false`
keeps the normal GPU process and window presentation. Check the result with the smoke script:

```bash
node ttmp/2026/11/12/CHB-027--*/scripts/mac-01-gpu-smoke.mjs 'http://localhost:4600/?engine=gpu&fresh'
# "gpu": { "vendor": "apple", "architecture": "metal-3" }, "engine": "GPU · apple metal-3 · 4000 px"
```

## Measuring

`scripts/mac-02-open-and-drag.mjs <url> <file> [--photo-checkbox] [--local]` opens a file through the hidden
`#file` input, then drags the Time slider with 20 real mouse moves 30 ms apart, and reports the time to result and
every main-thread stall over 100 ms (gaps between `requestAnimationFrame` callbacks, the measure the CHB-026 probe
uses). `--local` runs the same steps in the Linux box's SwiftShader Chromium for comparison.

First result, pre-CHB-027 build of main (`0b381c6`), `DSC_8559.NEF` opened as a photo (`various/mac/01-…json`):

| Step | Real GPU (M1 Max) | CPU reference engine (CHB-026, Linux) |
|---|---|---|
| Open, time to result after the upload | 9.6 s | ~7 s at 512 px |
| Open, worst main-thread stall | 1.0 s | 2.9 s |
| Drag (20 moves), time to result after release | 0.28 s | ~3 s settle, 12.2 s drag |
| Drag, worst stall | none | 2.4 s |

## Rules

- **Exclusive runs.** Timings from two browsers at once are worthless. Take the lock before a run and release it
  after, always (`mkdir` is atomic):
  `ssh mimimi-2.local 'mkdir /tmp/chromobench-pw/lock && echo <who> > /tmp/chromobench-pw/lock/owner'` …
  `ssh mimimi-2.local 'rm -rf /tmp/chromobench-pw/lock'`.
- **The Mac belongs to a person.** A Chrome window appears on the owner's screen during each run; the Mac must be
  awake and logged in. Close the browser at the end of every script, including on errors (`try/finally`).
- **Private photos.** `setInputFiles` streams files from the Linux box to the remote browser; nothing lands on the
  Mac's disk. Do not stage the photographer's files on the Mac unless the owner agrees.
- **Uploads are slow.** Streaming a 30 MB NEF through Playwright's protocol and the tunnel took about 44 s
  (≈ 0.7 MB/s). Measure from the moment `setInputFiles` returns, never from before it, and use a small synthetic
  file when only the GPU path matters.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `engine` says `reference · CPU f64 (no WebGPU …)` | the page is not a secure context (loaded via the LAN name) or the `-R` for that port is missing | load `http://localhost:<port>`; add the `-R` |
| `Browser context management is not supported` | `connectOverCDP` against Chrome 157 | use the run-server and `chromium.connect` |
| `connect ECONNREFUSED 127.0.0.1:9333` | tunnel down or server not running | restart the tunnel; `tail /tmp/chromobench-pw/server.log` on the Mac |
| protocol or version error on connect | server version differs from the repo's `@playwright/test` | restart the server with the matching `playwright@<version>` |
| `Cannot find package 'playwright'` | the repo depends on `@playwright/test` only | import from `@playwright/test` |
| `mkdir: … File exists` | someone holds the lock | read `lock/owner`; wait and retry |
