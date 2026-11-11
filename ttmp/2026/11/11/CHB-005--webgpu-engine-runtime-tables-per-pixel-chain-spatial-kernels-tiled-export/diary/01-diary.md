---
Title: Diary
Ticket: CHB-005
Status: active
Topics:
    - webgpu
    - image-pipeline
    - testing
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:22.970760049-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-005 and CHB-011 (WebGPU engine and output). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-webgpu-engine.md` (13349 words), added 18 staged tasks, and related the primary source files.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Requested milestone: a complete intern guide plus a task breakdown for this ticket.
**Inferred user intent:** The ticket can be picked up by a new engineer or agent without prior context.

### Evidence and commits
- Brief: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md` (session scratchpad); shared map: CHB-001 `design-doc/01-chromobench-architecture-and-work-plan.md`.
- Filed with `python3 -I CHB-001/scripts/07-ingest-intern-guides.py <agent output> .` and checked with `scripts/08-check-guide-markdown.py` (fences tagged, no raw HTML).
- Writer agent: one background general-purpose agent for CHB-005 + CHB-011; number checks in scratchpad out_numbers.py; web research on WebGPU limits, PNG cICP/iCCP, TIFF 34675, lcms-wasm, Compact ICC Profiles.
- The writer's own summary, kept as returned:

> Summary: I wrote both intern guides, following the common brief. For each I drafted, reread and revised, then checked every Chromogen line range I cite against `05-inline.js` and every textbook number against the source. Web research is cited in each guide's reference section:
> - WebGPU spec limits and features, plus web3dsurvey adapter values;
> - the PNG Third Edition rules for cICP, iCCP and sRGB, and TIFF tag 34675;
> - `lcms-wasm` 1.0.5 and `@kittl/little-cms`, with their exported APIs;
> - the Compact ICC Profiles (CC0);
> - Chrome's timestamp quantisation and headless WebGPU flags.
> 
> I ran small number checks only, with scripts in `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/out_numbers.py`. They covered grey-card encodings in the five output spaces, paper white and black, the knee values, tiling overheads and the CRC vectors. No WebGPU code was executed. The scratchpad drafts are `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb005.md` and `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb011.md`; they are identical to the text below.
> 
> Points the orchestrator should know:
> - Both guides contain "Proposed contract additions (for CHB-002)" sections, which overlap: `EvalTarget.signal` and `Engine.plan` appear in both.
> - CHB-011 proposes moving `finishing.*` ops before `output.display`, so that gamut compression stays the last colour step. That conflicts with the current catalog, which puts them on `display-rgb`.
> - CHB-011 stage 4 (soft proofing) depends on the open decision in design doc §8.4.
> - `scan-of-print` in CHB-011 requires a compile rule that sets `view.flare` to 0. CHB-002 or CHB-003 would need to accept it.
> 

### Noteworthy decisions or failures
- The guide's "Proposed contract additions (for CHB-002)" section, where present, is a proposal. It must be reconciled with CHB-002 before implementation.
- Numbers the writer computed for the guide (not from the textbook) are labelled as such in the guide. They are not independently re-verified here.

### Remaining requirements and next action
- Implementation has not started. Tasks in `tasks.md` are open.
- Next: review the guide, settle the open decisions it lists, and start stage 1.

## Step 2: Orientation: brief, architecture document, writing guidance and ticket workspace

The orchestrator assigned two intern guides in one task: CHB-005, the WebGPU engine (`packages/gpu`), and CHB-011, output and colour management (`packages/output`). Before reading any source code I read the common brief and the architecture and work plan. I also read the writing guidance the brief points to and listed the ticket workspaces, so I knew the return format, the constraints and what neighbouring tickets already contained.

The main finding was that the neighbouring guides did not exist yet. The CHB-002 and CHB-003 design documents were 144- and 148-word templates with empty headings, and the CHB-005 and CHB-011 `tasks.md` files held only `# Tasks` / `## TODO`. The guide therefore had to work from the contract sketches in the CHB-001 design doc, and it had to propose contract additions instead of citing finished ones.

### Prompt Context

**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."

