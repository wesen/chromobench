# Tasks

## TODO
- [ ] 1. Host capabilities typed: HostCapabilities at mount, commands declare requires:, remove hostHas/hostRun <!-- t:kyfu -->
- [ ] 2. One source of truth for menus: drop the command menu: field; build check for orphan commands and unknown menu ids <!-- t:9d5c -->
- [ ] 3. Split createCb() into per-area command tables (file, frame, view, print, library, roll, finish, looks, host); snapshots unchanged <!-- t:wvz2 -->
- [ ] 4. Shared modules as a library (cb.modules.*, cb.menus.*); no layout imports another <!-- t:8sk0 -->
- [ ] 5. Status bar in the DSL (ck.statusbar, cb.status.engine/mode/jobs/notes/message/offline); host dialogs built from DSL pieces in studio-kit <!-- t:5tv9 -->
- [ ] 6. Jobs slice (transient): renders derived from the queue, withJob() for opens/decodes/exports, throttled; viewer busy badge, status jobs list with cancel, staged open progress, thumbnail spinners <!-- t:7fk7 -->
- [ ] 7. Typed state: extend CbState, typed selectors (cb.sel.*), exposed in the layouts' d.ts <!-- t:ahix -->
- [ ] 8. Catalogue ui metadata order + advanced; Advanced disclosure in controls panels; contract minor bump and decision record <!-- t:xthl -->
- [ ] 9. Rename variant → layout across API, folders, prefs, tests, docs (?variant= stays as alias); glossary from CHB-028 <!-- t:ydsk -->
- [ ] Cosplay session on the CPU engine to confirm the progress display <!-- t:vde3 -->
