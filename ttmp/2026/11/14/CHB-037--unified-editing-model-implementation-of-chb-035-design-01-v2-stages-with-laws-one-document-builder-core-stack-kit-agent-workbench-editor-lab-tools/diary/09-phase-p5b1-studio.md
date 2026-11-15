---
Title: Diary — phase P5b-1 studio
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
LastUpdated: 2026-11-15T00:11:14.09127-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

The phase agent's record of phase P5b-1 of CHB-037: the studio on format-3 documents and the one document log.
packages/studio-kit (core, finish, looks, roll, chat kits, layouts, demo), apps/studio, packages/output,
packages/ingest and e2e/ move from the recipe and the two old histories (the shell's patch history and the
contract's EditLog, both deleted by P2a and P4) to documents opened in the shell store's values Log under the
contract's LOG_RULES. Spec: plan `design-doc/01-implementation-plan-and-working-rules.md` §7 "P5b-1" with the
amendments after P0, P1, P2a, P5a, P3 and P4; design: CHB-035 design 01 v2 (opening, §20–§29, §32–§33).

## Step 1: Reading the spec, the design and the code; the decisions the spec leaves open

The main agent assigned me phase P5b-1. Before writing code I read the working rules and the P5b-1 spec with every
amendment, the design's opening and §20–§29, §32–§33, the phase diaries 04 (P5a), 05 (P2a), 06 (P2b), 07 (P3) and
08 (P4, Step 5: the store and log API), packages/shell/README.md, packages/values/README.md, and the code I own:
studio-kit's core (studio.ts, cb.ts, sel.ts, handles.ts, the bridge, model, kit, commands, dom), the kits, the
layouts, apps/studio's main.ts and host, and the e2e helpers. The size (studio-kit 13.7k lines, apps/studio 5k,
e2e 2.2k, output 2.6k, ingest 6.5k) made me split the work: I write the studio-kit core myself (every other part
builds on its API), then hand independent parts to forks of myself that inherit this context (output and ingest
first; then the finish kit, the looks and roll kits, and apps/studio in parallel; the e2e specs last), and commit
each part after checking it.

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together
and add the editor lab functionality / consolidate it all."

Later direction from the owner (verbatim): "unify all of it, we don't have backwards compatibility needs or wrapping
or so, we can do hard cutoff, now is the time to strive for elegance and consistency and all that. nothing is not
worth it if it creates a more robust and simple core"

**Assistant interpretation:** The main agent assigned me P5b-1: every consumer of the old recipe and the old
histories (studio-kit, apps/studio, output, ingest, e2e) onto document format 3 and the values log, with today's
features, a hard cut-off for stored state, and the checks (typecheck, vitest, lint, gen:check, the browser suite on
SwiftShader on ports 5561–5564).

**Inferred user intent:** The photographer's studio runs on the one editing model (documents, laws, one compiler,
one history) without a second path, so the stack kit (P5b-2), the workbench (P6b), links (P7) and the Editor lab
tools (P8) build on it.

### What I did
- Read the documents above; `pnpm install --frozen-lockfile --prefer-offline` in the worktree.
- Added per-package tsconfigs (`packages/{studio-kit,output,ingest}/tsconfig.json`, `apps/studio/tsconfig.json`).
  First counts: studio-kit 347 errors, apps/studio 373 (with studio-kit's), output 26, ingest 2.
- Created this diary (`docmgr doc add --ticket CHB-037 --doc-type diary --title "Diary — phase P5b-1 studio"`),
  renamed `09-diary-phase-p5b-1-studio.md` to `09-phase-p5b1-studio.md`.

### Why
- The store and log API (P4 Step 5) and the document model (P2a) fix most of the shape; the decisions below are
  the ones they leave to the studio.

### What worked
- The P4 store already does what the old EditLog route did by hand: a transaction's writes under a mounted
  document become that document's net change (values `diff`), several documents one batch, one step.

### What didn't work
- `grep -rn … --include=*.ts` under zsh: `no matches found: --include=*.ts` (P4 saw the same); plain `grep -rln`.

### What I learned
- The studio imports `@chromobench/agent` (the chat) at the top of main.ts, and studio-kit's tests import
  `@chromobench/dsl`; both are being rewritten by P6a. An ES module that imports a missing export fails to link, so
  the app would not boot until P6a lands: the chat must load lazily, and the tests must not import the DSL.
- `output.frame` exists in core and in the contract's compile (the display cut) but not on the GPU (P3): the
  studio's engine wrapper keeps the host implementation for the GPU.

### What was tricky to build
- N/A (reading).

### What warrants a second pair of eyes
- The decisions below.

### What should be done in the future
- N/A for this step.

### Code review instructions
- Nothing to review yet.

### Technical details

Decisions the spec does not make (the code follows them):

1. **Mount `docs`**, not `recipes`: `k.mount('docs', { keyDepth: 1, kind: 'frame', checkPath })`; a frame's
   document shows at `docs.<frameId>` in its physical tree. The word "recipe" leaves the studio.
2. **Paths.** Controls name document paths (`main.params.time_s`, `lights.params.logH`,
   `stages.darkroom.medium.paper`); a write goes to `['docs', f, ...resolvePath(doc, path).phys]`
   (`storePath`), and the log records the id-anchored path. Control models: media/geometry/output fields from the
   contract's `schemas()` (the consuming op's ArgSpec with ui), layer arguments from the entry's op (`main`:
   expose, `lights`: filter, any other id: the document's entry, or at build time the first layer op with that
   argument).
