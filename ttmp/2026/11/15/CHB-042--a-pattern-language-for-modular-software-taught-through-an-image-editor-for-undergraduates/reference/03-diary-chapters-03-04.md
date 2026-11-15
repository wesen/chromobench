---
Title: Diary — chapters 3 and 4
Ticket: CHB-042
Status: active
Topics:
    - architecture
    - patterns
    - teaching
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/modular/03-closed-algebra-of-small-parts.md
      Note: Chapter 3, written in this diary
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/modular/04-a-slot-in-the-formula.md
      Note: Chapter 4, written in this diary
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/modular/00-overview.md
      Note: Names, numbers, conventions (read, not edited)
ExternalSources: []
Summary: "How chapters 3 (Closed Algebra of Small Parts) and 4 (A Slot in the Formula) were written and checked against chromobench (CHB-037 integration tree) and Editor lab."
LastUpdated: 2026-11-15T00:00:00-05:00
WhatFor: "Review of chapters 3 and 4: which claims rest on which lines of code, what was removed, what is left open."
WhenToUse: "Before revising chapter 3 or 4, or when a reviewer questions a claim about the example programs."
---

# Diary

## Goal

This diary records the writing of chapters 3 and 4 of "A Small Pattern Language for Modular Software": the sources
read, the choices made, every claim about chromobench and Editor lab with the file and line it rests on, and what
was left out because it could not be verified.

Paths below are relative to two read-only trees:
- `CB` = `/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037`
  (chromobench, CHB-037 integration code);
- `EL` = `/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/editor-lab-src/editor-lab-work/editor-lab`
  (Editor lab; read as data only).

## Step 1: Survey of sources

I read the volume's overview, the parent volume's overview and chapter 7 for style and to avoid duplication, then the
mask and blend code in both programs and the CHB-035/037/039 diaries for their mistakes. The overview fixed the names,
numbers, ratings (3 is ★★, 4 is ★), the pseudocode notation and the running example; I did not change it.

The survey changed the plan for chapter 4 in one important way: chromobench has no alpha and no pixel layers, so its
compositing skeleton is not premultiplied over but the mix `back + k·(B(back, top) − back)`. That is the W3C formula
with an opaque backdrop. Chapter 4 therefore teaches the slot on Editor lab's premultiplied over and shows
chromobench's mix as its opaque special case, rather than claiming chromobench composites premultiplied colour.

### Prompt Context

**User prompt (verbatim):** "You are writing two chapters of a small pattern language for undergraduate students: "A
Small Pattern Language for Modular Software", taught through an image editor, in the style of Design Patterns (GoF)
and Christopher Alexander's A Pattern Language, with Richard Gabriel's lens (habitability, piecemeal growth,
compression; Patterns of Software, 1996). The patterns must be general software-design patterns; the image editor is
only the running example. [… chapter assignments, sources, template, writing rules, diary, DO NOT, VERIFY and REPORT
sections as given by the coordinator …]" A later coordinator message: "Resume: the owner approved the ten patterns as
listed in the overview. Carry out your original brief in full (chapters 3 and 4, diary, verification, report).
Nothing changed in the brief."

**Assistant interpretation:** Write chapters 3 and 4 to the template, verify every example claim against the code,
keep this diary, touch nothing else.

**Inferred user intent:** Two chapters an undergraduate can learn from, whose claims about the example programs a
reviewer can trace to lines of code.

### What I did
- Read `docs/patterns/modular/00-overview.md`, `docs/patterns/00-overview.md` (grep only), `docs/patterns/07-barrier-cut-fusion.md`.
- chromobench, masks: `CB/packages/core/src/print/masks.ts` (whole file), `CB/packages/contract/src/pixel.ts:61-77`
  (`mixPixel`, `maskCombine`), `CB/packages/contract/src/compile.ts:47-54, 179-235` (`Compiler.mask`, `coverage`),
  `CB/packages/contract/src/document.ts:134-157, 259-299` (entries, groups, masks), catalogue
  `CB/packages/contract/src/catalog/view-output-mask.ts:87-179` (mask op domains), `CB/packages/gpu/kernels/pointwise.wgsl:28-47, 444-477`
  (ops 12–15, 17, 27, 28), `CB/packages/gpu/kernels/combine.wgsl:22-23, 71-78` (mode 10), `CB/packages/gpu/src/engine-gpu.ts:512-520, 631-635`,
  `CB/packages/gpu/src/engine/dag.ts:17-39`, `CB/packages/contract/CONTRACT-DECISIONS.md:540-560` (CC-023),
  `CB/packages/studio-kit/src/bridge/render-bridge.ts:256-260` (overlay), `CB/packages/values/src/{index,coll,mutations,transactions}.ts`.
