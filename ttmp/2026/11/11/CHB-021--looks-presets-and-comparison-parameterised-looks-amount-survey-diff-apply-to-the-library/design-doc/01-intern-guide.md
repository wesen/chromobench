---
Title: 'Intern guide: Looks, presets and comparison'
Ticket: CHB-021
Status: active
Topics:
    - ui
    - product
    - dsl
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://packages/contract/src/editlog.ts
      Note: propose, expect, stale handling
    - Path: repo://packages/contract/src/paths.ts
      Note: fieldSpec, getPath, settable paths
    - Path: repo://packages/contract/src/spec.ts
      Note: ArgSpec and UiHints for param and Amount rules
    - Path: repo://packages/contract/src/units.ts
      Note: unit conversions for Amount and diff
    - Path: repo://packages/dsl/src/docs/topics/editing-and-approval.md
      Note: agent counterpart style
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/src/app/develop-model.js
      Note: scalePreset, KEEP, SYNC_GROUPS
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/src/app/develop-scopes.js
      Note: reference render and Match
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/src/app/develop.js
      Note: presets panel, snapshots, sync dialog
ExternalSources: []
Summary: 'Looks kit (cb.looks): presets, parameterised looks, Amount as a recipe pass, survey/diff/compare, apply as one batch, storage and library UI.'
LastUpdated: 2026-11-11T15:10:21.098253573-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Looks, presets and comparison

## 1. What this ticket builds

A photographer who prints a roll of negatives wants to say "make this frame look like that", try four treatments side by side, pick one, tone it down, and put it on the other frames of the roll. Lightroom calls these presets, Amount, Survey and Sync. Dehancer and Negative Lab Pro call them film looks. This ticket builds the same capabilities for chromobench as the **looks kit**: `packages/studio-kit/kits/looks`, namespace `cb.looks.*`, installed in a variant with `.use(looksKit)`.

The constraint from the UI design brief is that the kit is nothing but JS API: every panel, tool and command is a builder call a variant may use, rearrange or omit, and everything the kit does for a person at a mouse the agent can do from the DSL, with the same names. A variant that leaves out the looks library still gets `frame.look(...)` and the diff pass; a variant that wants a one-button "warm / cool" toggle can build it from the same parts.

What the kit provides:

- **Presets**: named bundles of recipe edits (paper, grade, lights offsets, film-stock settings) that can be applied, scaled and shared as files.
- **Looks**: presets with parameters, written as a small JS function ("warm print" with a `warmth` slider in printer points).
- **Amount**: apply any preset or look at 0 to 200 %, with scaling rules that respect darkroom units.
- **Comparison**: before/after against a snapshot, A/B against a reference frame, a survey of N looks on one frame, a ring-around as a special survey.
- **Diff**: a pass that says which recipe paths differ between two recipes and by how much, in darkroom units.
- **Apply**: to the selection, a roll, a collection or the library, as one mutation batch, with sync groups and staleness handling.
- **Storage**: where presets, looks and snapshots live, and the library UI that browses them.

The ticket does not build the film physics (CHB-012), the roll workflow (CHB-020), the ring-around tool's tile layout (CHB-019, see 8.4) or the shell (CHB-018). It depends on CHB-019 for `cb.arg`, `cb.viewer`, the frame handle and history adapter, and on CHB-012 only for the film-look content in stage 8. Stages 1 to 7 run against the mock engine.

Throughout this guide **Amount** is the scale factor k (0 to 2) applied to a preset or look; **recipe** is a frame's settings document (`FrameRecipe`, `packages/contract/src/recipe.ts`); a **mutation** is one recipe change from the closed set in `packages/contract/src/mutations.ts` (`set`, `exposure.add`, `exposure.remove`, `mask.set`, `frame.add`); an **EditLog** is the per-frame append-only journal that folds into the recipe (`editlog.ts`).

## 2. Definitions

### 2.1 Preset

A preset is a *partial recipe*: a list of path entries, each either an absolute value or an offset.

```ts
type PresetEntry =
  | { path: string; set: unknown }                 // absolute: print.grade = 3
  | { path: string; add: number | number[] };      // offset in the path's own unit: print.lights.logH += [0.10, 0, -0.05]

interface Preset {
  format: 'chromobench.preset'; version: 1;
  id: string;                    // slug, unique in the library
  name: string; group?: string; notes?: string;
  entries: PresetEntry[];
  exposures?: ExposureInput[];   // dodge/burn/flash rows to add (exposure.add)
  requires?: { source?: 'film-scan' | 'digital-raw' | 'any' };
  amount?: Record<string, AmountRule>;   // per-path overrides of the default rule (section 4)
  contract: string;              // recipe contract version it was written against
}
```

Offsets exist because a roll is balanced frame by frame: frame 12 has `print.lights.logH` of `[0.31, 0.02, -0.07]` and frame 13 something else. A preset that says "warmer by 4 pt" is meaningful on both; a preset that sets lights absolutely wipes out the balance work. Absolute entries are right for things that have no balance: paper, grade, stock, grain size.

A preset has no code and no parameters. It is data, safe to share as a file and safe to read in any tool.

### 2.2 Look

A look is a **JS function with declared parameters** that produces recipe edits for a given frame and parameter values. The declaration is a builder:

```js
const warmPrint = cb.look('warm print')
  .group('Print')
  .param('warmth', cb.slider(0, 10, { unit: 'pt', default: 4, label: 'Warmth' }))
  .param('density', cb.slider(-1, 1, { unit: 'stop', step: 1 / 6, default: 0, label: 'Density' }))
  .edits((f, p) => ({
    'print.lights.logH': cb.add(units.pt([p.warmth / 2, 0, -p.warmth / 2])),
    'print.enlarger.time_s': cb.add(units.stop(p.density)),
  }))
```

(Which sign of light means "warm" is a physics question for the print-chain people; the shape of the call is what matters.) `cb.slider(0, 10, { unit: 'pt' })` is not a new widget kind. It builds an **ArgSpec-shaped** parameter (`type: 'number'`, `unit`, `min`, `max`, `default`, `ui`), the same shape the registry uses (`packages/contract/src/spec.ts`). That gives parameters three things for free: the same per-value check (`checkArgValue`, so out-of-range is `E_ARG_RANGE` with the same message in the UI and for the agent), the same control generation as `cb.arg`, and DSL documentation generated from the declaration.

A look body may return one of two things:

