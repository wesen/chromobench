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
`test/kit.test.ts` compares `PRINT_OPTIONS` with the DSL's and `cb.sel.frame(s).print()` with `Host.printOf` on the M1
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

---

# Contract requests from the finish kit (CHB-022)

Contract 0.3 already gave CHB-022 `view.frame`, `retouch.spots.<id>` with null-delete and the `retouch.heal` node.
These are what is still missing. Nothing below blocks the kit; each has a local workaround.

## F1. `retouch.heal`: the doc no longer says "stub", and names the order and the algorithm

**What.** Replace the last sentence of the op's `doc` and say how spots are ordered.

**Why.** core, the GPU and the mock implement it now (no `W_PREVIEW_APPROX`). The composite order is the natural
order of the spot ids (`s2` before `s10`), because `canonicalJSON` sorts the record's keys and the insertion order
is lost; the doc should say so, since the order decides which spot covers which.

**Proposed diff** (`packages/contract/src/catalog/view-output-mask.ts`):

```diff
-    doc: 'Heals and clones circular spots on the print (after view.adapt, before finishing). Every source is read from the image before retouching; a later spot covers an earlier one. Contract 0.3 stub: the engines pass the image through with W_PREVIEW_APPROX until CHB-022 implements it.',
+    doc: 'Heals and clones circular spots on the print (after view.adapt, before finishing). Every source is read from the image before retouching; spots are composited in the natural order of their ids (s2 before s10), a later one covering an earlier. Clone copies the source disc (bilinear at pixel centres); heal multiplies it by exp(u), u the harmonic (Poisson-integral) extension of log T − log S on the ring r + ½ … r + 2½ (core print/retouch.ts).',
```

## F2. Crop validity where the frame size is known: `compile()` or `cropFits` in `frame.ts`

