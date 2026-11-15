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