- a map from path to `cb.set(v)` / `cb.add(delta)` / plain value (an absolute set), the preferred form; or
- a **what-if handle**, using the same options the DSL already accepts: `(f, p) => f.print({ lights: units.pt([p.warmth, 0, 0]), grade: 3 })`. The what-if options of `frame.print(opts)` (`paper, time_s, fstop, filtration, lights, grade, preflash, illuminant, flare`, see the `darkroom-vocabulary` topic) map one to one onto recipe paths, so the handle's overrides *are* a path map. A helper `lookEdits(handle)` reads them back. This is the "pipeline" form the ticket description mentions. It is convenient for looks that think in terms of the print, but the result is still reduced to path edits, because only paths can be applied, diffed, scaled and approved. **Decision:** a look never stores a pipeline; it always resolves to mutations (see 2.5).

`f` is a read-only frame handle (`f.recipe`, `f.source`, `f.stock`): a look may adapt to the frame, for example scale density with the stock's speed, but it may not run measurements. If we later want auto-looks that measure (for example "match the shadow density of the reference"), that is a different object, an *auto look*, and it needs the async DSL handles; not this ticket.

A preset is the degenerate look with no parameters and a constant body. `cb.looks.fromPreset(preset)` wraps one, and `look.bake(params)` turns a look with chosen parameters into a preset. Everything downstream (Amount, diff, apply, survey) works on a **resolved look**: the list of `PresetEntry` after the body has run. So there is one pipeline, with two authoring forms in front of it.

### 2.3 Snapshots and virtual copies

A **snapshot** is a named copy of one frame's folded recipe, with the EditLog position it was taken at:

```ts
interface Snapshot { id: string; frame: string; name: string; ts: number; seq: number; recipe: FrameRecipe; hash: string }
```

Snapshots are the "before" in before/after and the target of "restore", which applies the differences as one batch of `set` mutations (so restore is undoable and shows in History); this follows CHB-009 section 5.8. They are per frame, in the document tier. Taking one is cheap; restore never rewrites history.

A **virtual copy** is a second frame record that shares a frame's source and starts from a copy of its recipe, with its own EditLog. It is made with `frame.add` (the existing mutation) plus a catalog field `virtualOf`. Virtual copies are for keeping two complete treatments (a warm print and a cool print) side by side in the library and for comparing them with the same tools as any two frames. The difference from a snapshot: a snapshot is a frozen record you compare against or restore from; a virtual copy is alive and keeps being edited. Virtual copies need one catalog field and a stack display in the roll views (CHB-020); this kit only provides the commands `looks.virtualCopy` and the compare source.

### 2.4 Where film looks fit

CHB-012 adds the forward film simulation for digital RAWs. A frame with `capture` in its recipe has `capture.stock`, `capture.exposureEV`, `capture.development.push`, `capture.development.halation.strength`, `capture.development.grain.amount`, `capture.development.grain.size_um` and then the usual `print.paper` and print settings. A **film look** is a look over exactly these paths:

```js
const portraEndura = cb.look('Portra 400 on Endura')
  .group('Film')
  .requires({ source: 'digital-raw' })
  .param('push', cb.slider(-2, 3, { unit: 'stop', step: 1 / 3, default: 0 }))
  .param('halation', cb.slider(0, 2, { unit: 'none', default: 1 }))
  .param('grain', cb.slider(0, 2, { unit: 'none', default: 1 }))
  .edits((f, p) => ({
    'capture.stock': 'kodak_portra_400',
    'print.paper': 'kodak_portra_endura',
    'capture.development.push': p.push,
    'capture.development.halation.strength': cb.scaleOf(p.halation),
    'capture.development.grain.amount': cb.scaleOf(p.grain),
  }))
```

Two things matter. First, `requires: { source: 'digital-raw' }`: applying it to a scanned negative would be meaningless (there the film is already in the scan), so the kit refuses with a diagnostic and the survey skips such frames with a note. Second, Amount for a film look is not "how much Portra": the stock is an enum and cannot be half applied. The stock and paper entries are *discrete* (rule `step`, section 4), and Amount scales the continuous parts, halation and grain. That is the behaviour a photographer expects from a "film strength" control. Film looks come with the CHB-012 data pack; until it lands, stage 8's fixtures use mock stock ids.

`finishing.look` (a `fraction` 0 to 1, "look amount", CHB-015) already exists in the recipe contract. It belongs to the finishing pass, not to this kit; a look may set it as one of its entries, but the kit's Amount is applied to the edit list, not stored in the recipe (see the open question in section 10 about storing it).

## 3. How it fits

```text
 variant (JS)  ──.use(looksKit)──►  forms:      cb.looks.library / params / amount / survey / diff / snapshots
                                     fragments:  viewer.compareWith · frame.look · arg.vsSnapshot
                                     commands:   looks.apply · looks.snapshot · looks.match · looks.sync …
                                     passes:     amount · diff · apply-plan · staleness · migrate-preset
                                     state:      document: looks, presets, snapshots   view: ui.looks.*

  look / preset ──resolve──► [PresetEntry]  ──amount pass──► [Mutation] ──apply-plan──► batch ──► EditLog(s)
                                              ▲                              │
                              recipe IR: defaults or current                  └─► user: apply now · agent: propose + one approval card
```

Dependencies and what is mocked while they are missing:

| Needs | From | Until it lands |
|---|---|---|
| `ck.kit`, `ck.fragment`, `ck.pass`, store tiers, commands | CHB-018 shell | develop against the CHB-016 API sketches; write the kit pieces as plain functions first and wrap them last |
| `cb.arg`, `cb.viewer`, frame handle, history adapter, approval cards | CHB-019 | the mock engine and a fake store in kit tests |
| `FrameRecipe`, `ArgSpec`, units, mutations, EditLog | `packages/contract` | exists |
| the DSL `frame`, `cb.explain`, topic docs | `packages/dsl` | exists; the kit adds a topic |
| film stocks and capture paths | CHB-012 | mock stock ids |
| roll selection, unedited predicate, roll balance | CHB-020 | `isUnedited` computed from the EditLog directly (section 6) |

## 4. Amount

### 4.1 What CraftKit does and why it is not enough

CraftKit's `scalePreset(partial, defaults, k)` in `sources/craftkit-studio/src/app/develop-model.js` walks the preset; for each numeric leaf with a numeric default it returns `default + (value - default) * k`; non-numeric leaves pass through; and a `KEEP` set (angles, seeds, curve split points, grading hue) is never scaled. Amount 0..200 % is a slider; 100 is the preset as made, 200 twice as far. The comment in the source says why `hue` is excluded: scaling teal 195 degrees by half gives green at 97.5 degrees, which is a different colour, not a weaker teal.