3. **Bursts become coalescing.** The route's 800 ms burst (preview, then one apply) is gone: a key press, wheel
   step or nudge commits at once with `coalesce: '<frame>:<path>'`, and the store folds a run of them within 1.5 s
   into one step. Behaviour change: the step appears at the first press (not after the pause).
4. **The library is the view tier** (`catalog` is a view prefix): opening a file adds a library entry without an
   undo step. Behaviour change: flags, stars and colour labels are not undone by Mod+Z (they were steps before).
5. **One cursor.** The History panel lists the steps that touched the frame; a click moves the log's one cursor
   there (other frames' steps after it are undone too). CB-H401 (a skipped undo) cannot happen any more.
6. **Saved edits per frame** (`bridge/saved.ts` `FrameSave`): initial document, transactions in effect, pending
   proposals, under the old key (sha:mode[:index]); on open the frame is opened with the saved initial state and
   the transactions are committed again in order (one step each) and the proposals proposed again. So History,
   `why` and Undo reach edits from before a reload. Behaviour change: those restored steps are on the undo stack.
7. **Hard cut-off on storage**: `resetStorage(kv)` clears the stores that held the old formats once (a
   `settings/storage-format` marker) and the host says so (`STORAGE_RESET_MESSAGE`). A saved record of another
   format is never read.
8. **Proposals for the panels**: the Studio publishes `ui.log = { v, proposals }` after every log change (a
   proposal changes no document, so no cell would see it otherwise); a card's "Show" renders
   `log.draft(f).apply(...).value`. Partial approval (unchecked changes) rejects the proposal and proposes and
   approves the checked changes in its place, in one step.
9. **The agent mode is host policy** (`studio.mode`): read-only refuses (E_READONLY), ask proposes, auto commits
   as the agent. The StudioLog (inert writes rewritten by the log) is deleted: the studio's own copy edits (looks,
   a roll's match, Apply Print Settings) pass through `withoutInert`; a direct write of an inert value by a script
   or the agent is recorded and changes nothing on the print.
10. **Preflash** is a darkroom layer (`+ preflash` in the Exposures panel), not a Paper control.
11. **Frame handles name cuts** (`print`, `finished`, `display`, `negative`, `scan`/`scene`, `source`); the
    print-time what-if options (`print({ time_s })`) are gone with the contract's vocabulary module.

## Step 2: output and ingest on documents (a fork of me)

The two packages that only consume the model went first, in a fork of me that inherited the reading of Step 1,
while I started the studio-kit core. Output exports the document's display cut (`output.frame` over
`output.display`, compiled with the export's space) and carries the document instead of a recipe; ingest's dust
detection now produces scan-stage heal layers with an explicit source instead of healing pixels at decode.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Spec items "ingest's dust detection produces heal layers with an explicit src" and
"output's export on documents (documentSha256)".

**Inferred user intent:** Dust becomes something the photographer sees and can undo (layers), and an export says
which document made it.

**Commit (code):** 849a9ea — "CHB-037 P5b-1: output and ingest on documents (export of the display cut,
documentSha256, the document as sidecar or embedded; dust detection as scan-stage heal layers with an explicit src
in a Dust group)"

