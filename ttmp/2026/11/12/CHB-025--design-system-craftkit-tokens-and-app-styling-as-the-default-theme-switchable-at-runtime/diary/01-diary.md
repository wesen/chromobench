---
Title: Diary
Ticket: CHB-025
Status: active
Topics:
    - ui
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-12T10:04:30.168327981-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-025 design system

## Step 1: CraftKit as the default theme, switchable at runtime; tokens everywhere; CraftKit's app styling on studio-kit

The studio looked unlike CraftKit Studio for three reasons, all confirmed in the code before changing anything: every
variant called `.theme('chromogen')` (white ground, Arial, radius 0); the CraftKit token set lived in
`packages/shell/src/themes/lightroom.ts` with empty `grays: {1..4}` while the grays were CSS rules in shell.css; and
CraftKit Studio's app-level CSS (CHB-016 `sources/craftkit-studio/src/app/app.css`) was never ported, so studio-kit
components (native range inputs, grid/filmstrip cells, history rows, approval cards) had browser defaults or
Chromogen-era literals. This step makes the theme data-driven and switchable (prefs.theme / prefs.gray), renames the
theme to `craftkit` (old name kept as an alias), replaces literal colours with tokens plus a lint that keeps it that
way, and ports the CraftKit look onto the studio-kit components. All checks green.

### Prompt Context
**User prompt (verbatim):** not available verbatim; the orchestrator's brief (a summary, not the user's words):
"implement ticket CHB-025 (design system: CraftKit tokens and app styling as the default theme, switchable at runtime)
… the user noticed the studio looks different from CraftKit Studio … The user wants the CraftKit design system. Do the
4 tasks … Note the red-for-pending/approval semantics from Chromogen should survive in the CraftKit theme as a token …
Be pragmatic; the user asked not to overdo polish."
**Assistant interpretation:** Runtime theme switch (View ▸ Theme, View ▸ Interface Gray; persisted; CraftKit default),
tokens instead of literal colours plus a failing check, CraftKit app styling on studio-kit components, screenshots.
**Inferred user intent:** The studio should look like CraftKit Studio (Lightroom-like greys) by default, with the
Chromogen look one menu click away, and stay consistent as new UI is added.
**Commit (code):** the commit following this entry — "CHB-025: CraftKit default theme, runtime switch …"

### What I did
- Before screenshots: `scripts/shots.mjs` (apps/studio on MockEngine, 4 frames, 1440×900) →
  `various/before/before-<variant>-current.png`; shell demo reference `various/before/ref-shell-demo-{light,dark}.png`
  (`scripts/ref-shell-demo.mjs`).
