# Contract requests from studio-kit (CHB-019)

> **Status (CHB-024, contract 0.3.0):** decided. Applied, adapted, deferred or noted item by item in
> `packages/contract/CONTRACT-DECISIONS.md`, section "Contract 0.3". Kept here as the record of the request.

## R1. `EditLog.preview` takes several mutations

**What.** `preview(m: Mutation | Mutation[] | null)`.

**Why.** A gesture that previews two paths of one frame at once (a look's parameter, a pad that moves the
lights and the density together, a test-strip band that sets time and filtration) can only put one mutation in the
log's overlay. The route keeps the shell's overlay as the readers' truth and puts only the last field into
`log.preview`; `log.state` is then wrong for the other paths during the gesture (only the agent reads it).

**Workaround now.** `EditLogRoute.preview` previews the last field written; the commit applies every field as one
unit, so nothing logged is affected.

**Proposed diff** (`packages/contract/src/editlog.ts`):

```diff
-  private overlay: Mutation | null = null;
+  private overlay: Mutation[] | null = null;
…
   get state(): FrameRecipe {
     if (!this.overlay) return this.committed;
-    if (!this.stateCache) this.stateCache = applyMutation(this.committed, this.overlay).recipe;
+    if (!this.stateCache) this.stateCache = this.overlay.reduce((r, m) => applyMutation(r, m).recipe, this.committed);
     return this.stateCache;
   }
…
-  preview(m: Mutation | null): void {
-    if (m) applyMutation(this.committed, m); // validate; throws on an invalid preview
-    this.overlay = m;
+  preview(m: Mutation | readonly Mutation[] | null): void {
+    const ms = m === null ? null : Array.isArray(m) ? [...m] : [m as Mutation];
+    if (ms) ms.reduce((r, x) => applyMutation(r, x).recipe, this.committed); // validate; throws on an invalid preview
+    this.overlay = ms && ms.length ? ms : null;
     this.stateCache = null;
-    this.emit({ type: 'preview', mutation: m });
+    this.emit({ type: 'preview', mutation: this.overlay?.[0] ?? null, mutations: this.overlay ?? [] });
   }
```

and in `LogEvent`: `| { type: 'preview'; mutation: Mutation | null; mutations: Mutation[] }`.

## R2. Move the frame vocabulary out of the DSL host

**What.** `ACCESSORS`, `PRINT_OPTIONS` and `cut(recipe, op)` in a shared module (contract or a small
`@chromobench/vocab`), imported by `packages/dsl/src/host.ts` and `packages/studio-kit/src/handles.ts`.

**Why.** Viewer and agent must name the same node for the same words. Today studio-kit keeps a copy;
`test/kit.test.ts` compares `PRINT_OPTIONS` with the DSL's and `cb.frame(s).print()` with `Host.printOf` on the M1
fixture, so a drift fails a test, but the copy should go (guide §14 item 9; CHB-017/CHB-007 decide where).

---

# Contract requests from the roll kit (CHB-020)

Guide `ttmp/2026/11/11/CHB-020--…/design-doc/01-intern-guide.md` §7. The kit works without them (workarounds
below); each removes a workaround.

## R3. `scan.baseT`: a roll-wide base

**What.** A settable path `scan.baseT: Vec3 | null` (veil-corrected linear value of the film base, the zero of
scanner density). `null` = measure on `scan.rebate` (today). `scan.density` uses it when set.

**Why.** `scan.rebate` is a box in one frame's pixels, so a roll's base (the median of its frames' rebates, the
thing roll setup measures) has no home; frames without film edge in view (cropped scans) can only be zeroed on
blank film inside the frame.

**Workaround now.** The first print writes each frame's own rebate box (ingest `filmLayout`: the film edge beside
the frame, never the sprocket holes); frames without film edge get a box of blank film inside the frame
(`W_REBATE_BLANK`, low confidence); the roll's median is evidence only.

**Proposed diff** (`packages/contract/src/recipe.ts`, `paths.ts`, `graph.ts`, the `scan.density` op):

```diff
 export interface ScanSettings {
   …
   /** null = automatic detection. */
   rebate: Box | null;
+  /** Linear value of the film base (veil- and flat-corrected); null = measure on `rebate`. Roll setup writes the roll's. */
+  baseT: Vec3 | null;
…
   'scan.rebate': OP,
+  'scan.baseT': custom('vec3 or null (linear)', (v) => (v === null || (Array.isArray(v) && v.length === 3 && v.every((x) => fin(x) && x > 0)) ? null : 'expected three positive numbers or null')),
…
-    n = I('scan.density', [n], s.rebate ? { rebate: s.rebate } : {});
+    n = I('scan.density', [n], s.baseT ? { baseT: s.baseT } : s.rebate ? { rebate: s.rebate } : {});
```

(`defaultRecipe`: `baseT: null`; the `scan.density` op gains an optional `baseT` vec3 arg that wins over `rebate`;
`migrateRecipe` adds `baseT: null`.)

## R4. `scan.flare: number | Vec3`, and engines that implement it

**What.** Widen `scan.flare` to `number | Vec3` (percent of the open-gate signal; a vec3 is per channel), and
implement the `scan.flare` op in core's RefEngine and the GPU engine (today only MockEngine has it).

