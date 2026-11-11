---
Title: 'Intern guide: Roll workflow (roll setup, first print, roll balance, contact sheet)'
Ticket: CHB-020
Status: active
Topics:
    - ui
    - darkroom
    - ingest
    - product
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://packages/contract/src/editlog.ts
      Note: per-frame EditLog the batch writes to
    - Path: repo://packages/contract/src/recipe.ts
      Note: AutoBalance, ScanSettings, RECIPE_FIELDS
    - Path: repo://packages/core/src/print/balance.ts
      Note: LATD, integrateToGrey, grey pick
    - Path: repo://packages/ingest/src/conditioning/classify.ts
      Note: base classes
    - Path: repo://packages/ingest/src/conditioning/rank.ts
      Note: stock ranking
    - Path: repo://packages/ingest/src/conditioning/rebate.ts
      Note: rebate estimate, base check
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/src/app/cull.js
      Note: cull pattern
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/various/ui-design-brief.md
      Note: shared UI brief
ExternalSources: []
Summary: 'Implementation guide for the roll kit cb.roll.*: roll setup, automatic first print, contact sheet and cull, print-the-roll-like-this-frame balance as one mutation batch.'
LastUpdated: 2026-11-11T15:10:20.970223884-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Roll workflow (CHB-020)

This guide is for the engineer who builds the roll kit: the part of the studio that takes a roll of scanned colour negatives from "files on disk" to "a first print of every frame, culled, balanced as a roll, ready for the darkroom". It is a guide for implementation, not a spec. Where something is a guess it is marked TODO or open question, and we will settle details as we work. Names follow the UI design brief (`ttmp/2026/11/11/CHB-016--…/various/ui-design-brief.md`); where this guide refines the brief it says so.

## 1. Purpose and scope

### 1.1 What the photographer does