- chromobench, blends: `CB/packages/contract/src/document.ts:102-115` (`BLEND_MODES`, 16), `CB/packages/core/src/composite/blend.ts`
  (whole file), `CB/packages/core/src/ops/ops.ts:322-337` (`composite.mix`), `CB/packages/gpu/kernels/working.wgsl:1-86`,
  `CB/packages/contract/src/stage-laws.ts:1-30, 183-262` (composite law, `mix`, groups), CC-020 in
  `CONTRACT-DECISIONS.md:523-536`, tests `CB/packages/contract/test/compile.test.ts:200-215`,
  `CB/packages/contract/test/composite-law.test.ts:92-104`, `CB/packages/core/test/composite.test.ts:170-192`.
- Diaries: CHB-037 `diary/05-phase-p2a-contract.md:155-175, 262-269`, `06-phase-p2b-reference.md:305-340, 395-402`,
  `07-phase-p3-gpu.md:388`, `11-phase-p8a-ops.md:150-206, 284-290, 364-385, 396-452, 503-520`,
  `reference/03-editor-lab-parity-what-made-it-into-chromobench.md:40-70`; CHB-035 `diary/01-diary.md:180-190`,
  `design/01-digital-editing-in-chromobench.md:318-350, 870-880`; CHB-039 `diary/01-diary.md` (whole), `design-doc/01-mask-overlay-spec.md` (skimmed).
- Editor lab: `EL/src/engine.js:139-184` (SEP, NONSEP, 18 modes, `blend3`), `:356-397` (components, `makeComp`,
  `maskImage`, `combine`), `:556-603` (`coverage`, `compValues`), `:607-682` (`applyLayer`, `blendSource`, `applyGroup`),
  `:684-690` (`sourcePixels`); `EL/src/workspace.js:335-352` (selections); `EL/src/views/stage.js:324-334` (overlay);
  book `EL/src/book/01.md` §1.2–1.3, `02.md` §2.1, §2.5, `03.md` §3.1–3.3.

### Why
- Every claim in the chapters had to be traceable; reading the diaries first pointed to the real mistakes.

### What worked
- The diaries recorded the mistakes plainly (two subtract algebras, non-commutative intersect, the min → product
  change and its golden), so the Implementation notes could be honest without guessing.

### What didn't work
- `grep ... --include=*.ts` failed in zsh with `no matches found: --include=*.ts` (glob expansion); reran without it.

### What I learned
- chromobench's mask combine on the GPU is `combine.wgsl` mode 10, not `pointwise.wgsl`; ops 12–15 there are
  luminance, linear, ellipse and invert (plus 17 constant, 27 colour, 28 radial).
- chromobench's isolated group evaluates its children on the backdrop (`stage-laws.ts:217-222`): there is no
  transparent to start from. Editor lab's isolated group starts on transparent (`engine.js:673-682`).
- Editor lab's mask amount scales the component value before combining (`engine.js:564`), so an intersect component
  at amount 0 empties the mask; chromobench's fade `v + a·(op − v)` (`pixel.ts:74-77`) makes amount 0 a no-op for every
  operator. Not recorded in either program's diaries as a bug; I derived it from the code and describe it as a
  difference with a consequence.

### What was tricky to build
- Fitting chapter 4's brief (premultiplied over) to chromobench, which has no alpha. Resolved by teaching the slot on
  the general formula and showing the opaque reduction in the sketch (`mix`), with chromobench's real numbers in the
  notes.

### What warrants a second pair of eyes
- Whether the reduction "W3C formula with αb = 1 gives back + k(B − back)" is stated clearly enough for students.

### What should be done in the future
- N/A

### Code review instructions
- Read the two chapters with this diary's Step 4 table beside them.

### Technical details
- W3C general formula (Editor lab `blendSource`, `engine.js:652-670`):
  `co = αs(1 − αb)Cs + αs αb B(Cb, Cs) + (1 − αs) cb`, `αo = αs + αb(1 − αs)`. With αb = 1: `co = cb + αs(B − cb)`.

## Step 2: Drafting chapter 3 (Closed Algebra of Small Parts)

I wrote the chapter around masks as coverage functions, with groups and the values library as the secondary
examples of closure. The four Motivation failures are all real: a case per combination (generic), pixels instead of
descriptions (Editor lab's brush component), two algebras for one idea (Editor lab's selections, chromobench's old
`mask.and`), and a second drawing path for the overlay (the path CHB-039 chose not to take).