### What I did
- ingest: new `src/conditioning/dust/layers.ts`: `dustSpots(rgb, w, h, Treb, o?) → HealSpot[]` (detection as
  decode's `healDust` did it, then `chooseSources`), `dustGroup(spots) → Group` (pass group "Dust", one `heal`
  layer per speck `dust-N` with spot id `dust-N-s`, provenance `{ kind: 'auto', by: 'ingest.dust' }`),
  `DUST_GROUP_ID = 'dust'`; `toRecipeSpots` and the contract `DustSpot` import deleted; `@chromobench/values` added
  to ingest's dependencies (`pnpm install --no-frozen-lockfile --prefer-offline`, 3 lockfile lines).
- output: `exportNode(doc, g, opts)` (display cut), `documentSha256(doc)` (sha256 of `canonicalJSON(doc)`),
  `documentPayload`, `sidecarName` (`x.png` → `x.chromobench.json`); `ExportRequest.recipe` → `document`,
  `EncodedFile.recipeSha256` → `documentSha256`, PNG keys `chromobench:document-sha256`/`chromobench:document`.
- tsconfigs: output adds `"types": ["node", "@webgpu/types"]` (canvas.ts).

### Why
- The dust is a list of heal layers (design §23 "scan.dust.spots[] → scan-stage heal layers (in a group Dust)");
  the contract's heal spot needs an explicit `src` (P2b), which detection must choose.

### What worked
- `pnpm exec tsc -p packages/{output,ingest}/tsconfig.json --noEmit` clean; `pnpm exec vitest run packages/output
  packages/ingest` → ingest 11 files 970 passed 11 skipped, output 4 files 79 passed; `pnpm lint` ok.

### What didn't work
- `TS2322: Type 'Coll<{…}>' is not assignable to type 'Json'` passing a Coll as heal params: the contract tests'
  idiom `Coll.of(...) as unknown as Params[string]`.
- A first edge test failed (`expected +0 to be 1`): a speck 4 px from a density edge scores 0 (the edge widens the
  local noise, 0.088 against a contrast of 0.167); the detection half moved the speck away from the edge.
- `TS2305: no exported member 'toRecipeSpots'` in `test/dust.test.ts`: assertion dropped, neutrality kept.

### What I learned
- Spot ids live in a Coll inside the layer's params, so they must be unique in the whole document too
  (`dust-3-s`, not `s1`).

