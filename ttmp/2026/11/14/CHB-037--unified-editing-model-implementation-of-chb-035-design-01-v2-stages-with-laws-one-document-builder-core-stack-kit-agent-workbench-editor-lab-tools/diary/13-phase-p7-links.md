---
Title: Diary — phase P7 links
Ticket: CHB-037
Status: active
Topics:
    - architecture
    - ui
    - webgpu
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T01:31:33.02042-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — phase P7 links

## Goal

Record phase P7 of CHB-037: rolls, looks, presets and sync become one link mechanism (design §27–§28, §31, D2, D5):
registered look functions that return groups, link entries expanded at compile with the stage law's amount, bake,
rolls on linked media, presets as parameterless looks, sync as copy or link, the DSL's named looks as link inserts.

## Step 1: The design of the links, and the contract's half

The contract had the hook (P2a: a resolver registry, roll links, `resolveLinks`, `bakeLink`) but no look functions,
no presets and no way for the studio to read or write a linked medium. This step decides the shape of every link
the phase needs and builds the contract's side: look functions registered by name and version, the look and preset
resolvers, link entries that carry a look into several stages under one key and one Amount, bake of a whole link
(with its masks), and the read/write helpers that make a linked medium usable by controls (a set of a field is an
override, a read goes through the link).

The built-in looks are rewritten as groups of ordinary layers: light in the darkroom (filters for colour and
density, the preflash, density masks, an edge burn through its own oval mask) and print layers (clarity), one of
them over two stages. The parameter-edit looks that set media (grades, papers, film stocks) have no group form and
are gone as looks (see the decisions below).

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work, according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together and add the editor lab functionality / consolidate it all." plus "unify all of it, we don't have backwards compatibility needs or wrapping or so, we can do hard cutoff, now is the time to strive for elegance and consistency and all that. nothing is not worth it if it creates a more robust and simple core"

**Assistant interpretation:** The main agent assigned me phase P7 (links: looks, rolls, presets, sync) of CHB-037:
make the four one link mechanism per design §27, hard cut-off of the parameter-edit looks and the roll fragment.

**Inferred user intent:** One robust core: a look, a roll's shared settings, a preset and a synced edit are the same
kind of thing (a link), resolved by the one compiler, undone in one step, readable by the photographer and the agent.

**Commit (code):** 33c73c0 — "CHB-037 P7: links in the contract — registered look functions, presets, bake of a whole link, linked media"

### What I did
- Read the plan (§1–§2, §8 P7, every amendment), the design (§16, §20–§22, §26–§29, §31), the P2a, P4, P5b-1 and
  P6a diaries, CONTRACT-DECISIONS (CC-019), the looks and roll kits, the DSL's named looks and every compile site.
- `packages/contract/src/links.ts` rewritten: `defineLook`/`getLook`/`allLooks`/`lookParams`/`lookSkip`; resolvers for
  rolls, presets and looks taking a `LinkScope { doc, ctx }`; `expandLink` returns `{ group, masks }` (the look's masks
  with ids `<linkId>--<maskId>`, entry mask refs rewritten); `resolveLinks` adds them to the mask library;
  `insertLink`, `linksOf`, `linkSiblings`, `keyOf`, `setLinkAmount`, `setLinkParams`, `removeLink`, `bakeLink(doc,
  key, ctx)`; `Preset` (format 3), `validatePreset`, `makePreset`, `lookAsPreset`; linked media: `storedPath`,
  `storedMutations`, `readField`, `linkMedium`, `unlinkMedium`, `divergence`, `followLink`, `resolveMedium(doc,
  stage, ctx)`.
- `packages/contract/src/links-looks.ts` (new): ten built-in looks (balance, neutral, warm-print, cool-print,
  print-density, soft-contrast, more-contrast, edge-burn, crisp-print, crisp-warm).
- `compile.ts`: `linkContext(doc, g, opts)` gives resolution the facts and the source size from the graph.
- Tests: `links-looks.test.ts` (12 tests), `links-bindings.test.ts` adapted. CC-020 in CONTRACT-DECISIONS.md.