The first full draft was 2,919 words with code (2,587 without); I trimmed one force (smooth vs textbook, which note 4
covers), shortened the Motivation and several notes to 2,810 with code, about 2,480 without.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Chapter 3 to the template, 1,800–2,800 words.

**Inferred user intent:** A ★★ pattern students can apply outside images.

### What I did
- Wrote `docs/patterns/modular/03-closed-algebra-of-small-parts.md`.
- Choices: the Part is "coverage at a position, reading an image" so luminance and colour ranges fit; the fold starts
  from `constant(0)`; `faded` puts the amount outside the operator; feather is marked as reading neighbours.
- Mermaid: one flowchart, 9 nodes, three primitives → two operators → one mask → three readers; it shows the shape
  that matters (one expression, several readers).

### Why
- Notes 1–3 (identity, amount, exact laws) are the lessons students most often miss and both programs illustrate them.

### What worked
- Every note has a concrete line in one of the two programs.

### What didn't work
- First sketch reassigned `m` inside its own closure (`m ← p → … m.at(p) …`), which reads as recursion. Fixed with
  `prev ← m`.

### What I learned
- The document-level mask in chromobench is a flat list (no component refers to another mask), while the graph
  operators are fully closed. That became note 9.

### What was tricky to build
- Keeping project identifiers out of Forces, Solution and Sketch while keeping notes concrete.

### What warrants a second pair of eyes
- Note 2 calls Editor lab's amount placement a law-breaker for intersect. It follows from `engine.js:564` and `:397`;
  Editor lab's book (`03.md:13`) defines amount as "scale its value", so the behaviour is as designed there, only
  inconsistent across operators.

### What should be done in the future
- N/A

### Code review instructions
- Check notes 1–11 against Step 4's table.

### Technical details
- N/A

## Step 3: Drafting chapter 4 (A Slot in the Formula)

I wrote the chapter around blend modes as one slot `B(Cb, Cs)` inside over. The general lesson is placement: the
slot receives straight colour, sees neither alpha nor `k`, and the skeleton is exact at both ends, so those
properties hold for all sixteen modes. Groups (pass-through and isolated) show the skeleton absorbing new structure.

The draft was 2,663 words with code (2,323 without); after verification edits, 2,677.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Chapter 4 to the template; Template Method / Strategy, but about where the hole goes.

**Inferred user intent:** Students learn to choose the slot's position by the invariants it must not reach.

### What I did
- Wrote `docs/patterns/modular/04-a-slot-in-the-formula.md`.
- Motivation failure 2 (overlay on premultiplied colour picks the dark branch for half-transparent white) and
  exercise 3 are worked by hand: premultiplied backdrop 0.5 → `2·0.5·0.3 = 0.3`; straight backdrop 1 →
  `1 − 2·0·0.7 = 1`.
- Mermaid: one flowchart, 9 nodes, drawn so alpha visibly bypasses the slot.

### Why
- The diagram is there because the shape (what does not pass through the slot) is the point.

### What worked
- chromobench's tests already state the skeleton's laws (both ends exact for all 16 modes; isolated normal ≡ pass),
  so the notes could cite tests rather than intentions.

### What didn't work
- I first wrote that the blend list is read by "the panel". I could not find the panel reading `BLEND_MODES` in
  `packages/studio-kit` or `packages/shell`; I replaced it with readers I found: `contract/src/validate.ts`,
  `contract/src/catalog/layers.ts:137`, `gpu/src/chain/working.ts:4, 26-27`, `dsl/src/host/edits.ts`.
- First draft of note 5 said a mode "on values in no stated space is refused"; the code refuses on the stage
  encoding (`ops.ts:330`, `engine-gpu.ts:628`) and the law converts first (`stage-laws.ts:191`). Reworded.
- Note 9 first said "an unmasked layer in any mode" fuses; the fused case requires the top to be a short pointwise
  chain on its backdrop (`dag.ts:12-17`). Reworded to "an unmasked per-pixel layer".

### What I learned
- Editor lab's blend function is one, but its compositing skeleton is written three times (`blendSource`
  `engine.js:652-670`; ROI branch `:617-631`; pointwise branch `:632-647`). That became note 7.

### What was tricky to build
- Not overclaiming chromobench's premultiplied compositing (it has none); see Step 1.

### What warrants a second pair of eyes
- Note 5's figure (display mean 0.25 vs 0.58) comes from the golden stacks; I name no image, only the numbers
  (`11-phase-p8a-ops.md:368-370`).