The photographer (Manuel's dad) shoots 135 colour negative film, gets it developed, and scans it with a camera and an LED light (CHB-013 calibrates that setup). He ends up with a folder of 36 scans. Today the tool for this job is Negative Lab Pro (NLP): import the scans, press convert, tweak. Our product does the same job in the order a darkroom worker thinks:

1. **Import the roll.** Drop the folder. The studio groups the scans into a *roll* (one stock, one scanner setup, one development).
2. **Roll setup.** The studio measures, once per roll, the things that are properties of the roll rather than of a frame: the film base (the unexposed rebate edge), the scanner's flare, the noise level, and which stock it probably is. It shows these, with numbers, and lets him override any of them.
3. **First print.** Every frame gets an automatic first print through the same film and paper model the darkroom uses. He sees 36 prints, not 36 grey inversions.
4. **Contact sheet.** He flags, stars and culls on the contact sheet, with the same keys as everywhere else in the studio.
5. **Print the roll like this frame.** He picks one frame that looks right and says "print the roll like this". The studio propagates that frame's printer lights and enlarger settings to the other frames, each with its own exposure correction. One approval card covers the whole batch.
6. **Hand-off to the darkroom.** He opens any frame in the darkroom module (test strips, dodge and burn, CHB-010) with the roll's settings already in place.

The kit is **`cb.roll.*`**, living in `packages/studio-kit/kits/roll`. It is the product replacing NLP; it is not a separate app. Everything in it is an ordinary builder call, so a variant (the three-step "simple" one, the Lightroom-like "classic", the "lab" one) can use the pieces, rearrange them, or leave them out.

### 1.2 What this ticket does not do

- It does not write inversion, balance maths or conditioning. Those exist in Phase 1 (`packages/core`, `packages/ingest`). This ticket calls them.
- It does not build auto print for real enlargers or printer lights in filtration units (CHB-010) or the scanner calibration (CHB-013). It consumes their results when they land and runs on the interim versions until then (section 4.3).
- It does not own the shell (CHB-018) or the studio-kit core: viewer, `cb.arg`, film strip, EditLog adapter, approval cards (CHB-019). It adds forms, fragments, commands, passes and a state slice on top of them.
- Looks and presets (CHB-021) and finishing (CHB-022) are separate kits. The roll kit only knows how to apply a roll-level change to many frames; CHB-021's "apply to the library" can reuse that machinery (section 6.4).

## 2. Background the implementer needs

### 2.1 Why measured inversion is different from NLP

Negative Lab Pro (like most "negative conversion" tools) inverts an image with heuristics: find the black and white points per channel from the histogram, apply an inverse curve or a LUT picked per film name, then adjust colour with auto-balance. It never asks what the film physically did. The result is plausible but its numbers have no physical meaning, so "Kodak Gold 200" in such a tool is a look, not a model.

Chromobench inverts through the film model (CHB-003). The chain is:

```text
scan (camera-linear T) → rebate-relative density d = −log10(T / T_rebate)
  → solve for dye amounts c in the stock's forward model   (invert.dyes)
  → the negative as the film made it (film-dyes domain)
  → expose paper through an enlarger with printer lights   (print.expose, print.lights)
  → the print
```

Two consequences matter for the roll workflow.

First, the inversion needs **calibration inputs that belong to the roll**: the rebate T (zero of scanner density), the stock (which forward model), the flare (a veiling-light fraction subtracted before density), and σ (the noise per channel, which decides what counts as "blank film" or "below base"). A heuristic tool needs none of these. We must therefore measure them, show them, and let the photographer correct them. That is **roll setup**.

Second, once the negative is represented as dyes, **colour balance is printer lights**: three log-exposure offsets of the paper. They add in log H, and CHB-003 measures that balancing with lights stays within 2.4 CIEDE2000 across a grey scale where a density shift leaves up to 14.6. So "print the roll like this frame" has a precise meaning: give the other frames the reference frame's lights (plus a per-frame exposure correction), not "copy the sliders".

### 2.2 What "roll analysis" means here

A roll is 36 exposures on one piece of film through one lab process. They share: the base colour of the film, the stock, the processing, the scanner and flare, the noise at a given scan size, and usually a lamp/light colour in the scenes. They do not share: exposure, scene content, dust.

**Roll analysis** is a pass over a roll's frames that produces two things:

- a **shared roll recipe fragment**: the settings that should be identical on every frame (scanner, stock, format, flare, base T, paper, aim, enlarger mode and lamp), each with the evidence that produced it;
- **per-frame deltas**: what differs per frame (rebate box, σ at the frame's scale, base class shares, dust specks, LATD, auto lights, orientation), as mutations or measurements.

The two outputs are kept apart on purpose. The shared fragment is what the photographer sees in the roll setup panel. The deltas are what makes each frame's first print right.

### 2.3 The roll's physical facts in numbers (Gold 200)

The Phase-1 fixtures give us real numbers to anchor on (from the CHB-006 and CHB-003 guides; check them against `fixtures/golden/ingest-gold200.json` once the file is there):

| fact | value | where it comes from |
|---|---|---|
| Gold 200 base D (R, G, B) through the illustrative X-T5 channels | 0.282, 0.643, 0.840 | CHB-006 §2.3 |
| C200 base | 0.274, 0.649, 0.819 (0.020 D from Gold 200) | same |
| Portra 400 base | 0.211, 0.659, 0.779 (0.072 D away) | same |
| rebate σ at 1,090×754 (full) | (0.0090, 0.0069, 0.0122) D | CHB-006 §2.6 |
| rebate σ at 640 px | (0.0043, 0.0033, 0.0057) D | same |
| class shares, 640×443 | blank 12.6 %, below base 9.7 %, gamut 0.05 % | CHB-003 §3.5 |
| class shares, 1,090×754 | blank 21.5 %, below 7.2 %, gamut 0 | same |
| rebate non-uniformity | 0.021 D denser at its top | CHB-006 risks |
| the sample has no flat, no open gate | `W_NO_OPEN_GATE` | CHB-006 §6 |

Two points from this table shape the design. The stock cannot be named from the rebate (Gold 200 and C200 differ by 0.02 D, about two σ at full size): ranking narrows, the photographer names. And class shares depend on the image size they are computed at, so a roll card that shows "12 % blank" must show the scale it was measured at.

## 3. How the kit fits the system

```text
apps/studio          loads a variant; variant says .use(rollKit)
packages/studio-kit  cb.* core (CHB-019): cb.arg, cb.viewer, film strip, approvals, EditLog adapter
  kits/roll          cb.roll.* (this ticket)
packages/shell       ck.kit, ck.fragment, ck.pass, commands, keys, store (CHB-018)
packages/ingest      conditioning: rebate, flare, σ, classes, rank, dust   (CHB-006, exists)
packages/core        inversion, balance, lights                            (CHB-003, exists)
packages/contract    recipe, paths, mutations, EditLog, ops                (exists)
```

The kit reads the document tier `catalog` (rolls, frames, flags, stars), reads recipes through the EditLog projection `recipes.<frameId>`, and writes recipes only through transactions that the shell routes to each frame's EditLog (user: apply; agent: propose). The kit never calls an engine directly: it asks for handles (`frame.print()`) and the render bridge does the rest, so the kit works against the mock engine (CHB-002) from day one.

Dependencies:

- **Needs** CHB-018 (kits, fragments, passes) and CHB-019 (studio-kit core). Both can be mocked: until they land, write the kit's logic as plain TypeScript in `kits/roll/src/engine/` (analysis, balance, plans), which has no UI imports, and add the builder layer afterwards. This is the main way to start early.
- **Needs** CHB-006 and CHB-003 (done in Phase 1) for conditioning and inversion.
- **Wants** CHB-010 (auto print, printer lights in filtration) and CHB-013 (a measured scanner model with per-channel flare). Not blocking.

## 4. The engine side: what exists and what is missing

### 4.1 What Phase 1 already provides

All paths are under `/home/manuel/code/wesen/chromobench/packages`.

**Conditioning (`ingest/src/conditioning/`):**

| need | function | file |
|---|---|---|
| rebate T from a box or automatically, with a confidence | `rebateFromBox`, `rebateAuto` (largest-rectangle region search), `rebatePercentile` (fallback, raises `W_REBATE_PERCENTILE`) | `rebate.ts` |
| check measured base against the stock's model | `baseCheck(rebateT, openGate, stock, fwd)` (warns above 0.02 D) | `rebate.ts` |
| open gate | `detectOpenGate`, `openGateFromBox` | `opengate.ts` |
| absolute rebate density | `rebateAbsoluteD` | `rank.ts` |
| stock ranking | `rankStocks(rebateAbsD, stocks, fwd)` returns `{stock, maxDiffD, rmsD, shapeDiffD, consistent}` | `rank.ts` |
| flare from a wedge | `fitFlare(readings)`, `fitFlareChannel` (per channel exists here) | `flare.ts` |
| σ at a scale | `sigmaD`, `noiseAtScale`, `madSigma`, `shadowFloor` | `sigma.ts` |
| base class per pixel and per image | `baseClass`, `classifyImage` (`below` / `blank` / `above`, Z = 3) | `classify.ts` |
| conditioning (noise gain 1/σ₃) | `sigmaTable`, `conditioningMap` | `conditioning-map.ts` |
| flat field | `flatGrid`, `flatAt`, `checkFlat` | `flat.ts` |
| dust | `specks`, `heal`, planted-speck tests | `dust/` |

**Inversion and balance (`core/src/`):**

| need | function | file |
|---|---|---|
| forward model and dye solve | `makeForward`, `solveDyes` | `scan/solve.ts` |
| flare removal | `removeFlare`, `withFlare` | `scan/solve.ts` |
| class with residual | `classify` (below beats blank beats gamut) | `scan/classify.ts` |
| frame LATD from printing densities | `latd`, `latdFromPD` | `print/balance.ts` |
| auto lights (integrate to grey) | `integrateToGrey(frameLatd, aim, alpha = 0.75)` | `print/balance.ts` |
| lights to sliders and back | `colourOffset`, `lightsToSliders`, `WARM_MIRED`, `TINT_PT` | `print/balance.ts` |
| grey pick | `greyPick(chain, c, start)` | `print/balance.ts` |
| lights as a value (adds in log H, refuses density) | `Lights` | `print/lights.ts` |
| grey patch lights, display chain | `greyPatchX`, `viewToDisplay` | `print/chain.ts` |

**Contract (`contract/src/`):** the recipe already has `print.lights.auto: AutoBalance` with `method: 'none' | 'integrate' | 'grey-patch' | 'roll' | 'match' | 'learned'`, `alpha`, `rollConsistency`, `matchFrame`, `matchAmount`, `applied`, `logH`. The mutation set is closed (`set`, `exposure.add`, `exposure.remove`, `mask.set`, `frame.add`), and every mutation carries `expect` for staleness (`E_STALE`). `EditLog` has `apply`, `propose`, `approve`, `reject`, and per-transaction undo units. Ops exist for `scan.rebate`, `scan.noise`, `scan.baseClass`, `scan.rankStocks`, `scan.specks`, `invert.dyes`, `invert.classify`, `print.expose`, `print.lights`, `measure.stats`, and `darkroom.contactSheet` (a decoration op that prints frames into one image, with `frames` and `cell_px`).

### 4.2 What roll analysis is made of

Roll analysis composes the functions above. Pseudocode (a sketch; names are ours, not yet in code):

```ts
// kits/roll/src/engine/analyse.ts (sketch)
interface RollAnalysis {
  shared: RollFragment;                 // proposed shared settings, each with evidence
  evidence: RollEvidence;               // per-setting numbers shown in the setup panel
  deltas: Map<FrameId, FrameDelta>;     // per-frame measurements and mutations
  diagnostics: Diagnostic[];
}

async function analyseRoll(frames: FrameHandle[], opts: RollOptions): Promise<RollAnalysis> {
  // 1. per frame, at a fixed analysis size (long side 1024 px, so σ and class shares are comparable)
  for (const f of frames) {
    const T   = conditioned(f)                         // flat, open gate
    const reb = rebateAuto(T, f.recipe.scan.crop)      // box + T + confidence
    const sig = noiseAtScale(T, reb.T, 1024, f, reb.box)
    ...
  }
  // 2. roll level
  const baseT   = robustMedian(frames.map(f => f.reb.T), reject: confidence < 0.5)  // per channel
  const spread  = maxAbs(frames.map(f => densityDiff(f.reb.T, baseT)))              // in D
  const ranking = rankStocks(rebateAbsoluteD(baseT, openGate) ?? shapeOnly(baseT), STOCKS, fwd)
  const flare   = scannerModel.flare ?? DEFAULT_FLARE                                // see 8.1
  // 3. second pass, now with the roll's base: σ, classes, specks, LATD, auto lights per frame
  ...
}
```

Notes on each step:

- **Rebate per frame, base per roll.** Each scan contains a strip of rebate or sprocket margin. `rebateAuto` finds it per frame with a confidence. The roll base is a robust median over frames with good confidence, per channel. The spread of per-frame rebates around that median is the roll's consistency check: below about 0.01 D is one film; above 0.03 D means a mixed roll, a bad flat or a mis-picked box (open question 8.2).
- **Stock.** `rankStocks` needs absolute density, so it needs an open gate. Without one (the Gold 200 sample has none) fall back to `shapeDiffD`, which removes the unknown common factor, and mark the suggestion as weak. The result is a ranked list shown to the photographer, never an assertion: the scan cannot name its stock. If the top two are within 0.02 D the panel says so and asks him.
- **Flare.** Per-roll flare cannot be read from a frame. It comes from the scanner model (CHB-013's wedge fit) when present, else the stock default; the panel shows the source. Today the recipe holds one number (`scan.flare`), though `fitFlare` in ingest fits per channel (open question 8.1).
- **σ at the scale used.** σ depends on resolution (0.0090 vs 0.0043 for red on Gold 200), so analysis fixes one scale (TODO: choose 1024 px long side; Chromogen uses 640) and always reports the scale with the number.
- **Base classes.** `classifyImage` per frame gives blank/below/gamut shares. A frame with blank share above ~40 % at analysis scale is a probable under-exposure: flagged in the contact sheet as a cull hint (TODO threshold from the fixtures roll).
- **LATD and auto lights.** `latdFromPD` over the frame's printing densities, then `integrateToGrey` with the stock's aim. The roll then blends: `ℓ = (1 − r)·ℓ_auto + r·mean_roll(ℓ_auto)` (Chromogen's roll consistency, CHB-010 §6.4), recorded as `auto.method = 'roll'`, `rollConsistency = r`.

### 4.3 What is still missing

| missing | owner | what we do meanwhile |
|---|---|---|
| auto print for real-enlarger mode, printer lights in filtration and time (`lightsToFiltration`, Bake) | CHB-010 | first print uses `print.enlarger.mode = 'normalised'`, lights only; the "hand-off" shows lights in points. When CHB-010 lands, first print writes the filtration and time too, and the roll fragment gains the lamp and pack. |
| measured scanner model, per-channel flare, flat checks | CHB-013 | use the built-in scanner ids (`xt5-fitted`, `xt5-rgb-led`, …) and the single `scan.flare` number; the setup panel shows "scanner: estimated, not calibrated". |
| roll as a record (catalog and contract) | this ticket proposes (section 7) | store in the catalog slice; recipes hold plain copies. |
| a batch id across frames' EditLogs | this ticket proposes (section 7) | shell-level transaction groups several frame transactions; approval card groups by `why` + timestamp until the field exists. |
| decision on the analysis size and thresholds | open | constants in one file, `kits/roll/src/engine/constants.ts`. |

## 5. The kit as builder calls

### 5.1 The shortest use

A variant installs the kit and drops the standard roll surfaces in:

```js
import { defineVariant } from '@chromobench/studio-kit'
import { rollKit } from '@chromobench/studio-kit/kits/roll'

export default defineVariant({
  id: 'simple', label: 'Three steps',
  build: (ck, cb) => ck.shell('Chromobench')
    .use(rollKit)
    .module('roll', m => m.label('Roll').key('R')
      .left(cb.roll.library())                      // roll cards, import drop zone
      .center(cb.roll.flow())                       // setup → first prints → contact sheet → match, as steps
      .right(cb.roll.setup())),                     // the roll setup panel
})
```

`cb.roll.flow()` is itself assembled from smaller calls, so a variant that wants a different arrangement writes those directly.

### 5.2 The parts

```js
cb.roll.library(opts?)        // grid of roll cards; the import drop zone; "new roll from folder"
cb.roll.card(roll, opts?)     // one roll card (θ per roll): thumbnail strip, stock, frame count, status, flags
cb.roll.setup(opts?)          // the roll setup panel for the selected roll
cb.roll.contactSheet(opts?)   // the contact sheet view of the selected roll
cb.roll.balanceBar(opts?)     // reference frame chip, "Match to reference", consistency slider, "Applied to 31 frames"
cb.roll.cullKeys              // key map: P X U 0–5 colour labels, B, arrows, plus roll keys
cb.roll.badge()               // the roll badge fragment for film-strip cells (section 5.5)
```

**The roll setup panel** is a generated panel: each setting is a `cb.arg` bound to a roll-shared path plus an evidence line.

```js
cb.roll.setup({
  sections: ['stock', 'scanner', 'base', 'flare', 'noise'],   // β: which rows, in what order
  evidence: true,                                              // show the numbers behind each suggestion
})
// is, in effect:
ck.panel('roll-setup', { title: s => `Roll setup · ${rollOf(s).label}` },
  cb.roll.row('scan.stock', {
    suggest: s => rollOf(s).analysis.ranking,                  // τ: re-runs when the analysis changes
    evidence: r => `${r[0].stock} fits the base to ${r[0].maxDiffD.toFixed(3)} D; ${r[1].stock} is ${(r[1].maxDiffD - r[0].maxDiffD).toFixed(3)} D further`,
  }),
  cb.roll.row('scan.scanner'),
  cb.roll.row('scan.baseT', { evidence: r => `median of ${r.n} frame rebates, spread ${r.spread_D.toFixed(3)} D`, pick: 'box' }),
  cb.roll.row('scan.flare', { evidence: r => r.from }),
  cb.roll.row('noise', { readonly: true }))
```

`cb.roll.row(path, opts)` wraps `cb.arg(path)` with three additions: a "roll" scope chip, a suggestion list (from the analysis, shown but never auto-applied for the stock), and an "overridden on N frames" note computed from the frames' recipes. An override at roll level is a batch edit; an override on one frame is an ordinary single-frame edit that marks that frame as diverging (section 6.2).

**The contact sheet** uses CHB-019's grid view with a θ cell:

```js
cb.roll.contactSheet({
  columns: 6,
  mode: s => s.view.contact.mode,                  // τ: 'balanced' (each frame with its lights) | 'single' (one time and pack)
  cell: (frame, i) => cb.roll.contactCell(frame, i, {
    print: f => f.print({ lights: s => s.view.contact.mode === 'single' ? rollOf(s).fragment.print.lights : undefined }),
    show: ['number', 'flag', 'stars', 'cullHint', 'rollBadge'],
  }),
  select: { bind: s => s.ui.selection, mode: 'multi' },
  activate: (frame, ctx) => ctx.go('print', { frame }),
})
```

`contactCell` is a θ function: it receives the real frame. It builds `frame.print()` as a handle at thumbnail scale and hands it to `cb.thumb`, which schedules it on the **bg lane** and caches by **node id**. Content addressing is what makes this cheap: moving a roll-level slider changes the recipe, so a frame's print node id changes and its thumbnail re-renders; frames whose recipe did not change keep their cached thumbnail. In `single` mode all frames render with the same time and pack, as on a real contact sheet, so exposure differences show; this is how the photographer judges whether the roll is evenly exposed. `balanced` mode is the default and the one he culls in. The decoration op `darkroom.contactSheet` is for export and printing the sheet as one image; the on-screen sheet is a grid of cells, not one engine evaluation, so a single cell can refresh alone.

**Commands** go in the shell's one command table, so menus, palette (Mod+K) and the shortcut sheet get them for free:

| command | what | disabled when |
|---|---|---|
| `roll.import` | pick a folder or files, create a roll, run analysis | none |
| `roll.analyse` | re-run roll analysis (after a setup change) | no roll selected |
| `roll.firstPrint` | write the first-print mutations for frames lacking them | analysis missing |
| `roll.setReference` | mark the primary frame as the roll's reference | no frame selected |
| `roll.matchToReference` | propose the balance batch | no reference ("Choose a reference frame first") |
| `roll.clearMatch` | return frames to their own auto lights | nothing matched |
| `roll.cull.sweep` | full-screen cull pass (as CraftKit's Cull) | none |
| `roll.exportSheet` | export the contact sheet via `darkroom.contactSheet` | no frames |

`cb.roll.cullKeys` is the pattern of CraftKit's `CULL_KEYS`: `{ P: 'photo.pick', X: 'photo.reject', U: 'photo.unflag', ...ck.digits(0, 5, 'photo.rate'), ...ck.digits(6, 9, 'photo.label'), B: 'collection.addToTarget' }`, plus `M: 'roll.matchToReference'`, `R: 'roll.setReference'`. The `photo.*` commands themselves are the shared library commands from studio-kit; the roll kit only adds the `roll.*` ones. Keys are scoped (module, panel) and checked at build, so a variant that omits the contact sheet and still binds `M` gets a build diagnostic, not a dead key.

**Cull semantics.** Flags (`pick`, `reject`), stars and labels live in `catalog` (document tier, undoable, persisted). They are not in recipes. Reject never deletes a file and never removes a frame from the roll; "rejected" frames drop out of the roll's *statistics* for balance (a rejected frame must not drag the roll mean) but stay in the sheet, dimmed. Hold-C peek (last pick beside the current frame) ports from CraftKit's cull module as `ck.spring`.

### 5.3 A variant that rearranges

Darkroom-first variant: no roll module at all, only the setup panel as a dialog and the match bar in the print module:

```js
ck.shell('Chromobench').use(rollKit)
  .command('roll.setup.open', { dialog: cb.roll.setup({ sections: ['stock', 'base'] }) })
  .module('print', m => m
    .left(ck.dock.column({}, cb.panel.filmstrip({ badges: [cb.roll.badge()] }), cb.panel.history()))
    .center(cb.viewer(s => cb.frame(s).print(), { tools: ['dodge', 'burn', 'test-strip'] }))
    .right(cb.roll.balanceBar(), cb.panel.approvals()))
```

A lab variant for us shows the evidence panel permanently and adds an analysis inspector:

```js
cb.roll.setup({ sections: 'all', evidence: true })
cb.roll.inspector(s => rollOf(s).analysis)    // per-frame table: rebate T, σ, class shares, LATD, auto lights
```

A variant can also replace the suggestion policy: `rollKit.with({ firstPrint: f => f.print({ lights: 'zero' }) })` (kit options are build-time β values), or leave out first print entirely so frames open flat until he asks.

### 5.4 Fragments the kit adds

A fragment extends an existing form, node kind or handle with methods, props and slots (`ck.fragment(target, spec)`, brief section 5). The roll kit adds:

```js
// 1. a roll badge on film-strip cells (and on any cb.thumb cell)
ck.fragment(cb.view.filmCell, {
  slots: { badges: { add: (frame, s) => rollOf(s, frame) && frame.id === rollOf(s, frame).reference ? ref('★ ref') : null } },
  props: { rollBadge: { type: 'bool', default: true } },
})

// 2. every cb.arg gains .rollScope(): this control edits the roll or this frame
ck.fragment(cb.arg, {
  methods: { rollScope(mode = 'ask') { return this.prop('rollScope', mode) } },   // 'frame' | 'roll' | 'ask'
})

// 3. the frame handle gains roll(), so variant code and agent code speak one language
ck.fragment(cb.frameHandle, {
  methods: { roll() { return cb.roll.of(this) } },       // roll().fragment(), roll().reference(), roll().isDiverging(path)
})
```

`rollScope` matters for balance: with `cb.arg('print.lights.logH').rollScope('ask')`, moving the lights slider while a roll is matched can offer "this frame / the roll", and "the roll" produces the same mutation batch as `roll.matchToReference` (section 6.4). The default is `'frame'`, so a variant that does not use the roll kit gets none of this.

### 5.5 Kit declaration

```js
export const rollKit = ck.kit('cb.roll', k => k
  .requires('cb')                                   // studio-kit core
  .state('roll', { document: ['rolls'], view: ['contact', 'selectedRoll'] })
  .forms({ library, card, setup, row, contactSheet, contactCell, balanceBar, inspector, badge })
  .fragments(filmCellBadge, argRollScope, frameRoll)
  .commands(rollCommands)
  .keys({ cull: cullKeys })
  .passes(analysePass, firstPrintPass, balancePass, buildChecks)
  .docs(rollDocs))                                  // appears in Help and ck.explain(variant)
```

Kit-contributed build passes (UI tree IR) catch variant mistakes: `CB-R001` roll badge used in a layout with no roll state, `CB-R002` `cb.roll.balanceBar()` without a reachable contact sheet or roll library (warning: no way to choose a reference), `CB-R003` a `rollScope` control bound to a path that is not roll-shared. Fixes are computed from the receiver ("add `cb.roll.library()` to the left dock, or `rollKit.with({ reference: 'primary' })`").

## 6. Recipes, passes and the data model

### 6.1 Roll-level shared settings versus per-frame recipes

Recipes belong to frames (`FrameRecipe`, with its own EditLog). A roll has settings that should be the same on every frame. There are two ways to model that.

**Decision record 1: copy the shared settings into each frame, tracked by a roll record.**

- *Context.* Sidecar recipe files, content addressing of nodes, the EditLog per frame and the agent's closed mutation set all assume a self-contained recipe. The mutation set has no cross-frame operation.
- *Alternatives.* (A) A roll record holds the shared fragment; frame recipes inherit from it at evaluation time. (B) Each frame recipe holds copies; the roll record lists which paths are shared and what the roll's value is.
- *Decision.* B. At import, `frame.add` creates each recipe with the roll fragment already applied. A roll-level edit is a batch of ordinary `set` mutations, one per frame.
- *Consequences.* Recipes stay portable (a frame's sidecar alone reproduces its print); history shows exactly which edit changed what; inheritance rules never enter the engine. The cost: a roll edit touches N EditLogs, which is why the balance pass exists (6.3), and divergence must be detected: a frame diverges on a shared path when its value differs from the roll's. Divergence is computed, not stored: `diverging(roll, frame) = sharedPaths.filter(p => getPath(recipe, p) !== roll.shared[p])`. The roll badge and setup panel show it ("base overridden on 2 frames").
- *Status.* Proposed.

The roll's shared paths in the first version (all existing recipe paths): `scan.scanner`, `scan.stock`, `scan.format`, `scan.flat`, `scan.openGate`, `scan.flare`, `print.paper`, `print.aim`, `print.enlarger.mode`, `print.enlarger.lamp`, `print.enlarger.filtration`, `print.enlarger.time_s`, `print.enlarger.fstop`, `print.grade`. Not shared: `scan.rebate` (a box in each frame's own pixels), `scan.crop`, `scan.orientation`, `scan.dust.*`, `print.lights.*` (per frame, see 6.4), exposures and masks.

Roll-wide base is the one path with no home. `scan.rebate` is a box in one frame's pixels, so it cannot be shared. See the proposed `scan.baseT` in section 7.

### 6.2 The roll record in the catalog

```ts
// kits/roll/src/model.ts (sketch). Lives in catalog.rolls (document tier).
interface Roll {
  id: string;
  label: string;                          // "Gold 200 · 2026-11 · Lake trip"
  frames: FrameId[];                      // in scan order
  fragment: RollFragment;                 // the shared settings, as recipe path → value
  analysis: RollAnalysisRecord | null;    // evidence and per-frame measurements, with their scale
  reference: FrameId | null;              // the "print like this" frame
  match: { alpha: number; consistency: number; appliedAt: number } | null;
  status: 'imported' | 'analysed' | 'set-up' | 'first-printed' | 'balanced';
}
type RollFragment = Record<SharedPath, unknown>;
```

Analysis is data, not recomputed on open: `RollAnalysisRecord` stores per-frame rebate box, σ with scale, class shares with scale, LATD, auto lights, and the diagnostics, keyed by the frame's source SHA-256 and the settings it was computed under, so re-analysis is skipped when nothing changed (same content-addressing idea as nodes).

### 6.3 The passes

The brief's vocabulary for IRs and passes (`ck.pass(name, { on, after, before }, fn)`) maps onto the roll workflow as one pipeline over a new small IR, the **roll plan**:

```text
frames (scans) ──roll.analyse──▶ RollPlan { shared, evidence, deltas, diagnostics }
                                      │ roll.lower
                                      ▼
                          MutationBatch { perFrame: Map<FrameId, Mutation[]>, label, why }
                                      │ batch passes: staleness · coalesce · scope
                                      ▼
                          one approval card ──▶ per-frame EditLog.apply/propose
```

**`roll.analyse`** (kit pass on the *roll* IR): input is the roll's frames, output is a `RollPlan`. It is `analyseRoll` of 4.2: a pure function of scan data plus options, run on the bg lane, abortable, with per-frame progress. It never writes recipes. Diagnostics it produces use contract codes where they exist (`W_NO_OPEN_GATE`, `W_REBATE_PERCENTILE`, base-check warnings) and `CB-R1xx` codes for roll-level findings ("mixed roll: frames 5–9 have a base 0.04 D from the median").

**`roll.firstPrint`** (lowering): turns a plan into a mutation batch that sets the shared fragment on every frame (those that lack it), the per-frame rebate box, and `print.lights.logH` from auto lights with `print.lights.auto = { method: 'roll', alpha: 0.75, rollConsistency: r, applied: true, logH }`. Default r (TODO, open question 8.5) is 0.5: a roll shares film, lab and often light, so half the way to the roll mean is a safe start. For the first print the batch is *auto-authored* (`by: 'auto'`), so it applies without an approval card, as the contract's `Author` already allows for ingest. The photographer does not approve 36 first prints; he reviews the contact sheet.

**`roll.balance`** (mutation-batch pass): input is a reference frame and the roll's frames; output is a `MutationBatch` of per-frame `set` mutations. Its core is one existing function:

```ts
// kits/roll/src/engine/balance.ts (sketch)
function matchBatch(roll: Roll, ref: FrameId, opts: { alpha: number }): MutationBatch {
  const refAim = { latd: analysis.latd[ref], lights: Lights.fromLogH(recipeOf(ref).print.lights.logH) };
  for (const f of roll.frames) {
    if (f === ref || isRejected(f)) continue;
    if (userEditedLights(f)) { skipped.push({ frame: f, why: 'lights were set by hand' }); continue; }
    const l = integrateToGrey(analysis.latd[f], refAim, opts.alpha);       // core/src/print/balance.ts
    mutations.set(f, [
      { op: 'set', path: 'print.lights.logH', value: l.logH, expect: current(f) },
      { op: 'set', path: 'print.lights.auto', value: { method: 'match', alpha: opts.alpha, matchFrame: ref, matchAmount: 1, applied: true, logH: l.logH, ... }, expect: ... },
    ]);
  }
  // shared enlarger settings of the reference become the roll's (time, pack, grade) where the roll fragment differs
  return { mutations, skipped, label: `Print the roll like ${label(ref)}`, why: `...` };
}
```

`integrateToGrey(frameLatd, aim, α)` computes `ℓ = ℓ_aim + m + α(Δ − m)` with `Δ = LATD_frame − LATD_aim`. With the **reference frame as the aim**, that is exactly "print like this frame": the mean `m` is each frame's exposure difference from the reference and is corrected in full (a dark frame gets more light); the colour departure `Δ − m` is corrected by α. At α = 0 every frame gets the reference's colour balance with its own exposure correction (a pure "same filter pack, density-corrected" lab print); at α = 0.75 it is ordinary auto colour with the reference's exposure anchor. The UI exposes this as one slider, **Roll consistency**, mapped to α (TODO: direction and range after the first user test). This is a deliberate reuse: no new colour maths.

The batch is evaluated against the frames' EditLog state: each mutation carries `expect`, so a frame that changed since planning triggers `E_STALE`, and the card offers "apply anyway" (the existing `ApproveOptions.force`). Frames the photographer has already balanced by hand are skipped and listed ("2 frames skipped: lights set by hand", with a checkbox to include them).

**Batch passes** (the brief's mutation-batch IR): *staleness* (re-read `expect` values at approval), *coalescing* (merge repeated matches into one pending batch: moving the consistency slider replaces the pending batch's preview rather than stacking), and *approval scope* (one card for the roll; the card lists frame count, a before/after thumbnail pair for the reference and three random frames, and the skipped frames).

**Preview before approval.** While the card is open the batch shows as a **preview** (pending proposals render as preview, brief section 6): the contact sheet's cells switch to the proposed lights without committing. Approve commits one transaction per frame, grouped as one undo step (see the batch-id proposal in section 7); reject drops it.

### 6.4 One mechanism, three uses

Roll setup changes (stock, base, flare), balance matching and CHB-021's "apply look to the roll" are all the same shape: *compute per-frame mutations, show one card, commit as a group*. The kit exports `cb.roll.batch(frames, build)` so that CHB-021's kit can use it instead of reinventing it. Roll-level edits via `rollScope('roll')` on a control use it with `build = f => [{ op: 'set', path, value }]`.

## 7. Proposed contract additions (for CHB-002 / CHB-017)

These are proposals; the existing contract is not redefined.

1. **`scan.baseT: Vec3 | null`** (new settable path, transmittance of the film base, flat-corrected, relative to open gate when known). `null` means "measure from `scan.rebate`" (today's behaviour). Roll setup writes the roll's base to every frame; `scan.density` and the base check use it when set. This is the only way to share a base across frames, since `scan.rebate` is a frame-local box.
2. **`scan.flare: number | Vec3`.** The recipe holds a single number today (CONTRACT-DECISIONS defers per-channel), while `fitFlare` in ingest and the calibration fit are per channel. A scalar stays valid; a vec3 is per channel.
3. **`LoggedMutation.batch?: string`.** An id shared by the entries of one cross-frame operation so that history and approval can group them; per-frame EditLogs stay independent. `EditLog.approve` and `reject` accept a batch id and apply to all entries of that batch in that log.
4. **`FrameRecipe.roll?: { id: string }`** (informational; not part of the path schema). Lets a frame's sidecar say which roll it belongs to; the roll record itself lives in the catalog, not in the recipe.
5. **A `Roll` record in the catalog schema** (section 6.2) and a `RollFragment` type, so the sidecar format for a roll (`roll.json` beside the frames, like CHB-013's fixture layout) is defined once.
6. **`AutoBalance` values.** `method: 'match'` with `matchFrame` already exists; add the note that for `'roll'` and `'match'`, `logH` is the applied result and the method records provenance. No new fields needed.
7. **Diagnostic codes**: `W_ROLL_MIXED` (per-frame base spreads beyond tolerance), `W_ROLL_STOCK_AMBIGUOUS` (top two stocks within 0.02 D), `W_FRAME_DIVERGES` (frame differs from roll on a shared path).

## 8. Open questions and risks

1. **Per-channel flare.** The recipe has one flare number; the real scanner's veiling light is probably not equal in the three channels (CHB-013). A single number silently biases the shadows of one channel. Needed before real calibration; blocks nothing now. Decide with CHB-013 whether roll setup shows three values or one.
2. **Roll-wide versus per-frame base.** The kit uses a roll median because one frame's rebate can be unrepresentative (the Gold 200 rebate is 0.021 D denser at the top). But if the frames have been developed unevenly, or the roll was spliced, per-frame is right. Policy: roll median by default, flag `W_ROLL_MIXED` when frames spread, offer "per frame" in the setup panel.
3. **Mixed rolls.** Two stocks on one roll (a half-used roll rolled back in), or a push or pull change partway. Detect by the base spread and by blank-share jumps; offer "split roll at frame N" (creates two roll records, same files). TODO: UI for this; may be a later stage.
4. **No open gate.** Without a flat/open gate, absolute density is unknown, so stock ranking is shape-only and the base check cannot run. The panel must say so rather than suggest confidently (the Gold 200 sample is exactly this case).
5. **Roll consistency default and direction.** r = 0.5 for first print, and the α mapping for matching, are guesses. They need his rolls and his preferences (CHB-013's beta).
6. **Match fails across different scenes.** The textbook's chapter 9 says matching to a frame fails when two scenes differ (a sunset next to an overcast street). The card should show before/after thumbnails and the skipped-frames list, and "reference" should be easy to change. TODO: a "suggest a reference" helper (the frame whose auto lights are closest to the roll mean).
7. **Edited-by-hand detection.** `userEditedLights` reads the EditLog (entries with `by: 'user'` on `print.lights.*`). Cheap; confirm that `auto` first-print entries are not counted.
8. **Analysis cost.** 36 frames at 24 MP scans; per-frame analysis at 1024 px should take well under a second each, but decode time dominates. Run on the bg lane with progress and cancel; cache the analysis record by source SHA-256.
9. **Thumbnail cost on the contact sheet.** 36 `frame.print()` at thumbnail scale per slider drag. Rely on node-id caching and the proxy-size lane; check with the mock engine first, GPU engine later.
10. **Ownership of cull data.** Flags and stars in the catalog, not in recipes: a user switching variants keeps them; a frame's sidecar does not carry them. Confirm that this is what he wants.

## 9. One flow traced end to end: a 36-exposure Gold 200 roll

All numbers below are plausible and marked where invented (marked "illustrative"); the Gold 200 numbers are from the fixtures.

**1. Import.** He drops `2026-11-lake/` with 36 TIFFs. The `roll.import` command creates a roll record `roll-7f3a`, runs `ingest` decode for each file (CHB-006), and creates 36 frames with `frame.add`. Status: `imported`. The contact sheet already shows 36 cells: each `frame.print()` handle renders with default recipes (flat grey-ish inversions), because no analysis exists yet. The roll card in the library shows "36 frames · analysing…".

**2. Roll analysis (`roll.analyse`, bg lane).** At analysis size 1024 px long side:

- Per frame, `rebateAuto` finds the rebate strip: 34 of 36 frames with confidence above 0.5; frames 9 and 21 have scan edges cropped (confidence 0.2, 0.3) and are excluded from the median.
- Roll base: median of 34 rebates, per channel. The spread of the 34 around the median is 0.008 D (illustrative; the Gold 200 fixture's rebate non-uniformity is 0.021 D top to bottom, so the spread shown is the roll's, not that).
- No open gate (as in the fixture), so `rankStocks` uses `shapeDiffD`. Ranking (shape differences, illustrative): Gold 200 0.004, C200 0.019, UltraMax 400 0.033, Portra 800 0.041. The top two are within 0.02 D, so `W_ROLL_STOCK_AMBIGUOUS`. The panel lists Gold 200 first, with the note "C200 is 0.015 D further; the scan can't tell them apart. Name the stock." He knows it is Gold 200 and confirms.
- Flare: the scanner model in use is `xt5-fitted` (no calibration yet); flare 1.2 % (illustrative stock default), "from: scanner default".
- σ on the rebate at the 1024 px size: (0.0058, 0.0044, 0.0079) D (illustrative; between the fixture's 0.0043 at 640 and 0.0090 at full size), reported as "σ at 1024 px".
- Per-frame classes at 1024 px: most frames 5–15 % blank and 3–9 % below base. Frames 3, 4 and 22 read 46 %, 52 % and 41 % blank: probable under-exposure; the contact sheet will mark them with a cull hint.
- Per-frame LATD from `latdFromPD` and auto lights from `integrateToGrey` with Gold 200's aim; roll mean of auto lights (illustrative): (+0.040, +0.003, −0.035) log H, i.e. about (+1.6, +0.1, −1.4) points.

Status: `analysed`. The setup panel shows the rows with evidence. He changes nothing.

**3. First print (`roll.firstPrint`).** The kit lowers the plan to a batch of 36 per-frame mutation lists: shared fragment (`scan.stock = 'kodak-gold-200'`, `scan.flare = 1.2`, `scan.baseT = [...]`, `print.paper = ...`, `print.aim = 'grey-0.184'`), per-frame rebate boxes, and `print.lights.logH` with `auto = { method: 'roll', alpha: 0.75, rollConsistency: 0.5, applied: true }`. Frame 17's own auto lights are (+0.062, +0.004, −0.050); blended 50/50 with the roll mean: (+0.051, +0.0035, −0.0425) log H (about +2.0, +0.1, −1.7 points). It applies as `by: 'auto'`: no card. Each frame's EditLog gets one undo unit "First print". Thumbnails refresh: frames have colour and tone. Status: `first-printed`.

**4. Contact sheet and cull.** He starts the cull sweep (`roll.cull.sweep`; the key is a variant decision). He steps with the arrow keys, presses `X` on frames 3, 4 and 22 (the hinted ones) and on 11 (out of focus), `P` on 17, 18 and 30. Stars on 17 (4) and 18 (5). These are catalog transactions: undoable, no EditLog involvement. Rejected frames dim; the roll statistics skip them.

**5. Match to reference.** Frame 18 (a shaded street, with a grey wall) looks right to him. He presses `R` on frame 18 (`roll.setReference`), then `M` (`roll.matchToReference`). The pass computes, for each of the 31 non-rejected, non-reference frames, `integrateToGrey(latd_f, {latd: latd_18, lights: lights_18}, α)`, with the consistency slider at its default (α = 0.45 from the mapping; TODO). Frame 18's lights: (+0.048, +0.002, −0.044). Frame 17: LATD differs from 18 by Δ = (+0.016, +0.004, −0.012), m = +0.0027, so lights = ℓ_18 + m + α(Δ − m) = (+0.048 + 0.0027 + 0.45 × 0.0133, +0.002 + 0.0027 + 0.45 × 0.0013, −0.044 + 0.0027 + 0.45 × (−0.0147)) = (+0.0567, +0.0053, −0.0479) log H. The card reads "Print the roll like frame 18 · 31 frames · 2 skipped (lights set by hand: 12, 27)". The contact sheet previews the result. He moves the slider once; the pending batch is replaced (coalescing), not duplicated. He approves. Each frame's EditLog gets one undo unit with the shared `batch` id, `auto.method = 'match'`, `matchFrame = 'frame-18'`. One global undo step reverts all.

**6. Hand-off.** He double-clicks frame 18: the `activate` handler runs `ctx.go('print', { frame })`. The print module shows the viewer with the frame's recipe: `print.lights.logH` as points, the roll's enlarger settings in place, History showing "First print" and "Print the roll like frame 18" (the second with its `why`). A "roll" chip sits beside the lights control (via `rollScope('ask')`); changing the lights there offers "this frame / the roll". He opens the test-strip tool (CHB-010) and carries on.

## 10. Implementation plan

**Stage 1: roll model and analysis, no UI.** `kits/roll/src/engine/`: `analyse.ts`, `constants.ts`, `model.ts` (`Roll`, `RollFragment`, `RollAnalysisRecord`, divergence). Runs on the reference engine and ingest; fixtures are a synthetic 12-frame roll made from the Gold 200 sample with scale, noise and offsets planted, plus the sample itself. *Done when:* analysis of the planted roll recovers the planted base within 0.005 D and flags the planted mixed section, and the Gold 200 sample's σ and class shares match the CHB-006 numbers at the same scale.

**Stage 2: first print and balance as mutation batches.** `firstPrint.ts`, `balance.ts` (`matchBatch`), batch coalescing and staleness over real `EditLog`s. *Done when:* applying a match to the planted roll gives each frame the lights `integrateToGrey` returns, a stale frame produces `E_STALE`, and one undo reverts all frames.

**Stage 3: kit shell (against the CHB-018 port and mock studio-kit).** `rollKit` declaration, state slice, commands, keys, build passes with `CB-R*` codes. *Done when:* a headless variant using `.use(rollKit)` builds with zero errors and its `ck.explain` snapshot is stable.

**Stage 4: roll library and roll setup panel.** `cb.roll.library`, `card`, `setup`, `row`; import flow. *Done when:* importing the Gold 200 fixtures creates a roll, the panel shows the evidence rows, and overriding the stock re-runs analysis and shows "overridden" on the divergent frames.

**Stage 5: contact sheet and cull.** `contactSheet`, `contactCell`, `cullKeys`, peek spring, `roll.cull.sweep`, cull hints. *Done when:* keys flag and rate frames undoably, and moving a roll-level setting re-renders only the cells whose node ids changed.

**Stage 6: balance UI.** `balanceBar`, preview of a pending batch on the sheet, the approval card with before/after thumbnails and the skipped list, `rollScope` fragment. *Done when:* the Playwright smoke test (open fixtures, analyse, match, undo) passes in the variant.

**Stage 7: variants and fragments.** Roll badge fragment, `inspector`, use in the classic, darkroom and simple variants (CHB-019 owns the variants; this stage supplies the roll parts and a variant example per layout). *Done when:* all four variants build headless with the kit; a variant omitting the contact sheet gets the `CB-R002` warning and a computed fix.

**Stage 8: CHB-010 and CHB-013 integration.** When auto print arrives, first print writes filtration and time and the fragment gains lamp and pack; when the scanner model lands, use its flare and replace the "estimated" tag. *Done when:* the roll fragment tests pass with both interim and calibrated inputs.

## 11. Testing and acceptance

**Unit and law tests** (Vitest, headless, no DOM):

- *Analysis recovers planted truth.* Build a synthetic roll from the Gold 200 sample: multiply each frame by a base offset (0 to 0.01 D), add noise at a known σ, include one frame with a base offset of 0.04 D. Expect: roll base within 0.005 D; `W_ROLL_MIXED` on exactly that frame. Test can fail: zero the offset logic and the warning must not fire.
- *Gold 200 numbers.* On the sample at 640×443: blank 12.6 %, below 9.7 %, gamut 0.05 %; at 1,090×754: blank 21.5 %, below 7.2 %, gamut 0; rebate σ (0.0090, 0.0069, 0.0122) D at full size and (0.0043, 0.0033, 0.0057) D at 640 (from the CHB-006 goldens; use their tolerances). The kit must report these *with their scale*.
- *Stock ranking.* Gold 200's rebate ranks Gold 200 first; C200 is 0.020 D from it, so `W_ROLL_STOCK_AMBIGUOUS` is raised; Portra 400 (0.072 D) is not a suggestion above Gold 200. Without an open gate, ranking uses `shapeDiffD`, and the evidence line says "weak".
- *Match law.* For a reference with lights ℓ and any frame f: at α = 1, f's lights equal `ℓ_ref + (Δ)` (full correction to the reference's grey), and at α = 0 only the mean correction is applied. Property test with random LATDs.
- *Batch laws.* Applying a batch then one undo restores every frame's recipe exactly (compare canonical JSON); a stale frame is reported, not silently overwritten; hand-edited frames are skipped and listed.
- *Divergence.* Editing `scan.flare` on one frame marks exactly that frame diverging on exactly that path, and `roll.analyse` leaves it alone.

**Builder tests:** every variant builds headless with zero error diagnostics and an `explain` snapshot; `CB-R001..R003` fire on their negative fixtures; commands report why they are disabled.

**Smoke (Playwright, one per variant using the kit):** import fixtures, wait for first print, flag three frames, set a reference, match, approve, undo.

**Fixtures.** The Gold 200 sample (SHA-256 `54bd952c…8793f78d`) plus planted variants made in `kits/roll/test/fixtures/`. The photographer's real rolls (CHB-013 §8 layout, `fixtures/scans/<setup-id>/<stock>/<roll-id>/roll.json`, gated by `CHROMOBENCH_PRIVATE_FIXTURES`) are the beta fixtures for r, α and thresholds, not for CI.

## 12. References

**Project files (repository-relative):**

- `packages/ingest/src/conditioning/{rebate,flare,sigma,classify,rank,opengate,flat,conditioning-map}.ts` and `dust/`: roll analysis inputs.
- `packages/core/src/print/balance.ts` (`latdFromPD`, `integrateToGrey`, `lightsToSliders`, `greyPick`), `print/lights.ts`, `scan/solve.ts`, `scan/classify.ts`: inversion and balance.
- `packages/contract/src/recipe.ts` (`AutoBalance`, `ScanSettings`, `RECIPE_FIELDS`), `paths.ts`, `mutations.ts`, `editlog.ts`, `catalog/source-scan-invert.ts`, `catalog/measure-darkroom-finishing.ts` (`darkroom.contactSheet`).
- `ttmp/2026/11/11/CHB-016--…/sources/craftkit-studio/src/app/cull.js` (cull module, peek spring), `library.js` (`photoCell`, `CULL_KEYS`, `libraryCommands`), `develop-model.js` (`SYNC_GROUPS`, `syncSettings`: the "apply these groups to those photos" idea the roll batch generalises).
- Guides: CHB-006 (conditioning, §2.3 base table, §2.6 σ, §2.7 classes, §6 flow), CHB-003 (§3.5 classes, §3.6 balance), CHB-010 (§6.4 lights and balance, contact sheets), CHB-013 (scanner model, §8 sample rolls).
- UI design brief: `ttmp/2026/11/11/CHB-016--…/various/ui-design-brief.md`.