**Orchestrator brief (not the user's words):** the task message began "Write two chromobench intern guides: **CHB-005 "WebGPU engine"** and **CHB-011 "Output and colour management"**. First read the common brief and follow it exactly, including its return format". It then gave a six-stage scope for CHB-005: runtime, tile planner, tables, per-pixel chain, spatial kernels and parity harness. For each stage it named the textbook sections, the Chromogen line ranges (`model.js` 1620–1901, `shaders.js` 1903–2085, `params.js` 2087–2193, `render.js` 2694–3228, `gpu.js` 3392–3604, `accel.js` 3606–3843) and three bugs to fix: the halation `.xxyy` packing, the repeating grain tile and radii given as frame fractions. The common brief is `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md` (90 lines).

**Assistant interpretation:** Write a self-contained guide that an intern can build `packages/gpu` from. It must cover background, how the package fits the system, what to port from Chromogen, the design, a traced flow, a staged plan, tests and risks. Return it in GUIDE, TASKS and RELATED blocks rather than writing it into the ticket.

**Inferred user intent:** Every work-plan ticket should have an onboarding document that is clear and technical enough for a new engineer to start implementation without reconstructing the analysis.

**Commit (code):** none. I made no repository changes; the orchestrator files the guide.

### What I did

- Read the brief (`Read`, 15:43:51 UTC by transcript timestamp).
- Listed the CHB-001 ticket and counted lines in the design doc and the writing-style reference (15:43:53).
- Read `design-doc/01-chromobench-architecture-and-work-plan.md` in full (591 lines at diary time) and `/home/manuel/.claude/skills/ticket-research-docmgr-remarkable/references/writing-style.md` (15:43:55–56).
- Listed `ttmp/2026/11/11/`, printed the CHB-005 and CHB-011 `tasks.md`, and counted the words in the CHB-002 and CHB-003 guides (15:44:59–15:45:08).
- Checked the scratchpad for a `guides/` folder and read `tickets.tsv` (15:45:11).

### Why

- The brief fixes the return format and the Markdown rules: every fence tagged, no raw HTML, no nested fences, `text` for diagrams, Unicode maths. Reading it first avoided reformatting later.
- The design doc defines the `Engine` interface, the domains and the package layout that the guide must implement against.

### What worked

- The design doc gave the `Engine` methods (`capabilities`, `open`, `evaluate`, `measure`, `prepare`, `dispose`), the domain list and the critical path 002 → 003 → 005 → 010 → 013. All of these went into guide §3.

### What didn't work

- Nothing failed. One limitation: there were no finished CHB-002 or CHB-003 guides to align with.

```text
 144 CHB-002--.../design-doc/01-intern-guide-contract-and-walking-skeleton.md
 148 CHB-003--.../design-doc/01-intern-guide-scan-to-print-physics-reference-in-f64-javascript.md
```

### What I learned

- The contract types `EngineCaps`, `ImageResult` and `TableKey` are named or implied in the design doc but not defined there. The guide therefore lists them under "Proposed contract additions (for CHB-002)".

### What was tricky to build

- Scoping against sibling tickets with no written guides. I drew the boundaries from the design doc's ticket descriptions: physics in CHB-003 and CHB-012, decoding in CHB-006, encoding in CHB-011 and UI in CHB-009. Guide §1 states them as "What CHB-005 does not do".

### What warrants a second pair of eyes

- The proposed contract additions in guide §10 overlap with CHB-011's (`EvalTarget.signal`, `Engine.plan`). CHB-002 should merge them once.

### What should be done in the future

- When the CHB-002 and CHB-003 guides land, check the CHB-005 guide's interface sketches against them.

### Code review instructions

- Compare guide §3 with the design doc's `Engine` interface and domain list.

### Technical details

Path abbreviations used in this diary (the original commands used absolute paths):

```text
C1 = /home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite
CS = $C1/various/extracted/chromogen-studio
SP = /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad
```

Constraints followed throughout: read-only on `ttmp/` and goja-cv, no imported HTML opened or executed, scripts only in `$SP/guides/` run with `python3 -I`, and web queries made of generic technical terms with no project or personal identifiers.

## Step 3: Textbook chapter 4 and the physics sections it depends on

The textbook *The Mathematics of the Colour Negative* is the main reading for this ticket. Chapter 4 ("Making it fast") gives every technique and measurement the engine needs: binding time, tables, neighbourhood costs, the GPU as a function evaluator, the WGSL solve, worker pools, parity proofs and the general rules. I read all of chapter 4. I also read the physics sections that define the spatial kernels the engine must run: §2.3 (DIR diffusion), §2.4 (halation and scatter), §2.5 (grain), §2.7 (viewing) and §3.5 (reachability).

Every quantitative tolerance and measurement in the guide's §2, §5 and §8 comes from this chapter: 2.18×10⁻⁶ for the solve, 7.2×10⁻⁷ for printing density, 4.2×10⁻⁷ for XYZ, 9.3×10⁻⁵ trilinear rms, 1.6×10⁻⁴ with 8-bit weights, 0.017 at edge cells, tetrahedral 1.9× better, the SAT figures, and the tile test (mean 0.0004 and max 1 with a halo; mean 0.017 and max 28 without). I quoted these numbers; I did not reproduce them.

### Prompt Context

**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Learn the techniques and measured numbers the guide must teach, and the tolerances the parity harness must hold.
**Inferred user intent:** Ground the guide in the project's own reference text, not in general GPU folklore.
**Commit (code):** none.

### What I did

```bash
cd "$C1/sources" && wc -l "The Mathematics of the Colour Negative.md" && grep -n "^#" "The Mathematics of the Colour Negative.md"
```

- Read lines 1050–1399, chapter 4 in full (15:44:02).
- Read lines 484–705: §2.4 scatter and halation, §2.5 grain, §2.6 printing, §2.7 viewing, §2.8 composition laws, §2.9 and the chapter end (15:44:04).
- Read lines 439–483, §2.3 DIR coupling and diffusion (15:49:41).
- Printed lines 874–916, §3.5 reachability, cut to 1,200 characters per line (15:49:45).

### Why

- The orchestrator named §4.1–4.9 as the core reading. The halation (§2.4) and DIR (§2.3) parameters are needed to size halos and global fields in µm.

### What worked

- Chapter 4 supplied all the WGSL lessons the guide repeats in §2.3–2.4 and §5.4:
  - no early return before `workgroupBarrier()`, quoting the Chromium compile error "'workgroupBarrier' must only be called from uniform control flow";
  - the reserved identifiers `active`, `filter` and `target`;
  - `gtol` raised to at least 1e-6 (6.49 passes per node at 1e-6, 8.55 at 1e-9, 5.70 at 1e-5 with errors 6.5× larger);
  - divergence (2.04 mean iterations, max 9, lockstep ratio 1.26);
  - timing (0.5 ms with `gl.finish()` against 652 ms with a read-back; 2,781 ms stalled against 1,410 ms timed once).
- §3.5 supplied the size dependence of the unreachable share: 19.3 % from the table against 13.7 % exact at 640 px, and 21.8 % against 17.1 % at full size.
- §2.7 supplied the grey card on Portra 400: dyes (0.687, 0.704, 0.864), print XYZ (0.1706, 0.1750, 0.1686), visual density 0.755 (0.746 with flare), `#70757b`, and the +10 red-point result (a* −20.7, density 0.956).

### What didn't work

- No failures. The §3.5 lines were read cut to 1,200 characters per line, so long lines there were seen only partially.

### What I learned

- The texture filter's 8-bit weights are a *model* in the textbook ("Careful" box in §4.2), not a GPU measurement. The guide says so and makes the export path use manual lookups from `textureLoad`.
- Halation acts on linear exposure before the logarithm. The textbook's law log₁₀(K ∗ E) ≥ K ∗ log₁₀ E became a parity test in guide §8.

### What was tricky to build

- Separating what the textbook measured from what it modelled or sketched, so that guide tolerances do not overclaim. For example, the "20 levels" for a per-tile wide kernel comes from a sketch in §4.7's "Try it", and the guide cites it as the textbook's sketch.

### What warrants a second pair of eyes

- All chapter-4 numbers in the guide are quoted from the textbook and were not re-run in this session. If the textbook is revised, guide §8 must follow it.
- The guide's definition of K (§2.1, "textbook §1.4") was written from the §1.4 heading and the analysis report's §2.2, not from reading §1.4 itself.

### What should be done in the future

- Stage 6 of the plan re-measures these numbers in headless Chromium. Record any differences against the textbook values.

### Code review instructions

- Spot-check guide §8's table against textbook §4.5 and §4.7 (lines 1226–1299).

### Technical details

Headings read (line numbers at diary time; the file has 1,399 lines):

```text
439 §2.3  484 §2.4  504 §2.5  530 §2.6  556 §2.7  588 §2.8  606 §2.9
874 §3.5
1050 Making it fast  1058 §4.1  1087 §4.2  1144 §4.3  1194 §4.4  1226 §4.5
1260 §4.6  1279 §4.7  1300 §4.8  1320 §4.9
```

## Step 4: Chromogen analysis report: pipeline, GPU and worker architecture, bugs

The CHB-001 analysis report (`$C1/various/analysis-chromogen-studio.md`) is a map of what Chromogen Studio computes, with evidence tags and line citations. The orchestrator pointed to §2, §4 and §6. I read it to find my way around `05-inline.js` before reading the code itself. The report is a map, not a source of truth: in Step 10 every line range the guide cites was re-checked against the code.

### Prompt Context

**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Use the report as an index to the code and to the bugs already found.
**Inferred user intent:** Avoid re-deriving what CHB-001 already established, while verifying it.
**Commit (code):** none.

### What I did

```bash
cd "$C1/various" && wc -l analysis-chromogen-studio.md && grep -n "^#" analysis-chromogen-studio.md
```

- Read lines 1–420 and 485–821 (15:44:10–12). At the time the file had 821 lines.

### Why

- §4 ("GPU / worker architecture") describes the WebGL2 renderer, the three table backends and the equivalence checks. §6 lists the approximations and the bugs.

### What worked

- The report gave the renderer's requirements (WebGL2, `EXT_color_buffer_float`, half-float fallback), the placeholder-sampler binding behaviour, `sync` by one-texel read-back, and the Gold 200 sample's fixed rebate box `[98,100,20,680]` and crop `[126,60,1090,754]` (report line 142 at diary time). The rebate box and crop became the fixtures in guide §8.

### What didn't work

- No failures.

### What I learned

- The report tags each claim `[code]`, `[data]` or `[inferred]`. Only `[code]` claims were carried into the guide, and only after the line check in Step 10.

### What was tricky to build

- N/A for this step.

### What warrants a second pair of eyes

- The report grew from 821 lines (when read, 15:44:08) to 842 lines at diary time; commit `0d9f7b1` "CHB-001: doc hygiene…" touched it. The section headings the guide cites (§2, §4, §5.3, §6.3) still exist, at lines 175, 506, 649 and 745.

### What should be done in the future

- N/A.

### Code review instructions

- `grep -n "^## \|^### " "$C1/various/analysis-chromogen-studio.md"` confirms the section numbers.

### Technical details

- Report sections used: §2.1–2.10 (pipeline), §4.1 (WebGL2 rendering), §4.2 (table backends), §4.3 (slow-path equivalence), §6.2 (approximations), §6.3 (bugs).

## Step 5: Chromogen `gpu.js` and `accel.js`: WGSL kernels, worker pool and backend policy

These two modules are what the GPU engine ports most directly. `gpu.js` holds the measured WGSL solve and spectral kernels plus their host code. `accel.js` holds the worker pool, the backend order and the benchmark that compares backends. I read both in full from the extracted bundle.

The verdict that went into the guide (§4.1–4.2): port the WGSL kernels nearly verbatim, because they are the measured ones. Rebuild the host code on pooled buffers, generated uniform packers and storage-texture output. Port the pool's shared queue and the benchmark's flip counting, and leave behind the `blob:` worker trick.

### Prompt Context

**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Identify what to port, what to change and what to drop in the table-building path.
**Inferred user intent:** Reuse proven code; fix only what is known to be wrong or awkward.
**Commit (code):** none.

### What I did

```bash
cd "$CS" && sed -n '3392,3604p' 05-inline.js    # gpu.js (15:44:18)
cd "$CS" && sed -n '3605,3843p' 05-inline.js    # accel.js (15:44:21)
```

### Why

- The orchestrator required porting `SOLVE` and `SPECTRAL` with workgroup memory, barriers before any early return, `select` masking and gtol ≥ 1e-6. The code shows exactly how the Studio does each of these.

### What worked

- The structure of `COMMON` (`WG` = 64, `LOG2_10`, `LOG10_2`, `sh: array<f32, 7 * 128>`, `nodeAt`), `SOLVE` (bounded LM with `select` masks) and `SPECTRAL` (mode 0 printing density, mode 1 XYZ) was clear and went into guide §4.1.
- In `gpuSolve` I found the 112-byte uniform layout: tolerances at float 24 (byte 96) and `activeSet` at float 26 (byte 104), with the gtol floor set at line 3592: `f.set([inp.tolerance, Math.max(inp.gtol || 0, 1e-6)], 24);`. That layout became the stage-1 acceptance test for the uniform packer.
- `Accel.order` (3721–3727) uses WebGPU under *Auto* only on hardware adapters. That became the fallback policy in guide §5.2.

### What didn't work

- No failures.

### What I learned

- `run` (3550–3582) creates and destroys four buffers per call. That is acceptable for a one-off table build, but the engine should pool them.
- Writing a table into a 3-D texture through `copyBufferToTexture` hits the 256-byte `bytesPerRow` rule: a 33-texel `rgba32float` row is 528 bytes. The guide therefore has the kernel write a `texture_storage_3d` directly, and uses `queue.writeTexture` for CPU-built tables.

### What was tricky to build

- Reading WGSL embedded as template strings inside a minified-then-reformatted bundle. Line numbers refer to `05-inline.js` as extracted, not to the original `src/gpu.js`.

### What warrants a second pair of eyes

- The 528-byte and `bytesPerRow` reasoning comes from WebGPU's copy alignment rules as I know them; I did not re-fetch that part of the spec in this session.

### What should be done in the future

- Stage 1 in the guide asks for a packer test against the 112-byte layout. It should run before any kernel work.

### Code review instructions

- Guide §4.1 against `$CS/05-inline.js` 3392–3604, and guide §4.2 against 3606–3843.

### Technical details

```text
gpuDevice 3521–3536 · pipeline 3538–3548 · run 3550–3582 · gpuSolve 3584–3595 (gtol floor 3592) · gpuSpectral 3596
Pool 3620–3696 · start 3629–3654 · run 3655 · pump 3669 · Accel 3697 · order 3721–3727 · any 3769–3784 · benchmark 3796–3842
```

## Step 6: Chromogen `model.js`, `shaders.js`, `params.js`, `render.js`, constants, worker bundle and perf chapter

This step covered the rest of the code the engine replaces: the table domains and builders, the GLSL passes, the parameter packing and the WebGL2 renderer with its global pass and tiled export. I also read the spec constants block `K`, inspected the worker bundle's job handler, and checked the Studio's own performance chapter.

This is where I confirmed the three bugs the orchestrator named and found three more. The halation channel mismatch was confirmed by reading `FS_DYES` (1921, 1929, 1932–1934) against the global pass (3027–3033). The grain tile repeat follows from `FS_PD` 1965 and `makeNoise` (2833–2875). The frame-fraction radii were confirmed at `K.HAL_RADII` (966) and line 3030. The three additional ones: neighbourhoods defined in render pixels, `pow`/`log` used for powers of ten, and f16 source tiles in export (3194).

### Prompt Context

**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Map each GLSL pass to a WGSL stage kernel, and list the bugs to fix while porting.
**Inferred user intent:** The intern should know exactly which lines become which file.
**Commit (code):** none.

### What I did

```bash
cd "$CS" && sed -n '1620,1901p' 05-inline.js     # model.js (15:44:25)
cd "$CS" && sed -n '1903,2193p' 05-inline.js     # shaders.js + params.js (15:44:28)
cd "$CS" && sed -n '2694,2960p' 05-inline.js     # render.js part 1 (15:44:31)
cd "$CS" && sed -n '2960,3228p' 05-inline.js     # render.js part 2 (15:44:35)
cd "$CS" && grep -n "v \* 257\|exportFrame(\|HAL_RADII\|GRAIN_SIGMA\|..." 05-inline.js   # constants (15:44:48)
cd "$CS" && sed -n '940,1000p' 05-inline.js; sed -n '2640,2692p' 05-inline.js        # K block, Source.working (15:44:52)
cd "$CS" && wc -c 04-st-worker.txt.js && awk '{print NR": "length($0)}' 04-st-worker.txt.js && tail -c 2500 04-st-worker.txt.js
cd "$CS/st-data" && find . -type f | sort | head -40; wc -l book/11-perf.md          # (15:54:55)
cd "$CS/st-data/book" && grep -n "^#\|tile\|halo\|WebGPU\|SwiftShader" 11-perf.md | head -50
```

### Why

- The orchestrator asked for the GLSL passes to be ported as WGSL compute and the listed bugs to be fixed. Both require reading the passes.

### What worked

- `HEAD` (1907–1917) shows the half-texel mapping `(u * 32.0 + 0.5) / 33.0` and the `g2` tile-to-frame mapping. These became guide §2.2 and the frame-coordinate rule in §5.3.
- `exportTiles` (3180–3227) confirmed 1024-px tiles with an 8-px halo, which is the halo the worked plan in guide §5.3 ends up with.
- The worker bundle is 40,174 bytes on 3 lines (lengths 241, 13,523 and 26,353). Its tail shows the job handler writing (c₁, c₂, c₃, residual) per node, the same layout as the main-thread tables.
- `11-perf.md` (284 lines) states that the Studio's timings were made on two CPU cores with SwiftShader. The guide repeats that caveat for its timings.

### What didn't work

- No failures.

### What I learned

- `emitE` writes (E_R, E_G, E_R, E_G). The blur gives (E_R⊛σ₁, E_G⊛σ₁, E_R⊛σ₂, E_G⊛σ₂), while the consumer assumes (E_R σ₁, E_R σ₂, E_G σ₁, E_G σ₂), as the uniform comment at 1921 says. Red therefore gets the narrow blur of the R/G average, and green the wide one.
- The grain tile is 1024² texels of 3 µm, so it repeats every 3.07 mm, about 12 times across 36 mm.

### What was tricky to build

- Getting the halation mismatch exactly right needed both ends: the producer at 1929, the blur's `.xxyy` packing in `FS_BLUR`, and the consumer at 1933 (`float ER = pow(10.0, x.r) + halAmt.x * 0.5 * (h.x + h.y);`). The guide quotes all three locations.

### What warrants a second pair of eyes

- The guide places the Studio's halation re-exposure for scans (a look) in `dyes.wgsl` as an option, pending CHB-002 and CHB-012 (guide §9). That placement is a proposal.

### What should be done in the future

- CHB-012 should confirm the spektrafilm halation parameters quoted in guide §5.6 (σ_c 2.2 µm, λ_t 9.3 µm, w 0.78, σ_h 65/50 µm, antihalation presets) against upstream when it imports them.

### Code review instructions

- Guide §4.4's table against `$CS/05-inline.js` 1903–2085 and 2694–3228; the guide §4.5 bug list against the cited lines.

### Technical details

```text
model.js: N3 33 · N1 512 · A_RANGE [−0.25, 2.55] · C_RANGE [0, 2.6] · X_RANGE [−2.5, 2.5] · CP_RANGE [0, 2.7] (1628–1633)
K: HAL_R 0.3 (963) · HAL_G 0.08 (964) · HAL_RADII [4e-3, 0.018] (966) · GRAIN_SIGMA 0.035 (968) · MASK_RADIUS 0.04 (972) · MID_RADIUS 8e-3 (974)
```

## Step 7: WebGPU specification, MDN, web3dsurvey and Chrome documentation

The orchestrator asked for the real default and typical WebGPU limits, and for the `float32-filterable` and `shader-f16` features, with the spec cited. I fetched the W3C WebGPU spec in four overlapping windows. I then used MDN for the feature descriptions and web3dsurvey for the values adapters actually report. Two Chrome developer pages supplied timestamp quantisation and headless flags, and a Chrome blog post covered requesting higher limits.

The spec values are now in guide §2.3's limits table. The survey numbers change the design: 99 % of adapters report a `maxTextureDimension2D` of at least 16,384, but only 16 % report a storage binding of at least 2 GiB. That is why the planner negotiates limits up to what the adapter reports and never assumes them.

### Prompt Context

**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Cite spec defaults and real-world values; do not guess.
**Inferred user intent:** Design decisions such as tile size and memory budget should rest on numbers that can be checked.
**Commit (code):** none.

### What I did

- `ToolSearch select:WebSearch,WebFetch` (15:45:35).
- `WebFetch https://www.w3.org/TR/webgpu/` at offsets 0, 100000, 200000 and 300000 (15:45:39–15:46:30).
- `WebFetch` on MDN `GPUCanvasContext/configure` and MDN `GPUSupportedFeatures` (15:46:32–38).
- `WebSearch` "WebGPU adapter limits typical values maxStorageBufferBindingSize 2147483644 maxBufferSize maxTextureDimension2D 16384 Chrome" (15:46:41).
- `WebFetch` on the web3dsurvey pages for `maxTextureDimension2D`, `maxBufferSize` and `maxStorageBufferBindingSize` (15:46:48–15:47:04).
- `WebSearch` on headless Chromium WebGPU flags (15:48:56) and on Chrome timestamp-query quantisation (15:49:10).

### Why

- Tile size, memory budget and the export path all depend on the limits a device grants.

### What worked

- Spec §3.6.2 defaults:
  - `maxTextureDimension2D` 8192, `maxTextureDimension3D` 2048;
  - `maxUniformBufferBindingSize` 65536, `maxStorageBufferBindingSize` 134217728, `maxBufferSize` 268435456;
  - `minUniformBufferOffsetAlignment` 256;
  - `maxComputeWorkgroupStorageSize` 16384, `maxComputeInvocationsPerWorkgroup` 256, `maxComputeWorkgroupsPerDimension` 65535.
- Spec §4.3: a `requiredLimits` value better than the adapter's rejects with `OperationError`. §3.6.2.4: `GPUAdapterInfo.isFallbackAdapter`.
- Spec §5.2: "The resolution of the returned Promise **only** indicates that the buffer has been mapped."
- MDN: `float32-filterable` allows filtering of `r32float`, `rg32float` and `rgba32float`; `shader-f16` allows `f16` in WGSL.
- web3dsurvey (overall rows):
  - `maxTextureDimension2D`: ≥ 16384 on 99 %;
  - `maxBufferSize`: ≥ 2,147,483,647 on 77 %;
  - `maxStorageBufferBindingSize`: ≥ 2,147,483,647 on 16 %.
- Chrome docs: timestamp queries are "quantized with a resolution of 100 microseconds"; the WebGPU Developer Features flag disables that.
- Search result: Emscripten's test setup used `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --enable-features=Vulkan`. The same results warned that headless screenshots of WebGPU canvases may be black on Linux, which led to guide §8's rule to compare read-back numbers instead of screenshots.
- The search results linked "New in WebGPU 133" (published 29 January 2025) on requesting higher limits explicitly.

### What didn't work

- The first spec fetch was cut off: "The excerpt is truncated partway through the Limits table (section 3.6.2), so I can only confirm some of the values you asked for." A second fetch at offset 100000 completed the table.
- The fetches at offsets 200000 and 300000 did not contain `GPUCanvasConfiguration` or the feature index: "The excerpt you provided doesn't contain items (1) through (3), and it doesn't contain timestamp-query quantization for item (4)." and "This section of the page doesn't cover most of what you asked for." MDN was used for those instead.
- The first limits search did not confirm 16384: "No result for maxTextureDimension2D = 16384: None of the results mention this value." Fetching the web3dsurvey page directly did.
- The search did not confirm that Playwright itself adds `--enable-unsafe-swiftshader`: "I could not confirm this against Playwright's source, so treat it as unverified." The guide does not claim it.

### What I learned

- A device gets the *default* limits unless it asks for more, even on a capable adapter. The guide's `negotiate()` caps each request at the adapter's reported value, because asking for more rejects the whole device.
- WebFetch returns a model-written summary of a page window, not raw text. Values quoted in the guide come from those summaries, cross-checked between the spec windows and MDN where both covered the same item.

### What was tricky to build

- The WebGPU spec page is about 400,000 characters, and each fetch reads 100,000. Finding the right window took four fetches.

### What warrants a second pair of eyes

- The survey percentages are snapshots of web3dsurvey on 2026-11-11 and will drift.
- Guide §2.3 also states the timestamp quantisation and the `isFallbackAdapter` / `requestAdapterInfo()` history. The history comes from the Studio's code (3528–3529), not from a spec.

### What should be done in the future

- Stage 1 should log the granted limits on the beta machines (CHB-013) and compare them with the survey.

### Code review instructions

- Check guide §2.3's table against W3C WebGPU §3.6.2, and guide §11's reference list against the URLs above.

### Technical details

```text
web3dsurvey maxBufferSize (≥, % of reports): 268,435,456 100 · 536,870,912 100 · 644,245,092 99 · 805,306,368 97 · 1,252,698,792 87 · 1,610,612,736 85 · 2,147,483,647 77
web3dsurvey maxStorageBufferBindingSize: 134,217,728 100 · 268,435,456 98 · … · 1,610,612,736 78 · 2,147,483,647 16
```

## Step 8: WGSL specification: accuracy table and integer wrapping (not retrieved)

I wanted two facts from the WGSL spec. The first was the required accuracy of `exp2` and `log2` for f32, to derive a hardware tolerance for the parity tests. The second was whether integer arithmetic on runtime values wraps on overflow, which the summed-area-table design relies on. Neither was retrieved. Four fetch windows of the 464,000-character page missed §15.7.4.1, a web search did not find the bounds, and the CTS floating-point primer does not state them.

The guide was written to match. The hardware tolerance of 10⁻⁵ is called "a guess to be confirmed on the beta machines" (guide §9). The wrapping rule is followed by "verify this with a probe kernel in the parity harness" (guide §5.6). §15.7.4.1 is cited in the references by its section title from the table of contents only.

### Prompt Context

**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Derive the GPU parity tolerances from the arithmetic, as the textbook does, and confirm the integer semantics used by the SAT design.
**Inferred user intent:** Tolerances that are justified, not tuned to pass.
**Commit (code):** none.

### What I did

- `WebSearch` "WGSL floating point accuracy exp2 "3 + 2 * |x|" ULP log2 absolute error 2^-21" (15:53:04).
- `WebFetch` of the CTS `fp_primer.md` via a searchfox mirror (15:53:12).
- `WebFetch https://www.w3.org/TR/WGSL/` at offsets 0, 300000, 200000 and 400000 (15:53:21–15:53:49).

### Why

- Without the spec bound, the hardware tolerance cannot be derived.

### What worked

- The table of contents located the material (§15.7.4.1 "Accuracy of Concrete Floating Point Expressions", §17.5 numeric built-ins, §8.8 arithmetic expressions), but no window reached those sections.

### What didn't work

Exact responses:

```text
search:  "The search did not find the specific accuracy bound you asked about."
primer:  "No, this document doesn't state accuracy requirements for `exp2` or `log2`."
WGSL@0:  "I can't answer either question from the content provided. The page text is cut off with "[Content truncated due to length...]" before the body of §15.7.4 and §17.5, and before §6.2.3 and §8.8."
WGSL@300000: "The provided text doesn't include the accuracy table for section 15.7.4.1."
WGSL@200000: "The excerpt you provided doesn't include section 15.7.4.1 (the f32 accuracy table) or section 8.8 (arithmetic expressions)."
WGSL@400000: "The excerpt doesn't include either item. It covers WGSL spec sections 9 through 12"
```

- Recovery: I did not try the remaining window (offsets 100000–200000) because of time. The guide marks both facts as unverified, as described above.

### What I learned

- For quantitative claims, a spec this long needs a targeted fetch of a section anchor, not offset windows.

### What was tricky to build

- Writing tolerances without the bound. The guide keeps the SwiftShader tolerances that the textbook measured, and states a looser hardware bound as a guess, "ten times below the table's own interpolation error of about 10⁻⁴".

### What warrants a second pair of eyes

- Guide §11 cites "WGSL §15.7.4.1 floating-point accuracy" even though the table was not read.
- The claim "WGSL integer arithmetic on runtime values wraps on overflow" in guide §5.6 is from memory and flagged for a probe test.

### What should be done in the future

- Fetch the WGSL section anchors directly (for example `https://www.w3.org/TR/WGSL/#floating-point-accuracy`) and replace the guessed 10⁻⁵ with a derived bound.
- Add the u32 wrap probe kernel to stage 6.

### Code review instructions

- Search the guide for "10⁻⁵" and "wraps on overflow" and check the wording still marks both as unverified.

### Technical details

- The WGSL page is 463,949 characters, according to the WebFetch note.

## Step 9: Check: `out_numbers.py` for memory, tiling and kernel sizes

I wrote one small script for the numbers both guides needed. For CHB-005 the relevant part covers the size of a 100 MP frame in each texture format, the halo overhead for several tile sizes, the tile count and the halation kernel sizes in pixels. The script ran once and printed the values used in guide §2.6 and §5.3. One result was later superseded: the halation pixel sizes at 5.8 µm per pixel. In review (Step 12) the frame geometry was corrected to 6.0 µm, and those figures were recomputed by hand. Step 14 rechecks them.

### Prompt Context

**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Compute every derived number the guide states, rather than estimating it.
**Inferred user intent:** Numbers in the guide should be reproducible.
**Commit (code):** none.

### What I did

```bash
python3 -I $SP/guides/out_numbers.py     # written and run at 15:56:37–39
```

The tiling part of the script:

```python
W,H=11600,8700; n=W*H; print(n, n*16/2**30,'GiB rgba32f', n*8/2**20,'MiB rgba16', n*6/1e6,'MB rgb16')
for T,h in [(256,8),(1024,8),(1024,64),(2048,64)]: print(T,h,((T+2*h)/T)**2-1)
print('tiles 1024:', math.ceil(W/1024)*math.ceil(H/1024))
print('halation px at 5.8um', [65*math.sqrt(k)/5.8 for k in (1,2,3)])
```

### Why

- Guide §2.6 argues that 100 MP forces tiling, so the memory figures have to be exact.

### What worked

```text
100920000 1.5038251876831055 GiB rgba32f 769.95849609375 MiB rgba16 605.52 MB rgb16
256 8 0.12890625
1024 8 0.031494140625
1024 64 0.265625
2048 64 0.12890625
tiles 1024: 108
halation px at 5.8um [11.206896551724139, 15.848945095560548, 19.41091422275466]
```

These became, in the guide: 1.50 GiB for `rgba32float`, 770 MiB for `rgba16float`, 3.2 % overhead for a 1024-px tile with an 8-px halo, 12.9 % for a 256-px tile, and 108 tiles.

### What didn't work

- The 5.8 µm pixel pitch was an assumption ("a 6 × 7 frame scanned to 12,000 px"). It did not match the 11,600 px width used elsewhere in the guide. It was corrected to 69.5 mm / 11,600 px = 6.0 µm in Step 12, and the script was not re-run.

### What I learned

- One `rgba32float` image of the frame alone exceeds the default `maxBufferSize` about six times. Tiling is required, not an optimisation.

### What was tricky to build

- Keeping the frame geometry consistent across sections: pixel count, physical size, µm per pixel and kernel radii.

### What warrants a second pair of eyes

- The 6.0 µm figures in guide §5.3 (33, 46 and 57 px; σ 2.7 to 4.7 px at downsample 4; 2,900 × 2,175) were computed by hand when editing. Step 14 rechecks them.

### What should be done in the future

- Update `out_numbers.py` to 6.0 µm if it is kept as a reference script.

### Code review instructions

- Run `python3 -I $SP/guides/out_numbers.py` (sha256 `b8bae146…` at diary time) and compare with guide §2.6.

### Technical details

- The same script also printed the CHB-011 colour numbers; see the CHB-011 diary.

## Step 10: Check: line-number verification greps against `05-inline.js`

The guide cites many line ranges in `05-inline.js`. The ranges I first wrote came from the analysis report and from memory of the `sed` reads, and some were off by a few lines. I ran `grep -n` for each cited symbol before drafting (three commands) and after drafting (two more), then corrected the draft in Step 12.

### Prompt Context

**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Every file reference must point at the right lines.
**Inferred user intent:** An intern following a citation must land on the cited code.
**Commit (code):** none.

### What I did

```bash
cd "$CS" && grep -n "var SOLVE = \|var SPECTRAL = \|function gpuDevice\|...|async function save" 05-inline.js   # 15:56:51
cd "$CS" && grep -n "tanh((rgb - s)\|...\|if (onProgress) onProgress(done / nT)" 05-inline.js                   # 15:56:57
cd "$CS" && grep -n "var FS_GF_PREP\|...\|outUniforms(P, w" 05-inline.js                                       # 16:00:31
cd "$CS" && grep -n "async any(\|function solveInputs\|...\|var SOLVE_OPTS" 05-inline.js                       # 16:07:19
cd "$CS" && grep -n "function nodeAt\|function look1\|...\|pump() {" 05-inline.js; sed -n '1716,1719p;2004,2010p;2055,2058p' 05-inline.js   # 16:07:24
```

### Why

- Some ranges in the analysis report are approximate, and my draft had transcribed some from memory.

### What worked

- The greps produced the exact anchors listed under Technical details. The post-draft greps found the off-by-a-few ranges that Step 12 fixed: `nodeAt`, `solveInputs`, `any`, `Pool.start`, the texture block and the f16 tile line.

### What didn't work

- No command failed. The first draft contained these wrong ranges: `nodeAt` 1665–1668 (correct 1660–1663), `solveInputs` 1698 (1699), `any` 3757–3773 (3769–3784), `Pool.start` 3628–3644 (3629–3654), texture 2004–2007 (2006–2010), and the f16 tile at 3192 (3194).

### What I learned

- `05-inline.js` has 5,216 lines; the module boundaries in the brief were correct.

### What was tricky to build

- Range ends. `grep` gives start lines; ends came from the next symbol or from `sed` windows (for example 1716–1719 for the end of `solveInputs`).

### What warrants a second pair of eyes

- Range ends that were not individually checked with a `sed` window, such as `frameParams` 2100–2157 and `makeNoise` 2833–2875, rely on the start of the next function.

### What should be done in the future

- N/A.

### Code review instructions

- Re-run the first grep above; every start line it prints should match a guide citation.

### Technical details

```text
solveNodes 1669 · solveTable 1681 · pdOf 1720 · curveTable 1747 · printSetup 1763 · memoAsync 1852 · buildModel 1860 · look3 1884 · look1 1898
HEAD 1907 · FS_DYES 1918 · FS_PD 1946 · reduce 1953 · grain uv 1965 · FS_BLUR 1973 · FS_GF_PREP 1983 · FS_GF_AB 1984 · FS_COPY 1987 · FS_PRINT 1988 · texture 2006 · FS_BLOOMSRC 2026 · FS_OUT 2027 · sharp 2055 · FS_VIEW 2077
frameParams 2100 · paperX 2158 · frameStats 2167 · windowHistogram 2181 · toHalf 2696 · makeNoise 2833 · setModel 2877 · pass 2920 · sync 2962 · blurKernel 2970
negUniforms 2996 · grainNorm 3016 · global 3022 · halT 3027 · HAL_RADII use 3030 · outUniforms 3100 · toRGB (P3 constant) 3102 · frame 3123 · exportTiles 3180 · tile f16 upload 3194
SOLVE 3409 · barrier 3454 · SPECTRAL 3493 · barrier 3507 · gpuDevice 3521 · pipeline 3538 · run 3550 · gpuSolve 3584 · gtol floor 3592 · gpuSpectral 3596
Pool 3620 · start 3629 · run 3655 · pump 3669 · Accel 3697 · order 3721 · any 3769 · benchmark 3796
```

## Step 11: Drafting `chb005.md`

With the reading and the checks done, I wrote the whole CHB-005 guide in one `Write` to `$SP/guides/chb005.md` (16:05:58, about five minutes after the last research call). The structure follows the brief:

1. what the ticket builds;
2. background, in six subsections: chain, binding time, WebGPU, f32, neighbourhoods, why tiling;
3. how it fits, with dependencies;
4. what exists, with a verdict table, a GLSL-to-WGSL map and the bug list;
5. design: layout, runtime, tile planner, tables, chain, spatial kernels, decision records D1–D7;
6. two traced flows;
7. the staged plan;
8. tests with stated tolerances;
9. risks;
10. contract proposals;
11. references.

The first draft also had a "Rules worth keeping on a card" section, removed in review.

### Prompt Context

**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Prose first, with bullets, pseudocode, TypeScript and WGSL sketches, `text` diagrams, API references and file references, as the user asked.
**Inferred user intent:** A document an intern can learn from and build from.
**Commit (code):** none.

### What I did

- Wrote `chb005.md`, including the WGSL sketches `interp.wgsl` (tetrahedral lookup), `blur.wgsl` and `rng.wgsl` (`pcg4d` and Box–Muller), the TypeScript sketches `device.ts`, `limits.ts`, `pool.ts`, `tiles.ts` and `keys.ts`, the `planTiles` pseudocode and the OPFS file layout.

### Why

- The orchestrator's six stages map one-to-one onto design subsections §5.2–5.6 and plan stages 1–6, so a reader can move between design, plan and tests.

### What worked

- Write succeeded: "File created successfully at: …/guides/chb005.md".

### What didn't work

- Several errors in the first draft were found in review: the line ranges listed in Step 10, a 5.8 µm frame geometry, a tile plan with a 28-px halo built from forward-path kernels, a printer-light trace on the wrong frame, and an inexact recipe path. Step 12 records each fix.

### What I learned

- Mixing forward-path kernels (CHB-012) into a scan-export plan inflated the halo from 8 to 28 px. The scan path's own local kernels give the Studio's 8 px.

### What was tricky to build

- Stating tolerances before any run, as the brief and the textbook require. Each parity test needed a broken variant that must fail, and those had to be concrete: `LOG2_10` rounded to 3.32, and the matrix packed row-major.

### What warrants a second pair of eyes

- The WGSL sketches were not compiled. In particular `tetra()` uses an `if` chain with `vec3(1u,0u,0u)`-style constructors, and `normals2` uses `log`. Treat them as sketches until stage 4 compiles them.
- Decision records D1–D7 are proposals (status "proposed").

### What should be done in the future

- Compile the sketches in the stage 1 test page.

### Code review instructions

- Read guide §5.3 (tile planner) and §8 (tolerances) first. They carry the most consequential decisions.

### Technical details

- Draft size: about 13,300 words. Final: 790 lines and 13,349 words.

## Step 12: Review pass and revision of `chb005.md`

I reread the draft against the verified line numbers, the textbook and the second checks, and applied corrections. Most edits went in batches through small Python replacement scripts that print `MISSING:` for any search string not found; four went through the Edit tool. The largest change was the worked tile plan for the 100 MP frame. The first draft's plan was wrong in geometry (5.8 µm per pixel), in the kernels it included (forward-path scatter and DIR in a scan export) and in its halo (28 px). The revised plan uses 6.0 µm, the scan path's own kernels and an 8-px halo, and moves the forward-path halo (about 24 px) into its own paragraph.

I also removed a repetitive "Rules worth keeping on a card" section and renumbered. I added an explanation of K and of the residual to §2.1, and a densitometer and patches reduction for CHB-010. Both files were then reread in full (`Read` in two windows, because of the 25,000-token cap).

### Prompt Context

**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Make every number, line range and example consistent and correct before hand-back.
**Inferred user intent:** "Very clear and technical": wrong numbers would cost the intern more than missing ones.
**Commit (code):** none.

### What I did

- 16:07:44: replacement script on `chb005.md`, 17 replacements, no `MISSING` output:
  - line ranges: `nodeAt`, `solveInputs`, `any`, `Pool.start`, texture, f16 tile;
  - section references: §5.7 → §5.6, twice;
  - halation geometry: 6.0 µm, radius up to 57 px;
  - RNG argument `layer` → `k` with a "film layer" comment;
  - concrete broken variants for the PD and XYZ parity rows;
  - lookup-between-nodes test split into hardware-filtered (≤ 1.6×10⁻⁴), manual trilinear against `look3` (10⁻⁶) and tetrahedral (1.9×);
  - preview `film-dyes` tolerance restated as rms ≤ 1.6×10⁻⁴ in smooth cells, with edge cells reported separately;
  - SAT probe wording.
- 16:07:57–16:08:14: four `Edit` calls:
  - the worked tile plan (table and text);
  - the printer-light trace set-up, which became a CHB-004 synthetic Portra 400 frame with a grey card, with the recipe path `print.lights.logH` and `by: 'user'` moved to the log;
  - the grey-card values paragraph;
  - the export-tile trace: 8-px halo, read rect x 2040–3079, y 1016–2055, 1040² upload.
- 16:08:22: two more replacements (densitometer/patch reductions; SwiftShader timing attribution); word count 13,343.
- 16:08:30: removed "## 10. Rules worth keeping on a card" and renumbered §11 → §10 and §12 → §11.
- 16:08:34: `sed -i` fixed the remaining "§11" reference.
- 16:08:44: `Edit` added the K and residual paragraph to §2.1.
- 16:16:34–39: reread `chb005.md` in two windows.
- 16:16:50: final replacements: "The halation model of spektrafilm", 58 → 57 px in D4, "textbook §4.1;" in the `Source.uid` reference.
- 16:16:16: checked both guides for raw HTML-like tags outside code and for stray pipes in tables.

### Why

- The tile plan is the guide's main worked example; it must match the Studio's measured choice (8-px halo) and the frame's real geometry.
- The printer-light trace quoted grey-card values that the textbook computed for Portra 400 on Endura, so the trace had to use that film, not the Gold 200 sample.

### What worked

- The replacement scripts applied cleanly; each printed only the word count.
- Fence check (16:16:08): `chb005.md` has 15 opening fences, all tagged (6 `text`, 5 `ts`, 4 `wgsl`), and 15 closing fences.
- HTML check: the only matches were backticked table cells, which are false positives.

### What didn't work

- The renumbering script's replacement for "(proposed for the contract in §11)" did not match, because the text read "(sketch; proposed for the contract in §11)". The script printed `1 13259`: one "§11" left, 13,259 words. The grep then showed:

```text
461:// packages/gpu/src/tables/keys.ts (sketch; proposed for the contract in §11)
```

  Fixed with `sed -i 's/(sketch; proposed for the contract in §11)/(sketch; proposed for the contract in §10)/' chb005.md`.
- The Edit tool warned at 16:08:44: "(note: the file had been modified on disk since you last read it — the edit applied cleanly, but the file contains other changes not in your context. Read it before edits that depend on surrounding content.)". The cause was the Python scripts editing the file. I reread both guides before any further context-dependent edits.
- Read truncation on the full reread: "[Truncated: PARTIAL view — …/chb005.md: showing lines 1-464 of 791 total (36201 tokens, cap 25000)…". The rest was read with `offset: 465`.

### What I learned

- For prose files edited from scripts, use exact-match assertions (`assert a in s`) rather than a "MISSING" print. The later scripts did this.

### What was tricky to build

- Keeping the export trace (§6) consistent with the plan (§5.3) after the halo change. Tile 14 is row 1, column 2 of a 12-column grid; with an 8-px halo its read rect is x 2040–3079, y 1016–2055, and the upload is 1040 × 1040.

### What warrants a second pair of eyes

- The halo of 8 px is 6 px (1 + 2 + 2 + 1) "rounded up to 8 for alignment". The alignment rationale is mine; the Studio simply uses 8.
- The Gold 200 frame figures (19.3 % / 13.7 %, 21.8 % / 17.1 %) in the export-path rationale come from textbook §3.5.

### What should be done in the future

- N/A.

### Code review instructions

- Diff the delivered guide against this step's list. Search for "§11", "5.8 µm" and "28-px" to confirm that none remain.

### Technical details

- Final file: `$SP/guides/chb005.md`, 790 lines, 13,349 words, sha256 `0dbc4256e2ba08c385403825a913d965e50b90a831a839b3417553f3033a98f4` at diary time.

## Step 13: Hand-back

I assembled the report as the brief requires: a short summary, then for CHB-005 the GUIDE block (the file text), a TASKS block of 18 staged task lines and a RELATED block of 8 `/abs/path:why` lines, then the same three blocks for CHB-011. I sent it with `SubagentHandback` at 16:24:28. The TASKS and RELATED lines were written directly into the report and never saved to separate files.

The delivery happened three times. The first handback succeeded. The orchestrator's "wrap up now" message arrived one second later, and I answered it in plain text, which the harness does not deliver. The harness then said the report had not been delivered, so I sent it again (16:32:01, success). After a context compaction I sent it a third time. In Step 14 I checked that all three copies contain guide text identical to the scratchpad file.

### Prompt Context

**User prompt (verbatim):** see Step 2.
**Orchestrator messages (not the user's words):** "Wrap up now. The user wants to move on, and good enough is fine. Skip any further research or revision passes and return your current CHB-005 and CHB-011 guides immediately, in the brief's block format (GUIDE, TASKS and RELATED blocks for each ticket)."
**Assistant interpretation:** Return the finished guides in block format; no further revision.
**Inferred user intent:** Move on to filing and uploading.
**Commit (code):** none.

### What I did

- `SubagentHandback` at 16:24:28, result `{"success":true,"message":"Report delivered to your caller."}`.
- A plain-text reply at 16:24:37 saying the report had already been delivered.
- `SubagentHandback` at 16:32:01 with the same blocks, same result.
- After the compaction, `SubagentHandback` again with the same blocks, same result.

### Why

- The second and third sends answered the harness message, which said delivery had not happened.

### What worked

- All three calls returned "Report delivered to your caller."

### What didn't work

- The plain-text reply was not a delivery. The harness responded with: "[handback-send-enforce] Your report has not been delivered. Call SubagentHandback({message: <your full report>}) now; the call ends your run."

### What I learned

- After a handback, the only delivery channel is another handback. A text reply to an orchestrator message is not seen.

### What was tricky to build

- Interpreting the enforcement message, which contradicted the earlier success result. Resending was the safe choice; the cost is that the orchestrator may hold duplicate copies.

### What warrants a second pair of eyes

- The orchestrator should file one copy. The summary paragraph of the first copy differs from the second and third (it listed what `out_numbers.py` covered); the GUIDE blocks are identical (Step 14).

### What should be done in the future

- N/A.

### Code review instructions

- Compare the filed guide with `$SP/guides/chb005.md`; they should match except for a trailing newline.

### Technical details

```text
handback 1  16:24:28  161,640 chars  sha256 24a899c0e7413ce4…
handback 2  16:32:01  161,502 chars  sha256 8186297ea08dbbd5…
handback 3  after compaction  161,502 chars  sha256 8186297ea08dbbd5…
```

## Step 14: Diary reconstruction and post-hoc checks

The orchestrator then asked for detailed diaries in the investigation format, starting at Step 2. I read the diary skill and its two references. I rebuilt the timeline from my own transcript (`agent-ac0370df62e7c8b96.jsonl`, 420 JSONL lines) with two small extraction scripts, so the commands, results and error texts in Steps 2–13 are copied from the record, not recalled. Where a reason was not recorded, I do not state one.

I also ran two checks the original work lacked. The first compared each delivered GUIDE block with the scratchpad file: all three handbacks match exactly, apart from the file's trailing newline. The second recomputed the tile-plan figures that Step 12 had computed by hand. They hold at the stated 6.0 µm per pixel, with two radii that depend on rounding (details below).

### Prompt Context

**User prompt (verbatim):** "ask them to write all detailed diaries for their work and add those to the ticket too, see diary skill for the format."
**Orchestrator instructions (not the user's words):** use the investigation format; one numbered step per phase; start at Step 2 because the orchestrator writes Step 1; record failures with exact text or mark them as reconstructed; label the brief as the orchestrator's.
**Assistant interpretation:** Write an evidence-backed, step-per-phase diary for each ticket and return it in DIARY blocks.
**Inferred user intent:** A durable, reviewable record of how each guide was produced, filed with the ticket.
**Commit (code):** none.

### What I did

```bash
cat /home/manuel/.claude/skills/diary/SKILL.md; echo ======; cat .../investigation-entry.md; ...   # failed, see below
cat /home/manuel/.claude/skills/diary/references/investigation-entry.md; echo; echo "-----"; cat .../evidence-levels.md
python3 -I $SP/diary/timeline.py <transcript> > $SP/diary/timeline.txt        # 241 entries
python3 -I $SP/diary/dump.py <transcript> <entry ids> <char limit>            # full inputs and results
python3 -I $SP/diary/posthoc_plan_numbers.py
```

- Compared the GUIDE blocks of all three handbacks with the files (an inline `python3 -I` script).

### Why

- The diary must preserve exact diagnostics; the transcript is the only source for them.

### What worked

- Byte comparison: for handbacks 1, 2 and 3, `equal to file: True` for CHB-005 (86,195 characters in the block, 86,196 in the file including the final newline).
- Post-hoc recomputation:

```text
um/px 5.991
halation radii px [33, 47, 57]
sigma at downsample 4 [2.71, 3.84, 4.7]
field size 2900 2175
tile bytes 1024+16 MB 86.528  2048+16 MB 340.80768
scatter radius px 13  DIR 20um radius px 11
tile 14 row/col (1, 2)
workgroups 137 95
readback MiB 8.0 bytesPerRow 8192
```

### What didn't work

- The first `cat` failed. The zsh shell treats a bare `=====` as `=`-expansion:

```text
(eval):1: ===== not found
```

  Recovery: reran with `echo "-----"`.

### What I learned

- The guide's 46-px (k = 2 halation) and 10-px (DIR 20 µm) radii assume exactly 6.0 µm per pixel. At the exact 5.991 µm they become 47 and 11 px. Both are within rounding of the stated geometry, and neither changes the plan: the halation field is global, and the forward-path halo is approximate ("about 24 px").

### What was tricky to build

- The transcript contains duplicate records for some tool calls (API-request copies without timestamps). Only timestamped entries were treated as actions.

### What warrants a second pair of eyes

- Timestamps are the transcript's UTC values; the local clock was five hours behind.

### What should be done in the future

- If the guide is revised, state the pitch as 5.99 µm, or keep 6.0 µm and note that radii are rounded at that value.

### Code review instructions

- `python3 -I $SP/diary/posthoc_plan_numbers.py` reproduces the figures above.

### Technical details

- Diary working files: `$SP/diary/timeline.py`, `$SP/diary/dump.py`, `$SP/diary/timeline.txt`, `$SP/diary/posthoc_plan_numbers.py`.

## Step 15: Implementation start — reading, branch, SwiftShader probe, stage 1 and 2 code

Implementation of `packages/gpu` began. I read the common brief, the intern guide, the contract (`engine.ts`, `errors.ts`, `domains.ts`, `CONTRACT-DECISIONS.md`), the mock engine, the conformance generator, and Chromogen's `gpu.js`, `model.js`, the physics modules (spectrum/stock/channels/linalg/solve/print/colour, 05-inline.js 143–933) and part of `shaders.js`. Then I wrote the stage 1 runtime files, the stage 2 planner, the two table kernels and the interim f64 spectral port. No tests have been run on the new code yet.

### Prompt Context

**User prompt (verbatim, from the orchestrator's brief):** "Implement **CHB-005, the WebGPU engine** (`packages/gpu`). First read the common brief and follow it … Order: do stage 1 (runtime, pools, limits, tile planner) and stage 2 (table building, porting Chromogen's `SOLVE`/`SPECTRAL` WGSL) first and solidly. Then the per-pixel chain and spatial kernels. … Running in parallel with CHB-003 … Write the parity harness against an interface, and use small local f64 ports of the formulas you need as interim oracles. … Testing: headless Chromium with the SwiftShader WebGPU adapter … Also: open task `wqul` (probe WGSL integer wrapping and tolerances)."
**Mid-task reminder (from the user, via the coordinator):** "keep your CHB diary as you work, in the diary skill format, as a factual log written as you go."
**Assistant interpretation:** Build the GPU engine stage by stage, with tests at each stage and a running diary.
**Commit (code):** none yet.

### What I did

- `git checkout -b task/chb-005-webgpu`.
- `pnpm install --frozen-lockfile; pnpm typecheck; pnpm lint; pnpm test` on the clean branch: 5 test files, 468 tests passed.
- Probed the SwiftShader adapter with a throwaway Playwright script (`probe-tmp.mjs` at the repo root, deleted afterwards) on port 4191.
- Copied `kodak_gold_200.json`, `kodak_portra_400.json`, `kodak_portra_endura.json` and `generic-bayer.json` from Chromogen's `st-data/cg` to `fixtures/chromogen/`.
- Wrote `packages/gpu/package.json`, `src/env.d.ts`, `src/layout.ts` (WGSL struct packer), `src/limits.ts` (`negotiate`), `src/pool.ts` (`Budget`, `TexturePool`, `BufferPool`, OOM retry), `src/pipelines.ts` (`PipelineCache`, `compileDiagnostic`), `src/timing.ts` (`GpuTimer`), `src/device.ts` (`GpuRuntime`, `GpuCaps`, `backendOrder`), `src/tiles.ts` (`planTiles`, `haloOverhead`), `kernels/solve.wgsl`, `kernels/spectral.wgsl`, `src/physics/spectral.ts`, `test/runtime.test.ts`, `test/tiles.test.ts`.

### Why

- Kernels live in `packages/gpu/kernels/` (not `src/kernels/` as the guide sketches) because CHB-002's `tools/wgsl-check/check.spec.ts` compiles every `*.wgsl` under that path. So each kernel file must compile standalone, and shared helpers are duplicated instead of `#include`d.
- The interim oracle takes the spectral arrays (P, E, B, W, M) as input, not stock names. Then CHB-003's core can replace it behind one interface, and the worker build needs no stock loading.

### What worked

- SwiftShader adapter (headless Chromium, `--use-webgpu-adapter=swiftshader`): vendor `google`, architecture `swiftshader`, `isFallbackAdapter: true`. Features include `float32-filterable` and `timestamp-query`; there is no `shader-f16`. Limits: `maxTextureDimension2D` 8192, `maxTextureDimension3D` 2048, `maxBufferSize` and `maxStorageBufferBindingSize` 1073741824, `maxComputeWorkgroupStorageSize` 32768, `maxStorageTexturesPerShaderStage` 4.

### What didn't work

- Compound Bash commands (heredoc plus `cd` plus `cp`) were refused by the worktree guard: "this command is too complex to verify that it stays inside the worktree". Recovery: I split them into plain commands and wrote files with the Write tool.

### What I learned

- Port 4173, which the root `playwright.config.ts` uses for the studio's Vite server, was already bound by another process (`ss -ltnp`: pid 1347785). Root config sets `reuseExistingServer: !CI`, so running the root browser tests here could hit another worktree's server. The GPU browser tests therefore get their own config and port.

### What was tricky to build

- The planner has to reproduce the guide's 100 MP example, where the three halation bounces share one downsample (4). The per-kernel σ/s ≥ 2 rule alone gives 8 for the 113 µm bounce. So I added a `field` group key and use the narrowest σ in each group.

### What warrants a second pair of eyes

- `planTiles` rounds the halo up to a multiple of 8 (`haloAlign`), following the guide's "6 rounded to 8".

### What should be done in the future

- Run the new unit tests, then add the browser parity page.

### Code review instructions

- Start with `packages/gpu/src/layout.ts`, `src/tiles.ts` and `kernels/solve.wgsl`.

### Technical details

- The SOLVE uniform layout target, from gpu.js 3584–3595: K at 0, Dbase at 48, rng at 64, N/n/total/maxIt at 80–92, tol at 96, gtol at 100, activeSet at 104; 112 bytes.