### What should be done in the future
- N/A

### Code review instructions
- Check notes 1–11 against Step 4's table.

### Technical details
- N/A

## Step 4: Verification

I checked every claim about the example programs against code or diary lines, checked links and the mermaid
blocks, checked the known uses, and aligned the star lines with the sibling chapters (01, 05, 09 add a short sentence
after the stars).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Verify before reporting.

**Inferred user intent:** No claim the code does not support.

### What I did
- Claims table (chapter, claim → source):

| Ch | Claim | Source |
| --- | --- | --- |
| 3 | add = max, subtract = v·(1 − c), intersect = v·c; amount fade; exact at amount 1 | `CB/packages/contract/src/pixel.ts:69-77` |
| 3 | fold from empty mask; skip constant for first add at amount 1; feather then invert | `CB/packages/contract/src/compile.ts:189-201` |
| 3 | first component is the base, its op ignored; amount scales value | `EL/src/engine.js:563-564` |
| 3 | Editor lab mask combine products | `EL/src/engine.js:395-397` |
| 3 | selection subtract `min(a, 255 − b)` | `EL/src/workspace.js:345` |
| 3 | old `mask.and` = min; golden `neg-burn-and` changed, max 1.03e-1 at print | CHB-035 `diary/01-diary.md:185-186`; CHB-037 `06-phase-p2b-reference.md:312, 399` |
| 3 | 58 golden cases | CHB-037 `06-phase-p2b-reference.md:305-307` |
| 3 | intersect not bit-commutative, 0.0075 vs 0.007500000000000007; fix | CHB-037 `05-phase-p2a-contract.md:267-269` |
| 3 | law test on 21 × 21 values | `CB/packages/contract/test/compile.test.ts:200-215` |
| 3 | product vs min crease; add keeps max | `EL/src/book/03.md:36-43` |
| 3 | positions in document px; rasterised on the grid at pixel centres; strokes as paths | `CB/packages/core/src/print/masks.ts:1-24, 80-144`; `CB/packages/contract/src/document.ts:272-288` |
| 3 | brush stored as pixels; ignores layer offset | `EL/src/engine.js:581-592` (no `ox`) vs `:687` (`ox`); CHB-035 `diary/01-diary.md:182-183` |
| 3 | ellipse antialiased over one pixel so f32 and f64 agree | `CB/packages/core/src/print/masks.ts:36-40` |
| 3 | mask parity ≤ 2.7e-6 (SwiftShader) | CHB-037 `07-phase-p3-gpu.md:388` |
| 3 | GPU combine pass, three modes; primitives as pointwise ops | `CB/packages/gpu/kernels/combine.wgsl:22-23, 71-78`; `pointwise.wgsl:28-47`; `engine-gpu.ts:631-635` |
| 3 | overlay reads `Compiled.coverage`; groups' masks intersected; output.frame widened | `CB/packages/contract/src/compile.ts:47-54, 207-235`; `CONTRACT-DECISIONS.md:540-556`; `render-bridge.ts:256-260`; CHB-039 `diary/01-diary.md:93-96` |
| 3 | Editor lab overlay calls `coverage`, grid ≤ 480 px | `EL/src/engine.js:389-393`; `EL/src/views/stage.js:327-328` |
| 3 | flat component list; mask ops Mask → Mask | `CB/packages/contract/src/document.ts:265-299`; `catalog/view-output-mask.ts:163-179` |
| 3 | mask.combine, feather, paint are GPU barriers | `CB/packages/gpu/src/engine-gpu.ts:515-518` |
| 3 | group is an entry with amount, mask, blend; holds `Coll<Entry>` | `CB/packages/contract/src/document.ts:134-157` |
| 3 | one collection shape; four mutations; inverse is a mutation; transaction inverse | `CB/packages/values/src/coll.ts:1-4`; `mutations.ts:1-22`; `transactions.ts:99-114` |
| 3 | radial and colour added later as primitives | CC-020, `CONTRACT-DECISIONS.md:523-528` |
| 4 | 16 W3C modes in chromobench; 18 in Editor lab (W3C + add, subtract) | `CB/packages/contract/src/document.ts:107-110`; `EL/src/engine.js:139-160` |
| 4 | blend on straight colour; alpha in one line | `EL/src/engine.js:652-670` (line 667 alpha) |
| 4 | "a blend mode changes colour, never coverage" | `EL/src/book/02.md:13` |
| 4 | k = amount × mask | `CB/packages/core/src/ops/ops.ts:333-336`; `EL/src/engine.js:639, 655` |
| 4 | mix exact at both ends (CPU, GPU); test for all modes | `CB/packages/contract/src/pixel.ts:61-67`; `CB/packages/gpu/kernels/working.wgsl:80-86`; `CB/packages/core/test/composite.test.ts:186-190` |
| 4 | no node at amount 1, no mask, normal | `CB/packages/contract/src/stage-laws.ts:187-196` |
| 4 | separable in linear RGB, non-separable in OkLCh, conversions | `CB/packages/core/src/composite/blend.ts:1-10, 56-70` |
| 4 | refusal outside working encodings; law converts first | `CB/packages/core/src/ops/ops.ts:330`; `CB/packages/gpu/src/engine-gpu.ts:628`; `stage-laws.ts:190-191` |
| 4 | display mean 0.25 vs 0.58 | CHB-037 `11-phase-p8a-ops.md:368-370` |
| 4 | no ClipColor; luminosity can leave gamut; output knee | `blend.ts:7-8`; CHB-037 `11-phase-p8a-ops.md:381-382` |
| 4 | skeleton written three times in Editor lab | `EL/src/engine.js:611-616, 617-631, 632-647` |
| 4 | one mix for layers and groups | `CB/packages/contract/src/stage-laws.ts:221, 250` |
| 4 | "branch for branch"; one WGSL file for both kernels | `working.wgsl:1-5`; CHB-037 `11-phase-p8a-ops.md:400-402` |
| 4 | parity 5.3e-6 / 1.1e-4 (SwiftShader) | CHB-037 `11-phase-p8a-ops.md:448-450` |
| 4 | unmasked mix fuses; masked mix one combine pass | `CB/packages/gpu/src/engine/dag.ts:12-39`; CHB-037 `11-phase-p8a-ops.md:201-203, 404-406` |
| 4 | Editor lab pass/isolated; agree for normal source layers | `EL/src/engine.js:673-682`; `EL/src/book/02.md:112` |
| 4 | chromobench isolated on the backdrop; isolated normal ≡ pass, tested | `stage-laws.ts:217-222`; `composite-law.test.ts:92-101`; CHB-037 `05-phase-p2a-contract.md:163-166` |
| 4 | add/subtract not added; readers of `BLEND_MODES` | CHB-037 `11-phase-p8a-ops.md:163-164`; files listed in Step 3 |