### Why
- Design §31: compile-time functions are registered, pure and stored only by name and version; the built-ins live
  in the contract because every compile site (studio, export, the agent's worker, conformance) must expand them
  without the studio kit.
- A look over two stages needs one Amount and one undo: the entries share `source.link = key`, ids `<key>-<stage>`.
- A look that brings mask geometry (the edge burn) was impossible with parameter edits (design §16: "A look cannot
  carry mask geometry"); masks in the look's output, prefixed like the children, make it a value.

### What worked
- The values path grammar already allows setting a missing last key, so a medium override is a plain
  `set('stages.scan.medium.overrides.stock', …)`; `unset` drops it ("follow the roll").
- Amount 0 of a darkroom look gives the same display node as the frame without it (the light law's identities), and
  a baked link compiles to the same graph as the link, for looks with masks and over two stages.

### What didn't work
- First version of `linkKind` indexed the `LinkRef` union directly: `error TS7053: Element implicitly has an 'any'
  type because expression of type '"roll"' can't be used to index type 'LinkRef'` — read it as `unknown` first.
- A test expected the roll's base in the scan node (`expected {} to match object { rebate: undefined }`): the frame
  overrides `baseT: null` (its own), so the roll's base does not show there; the test checks the overridden flare.

### What I learned
- `checkMedium` already validates a linked medium's overrides against the medium schema field by field, so the
  override paths need no new validation.
- The light law's amount range is [0, 16] and composite/repair's [0, 1]: the UI's 0–200 % is time and density in the
  darkroom and at most 100 % opacity on the print (`clampAmount`).

### What was tricky to build
- **Which looks survive.** Five of the eight CHB-021 looks set media (grade, paper, film stock, push). A medium is not
  a group: it has no amount (half a film stock means nothing), no mask, and the film stage has no law. Two options
  were a look that may also link media, or looks that are groups only. I chose groups only (design §27/D5 "look
  functions returning groups"): contrast looks became light (density masks, a preflash: a printer's way to change
  contrast without changing paper), the film looks were deleted (choosing a stock is a medium setting; sharing it
  across frames is the roll link or a sync by copy).
- **What the roll links.** The roll links the scan medium (scanner, stock, format, flat, open gate, flare, base): what
  every frame of a piece of film shares physically (design §27's list). The darkroom's printing choices (paper,
  grade, mode, filtration, f-stop) stay per frame; the first print and the match set them per frame as before, and a
  sync copies them. Linking the darkroom medium too would make every studio reader of `darkroomMedium(doc)` need the
  roll, which the studio code does not have at hand.

### What warrants a second pair of eyes
- `readField` without a context falls back to the frame's overrides only (a roll field reads undefined): callers that
  show a linked medium must pass the context.
- Look functions read the stored document (the neutral filter follows the printer lights). That is allowed by design
  §31 ("may read the document") but means a look's expansion changes when other entries change; it never reads its
  own expansion (resolution reads the stored document, not the resolved one).

### What should be done in the future
- A cache of look expansions keyed by the hash of (look, params, facts, size) if expansion shows in profiles (it is
  pure); today a compile re-expands, and the studio's bridge caches per document anyway.

### Code review instructions
- Start at `packages/contract/src/links.ts` (the header has the API with examples), then `links-looks.ts`.
- `pnpm exec tsc -p packages/contract/tsconfig.json --noEmit`, `pnpm exec vitest run packages/contract`,
  `node tools/gen-docs/main.ts --contract-only --check`.

### Technical details
- Link entry: `{ kind: 'link', ref: { look: 'warm-print', version: 1 }, params: { warmth: 6, density: 0 },
  overrides: {}, name: 'Warm print', enabled: true, amount: 0.6, mask: null, blend: 'pass', source: { kind: 'look',
  link: 'w1' } }` at id `w1-darkroom`; it expands to a pass group `w1-darkroom` with child `w1-darkroom--warmth`.
- Linked medium: `stages.scan.medium = { link: { roll: 'roll-1' }, overrides: { umPerPx: 6, rebate: null } }`.

## Step 2: Rolls on links, and the studio's reads and writes of a linked medium

A frame on a roll now holds no copy of what the roll shares. The roll record keeps the scan fields of the piece of
film (`media.scan`: scanner, stock, format, flat, open gate, flare, base); New Roll links every frame's scan medium
to it in the same step (`{ link: { roll }, overrides }`, the frame's own pitch and rebate as overrides); the analysis
writes the measured base and veil on the roll, and every frame follows. Divergence is read from the overrides.

The studio needed three small things to live with a linked medium, all in P5b-2's part of studio-kit and kept to a
few lines each: the render bridge compiles with the state's links (and caches per link context, so a roll change
re-lowers every frame), `read()` reads a medium field through the link and `physical()`/`commit`/`propose` write it
to the override, and the export writes the resolved document.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Rolls on links: the roll record holds partial media and stacks, frames link, overrides
are divergence; the roll kit's first print, match and alpha on links; the fragment copies deleted.

**Inferred user intent:** One roll edit reaches every frame; the photographer sees which frames depart from the roll.

**Commit (code):** 660f5a6 — "CHB-037 P7: rolls on links, looks as links in the studio kits; the studio reads and writes linked media"

### What I did
- `kits/roll/src/engine/constants.ts`: `ROLL_FIELDS`, `SHARED_PATHS` (scan paths only), `rollField`; `SharedKey`/
  `sharedKey` gone. `engine/model.ts`: `Roll` without `fragment`; `newRoll(id, label, frames, scan)`, `sharedOf`,
  `rollValue`, `withRollValue`, `linkFrame`, `linkedRoll`, `diverging`/`divergence` from the overrides;
  `fragmentOf`/`fragmentWith`/`fragmentGet`/`fragmentEntries` deleted.
- `engine/lower.ts`: the first print no longer copies shared settings; a mixed frame's base is an override
  (`baseT: null`, always set). `engine/batch.ts`: `frameSets` writes through `storedMutations`.
- `kit.ts`: New Roll is one batch (roll record, order, every frame's link; by auto); the analysis reads resolved
  documents and writes `media.scan` on the roll; `roll.setShared` sets a roll field and drops the frames' overrides
  (one step), or copies a non-roll setting to the frames; `roll.followRoll` (new) drops one frame's override.
- `kits/roll/src/dom.ts`: the setup panel reads the roll's fields.
- Studio (P5b-2's files, minimal): `src/model/doc.ts` (`read(doc, path, links?)`, `physical` via `storedPath`,
  `linksOf(state)`, `linkDataOf(state)`), `src/bridge/render-bridge.ts` (`links` provider, cache per context),
  `src/studio.ts` (`links()`, `linkData()`, `resolved(f)`, medium paths mapped in `commit`/`propose`),
  `src/dom/arg.ts` (reads through links), `src/bridge/frames.ts` (rebate rescale on the override),
  `src/model/history.ts` ("Added the look …"), `apps/studio/src/main.ts` (export of `studio.resolved(f)`),
  `apps/studio/src/host/chat.ts` (`links: () => studio.linkData()` for the agent's worker).
- Tests: roll engine and kit tests rewritten for links (divergence from overrides, Set on the Roll, Reset to the
  Roll, the analysis on the roll, frames hold only `rebate` and `umPerPx`).

### Why
- Design §27: "a roll change reaches every frame that has not overridden it", "divergence … read directly instead of
  computed". The fragment copied values into every document and compared them back.
- The roll shares what the film shares; printing choices stay per frame (Step 1).

### What worked
- The analysis and the measurements run unchanged on `resolveLinks(doc, links)`; the first print's batch is plain
  sets on darkroom paths plus the rebate override.
- `layouts.test.ts` explain snapshots changed only by the command table (updated with `-u`).

### What didn't work
- Kit test, first flow: `expected { …(6) } to deeply equal { …(6) }` after one undo — the frames are linked after
  New Roll, so undoing the first print no longer returns the documents as opened; the test now undoes the three steps.
- Browser roll spec: the mixed frame had no `baseT` override (`- true + false` at index 4). `frameSets` compared
  `read(doc, p) ?? null` (undefined → null) with the wanted `null` and skipped the set; the first print now always
  sets the mixed frame's base.

### What I learned
- `rt.store.peek(['roll'])` gives the plain (frozen) state; cells see tracking proxies, so `linksOf` strips before it
  compares identities (otherwise every read would make a new context and defeat the bridge's cache).

### What was tricky to build
- **"Unedited" after New Roll.** Linking puts a transaction on every frame; the looks kit and the agent call a frame
  "unedited" when every entry in effect is by `auto`. Linking changes no print, so the New Roll batch is by `auto`
  (the History still shows "New roll …").
- **Reading a linked field without the roll.** `read(doc, path)` without links returns the override or undefined;
  every UI read that shows a value must pass `linksOf(state)` (the arg renderer does).

### What warrants a second pair of eyes
- The bridge cache is now `WeakMap<LinkContext, WeakMap<Document, …>>`; the context object is memoised in
  `model/doc.ts` (module-level `lastLinks`), shared by every studio in the page (fine for one studio; two studios in
  one page would thrash it, not break it).
- `Studio.commit/propose` map medium paths through `storedMutations`: a caller that already writes
  `stages.scan.medium.overrides.x` is unchanged.

### What should be done in the future
- P5b-2: the stack kit should show a link entry as one row (name, Amount, Bake, Remove) and a linked medium's
  fields with a "roll" badge (override / follow); `cb.arg` readers that bypass `read(…, linksOf(s))` show nothing for
  a roll field.
- Darkroom media could link to the roll too once every reader resolves through `read(…, links)`.

### Code review instructions
- `packages/studio-kit/kits/roll/src/kit.ts` (`roll.fromFrames`, `analyse`, `roll.setShared`, `roll.followRoll`),
  `engine/model.ts`; `packages/studio-kit/src/model/doc.ts` (`read`, `physical`, `linksOf`).
- `pnpm exec vitest run packages/studio-kit/test/roll`.

### Technical details
- A frame after New Roll: `stages.scan.medium = { link: { roll: 'roll-1' }, overrides: { rebate: null, umPerPx: … } }`;
  after the first print a mixed frame also has `baseT: null`.

## Step 3: The looks kit on links

The looks kit was a parameter-edit engine (paths with set/add/mul, per-unit Amount rules, staleness of each set).
It is now a library over the contract's registered looks and the photographer's presets, and an apply is a link:
the look's entries go on top of each stack it touches, or the frame's link of that look is adjusted. What a look
does to a frame is described from its expansion at the Amount, the frame's looks have one Amount each with Bake
and Remove, sweeps are looks at fixed params, and sync either copies values (and the source's looks) or links one
preset made from the source's layers.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Built-in looks as groups, one batch per apply via plan, presets as parameterless
looks, sync as copy or link with the UI saying which; delete the parameter-edit looks.

**Inferred user intent:** A look is one fadeable, maskable, removable unit; applying it to a roll is one undo.

**Commit (code):** 660f5a6 — (same commit as Step 2)

### What I did
- New `engine/looks.ts` (`LookItem`, `lookItem`, `presetItem`, `lookItems`, `freshKey`, `appliedKey`, `itemParams`,
  `applyMutations`, `withLook`, `expansionOf`, `planFrame`, `planLook`, `changing`, `isUnedited`), `engine/describe.ts`
  (`lookLines`, `appliedLooks`), `engine/sweep.ts` (`ring` on the balance look, `along`), `engine/files.ts` (preset
  files version 3, "needs review" for unknown ops), `engine/diff.ts` (a link compared as one unit), `engine/groups.ts`
  (sync group "Looks" = `@link`).
- `model.ts`, `commands.ts`, `panels.ts`, `state.ts`, `kit.ts`, `dom.ts` rewritten around items and links; new
  commands `looks.setAmount`, `looks.bake` (link → group), `looks.remove`, `looks.syncMode`,
  `looks.saveLookAsPreset`; removed `looks.from`.
- Deleted `engine/look.ts`, `engine/amount.ts`, `engine/plan.ts`, `engine/builtin.ts`, `engine/provider.ts`.
- Tests: `test/looks/engine.test.ts` (12) and `test/looks/kit.test.ts` (11) rewritten; `test/chat/types.test.ts` no
  longer checks the provider.

### Why
- Design D2/D5: the Amount is the stage law's (a filter's density, a burn's time, a print layer's opacity), so the
  unit rules have nothing left to do; a sweep is a look over a parameter grid, so they are not needed there either.
- Sync by link has to keep the frames together: the source's layers go into a preset that the source and the
  targets link (the source prints the same, its layers now come through the link).

### What worked
- A preview is `edit(doc, applyMutations(…))` handed to the bridge, so tiles, the main view and the survey compile
  through the same path as the committed document; a tile's node equals the main view's after apply.
- Re-applying a look adjusts its link: no duplicate copies, one more step.

### What didn't work
- `planFrame(... 0.5)` for crisp-warm gave `Warmth R −0.7 pt` (0.0375 · 0.5 / 0.025 = 0.7499…); the test takes the
  rounded value.
- First agent-batch test inserted the same key on frame 3 from the user's side while the agent's insert was pending;
  `looks.batch.approve` returned undefined (the batch's proposal for that frame was no longer valid); the test now
  nudges the lights instead (a link never overwrites a value, so it is not stale).

### What I learned
- The agent card's staleness check (inverses of sets) never fires for link inserts: a look on its own filter does not
  overwrite the photographer's values, which removes the E_STALE / Apply anyway path from user applies.

### What was tricky to build
- **Lines need the image size.** The edge burn places its mask in document pixels; the kit's state-only selectors
  (tile captions) have no graph, so `lookLines` falls back to the look's name when it cannot expand, and command
  paths pass the size (`linksFor(ctx, f)` from the frame's graph).

### What warrants a second pair of eyes
- `looks.sync` in link mode removes the source's layers of the chosen groups and links the new preset in their
  place, in one batch with the preset's record on the main document; undo restores both. Check the source's print is
  identical (the kit test compares the display node).

### What should be done in the future
- "Update preset from this frame" (re-save a sync preset so every linked frame follows).
- Dedupe the two diff entries of a two-stage look in `diffDocs` (one per stage today).

### Code review instructions
- `packages/studio-kit/kits/looks/src/engine/looks.ts`, `model.ts` (`commit`, `commitFrames`, `presetFrom`),
  `commands.ts` (`looks.sync`).
- `pnpm exec vitest run packages/studio-kit/test/looks`.

### Technical details
- Apply on six frames at 60 %: one batch `look:warm-print:…`, label "Look: Warm print at 60 %", each frame gets
  `insert('stages.darkroom.stack', 'warm-print1-darkroom', { kind: 'link', …, amount: 0.6 })`.

## Step 4: The DSL's named looks as link inserts; LooksProvider deleted

The agent's `cb.looks` now builds the same links: `apply` queues the look's link inserts (or the adjustment of the
frame's link) on every target frame and the eval submits them as one batch; `whatIf` is a view with the link;
`diff` lists the mutations between two documents; `bake` is new. The DSL compiles every cut with the host's link
data (`DslSessionOptions.links`: rolls and presets as data), so a frame on a roll prints in the DSL too, and the
agent's worker gets that data in its snapshot.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The DSL's named looks become link inserts with a LinkContext; delete LooksProvider.

**Inferred user intent:** The agent and the photographer use one mechanism; the agent can name, try and apply looks.

**Commit (code):** 9c951df — "CHB-037 P7: the DSL's named looks are link inserts; the DSL compiles with the host's link data; LooksProvider deleted"

### What I did
- `packages/dsl/src/host/named-looks.ts` rewritten; `host.ts` (`linkSource`, `linkData()`, `links()` memoised,
  `compiledDocs()` per link context, `looks.bake` native); `host/cuts.ts` (compile with links; `applyTo` maps medium
  paths to overrides); `session.ts` (`links` option, context line through `readField`); `host/types.ts` (`DslLinks`
  replaces `LooksProvider`); `prelude.ts` (`cb.looks.bake`); topic `looks.md` and the vocabulary rewritten; `pnpm gen`.
- `packages/agent/src/worker/{protocol,client,server}.ts`: `DocsSnapshot.links`, `AgentDocs.links?()`, the worker's
  session reads them (P6a's package; four small edits).
- Deleted `packages/dsl/test/looks-provider.ts`; `test/looks.test.ts` rewritten (7 tests).

### Why
- P6a's note for P7: "the DSL compiles without a LinkContext … named looks then become link inserts and
  LooksProvider can go". Link data rather than resolver functions, because it must cross into the worker as JSON.

### What worked
- Whole repo: `pnpm typecheck` 0 errors, `pnpm lint`, `pnpm gen:check` (26), `pnpm test` 125 files, 2935 passed,
  19 skipped.

### What didn't work
- `cb.looks.apply('crisp warm')` → `E_UNKNOWN_OPTION no look "crisp warm"` (the label is "Crisp and warm"): names
  now also match their slug.
- The roll test expected the frame's stock to come from the roll; the frame's own stock differs from the roll's, so
  `linkMedium` kept it as an override — the expected behaviour; the test says so.

### What I learned
- The docs test runs every js block of the topic pages with its tag (`error=E_ARG_RANGE`), so the topic page is a
  second test of the vocabulary.

### What was tricky to build
- **Cache keys.** The DSL cached compiles per document (`WeakMap<Document, Compiled>`); with links the same document
  compiles differently when a roll changes, so the cache is now per link context (the host memoises the context on
  the identity of the host's data object).

### What warrants a second pair of eyes
- `looksDiff` is now the values `diff` in words (paths and ids), not the studio's darkroom-unit diff (that lived in
  studio-kit, which the DSL must not import).

### What should be done in the future
- P6b: `wb` can list the frame's links (`frame.links()`), and `frame.get` of a linked medium field could read through
  the link (today `frame.get('stages.scan.medium.stock')` on a frame on a roll is undefined: read the override path or
  the context line).

### Code review instructions
- `packages/dsl/src/host/named-looks.ts`, `host.ts` (`links`, `compiledDocs`), `host/cuts.ts`.
- `pnpm exec vitest run packages/dsl`, `pnpm gen:check`.

### Technical details
- Receipt: `{ status: 'queued', label: 'Look: Warm print at 50 %', frames: 2, link: 'warm-print1', layers:
  ['darkroom: filter {"logH":[-0.05,0,0.05]} × 0.5 (light and density)'] }`.