**Why.** ingest's `filmLayout` reads the veil on the opaque holder per channel (Gold 200 sample: 0.009 %, 0.08 %,
0.08 % of the base in R, G, B — not equal) and divides it by the open gate when sprocket holes are in view. One
percent cannot hold that, and a recipe with `scan.flare ≠ 0` fails with `E_NOT_IMPLEMENTED` on core and GPU.

**Workaround now.** The host subtracts the veil from the decoded pixels before registering them (ingest
`subtractVeil`, as it heals dust there); recipes keep `scan.flare = 0`; the roll record holds veil and flare as
evidence.

**Proposed diff** (`recipe.ts`; the op's arg spec in `catalog/source-scan-invert.ts` gains a vec3 form):

```diff
-  /** Scanner flare, percent of the open-gate signal (per-channel flare deferred, see CONTRACT-DECISIONS). */
-  flare: number;
+  /** Scanner flare, percent of the open-gate signal; a vec3 is per channel (R, G, B). */
+  flare: number | Vec3;
```

## R5. `LoggedMutation.batch` and batch approval

**What.** `LoggedMutation.batch?: string`, the id of a cross-frame operation; `EditLog.apply` / `propose` take it,
`approve` / `reject` accept `{ batch }` and act on every entry of that batch in that log.

**Why.** The first print and "print the roll like this frame" write N independent EditLogs as one operation;
History and the approval card should group them, and an agent's roll-wide proposal needs one approval.

**Workaround now.** Roll batches share one `tx` prefixed `roll:` (also how a later match tells a roll batch from a
hand edit), applied through `EditLogRoute.applyBatch` (one global undo step, one part per frame); the match is a
user action previewed in the kit's view state, not an EditLog proposal.

**Proposed diff** (`mutations.ts`, `editlog.ts`):

```diff
 export interface LoggedMutation {
   …
   tx?: string;
+  /** Cross-frame operation this entry belongs to (a roll batch); the same id in every frame's log. */
+  batch?: string;
…
-  apply(ms: readonly Mutation[], by: Exclude<Author, 'agent'>, label: string, opts: { tx?: string } = {})
+  apply(ms: readonly Mutation[], by: Exclude<Author, 'agent'>, label: string, opts: { tx?: string; batch?: string } = {})
-  propose(ms: readonly Mutation[], meta: { tx: string; why?: string; label?: string })
+  propose(ms: readonly Mutation[], meta: { tx: string; why?: string; label?: string; batch?: string })
-  approve(seqs: readonly number[], opts: ApproveOptions = {})
+  approve(which: readonly number[] | { batch: string }, opts: ApproveOptions = {})
```

## R6. `FrameRecipe.roll` and a `Roll` record

**What.** `FrameRecipe.roll?: { id: string }` (informational, outside the path schema), and `Roll` /
`RollFragment` types for the catalog and a `roll.json` sidecar beside the frames: `{ id, label, frames, fragment:
Record<SharedPath, unknown>, analysis, reference, match, status }` (today `kits/roll/src/engine/model.ts`).

**Why.** A frame's sidecar should say which roll it belongs to; the roll record should be defined once for the
catalog, the sidecar and CHB-013's fixture layout.

**Workaround now.** The roll record lives in the kit's document slice `roll` (persisted with the document tier).

## R7. Diagnostic codes

`W_ROLL_MIXED` (a frame's base beyond 0.03 D of the roll's), `W_ROLL_STOCK_AMBIGUOUS` (top two stocks within
0.025 D), `W_ROLL_BASE_WEAK` (no confident rebate on the roll), `W_FRAME_DIVERGES`, and ingest's `W_NO_SURROUND`,
`W_SURROUND_BRIGHT`, `W_REBATE_BLANK`, `W_NO_REBATE`, `W_NO_FILM`: add them to the contract's diagnostic table.

# Contract requests from the looks kit (CHB-021)

Status: none needed to ship. Contract 0.3 already has what the looks kit uses: `LoggedMutation.batch` on
`EditLog.apply` / `propose`, `approve({ batch })` / `reject({ batch })`, `fieldSpec` / `checkSet` for the Amount
rules and range checks, `MOVED_PATHS` for preset migration, `PRINT_OPTION_PATHS` for the what-if form of a look.
Two candidates for a later contract step, neither blocking:

## R8. (optional) Kit diagnostic codes

The kit reports `CB-L110` (Amount leaves a path's range; fix = the clamped value), `CB-L111` (clamped silently),
`CB-L120` (a look sets a roll-balance path absolutely on a frame of a roll; the guide's `CB-LOOK-CONFLICT`) and
`CB-L130` (a preset path migrated). They are kit codes (like CB-R…) built as plain `Diagnostic` objects, because
`diag()` takes only the contract's closed `ErrorCode` list. If they should reach the agent through the DSL with a
contract meaning, add `W_LOOK_RANGE`, `W_LOOK_CONFLICT`, `W_PRESET_MIGRATED` to `ERROR_CODES`.

## R9. (open question 12.1) Symbolic looks

Looks resolve to plain `set` mutations (decided). If the photographer wants "change Amount later" or "update the
look and re-sync the roll", the recipe would need `looks: [{ id, params, amount }]` folded before explicit edits —
a fold change for every consumer. Not requested now; the batch id (`look:<id>:…`) and the unit label
("Look: warm print at 60 %") already record which look made a unit, so a "reapply" command can be built without it.