- Links: `../07-barrier-cut-fusion.md`, `../09-vector-edit-document.md`, `01-…`, `03-…`, `04-…`, `05-…`, `09-…` exist.
  `02-one-declaration-many-readers.md` did not exist at first; it appeared while I worked, and a rerun of the check
  found every link in both chapters resolving.
- Mermaid: both blocks are `flowchart LR` with 9 nodes, plain ids, labels in `[...]` (one quoted label with
  parentheses). No renderer is installed locally (`mmdc not found`), and running a browser renderer is outside the
  brief, so the syntax was checked by reading.
- Word counts (`wc -w`, with code / prose outside code blocks): chapter 3 2,821 / 2,489; chapter 4 2,688 / 2,348.
- Reflowed prose lines over 120 characters left by the edits; the remaining long lines are table rows.
- Privacy: neither chapter names or describes a photo, a photo file or a person.

### Why
- The brief requires each claim to be checked before the report.

### What worked
- All retained claims have a source line.

### What didn't work
- Removed rather than verified: "the panel reads the blend list" (Step 3); "the GPU is compared with the reference
  bit by bit where it can be" (chapter 3, note 3), replaced by a claim the code shows (equality in tests; the compiler
  drops amount-0 components, `compile.ts:198`).

### What I learned
- N/A

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Known uses not taken from the code (from general knowledge): SICP closure and picture language; relational algebra
  and SQL; regular expressions; Parsec and Hutton–Meijer 1998; OpenSCAD CSG; Unix pipelines; Lightroom Classic mask
  add/subtract/intersect; W3C Compositing and Blending Level 1 with CSS `mix-blend-mode`; Porter–Duff 1984 (twelve
  operators); Cairo, Skia, Core Graphics blend modes beside Porter–Duff operators; Photoshop and GIMP layer modes;
  Photoshop pass-through groups; `qsort`, Java `Comparator`; MATLAB `ode45`, SciPy `solve_ivp`; fold/reduce.

### What should be done in the future
- N/A

### Code review instructions
- `wc -w docs/patterns/modular/0[34]-*.md`; open each table row's source.

### Technical details
- Link check: for each `](x.md)` in both chapters, `[ -f x.md ]` from `docs/patterns/modular/`.