**What.** A `view.frame` whose crop, turned by the angle, leaves the frame should be refused with the largest valid
box as the fix (guide §3.1). `assertRecipe` cannot do it (a recipe does not know the frame's size); `compile()` can,
because the graph has the source's `SourceInfo`.

**Why.** The finish kit never writes such a frame (its tools and commands keep the crop inside), but an agent or an
old recipe can. Today such a frame renders with empty (0) corners.

**Workaround now.** `cb.kits.finish.cropProblem(recipe, W, H)` → `CB-F110` with the fix, shown in the crop panel,
and the command `crop.fix` (Finish menu) applies it. The geometry is `kits/finish/src/geometry.ts`
(`fitsInside`, `constrain`), pure, so the contract can take it as it is.

**Proposed diff** (`packages/contract/src/frame.ts` plus one call in `graph.ts` `compile`):

```diff
+/** The crop's sampled region (the box turned by −sign·angle about its centre) lies inside the W × H frame. */
+export function cropFits(crop: Box, angle_deg: number, orientation: Orientation | string, W: number, H: number): boolean {
+  const t = (-sensorAngleSign(orientation) * angle_deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
+  const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
+  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, b]) => {
+    const u = (a! * crop.w) / 2, v = (b! * crop.h) / 2;
+    const x = cx + u * c - v * s, y = cy + u * s + v * c;
+    return x >= -1e-6 && y >= -1e-6 && x <= W + 1e-6 && y <= H + 1e-6;
+  });
+}
```

```diff
   const f = r.view.frame;
+  const src = g.sourceInfo?.(r.source.sha256);
+  if (src && f.crop && !cropFits(f.crop, f.angle_deg, f.orientation, src.width, src.height))
+    fail('E_ARG_RANGE', `view.frame: the crop turned by ${f.angle_deg}° leaves the ${src.width} × ${src.height} frame`, { path: 'view.frame.crop' });
   return g.intern('output.frame', [d], …
```

(Or a `W_CROP_OUTSIDE` warning instead of a failure, if old recipes must keep rendering.)

## F3. `finishing.tone` and `finishing.saturation` (guide §3.3)

**What.** Two finishing ops on `print-xyz`, before `output.display`, `ui.group: 'Finishing'`, and their recipe fields
`finishing.values.shadows | highlights | contrast | saturation`, compiled after `retouch.heal` like
`finishing.clarity`.

**Why.** The Finishing panel offers only Clarity today, because that is the only finishing value `compile()` turns
into a node. Shadows, highlights and an S-curve on print lightness (chroma held) are what the photographer asks for
after the print.

**Proposed op** (`packages/contract/src/catalog/measure-darkroom-finishing.ts`):

```ts
defineOp({
  name: 'finishing.tone', area: 'finishing', owner: 'CHB-022', on: 'Image', returns: 'Image', domainIn: 'print-xyz', domainOut: 'print-xyz',
  class: 'pointwise', binding: 'setting', recipePath: 'finishing.values',
  args: {
    shadows: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0, path: 'finishing.values.shadows', doc: 'Lift (+) or deepen (−) the shadows, on print lightness, chroma held.', ui: { widget: 'slider', step: 0.01, label: 'Shadows', group: 'Finishing', bipolar: true } },
    highlights: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0, path: 'finishing.values.highlights', doc: 'Pull (−) or push (+) the highlights.', ui: { widget: 'slider', step: 0.01, label: 'Highlights', group: 'Finishing', bipolar: true } },
    contrast: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0, path: 'finishing.values.contrast', doc: 'An S-curve about mid-grey.', ui: { widget: 'slider', step: 0.01, label: 'Contrast', group: 'Finishing', bipolar: true } },
  },
  doc: 'Finishing tones on print lightness (digital, after the print; not a darkroom control).',
}),
```

and in `compile()`, after `finishing.clarity`:

```diff
+  const tone = ['shadows', 'highlights', 'contrast'].map((k) => r.finishing.values[k] ?? 0);
+  if (tone.some((x) => x !== 0)) v = I('finishing.tone', [v], { shadows: tone[0], highlights: tone[1], contrast: tone[2] });
```

The kit's `FINISHING_PATHS` grows by these paths once they exist; the engines (core, GPU, mock) come with them.

## Notes (no contract change)

- `finishing.clarity` is implemented by the mock engine only; core and the GPU fail with `E_NOT_IMPLEMENTED` when
  Clarity is not 0. The `classic` variant's Finish module therefore leaves the tones panel out (`tones: false`);
  the `finish` variant shows it. For CHB-015.
- `scan.heal` (dust on the film) is a pass-through in the mock and missing in core and the GPU. The spot tool offers
  its Dust mode only when the engine lists `scan.heal` and the frame is a negative scan; the default mode is Heal.


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

# Contract requests from CHB-027 (WS-A, open mode)

## R10. The decode mode is part of a source's identity in the graph

**What.** `source.open` takes `mode: 'scan' | 'photo'` (bound from `source.decode.mode`, like `encoding`), so its
node id, and every id downstream, differs between a file opened as a negative and the same file opened as a photo.
Optionally `Engine.open(source, o?: { decode?: Partial<DecodeOptions> })`, so the decode mode reaches an engine
without a host-side opener.

**Why.** CHB-027 lets the photographer re-open a frame as a photo or as a negative (F3, F6). The same file is then
decoded differently (camera RAW: CFA-binned scan mode vs demosaiced photo mode, different working sizes), but
`source.open(sha, encoding)` names the same node, so every engine would serve cached results and stale node infos
(sizes) of the old decode.

**Workaround now.** `RefEngine.forgetSource(sha)` and `GpuEngine.forgetSource(sha)` (host glue next to
`openDecoded`) drop cached results and rebuild the engine graph; `StudioEngine` replaces its graph and calls them
when a sha is registered again in another mode; each frame entry gets a fresh `Graph`. Studio-kit passes the mode
through its own `SourceOpener`, not `Engine.open`.

**Proposed diff** (`packages/contract/src/catalog/source-scan-invert.ts`):

```diff
     args: {
       source: { type: 'string', path: '', doc: 'SHA-256 of the source file (FrameRecipe.source.sha256); the engine must have opened it.' },
       encoding: { type: 'enum', values: ['linear', 'srgb', 'gamma22'], default: 'linear', doc: 'Transfer encoding of the stored samples.', ui: { widget: 'segmented', label: 'Encoding', group: 'Source' } },
+      mode: { type: 'enum', values: ['scan', 'photo'], default: 'scan', doc: 'How the file was decoded (FrameRecipe.source.decode.mode): a negative scan or a photo. Part of the source identity.' },
     },
```

Engines then key their sources by `(sha, mode)` (`openDecoded(info, data, mode)`).
