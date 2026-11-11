# Tasks

## TODO
- [ ] [stage 1] Write the UI framework decision record and scaffold apps/studio (Vite, React 19, TypeScript, React Aria, vite-plugin-pwa) with the framework-free src/core and a drag-latency spike on the mock engine <!-- t:ex7d -->
- [ ] [stage 1] Implement the PWA: manifest, precached app shell, cache-first data packs, update prompt, offline-ready indicator <!-- t:idnv -->
- [ ] [stage 1] Implement library access: showDirectoryPicker with persisted handles and permission re-request; webkitdirectory session/import-to-OPFS fallback; identity by SHA-256 <!-- t:j4q9 -->
- [ ] [stage 1] Implement the IndexedDB schema (projects, rolls, frames, append-only log, heads, checkpoints, snapshots, probes, handles, threads, settings) and the OPFS cache layout with quota and LRU eviction <!-- t:ibl7 -->
- [ ] [stage 1] Build projects, rolls and the film strip with mock thumbnails, badges and keyboard navigation <!-- t:ykeg -->
- [ ] [stage 2] Implement the WebGPU presenter (display-p3, rgba16float, standard tone mapping) and the Canvas2D P3 fallback, with the viewport transform, zoom presets and panning <!-- t:fkbi -->
- [ ] [stage 2] Implement RenderScheduler (draft/screen/refine passes, latest request wins, monotonic presentation, abort of superseded work) with fake-engine tests <!-- t:ey84 -->
- [ ] [stage 2] Implement the print, negative, dyes and base & gamut views and before/after against snapshots or defaults <!-- t:mhnb -->
- [ ] [stage 2] Implement the densitometer probe (hover, pinned named probes, keyboard-driven) through measure.densitometer <!-- t:x8bf -->
- [ ] [stage 3] Implement units.ts and controls.ts: ControlModel generation from ArgSpec.ui, conversions for points, stops, seconds in stop steps, f-numbers and CC, detents and dual-unit asides <!-- t:ob8t -->
- [ ] [stage 3] Implement widgets (slider, stepper, lights pad + density, select, segmented), the darkroom arrangement with its audit test, and the GestureController (draft overlay, one mutation per gesture, 800 ms keyboard bursts) <!-- t:kygr -->
- [ ] [stage 4] Implement the history panel from the edit log (tx grouping, labels, cursor jumps, rejected entries) and the pending-approval cards wired to ask mode <!-- t:a27w -->
- [ ] [stage 4] Implement the why(path) provenance popover and snapshots (create, compare, restore as one transaction) <!-- t:e0zw -->
- [ ] [stage 5] Implement the test strip and ring-around tool UIs against mock darkroom ops, with click-to-apply as one mutation and the centre-tile identity test <!-- t:ihjx -->
- [ ] [stage 5] Implement the contact sheet with multi-frame "apply these settings" transactions <!-- t:digl -->
- [ ] [stage 5] Implement the mask editor (brush, gradient, ellipse, feather, invert, overlay, vector MaskSpec with stroke simplification) and the exposure list with stop/second arithmetic and a printing script <!-- t:o0iu -->
- [ ] [stage 6] Implement the keyboard shortcut map, ARIA labelling with aria-valuetext in darkroom units, live regions, and axe-core checks in Playwright <!-- t:grer -->
- [ ] [stage 6] Implement the chat panel on CHB-008's ChatSession (streaming text, step cards, looks, approval cards, Stop, mode and effort selectors) <!-- t:rrhv -->
- [ ] [stage 6] Write the M1 walking-skeleton Playwright test: open fixture TIFF, mock render, slider change, undo, DSL eval through window.chromobench.eval, canvas readback <!-- t:o944 -->