- Shell themes: `git mv themes/lightroom.ts themes/craftkit.ts`; `craftkit` (label 'CraftKit') with light, dark and
  grays 1 and 3 filled from shell.css's old `.ck-app[data-gray]` rules (2 = the dark set, 4 = the light set);
  `lightroom` exported as the same object and `THEME_ALIASES.lightroom = 'craftkit'`. New tokens in both themes:
  `pending`, `onpending`, `pendsoft` (Chromogen: its red #e2001a; CraftKit: #d7373f light / #f15c63 dark), `well` /
  `onwell` (dark wells under plots), `mono`, the five `label-*` colours.
- `themes/tokens.ts` (headless): `themeTokens(theme, {dark, gray})` — gray 4 over the light set, 1–3 over the dark set,
  a theme without grays shows that set; `resolveTheme` with aliases; `GRAY_IDS`, `DEFAULT_THEME`.
- `dom/theme.ts`: `themeHandle(target, fallback)` writes the tokens as custom properties on a target, removes stale
  ones, sets `data-ck-theme`, `data-gray`, `color-scheme`, follows prefers-color-scheme / `<html data-theme>`.
  `applyTheme` kept as a one-shot wrapper.
- Runtime: `themeName(s)` (prefs.theme → program theme → craftkit), `setTheme(name)`, `setGray(g)`; `cycleGray` uses
  it. Built-in commands `view.theme.<name>` (one per registered theme, group 'Theme') and `view.gray.{auto,1..4}`
  (group 'Interface Gray'), checked from state. `menuBar()`: an `'app.theme'` item in any menu expands to the two
  submenus, so every variant (explicit or generated menus) gets View ▸ Theme and View ▸ Interface Gray.
- `mount.ts`: a cell on `themeName|gray` drives the handle; `DomServices.themeRoot` (default: the app root).
  shell.css: data-gray rules removed (now data), `/* theme:begin */ … /* theme:end */` markers, new tokens in the
  :root defaults, a few chrome literals tokenised (switch knobs, plate mark, histogram well, error toast),
  `.ck-thumb-badge` styled (it had no CSS). `viewport.ts`: the stage around the picture reads the theme's `--canvas`
  at paint time (was a fixed 0.18 grey) and repaints on a theme/gray change; `cssColour` parses #rgb/#rrggbb/rgb().
- Variants: `.theme('chromogen')` → `.theme('craftkit')` in all seven; explain snapshots updated (header
  `theme craftkit`, command counts +7).
- studio-kit.css rewritten on tokens with CraftKit's app.css ported: Lightroom's track and knob for every
  `input[type=range]` in `.ck-app`, the value field like `.ck-slider-v`, history rows like `dv-hist-r`, library sources
  like `lib-src`, grid/filmstrip cells like `lib-cell` (cell / cellsel / cellhi), the grid on a canvas/panel2 mix,
  approval cards (`.cb-card`) and the proposal ribbon in `--pending`, readout on `--hud`. Kit CSS (roll, looks, chat)
  on tokens (chat used nonexistent `--ck-accent` / `--ck-border` with literal fallbacks).
- apps/studio: app.css on tokens; `themeRoot: document.documentElement`, so the host bar and status line follow the
  theme; theme boot from localStorage (`chromobench.theme`, mirrored from prefs) before mount; the looks kit's renderers
  and CSS were missing from the app (the looks variant showed `[looks.params]` placeholders) — added;
  `#app { height: auto }`.
- `tools/scripts/check-colours.ts` (+ test), chained into `pnpm lint`: literal colours (#hex, rgb[a](), hsl[a]() in
  CSS and HTML, and in TS/JS string literals) outside `packages/shell/src/themes/` and the theme markers fail; a
  per-file allowance with a reason covers overlays drawn on the picture and data colours (channel curves, temperature
  track), so a new literal in those files fails too.
- Tests: `packages/shell/test/dom/theme.test.ts` (8), `tools/scripts/check-colours.test.ts` (3), `e2e/theme.spec.ts` (1).

### Why
- Tokens on a target element (not CSS rules per theme) make a theme pure data and let the host page opt in with
  `themeRoot`; removing the `.ck-app[data-gray]` rules was required, since rules on `.ck-app` would override tokens
  inherited from `<html>`.
- One command per theme plus command groups instead of only a cycle command: checked state in the menu, palette
  entries ("Chromogen — Theme"), and a plain id for agents (`run('view.theme.chromogen')`).
- Expanding `'app.theme'` in `menuBar` instead of editing each variant's menu keeps the variants unchanged apart from
  the theme name.

### What worked
- `pnpm typecheck` clean; `pnpm lint`: "import boundaries ok (328 file checks)", "check-colours: 132 files, no
  literal colours outside the theme files and the counted overlays"; `pnpm gen:check` ok (26 files).
- `pnpm test`: 87 files, 2642 passed | 7 skipped (baseline 2631 + 8 theme + 3 colour-check tests).
- `CI=1 STUDIO_PORT=4390 SHELL_DEMO_PORT=4391 GPU_PARITY_PORT=4392 STUDIO_KIT_PORT=4393 pnpm test:browser`: 86
  passed (port 4173 was taken by another worktree); then `e2e/theme.spec.ts` alone: 1 passed.

### What didn't work
- First theme test: `expected [ 'view.gray.1', …, 'view.gray.auto' ] to deeply equal [ 'view.gray.auto', … ]` —
  iterating `Object.keys(GRAYS)` puts integer-like keys first; fixed by iterating `GRAY_IDS`.
- `TS2375 … Types of property 'doc' are incompatible` (exactOptionalPropertyTypes) for `doc: t.doc`; spread only when set.
- `rt.runCommand('view.theme.chromogen')` in the test: `TS2555 Expected at least 2 arguments` — pass `null` as the event.
- `ref-shell-demo.mjs` first went to `/` → `ERR_HTTP_RESPONSE_CODE_FAILURE`; the demo lives at `/demo/index.html`.

### What I learned
- The app's filmstrip was half hidden under the status line in every variant: `.ck-app { height: 100% }` beat the
  fixed `#app { top; bottom }` box (h = 900 instead of 844). Pre-existing; `#app { height: auto }` fixes it.
- The viewer's dark surround was not CSS but the presenter's stage colour (`DEFAULT_COLOURS.stage = 0.18`).
- `.ck-thumb-badge` (the "agent 2" badge on cells) had no styles anywhere.

### What was tricky to build
- Ordering: mount's theme cell is registered before any viewport, so on a theme change the tokens are written before
  the viewport's cell repaints and reads `--canvas`. A system light/dark switch with gray 'auto' does not repaint the
  stage until the next paint (accepted).

### What warrants a second pair of eyes
- `menuBar` rewriting `'app.theme'` into submenus is implicit; `app.theme` stays a palette command (cycle gray).
- The allowances in `tools/scripts/check-colours.ts` (shell.css 33, forms/basic.ts 13, forms/plane.ts 7, finish kit 13, …).

### What should be done in the future
- Repaint the stage on a system light/dark switch while gray is auto.

### Code review instructions
- Start at `packages/shell/src/themes/tokens.ts`, `packages/shell/src/dom/theme.ts`, `dom/mount.ts` (theme cell),
  `app/builtins.ts` (`themeCommands`), `app/chrome.ts` (`THEME_MENU`), then `packages/studio-kit/src/dom/studio-kit.css`.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm gen:check`; `npx playwright test e2e/theme.spec.ts`.

### Technical details
- Tokens (both themes): app panel panel2 panel3 field line line2 text text2 text3 strong accent accent2 onaccent
  accsoft hover active sel selline track knob knobline canvas cell cellsel cellhi menu shadow ok warn err info pending
  onpending pendsoft tip ontip hud onhud star scroll well onwell label-{red,yellow,green,blue,purple} font mono
  fontSize radius rule.

## Step 2: Screenshots per variant in CraftKit light, CraftKit dark and Chromogen; outliers fixed

With the switch in place, `scripts/shots.mjs` was extended (lab with two agent proposals waiting and one shown, so the
approval cards and the ribbon are in the picture; classic's View ▸ Theme menu, the command palette and its library,
roll, finish and assistant modules) and run for all seven variants in the three looks, plus gray 3 for classic and lab.
I looked at the images and fixed what was off: the looks library cells (step 1's flex rules squeezed the name and
caption, the second button was cut off, then the labels were truncated). The other variants needed nothing further.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Task c8jc — screenshots under the ticket's various/ folder, compared with CraftKit, fix outliers.
**Inferred user intent:** Evidence that the studio now looks like CraftKit Studio, and that Chromogen still works.
**Commit (code):** the commit following this entry — "CHB-025: screenshots per variant and theme; looks cells fixed"

### What I did
- `BASE=http://localhost:4290 node scripts/shots.mjs various/after after craftkit-light craftkit-dark chromogen`
  (dev server `pnpm --filter @chromobench/studio exec vite --port 4290`, 4173 was in use) → 39 images; then
  `VARIANTS=classic,lab … gray-3` → 8 more. Names: `after-<variant>[.<module>|.menu|.palette]-<look>.png`.
- looks.css: `.cb-look-cell > * { flex: none }`, the thumbnail takes the rest (`flex: 1 1 0; min-height: 40px`), the
  caption lost its 2.6em minimum, the action row does not wrap and its buttons keep their width (`flex: none; padding: 0 5px`).
- Re-shot the looks variant in the three looks.

### Why
- Reviewing the images directly (Read on the PNGs) was the acceptance check; the reference is the shell demo on the
  CraftKit theme (`various/before/ref-shell-demo-*.png`) and CHB-016's app.css.

### What worked
- Every variant renders on CraftKit greys with Lightroom sliders, lib-cell grid/filmstrip cells (selected cell light,
  others darker), the canvas-grey stage around the print (#9a9a9a light, #161616 dark), blue accent on primary buttons
  and the selected segment, approval cards and the "Agent proposal, not applied" ribbon in the pending red. Chromogen
  keeps its white ground, Arial, square corners, black primary buttons and red selection/pending. Gray 3 re-tints the
  whole page, the host bar included. No page errors in any run.

### What didn't work
- After step 1, `after-looks-craftkit-dark.png` showed the look cells' "Survey ±" buttons cut off at the bottom; after
  the first fix (`flex-wrap: nowrap`) the labels were ellipsised ("Previ…", "Surve…"). Fixed as above.

### What I learned
- The roll module's sheet is empty until a roll exists, so its screenshot shows only the empty state; the roll kit's
  cards are covered by the studio-kit browser tests, not by these screenshots.

### What was tricky to build
- Nothing beyond the look cells; the screenshot script drives the app through `window.chromobench` (run, propose,
  rt.go) so it needs no test ids.

### What warrants a second pair of eyes
- Whether the pending tint (`--pendsoft`, red at 10 % on the panel) is too strong in CraftKit light.

### What should be done in the future
- The slider rows show the value twice (head and editable field), as before this ticket; CraftKit shows it once.
  Left alone (polish; browser tests read `.cb-arg-v`).

### Code review instructions
- Compare `various/before/before-<variant>-current.png` with `various/after/after-<variant>-craftkit-light.png`.
- Re-run: start the studio dev server, then `BASE=http://localhost:<port> node scripts/shots.mjs <out> after craftkit-light`.

### Technical details
- 1440×900, `colorScheme` light for craftkit-light and chromogen, dark for craftkit-dark; four 96×64 synthetic frames.

### Validation before the commit (Step 2)
- `pnpm typecheck` clean; `pnpm lint` ok (check-colours: 132 files); `pnpm gen:check` ok (26 files);
  `pnpm test` 2642 passed | 7 skipped.
- `CI=1 STUDIO_PORT=4390 SHELL_DEMO_PORT=4391 GPU_PARITY_PORT=4392 STUDIO_KIT_PORT=4393 pnpm test:browser`, first run:
  86 passed, 1 failed — `e2e/studio.spec.ts:161 › tools: test strip band …`: `Expected substring: "rendered"`,
  `Received string: "opened 3 files"` in `open()`. The status line race: with three files, the renders can finish
  before the last file is opened, and `opened 3 files` overwrites `rendered N`. Not touched by this ticket (status text
  comes from main.ts's `rendered` handler and the open loop). `--repeat-each 4 -g "tools: test strip"`: 4 passed.
  Second full run: 87 passed (86 + `e2e/theme.spec.ts`).