### What was tricky to build
- The source choice: candidates on rings of 2.5–6 r in eight directions, inside the image and off every target;
  cost = variance of the source disc + (its mean − the target surround's mean)², slightly penalising distance.

### What warrants a second pair of eyes
- `chooseSources` drops a speck that has no clear candidate (crowded dust); the old pixel heal healed it anyway.

### What should be done in the future
- N/A.

### Code review instructions
- `packages/ingest/src/conditioning/dust/layers.ts`, `packages/output/src/export/run.ts`, `encode/metadata.ts`.
- `pnpm exec vitest run packages/output packages/ingest`.

### Technical details
- Behaviour changes: the sidecar is `.chromobench.json` (was `.recipe.json`) holding the canonical document JSON;
  output tests export the display cut including `output.frame` (core implements it).

## Step 3: The studio-kit core on documents and the log

I rewrote the core in one pass, because its parts depend on each other: the document helpers, the control models
on document paths, the frames without logs, the Studio as the log's host, the render bridge on cuts, the
selectors, cb.core's mount, the commands, the panels and the control renderer. The EditLog route (384 lines), the
StudioLog, `recipes.ts` and `enlarger.ts` are deleted; what they did is either the store's own behaviour now (a
transaction's net change per document, batches, drafts, coalescing) or a small pure function on documents.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The spec's core items: mount and `store.open` per frame, LOG_RULES at start, delete
the route and the StudioLog, controls on document paths, the darkroom tools on layers and masks as values.

**Inferred user intent:** One history and one document in the studio, with nothing in between.

**Commit (code):** (with the kits and the tests, Step 5)

### What I did
- New `src/model/doc.ts`: well-known ids (`main`, `lights`, `retouch`, `dust`), `read`/`physical`/`storePath`,
  `entriesOf`/`findEntry`/`layerOf`/`nextId`/`paramsOf`, the darkroom (`mainExposure`, `lightsOf`, modes,
  `isInert`, `exposureStep`, `withoutInert`, `withEnlargerMode`), `exposureRows`/`printingScript` through the
  contract's `termSeconds`, `newDarkroomLayer`, `defaultDocument`.
- `model/controls.ts`: `documentControls()` from `schemas()`, `layerControl(op, id, arg)`; `kit/args.ts`:
  `modelAt(path, doc?)`, `argModel(path, doc?)`, `argProblem` on document paths.
- `model/tools.ts`: test strip and ring-around on the main exposure and the lights; `maskedLayer` (a mask value
  with one component, feather in mm from the print's pitch, and a burn through it), `addDarkroomLayer`.
- `model/history.ts`: `describe` for the four mutations, `historyRows(log, f)`, `whyRows(log, f, path)` on
  `log.trail`. `model/settings.ts`: view modes and `copySettings`.
- `bridge/frames.ts`: FrameEntry holds the graph, the first document and the saved edit; `stripFrameDocument`,
  `rescaleStrip`. `bridge/saved.ts`: `FrameSave`, `frameSave`, `restoreFrame`/`replayFrame`, `resetStorage`.
  `bridge/kv.ts`: `keys(store)` (memory, localStorage; IndexedDB in apps/studio/src/storage/db.ts).
- `studio.ts`: opens/closes documents in the store, restores saved edits, saves per frame, publishes `ui.log`,
  `commit`/`change`/`propose`/`approve`/`approveBatch`/`reject`/`jump`, the agent mode.
- `handles.ts` (cuts), `bridge/render-bridge.ts` (compile → cut → shown; test strip bands as documents),
  `sel.ts` (`doc`, `proposals`, `logVersion`), `cb.ts` (`mount('docs', …)`, state options), commands, panels,
  `dom/arg.ts` (writes at `storePath`, coalescing nudges), layouts' paths, the demo's hook, docs/HANDOFF.md.

### Why
- See Step 1's decisions; each deleted piece had a direct replacement in values or the shell.

### What worked
- `pnpm exec tsc -p packages/studio-kit/tsconfig.json --noEmit`: no error left in `src/`, `demo/`, `kits/chat`
  after three fixes (below); the kits and the tests are the forks' (Step 4).

### What didn't work
- `src/index.ts(22,1): error TS2308: Module './model/controls.ts' has already exported a member named
  'componentOf'` (the mask helper had the vec3 helper's name): renamed it `maskComponent`.
- `src/model/controls.ts(189,40): error TS2322: Type 'string' is not assignable to type 'Area'`: the media models
  pass their stage as the area (cast).
- `src/model/doc.ts(298,171): error TS2339: Property 'id' does not exist on type 'Layer'` (an entry has no id;
  its place has).
- The modules' `txOpts: s => ({ channel })` no longer typecheck (`Type '(s: any) => { channel: string | null; }'
  is not assignable to type 'TxOpts'`): channels are gone with P4; `docName`/`currentDoc` say where a step is.

### What I learned
- A proposal changes no document, so no cell sees it: the Studio's `ui.log` counter is what makes the panels
  redraw on propose, reject and approve.

### What was tricky to build
- Restoring a saved frame: the store mounts a document with `store.open`, and only then can `store.change`
  replay its transactions; a replay that fails must close it again and open the first document instead.
- `catalog` had to move to the view tier: every main-document write is a step of the log now, so cataloguing a
  frame on open would have put "Add frame" on the undo stack.

### What warrants a second pair of eyes
- `studio.ts` `added()` (re-open in the other mode with the same id closes and reopens the document) and
  `afterLog()` (the save signature per frame).
- `history.ts` `historyRows` folds each mutation separately to describe the next against the state before it.

### What should be done in the future
- The log keeps every step of a session; `compact(n)` in values (P4's note) when sessions get long.

### Code review instructions
- Start at `packages/studio-kit/src/studio.ts`, then `model/doc.ts`, `bridge/saved.ts`, `dom/arg.ts`.

### Technical details
- Deleted: `src/bridge/editlog-route.ts`, `src/model/enlarger.ts` (StudioLog), `src/model/recipes.ts`.