That rule is linear in *parameter space*. Lightroom's parameters are mostly UI units (-100..100) where linear is fine. Ours are physical, and linear is wrong for several:

- **Time** (`print.enlarger.time_s`): a preset that lengthens a 12.0 s exposure to 15.1 s is +1/3 stop. At 50 % the photographer expects +1/6 stop (13.5 s), not the arithmetic midpoint 13.56 s: the two are close here but diverge for large moves (12 s to 48 s is +2 stops; the linear midpoint 30 s is +1.3 stops, the stop midpoint is 24 s). Exposure is multiplicative, so scale in stops: `t = t0 * (t1 / t0)^k`.
- **Lights** (`print.lights.logH`): stored in log exposure, so linear in logH is already linear in stops. Linear scaling is right; the point is to say so, and to display it in points.
- **Colour temperature** (`K`): interpolate in mired (the contract's own `convert` treats K and mired as inverses).
- **Density and filtration** (`D`, `CC`): linear.
- **Fractions and percentages**: linear.
- **f-number** (`fstop`): scale in stops (`2 * log2`), as `stopsFromFstop` does.
- **Enums, bools, strings, stock ids**: no midpoint exists.

### 4.2 The rule per ArgSpec

The rule is chosen from the target path's `ArgSpec` (via `fieldPattern` and `fieldSpec` in `packages/contract/src/paths.ts`), by unit and `ui.scale`, and can be overridden per path on the preset or by the look:

```ts
type AmountRule = 'linear' | 'stops' | 'mired' | 'keep' | 'step' | { step: number /* threshold, default 0.5 */ };

function ruleFor(path: string, entry: PresetEntry, preset: Preset): AmountRule {
  const o = preset.amount?.[path]; if (o) return o;
  const spec = fieldSpec(fieldPattern(path)!);
  if (!spec) return 'keep';
  if (spec.type === 'number' || spec.type === 'vec3' || spec.type === 'cmy') {
    if (spec.unit === 's' || spec.unit === 'fstop' || spec.ui?.scale === 'log2') return 'stops';
    if (spec.unit === 'K') return 'mired';
    return 'linear';                              // logH, point, stop, D, CC, fraction, percent, none
  }
  if (spec.type === 'enum' || spec.type === 'bool' || spec.type === 'stockId' || spec.type === 'string') return 'step';
  return 'keep';
}
```

Applying the rule needs a **base value** for each path, the value Amount 0 means. CraftKit uses the defaults. We offer both, as `from: 'defaults' | 'current'` on the pass:

- `from: 'current'` (the default for offsets): `add` entries scale as `delta * k` in the rule's space; Amount 0 leaves the frame untouched. This is the right thing on a balanced roll.
- `from: 'defaults'` (CraftKit's behaviour, for `set` entries that describe a whole treatment): Amount 0 is the stock/paper neutral pack, as given by `defaultRecipe` in `paths.ts`.

For `set` entries with `from: 'current'`, the base is the frame's present value. Which is the right default for `set` entries is an open question (section 10); the pass supports both and the library chooses per preset (`preset.base`, default `'current'`).

### 4.3 As a recipe pass

Amount is a pass on the **recipe IR** (the brief's list: validate, migrate, units, preset Amount, diff). Input: resolved entries, the frame's recipe, k, the options. Output: a mutation list, or diagnostics.

```ts
ck.pass('looks.amount', { on: 'recipe-edits', after: 'looks.resolve', before: 'looks.apply-plan' },
  (edits: ResolvedEdits, { recipe, defaults, amount, from }) => {
    const out: Mutation[] = [];  const diags: Diagnostic[] = [];
    for (const e of edits.entries) {
      const rule = ruleFor(e.path, e, edits.preset);
      const base = from === 'defaults' ? getPath(defaults, e.path) : getPath(recipe, e.path);
      const v = scale(rule, base, e, amount);      // see below
      const check = checkSet(recipe, e.path, v);   // same checker the EditLog uses; nothing clamps (DR-2)
      if (check.error) diags.push(rangeDiag(e.path, v, check, { fix: clampTo(check) }));
      else out.push({ op: 'set', path: e.path, value: v });
    }
    return { mutations: out, diags };
  })
```

`scale` is a plain function, tested in isolation:

```ts
function scale(rule: AmountRule, base: any, e: PresetEntry, k: number): any {
  const target = 'set' in e ? e.set : applyDelta(base, e.add, rule);   // add: base + delta in the rule's space
  switch (typeof rule === 'string' ? rule : 'step') {
    case 'linear': return lerpN(base, target, k);                      // componentwise for vec3
    case 'stops':  return base * Math.pow(target / base, k);           // t0 * (t1/t0)^k
    case 'mired':  return 1e6 / lerpN(1e6 / base, 1e6 / target, k);
    case 'keep':   return target;
    case 'step':   return k >= (typeof rule === 'object' ? rule.step : 0.5) ? target : base;
  }
}
```

For `add` entries the delta is itself scaled, which for `stops` means a delta of `+1/3 st` at k = 0.6 is `+0.2 st`, so `t = t0 * 2^(0.2)`. The dodge/burn `exposure.add` rows in a preset are scaled through their own `stops` field (`print.exposures.*.stops`) and `time_s`, with the same rules.

**Range.** Amount above 100 % can leave the allowed range (grade 5 at 150 % is 7.5). The pass does not clamp (the contract's principle DR-2: nothing clamps); it returns a diagnostic with the clamped value as the computed fix, and the UI shows "Amount 150 %: grade would be 7.5, maximum 5; apply clamped?". A variant may set `amount: { over: 'clamp' }` to clamp silently with a note in `why`.

**Display.** The Amount slider shows the percentage and, below it, the diff of the *result* in darkroom units (section 5.4), so that 60 % is not an abstract number: "time +0.10 st = 12.0 → 12.9 s, lights R +1.5 pt, B -1.5 pt".

## 5. Comparison

### 5.1 Before/after and snapshots

CraftKit's `view.compare` modes (Before/After, left/right, top/bottom, split) compare the current photo against the state it had before the last change, or against a snapshot. We keep the modes and give them a single input: the viewer's **compare source**.

```ts
type CompareSource =
  | 'before'                         // the frame at the last undo boundary (EditLog cursor - 1)
  | 'defaults'                       // defaultRecipe(frame)
  | { snapshot: string }             // a snapshot id
  | { frame: string }                // another frame (the reference)
  | { look: string; params?: any; amount?: number }   // a look applied in the what-if sense
  | { recipe: FrameRecipe }          // anything computed
```

Each source resolves to a second recipe, hence a second compiled graph; the viewer renders both through the Engine. Because the compiler content-addresses nodes, the shared prefix of the chain is the same node id and is computed once. Rendering the same recipe twice must give identical pixels; that is the invariant that makes "the current tile equals the main view" a test rather than a hope (CHB-009 section 5.9 says the same of the ring-around centre tile).

### 5.2 A/B against a reference frame, and Match

CraftKit sets a reference photo (`develop.setReference`, `ui.reference`), shows it beside the active one, and `develop.match` (in `develop-scopes.js`) computes log-average luminance and mean opponent colour of both at 256 px on the bg lane, then writes exposure, temperature, tint and saturation so the active photo's statistics approach the reference's. In chromobench:

- the reference is `view.reference` (a frame id, view tier); the compare source `{ frame }` shows it; the scopes overlay both (CHB-019).
- **Match** is already half-designed in the contract: `print.lights.auto` carries `method: 'match'` (`AutoBalance`, `packages/contract/src/recipe.ts`). `looks.match` computes the statistics on both frames (`measure.stats`, the DSL op), converts the difference to *darkroom* edits (a time change in stops and a lights change in points, never "exposure +0.4") and proposes them as one batch with `why: 'match to frame 12'`. Whether it also sets `print.lights.auto` to record that the lights came from a match is open (section 10).
- Match is a command, not a look: it measures. It sits beside the library in the same kit because it shares the apply batch and the diff.

### 5.3 Survey of N looks on one frame

A survey shows N variants of **one frame**, each tile the frame printed with one look. (CraftKit's library survey, `library.js` `survey()`, shows N *photos*; we use the word for N treatments of one photo and keep the CraftKit one in the roll views.)

```js
cb.looks.survey({
  frame: s => cb.frame(s),                       // τ: which frame
  looks: s => s.ui.looks.surveySet,              // τ: the looks to show, resolved at build or per change
  amount: s => s.ui.looks.amount,
  tile: (frame, look, i) => cb.looks.tile(frame, look, { caption: 'diff' }),   // θ per tile
  on: { pick: (look, ctx) => ctx.set({ ui: { looks: { picked: look.id } } }) },
})
```

Each tile's pixels are `frame.look(look, params, { amount }).display()`, evaluated as a θ cell on the bg lane at thumbnail size and cached by node id: because the node id is a hash of the recipe subgraph, two tiles that differ in one path share everything before it, and a tile whose look has not changed is never recomputed. The caption is the diff summary (5.4). Clicking a tile *previews* it in the main viewer (`ctx.preview`, live, uncommitted) and selects it; double-click or Enter applies it. Looks that fail `requires` are shown disabled with the reason.

### 5.4 The diff pass

A diff answers: *which recipe paths differ between two recipes, and by how much, in units a darkroom person reads*. It is a pass on the recipe IR.

```ts
interface DiffEntry {
  path: string;
  a: unknown; b: unknown;
  unit: Unit | null;
  delta?: number | number[];           // in the path's stored unit
  shown: string;                       // "12.0 → 15.1 s (+1/3 st)"
  group: string;                       // sync group (section 6.3)
}
function diffRecipes(a: FrameRecipe, b: FrameRecipe, opts?: { tolerance?: number }): DiffEntry[]
```

It walks the union of settable paths (`settablePaths()` in `paths.ts`, with exposure ids as keys), compares values structurally, and formats each difference with a per-unit formatter:

| path unit | `shown` |
|---|---|
| `s` | seconds and signed stops: `12.0 → 15.1 s (+1/3 st)` (via `stopsFromTime`), stops rounded to the nearest 1/6 with a "~" when not exact |
| `logH` on `print.lights.logH` | printer points per channel, `R +4.0 pt  G 0  B -2.0 pt` (0.025 log H per point) |
| `CC`, `D` | `Y 52.5 → 62.5 CC` |
| `stop`, `fstop` | signed stops |
| enum, stock id | `grade 2 → 3`, `paper A → B` |
| vec3 without a reading convention | components |

Tolerances come from the unit (below 0.5 % of the range counts as equal, so float noise from Amount scaling does not appear). The same pass feeds: survey captions, the Amount slider's result line, approval cards for agent proposals ("3 paths: ..."), the snapshot compare ("what changed since 'first print'"), roll-conflict warnings (6.4), and `cb.looks.diff(a, b)` in the DSL. It deliberately has no UI of its own: `cb.looks.diff()` is a panel form that renders entries, and any other form can embed `diff.summary(a, b)` as a τ label.

### 5.5 Ring-around as a survey

A ring-around is a survey whose looks are *generated by a sweep*, not picked: the current recipe with the lights moved one step in each of six colour directions and in density (CHB-009 section 5.9, Chromogen's `renderRing`). The looks kit provides the generator:

```js
cb.looks.sweep.ring({ step: units.pt(4), directions: 'six+density' })   // → 9 looks; "current" is one of them
cb.looks.sweep.axis('print.enlarger.time_s', { steps: [-2, -1, 0, 1, 2], unit: 'stop' })   // a test-strip-like row
```

and `cb.looks.survey({ looks: sweep })` renders them; a click writes one `set` of the chosen tile's lights. **Boundary with CHB-019:** CHB-019 owns the `ringAround` *tool* (hex layout, the keyboard behaviour, labels like "+Y (-B)"). The decision here is that the tool is a *layout* of this kit's survey: `ringAround` = `survey` with `layout: 'hex'` and `sweep.ring`. If CHB-019 lands first with its own tile rendering, stage 6 replaces its tile source with the survey's and leaves the layout; if not, CHB-019 imports the survey. Either way there is one tile pipeline and one cache.

## 6. Apply

### 6.1 One mutation batch

Applying a look to N frames builds an **ApplyPlan**: for each target frame, the mutations the Amount pass produced against *that frame's* recipe, each carrying `expect` (the value proposer saw, the contract's DR-7), under one batch id.

```ts
interface ApplyPlan {
  id: string;                            // batch id, becomes the shared tx group
  label: string;                         // "Look: warm print at 60 %"
  look: { id: string; params: unknown; amount: number; from: 'current' | 'defaults' };
  groups: string[];                      // sync groups included (6.3)
  frames: { frame: string; mutations: Mutation[]; diff: DiffEntry[]; skipped?: Diagnostic }[];
  by: 'user' | 'agent';
}
```

The apply path differs by author:

- **User** (button, menu, library click): commit every frame's mutations to its EditLog in one go with the shared group id. The EditLog is per frame; each frame gets its own undo unit labelled with the plan's label and sharing `tx` with the others. The history adapter (CHB-019) treats units with a common batch id as one global undo step, and the History panel shows "applied to 23 frames" (the contact-sheet wording in CHB-009 5.9). This needs the adapter to support grouped units across channels; it is a CHB-019 request.
- **Agent**: each frame gets `propose(...)` (always recorded `by: 'agent'`; sandboxed code never holds an EditLog, per `editlog.ts`). Today that yields one pending card per frame. A new **approval-scope pass** on the mutation-batch IR coalesces pending entries that share the plan's batch id into one card: "Agent: apply 'warm print' at 60 % to 23 frames", with the aggregate diff (the diff entries merged by path, with the range of deltas) and a sample of frames, plus Approve, Reject and "Review per frame". The card is a form in the kit, `cb.looks.approvalCard()`, registered as the renderer for batches with `kind: 'look-apply'`; the rest keep CHB-009's per-transaction cards.

### 6.2 Targets

Targets are a *selector*, resolved when the plan is built:

```js
cb.looks.apply(look, params, { to: 'selection' })                       // or a frame id / array
cb.looks.apply(look, params, { to: { roll: 'lisbon-1', where: f => f.unedited } })
cb.looks.apply(look, params, { to: { collection: 'portfolio' } })
cb.looks.apply(look, params, { to: 'library', where: f => f.stock === 'kodak_portra_400' })
```

`f.unedited` is computed from the EditLog: no applied entry with `by` in `user` or `agent` beyond `frame.add` and `auto` ingest entries. CHB-020's roll workflow will have its own notion (a frame that has had its "first print"); the selector takes any predicate, so the roll kit can export its own. A library-wide apply is allowed but is an obvious place for a confirmation dialog in the variant; the kit shows the frame count and the aggregate diff before committing.

### 6.3 Sync groups

CraftKit's `SYNC_GROUPS` map a Lightroom group name to top-level setting keys, and `syncSettings` copies those keys from one photo to others. Our recipe is paths, so a sync group is a list of **path patterns** (the same `*`-wildcard patterns as `RECIPE_FIELDS`):

```ts
const SYNC_GROUPS: Record<string, { match: string[]; default: boolean }> = {
  'Film simulation':   { match: ['capture.*'],                                         default: true  },
  'Paper':             { match: ['print.paper', 'print.aim'],                          default: true  },
  'Exposure':          { match: ['print.enlarger.time_s', 'print.enlarger.fstop', 'print.enlarger.magnification'], default: true },
  'Colour balance':    { match: ['print.enlarger.filtration', 'print.lights.*'],       default: true  },
  'Contrast':          { match: ['print.grade', 'print.preflash'],                     default: true  },
  'Dodge and burn':    { match: ['print.exposures.*'],                                 default: true  },
  'Finishing':         { match: ['finishing.*'],                                       default: true  },
  'Output':            { match: ['view.*'],                                            default: false },
  'Scan conditioning': { match: ['scan.flare', 'scan.flat', 'scan.rebate', 'scan.scanner'], default: false },
  'Crop and dust':     { match: ['scan.crop', 'scan.openGate', 'scan.orientation', 'scan.dust.*', 'probes.*'], default: false },
}
```

Groups that describe *this frame's physical situation* (crop, dust, probes, orientation, source decode) default to off and are labelled so in the dialog, as CraftKit's Paste excludes Crop, Spot Removal and Masks. The table is data: a variant passes its own (`cb.looks.syncGroups({...})`), and CHB-022's finish kit can register its groups through a fragment on the table. Applying a look with `groups: [...]` simply drops entries whose path is not in a chosen group; copy/paste/sync (`looks.copy`, `looks.paste`, `looks.sync`) use the same machinery with the source being a frame's recipe rather than a look: the entries are the paths of the chosen groups, as `set` entries, with `from: 'defaults'` irrelevant because Amount is 100 %.

### 6.4 Staleness and conflicts

Two staleness problems, one rule each.

1. **A plan is stale when a frame changed after the plan was computed.** The plan stores `expect` values; the EditLog's `propose` checks them and returns `E_STALE` per mutation. For a user apply this cannot happen (it commits immediately). For an agent apply, the user may edit frame 17 while the card waits. The card then shows "1 of 23 frames changed since this was proposed (frame 17)" and offers Approve the others, Apply anyway (recompute against the current recipe and apply), or Skip. Snapshots are a different case: a snapshot is never stale; it records the `seq` it was taken at and the diff against the current recipe is always computable.
2. **A preview is stale when its inputs change.** Survey tiles and the Amount result line are τ cells; they re-run when the frame's recipe changes (the projection's path read), the look, its params, or Amount. Cells are keyed by node id, so a re-run that produces the same graph is free.

**Conflict with roll balance** (CHB-020). A roll is balanced so that frames have comparable density and colour. A preset that `set`s `print.lights.logH` absolutely, or a look whose Amount base is `'defaults'`, destroys that. The kit's rule: entries on paths the roll balance owns (`print.lights.*`, `print.enlarger.time_s` when `print.lights.auto.applied`) should be `add` entries; if a preset has `set` entries there, the apply plan warns with `CB-LOOK-CONFLICT` and the fix "apply as offsets" (convert `set` to `add` against the preset author's reference frame, if stored in the preset, otherwise refuse). How roll balance tracks "owned" is CHB-020's call; this is an open question for that ticket.

## 7. Storage and the library UI

### 7.1 Where things live

Per the brief's state model: document tier keys `looks`, `presets`, `snapshots`; view tier for UI state (`ui.looks.amount`, `ui.looks.picked`, the survey set, the open group). Concretely:

```text
store.document.presets      Record<id, Preset>              data; files you can share
store.document.looks        Record<id, LookRecord>          { id, name, group, source: 'builtin' | 'file', file?, version }
store.document.snapshots    Record<frameId, Snapshot[]>
store.document.looks.$fav   string[]                         favourite ids
store.view.ui.looks         { amount: 100, picked: null, surveySet: [], from: 'current' }
```

Built-in looks (shipped with the app: neutral, warm, cool, grade ladders, the film looks) live in the kit as JS and are registered at install. User looks and presets live in the library storage that CHB-009 already has (IndexedDB, OPFS, File System Access), as files under `looks/`.

### 7.2 Files

Presets are JSON: `*.cbpreset.json`, the `Preset` shape above with `format`, `version` and `contract` fields. A look is JS source (`*.cblook.js`) exporting a `cb.look(...)` declaration. Sharing a preset file between two installs is safe because it is data. Sharing a look file is running code, so:

**Decision: look files from outside the app (imported, or written by the agent) are evaluated in the QuickJS sandbox of CHB-007, not in the page.** A look body is a pure function of a read-only frame description and numeric parameters, which is exactly what the sandbox runs well; its output is checked path by path against the registry before any use. Built-in looks written by us run host-side for speed. The cost: sandboxed looks cannot import helpers; the kit exposes `units`, `cb.add`, `cb.set` and the stock tables to them.

*Versioning*: a preset records `contract` (the recipe contract version) and the kit runs a `looks.migrate` pass on the recipe IR when a path was renamed: a table `{ from, to, since }` rewrites entry paths, unknown paths produce a diagnostic with `closest` suggestions (the registry's did-you-mean in `registry.ts`), and the library marks the preset "needs review" rather than dropping it. A file version newer than the app refuses to load with a message.

### 7.3 The library UI

```js
cb.looks.library({
  groups: ['Print', 'Film', 'Mine'],
  view: 'grid',                                // or 'list'
  thumbs: { frame: s => cb.frame(s) ?? cb.looks.testFrame(), size: 96 },
  favourites: true, search: true,
  on: { activate: (look, ctx) => ctx.run('looks.apply', { look }) },
})
```

A tree or grid of looks by group. When `thumbs` is on, each row's preview is a θ cell on the bg lane rendering the *current frame* (or a bundled test frame when none) through the look at the current Amount, cached by node id, evicted by the scheduler's lane policy so that scrolling a hundred looks never starves the main viewer. Favourites are a toggle on the row (`F`) and a filter. Hovering a row previews on the main viewer (`ctx.preview`), click applies to the selection at the current Amount (CraftKit's `activate` and `onSelect` in `presetsPanel`), right-click offers Save as preset, Save look as file, Rename, Delete, Set as default for new frames. A preset made from the current frame (`looks.saveAsPreset`) offers the diff against defaults as its entries, with checkboxes per sync group.

## 8. As builder calls

### 8.1 The kit

```ts
export const looksKit = ck.kit('looks', k => k
  .requires('studio-kit')
  .forms({ library, params, amount, survey, tile, diff, snapshots, approvalCard })
  .fragments(viewerCompare, frameLook, argVsSnapshot)
  .commands(commands)
  .passes(resolve, amount, diff, applyPlan, approvalScope, migrate)
  .state({ document: { looks: {}, presets: {}, snapshots: {} }, view: { 'ui.looks': initialUi } })
  .docs('docs/looks.md'))
```

### 8.2 A variant using it

Everything below is one variant's JS; a different variant picks other pieces.

```js
export default defineVariant({
  id: 'darkroom',
  build: (ck, cb) => ck.shell('Chromobench')
    .use(rollKit).use(looksKit)
    .module('print', m => m
      .left(ck.dock.column({}, cb.panel.filmstrip(), cb.looks.library({ groups: ['Print', 'Film'] }), cb.looks.snapshots()))
      .center(cb.viewer(s => cb.frame(s).print(), { tools: ['dodge', 'burn'] })
        .compareWith(s => s.ui.compare ?? 'before')          // fragment on the viewer
        .compareModes(['split', 'leftRight', 'flicker']))
      .right(ck.dock.column({},
        cb.looks.params(),                                    // generated sliders of the picked look
        cb.looks.amount({ range: [0, 200], showDiff: true }),
        cb.looks.diff({ against: 'snapshot' }),
        ck.panel('enlarger', { title: 'Enlarger' }, cb.arg('print.enlarger.time_s').vsSnapshot(), cb.arg('print.grade')))))
    .commands(c => c.bind('looks.apply', 'Mod+Enter').bind('looks.snapshot', 'Mod+Alt+N'))
})
```

A one-button variant for the photographer's simple mode:

```js
ck.row(
  cb.looks.choice(['neutral', 'warm print', 'cool shadows']),    // a segmented control over three looks
  cb.looks.amount({ range: [0, 100] }))
```

A lab variant keeps only the survey and diff and omits the library:

```js
cb.looks.survey({ frame: s => cb.frame(s), looks: cb.looks.sweep.ring({ step: units.pt(4) }), layout: 'hex' })
```

### 8.3 Fragments

| Fragment | Target | Adds |
|---|---|---|
| `viewerCompare` | `cb.viewer` | `.compareWith(src)`, `.compareModes([...])`, a slot `compareLabel` (default: the diff summary) |
| `frameLook` | the frame handle (host-side, also in the DSL) | `frame.look(look, params?, { amount, from })`: a what-if handle; `frame.snapshot(name)`; `frame.diff(other)` |
| `argVsSnapshot` | every `cb.arg` | `.vsSnapshot()`: a marker on the control when its path differs from the compare source, reading the diff entries |

### 8.4 Commands

One table drives menus, palette, toolbars and keys; disabled items say why: `looks.apply`, `looks.applyToRoll`, `looks.applyToSelection`, `looks.snapshot`, `looks.restoreSnapshot`, `looks.virtualCopy`, `looks.setReference`, `looks.match`, `looks.copy`, `looks.paste`, `looks.sync`, `looks.saveAsPreset`, `looks.favourite`, `looks.survey.open`, `looks.undoLast`. For example `looks.apply` is disabled with "Select a frame first" or "This look needs a digital RAW" computed from the receiver, as CraftKit's commands do with their `why`.

### 8.5 The agent counterpart

The DSL (`packages/dsl`, run in QuickJS) gets the same vocabulary. All of it reduces to existing primitives: `frame.edit` batches proposals, `why` is recorded, approval is the EditLog's.

```js
// compare four looks on frame 12 by measurement, no UI
const f = cb.frame(12)
const names = ['warm print', 'cool shadows', 'flat grade 2', 'strong grade 4']
const rows = []
for (const n of names) {
  const v = f.look(n, {}, { amount: 1 })                    // what-if handle
  rows.push({ look: n, D: (await v.print().measure.densitometer({ at: [48, 32] })).D, diff: cb.looks.diff(f.recipe, v.recipe).map(d => d.shown) })
}
return rows

// apply, as one proposal batch (one card)
return cb.looks.apply('warm print', { warmth: 4 }, { amount: 0.6, to: { roll: 'lisbon-1', where: x => x.unedited }, why: 'warm print at 60 % on the unedited frames' })
```

`cb.looks.apply` returns the batch receipt `{ id, status, frames: n, skipped: [...], diff }` and, like `frame.edit`, takes effect only when the eval succeeds. A look evaluated in the sandbox, whether imported or written by the agent, is the same code path as a user's imported look file (7.2). The kit adds a DSL topic, `packages/dsl/src/docs/topics/looks.md`, written in the same style as `editing-and-approval.md` (code blocks that the docs test runs against the mock engine).

## 9. One flow traced end to end

*Compare four looks on frame 12, pick one at Amount 60 %, apply it to the roll's unedited frames.* Roll "lisbon-1" has 36 frames; 13 have been worked on; frame 12 is open in the print module of the darkroom variant.

1. **Open the survey.** The user selects frame 12 and presses `N`. `looks.survey.open` sets `view.mode = 'survey'`. The survey form's `frame` τ cell reads the selected frame; `looks` reads `ui.looks.surveySet`, which the user filled by Ctrl-clicking four rows in the library: warm print, cool shadows, flat grade 2, strong grade 4.
2. **Resolve.** Each look runs `resolve` with its default params and frame 12's handle. All four are plain print looks with `requires: any`, so all four resolve. (Had the user added the Portra film look, whose `requires` is `digital-raw`, frame 12 being a scan would give that tile a disabled state with "needs a digital RAW": the survey reports, it does not hide.)
3. **Render tiles.** For each look, the amount pass runs at k = 1 (`from: 'current'`), producing mutations; `frame.look` applies them to a *copy* of frame 12's recipe (`applyMutation`, pure) and compiles it. The tile's θ cell evaluates `.display()` at 96 px on the bg lane. The "warm print" tile's caption comes from `diffRecipes`: `lights R +2.0 pt, B -2.0 pt`. Tiles appear as they finish; each is cached under its graph's node id.
4. **Pick and preview.** The user clicks "warm print". `on.pick` sets `ui.looks.picked`; the params panel shows its two sliders (warmth 4 pt, density 0 st); the main viewer previews the look at the current Amount with `ctx.preview` (nothing committed, undo stack untouched). The viewer compares with `before`, split view.
5. **Amount.** The user drags Amount to 60 % (a `bind` on `ui.looks.amount`, view tier). On each change the amount pass re-runs: lights add `[+0.05, 0, -0.05]` logH scaled by 0.6 is `[+0.030, 0, -0.030]`, which the display shows as `R +1.2 pt, B -1.2 pt`; a look with density +1/6 stop would give `t = 12.0 * 2^(1/6 * 0.6) = 12.86 s`, shown as `12.0 → 12.9 s (+0.10 st)`. The preview re-renders (latest wins in the scheduler; the draft proxy size during the drag, refine on release).
6. **Apply target.** The user chooses "Apply to roll, unedited frames". `looks.applyToRoll` resolves the target: the roll's 36 frames, `where: unedited` keeps 23. It builds an `ApplyPlan` with `from: 'current'`, the look's `warmth`, k = 0.6, `groups` = the defaults of 6.3 (Colour balance and Exposure included), 23 entries each with `expect` values from that frame's recipe. Frames where the amount pass produced a range diagnostic are `skipped` with the diagnostic; here none.
7. **Confirm.** A dialog states "Apply 'warm print' at 60 % to 23 frames: `lights R +1.2 pt, B -1.2 pt` on all; 0 skipped." with Apply and Cancel. Apply commits all 23 mutation lists in one batch: each frame's EditLog gets one undo unit labelled `Look: warm print at 60 %`, sharing a `tx` group. History for frame 12 shows the entry; Edit > Undo undoes all 23 (the history adapter treats the shared batch id as one step).
8. **Same action by the agent.** The user asks the chat to do step 6 ("warm print at 60 % on the unedited frames"). The agent's eval calls `cb.looks.apply(..., { to: { roll, where }, amount: 0.6, why })`. The host builds the same plan with `by: 'agent'`; `propose` records 23 pending entries; the approval-scope pass coalesces them to one card with the aggregate diff. While the card waits, the user nudges frame 17. When they click Approve, frame 17 returns `E_STALE`; the card offers "Apply anyway" for frame 17, which recomputes against its current recipe; the other 22 are committed. The chat receives the outcome in the next context block.

What to notice: the same plan data drives the tile captions, the Amount line, the confirm dialog, the approval card and the DSL receipt. The look itself was resolved once, per frame, into mutations; nothing symbolic is stored.

## 10. Implementation plan

Directory layout:

```text
packages/studio-kit/kits/looks/
  index.ts                kit definition (8.1)
  model/                  look.ts (builder), preset.ts (types, validate), snapshot.ts, files.ts (read/write, migrate)
  passes/                 resolve.ts, amount.ts, diff.ts, apply-plan.ts, approval-scope.ts, migrate.ts
  forms/                  library.ts, params.ts, amount.ts, survey.ts, tile.ts, diff-panel.ts, snapshots.ts, approval-card.ts
  fragments/              viewer-compare.ts, frame-look.ts, arg-vs-snapshot.ts
  commands.ts   sync-groups.ts   builtin/ (neutral.ts, warm.ts, grades.ts, film.ts)
  docs/looks.md   test/
packages/dsl/src/docs/topics/looks.md   (DSL topic)
```

**Stage 1: model and builder.** `cb.look`, `cb.slider`/param specs as ArgSpec, `cb.set`/`cb.add`, `resolve`, `lookEdits(handle)`, preset types and validation, `bake`. Done means: unit tests resolve "warm print" at two param sets; a bad param gives `E_ARG_RANGE`; a bad path gives `E_PATH` with a suggestion; no UI needed.

**Stage 2: Amount pass.** `ruleFor`, `scale`, `from` modes, range diagnostics with clamp fix. Done means: table tests for each rule (time +1/3 st at 0.5 = 1/6 st; K via mired; enum step at 0.5; vec3 componentwise; k = 0, 1, 2), idempotence at k = 1 (the entries unchanged), and a CraftKit parity test that `linear` rules reproduce `scalePreset` on its own fixtures.

**Stage 3: Diff pass.** `diffRecipes`, per-unit formatters, tolerances. Done means: golden strings for the cases in the 5.4 table; a recipe diffed with itself is empty; diff of scaled-by-k recipes shows k times the delta in stops.

**Stage 4: Apply plan, sync groups, staleness.** Plan builder, selectors (selection, roll, collection, library, `where`), sync groups with wildcard matching, user commit with shared tx, agent propose, approval-scope coalescing, `E_STALE` handling. Done means: applying to 23 mock frames gives 23 EditLog units with one batch id, one undo restores all; an agent apply gives one card; a frame edited in between is reported stale and "apply anyway" recomputes; a group-excluded path is never written.

**Stage 5: Snapshots, compare, reference, Match.** Snapshot record and restore as a `set` batch, virtual copy command, `viewer.compareWith` fragment, the sources of 5.1, `looks.match` against the mock `measure.stats`. Done means: restore of a snapshot is undoable and shows in History; compare against `{ frame }` renders both on the mock engine; the same recipe in both panes renders identically.

**Stage 6: Survey, tiles, ring.** `survey`, `tile` as θ cells on the bg lane, cache by node id, `sweep.ring` and `sweep.axis`; coordination with CHB-019's ring-around. Done means: a survey of 6 looks fills without blocking the main viewer's render; changing one look re-renders one tile; disabled tiles explain themselves.

**Stage 7: Library UI and storage.** Library form with thumbnails and favourites, params and amount forms, save-as-preset, preset files read/write, migrate pass, sandboxed look evaluation. Done means: a preset written, deleted and re-imported round-trips; an unknown path is flagged "needs review"; a sandboxed look cannot reach the page.

**Stage 8: Film looks, DSL topic, variants.** Film looks over the CHB-012 data pack, `docs/looks.md`, the DSL topic, wire the kit into the four variants. Done means: Playwright smoke (open fixture, apply a look at 60 %, undo, survey, approve an agent apply) per variant; DSL docs tests pass.

## 11. Testing and acceptance

- **Unit**: each pass as a pure function, with the golden numbers above. Property: for any look, apply at k = 1 on a frame then diff against the look's own entries gives empty.
- **Round trip**: snapshot, change three paths, restore, recipe hash equals the snapshot's.
- **Batch**: N frames, one tx id; global undo reverts all; EditLog invariants (cursor, seq) hold on every frame.
- **Staleness**: propose, mutate the frame, approve: `E_STALE` surfaces, "apply anyway" yields the intended recipe.
- **Rendering**: tile for look L and the main view with L applied have the same node id and the same pixels on the mock engine; survey tiles cached on second open.
- **Variant tests** (brief section 11): each variant builds headless with zero error diagnostics; `ck.explain` snapshot includes the looks forms where installed.
- **DSL**: topic examples run in the docs test harness; `cb.looks.apply` is refused in `read-only` agent mode with the usual diagnostic.
- **Acceptance**: the flow of section 9 runs in a Playwright script on the mock engine, in the darkroom variant, with the agent half using a scripted eval.

## 12. Risks and open questions

1. **Symbolic or re-run looks** (blocking for stage 4 design, not stage 1). We resolve a look to values and apply; the recipe does not remember "warm print at 60 %". The advantage: recipes stay plain, portable, diffable; the EditLog's `why` keeps the story. The cost: no "change Amount later" or "update the look and re-sync the roll". A symbolic design would add a recipe field (for example `looks: [{ id, params, amount }]` evaluated before the explicit edits), which is a contract change (CHB-002 owner) and changes every consumer's fold. Recommendation: ship resolved; record `look: { id, params, amount }` in the EditLog `why` and tx label so a "reapply" command can be built later; revisit with the photographer's use.
2. **Scaling rules per unit**: stops for time, mired for K, step for discrete. Open: lights are linear in logH, which is multiplicative in exposure per channel; is that what a printer expects when scaling a colour balance (probably yes)? Is `grade` (integer or fractional?) a `linear` or `step`? Check against `print.grade` in the catalog. `finishing.look` is already an Amount of its own; do we double scale?
3. **`set` versus `add` for preset authoring.** Offsets are safe on balanced rolls; absolute sets are needed for whole treatments. The default base (`current` or `defaults`) for `set` entries needs a photographer's opinion.
4. **Preset conflicts with roll balance** (6.4); depends on how CHB-020 marks what the balance owns.
5. **Pipeline-form looks** are reduced to path edits via `lookEdits(handle)`. This relies on what-if options mapping one to one to paths; an option that does not (derived values) would be dropped silently. Add a test that every what-if option of `frame.print` has a path, or return an error.
6. **Grouped undo across frames** needs the history adapter (CHB-019) to treat a shared batch id as one step. Request filed in the task list.
7. **One card for a batch** requires an approval-scope pass and a card renderer; the per-frame cards must stay available ("Review per frame").
8. **Sandboxed looks.** Cost of per-render evaluation in QuickJS across 100 library thumbnails: resolve once per (look, params, frame-kind) and cache; a look that depends on `f.recipe` values reruns when they change. Measure in stage 7.
9. **Performance of surveys.** N tiles at once compete with the main view; rely on the scheduler's bg lane and abort-on-change; test with 12 tiles on real GPU.
10. **Ring-around ownership** (5.5) must be settled with the CHB-019 writer before either stage 6 or the CHB-019 ring-around tool is built.
11. **Virtual copies** need a catalog field and roll-view support (stack display), which sit in CHB-019/020.
12. **Match bookkeeping**: does `looks.match` also set `print.lights.auto.method = 'match'`?).

## 13. References

- UI design brief: `ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/various/ui-design-brief.md`
- CraftKit, under `CHB-016--*/sources/craftkit-studio/src/app/`: `develop-model.js` (`scalePreset`, `KEEP`, `SYNC_GROUPS`, `syncSettings`, `merge`), `develop.js` (`presetsPanel`, `applyPreset`, snapshots, `syncDialog`, `develop.paste`), `develop-scopes.js` (reference render, `develop.match`), `library.js` (`survey()`, compare).
- Contract: `packages/contract/src/paths.ts` (`settablePaths`, `fieldPattern`, `fieldSpec`, `getPath`, `setPath`), `spec.ts` (`ArgSpec`, `UiHints`, `checkArgValue`), `units.ts` (`convert`, `LOGH_PER_POINT`, `stopsFromTime`), `mutations.ts`, `editlog.ts` (`propose`, `expect`, `E_STALE`), `recipe.ts` (`RECIPE_FIELDS`, `AutoBalance`).
- DSL topics: `packages/dsl/src/docs/topics/editing-and-approval.md`, `darkroom-vocabulary.md`.
- CHB-009 guide sections 5.8 (history, snapshots) and 5.9 (ring-around, contact sheet apply).
- CHB-012 guide sections 3.1 and 5.6 (capture paths, halation and grain, the digital RAW chain).
