---
Title: Diary
Ticket: CHB-010
Status: active
Topics:
    - darkroom
    - film-emulation
    - color-science
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:24.798847087-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-010 and CHB-015 (darkroom printing and extensions). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-darkroom-printing.md` (11612 words), added 16 staged tasks, and related the primary source files.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Requested milestone: a complete intern guide plus a task breakdown for this ticket.
**Inferred user intent:** The ticket can be picked up by a new engineer or agent without prior context.

### Evidence and commits
- Brief: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md` (session scratchpad); shared map: CHB-001 `design-doc/01-chromobench-architecture-and-work-plan.md`.
- Filed with `python3 -I CHB-001/scripts/07-ingest-intern-guides.py <agent output> .` and checked with `scripts/08-check-guide-markdown.py` (fences tagged, no raw HTML).
- Writer agent: one background general-purpose agent for CHB-010 + CHB-015; it re-derived textbook §2.6 numbers with Python scripts (enlarger.py, printchain.py, extra.py, strip.py, fade.py) over the decoded Filmbench data in the session scratchpad.
- The writer's own summary, kept as returned:

> Both guides are written and revised. The drafts are kept at /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb010.md (about 11,600 words) and /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb015.md (about 8,600 words). The verification scripts are in the same folder: enlarger.py, printchain.py, extra.py, strip.py and fade.py. They run on the spektrafilm data embedded in Filmbench, decoded to data.json in that folder.
> 
> Main findings:
> - **Textbook numbers check out.** I re-derived the §2.6 ∂x/∂v matrices, with and without normalisation, from the decoded data. They agree to four decimals; the only exception is G/Y, which comes out −0.0015 against the textbook's −0.0016. The grey card's paper dyes (0.665, 0.548, 0.499) and paper slopes (2.36, 1.98, 1.95) also match.
> - **Real-mode filter factors match Kodak's guidance.** To restore the grey card's visual density, 10 M needs ×1.119 more time, 10 Y ×1.039 and 10 C ×1.080. Kodak's E-4020 datasheet gives about 1 % per unit of magenta and says yellow changes are negligible.
> - **Normalised mode does not hold visual density.** Adding 10 Y darkens the normalised print by 0.053.
> - **Global split filtration on colour paper is almost one filtration.** It deviates from a single equivalent exposure by at most 0.48 points.
> - **A flash must go through the film base.** An open-gate flash with the neutral pack fogs the print orange-red: (−8.6, +1.5, +7.0) points of colour.
> - **The Jacobian preview for filter changes is accurate.** Its error is at most 0.37 points for 10 M and 0.62 points for 20 M + 20 Y. The two plausible buggy variants of the preview err by 1.2–6.2 points, so the parity test can tell them apart.
> - **Chromogen's log-domain burns are wrong at feathered edges.** At mask 0.5, a one-stop burn should add 0.176 log H (the linear sum); Chromogen adds 0.151.
> - **Printer lights cannot fix fading.** For a fade of k = (0.70, 0.90, 0.85), lights fitted at the grey card leave about 5.5 ΔE*ab at the white and black patches, as crossover.
> - **The DIR-aware inverse needed for reprinting is a well-posed 3×3 solve.** By the Gale–Nikaidô theorem it is injective given the slope bounds checked on Portra 400.
> - **The contract catalog has a conflict.** It puts `finishing` ops on `display-rgb`, which is after the gamut knee. The CHB-015 guide proposes moving them before `output.display`.
> 
> Limits of the evidence:
> - I could not open Wilhelm's book. The fading facts are cited from Anderson & Ellison (JAIC 1992), CCI Note 16/5, Gschwind & Frey (1994) and Chatterjee et al. (Heritage 2023); Wilhelm is cited only as the general survey.
> - I did not verify Ctein's highlight-mask procedure against the book. The guide says to check it before choosing defaults.
> - Chromogen's claim that its learned estimator has "half the error" of integrate-to-grey cannot be checked: its design document is not in the project.
> - Newson-grain cost on WebGPU is an extrapolation from the paper's CPU timings and is marked unmeasured.
> 

### Noteworthy decisions or failures
- The guide's "Proposed contract additions (for CHB-002)" section, where present, is a proposal. It must be reconciled with CHB-002 before implementation.
- Numbers the writer computed for the guide (not from the textbook) are labelled as such in the guide. They are not independently re-verified here.

### Remaining requirements and next action
- Implementation has not started. Tasks in `tasks.md` are open.
- Next: review the guide, settle the open decisions it lists, and start stage 1.

## Step 2: Orientation: the brief, the architecture document and the writing guidance

I started by reading the orchestrator's task message, then the common brief, the shared architecture document and the writing guidance the brief points to. I wanted the constraints and the contract's vocabulary fixed before opening any source code, so that every later citation would use the contract's names for domains, ops and recipe fields.

This step produced no files. It settled the rules for the rest of the work:
- existing material is read-only;
- scripts go only into the session scratchpad and run with `python3 -I`;
- the imported HTML apps are not opened or executed;
- web sources must be cited, and queries must carry no personal or project details;
- the guide is returned as text in a fixed block format, not written into the ticket.

### Prompt Context
**User prompt (verbatim), for the guides:** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
(This is the text the coordinator relayed. Step 1 quotes a longer form of the same prompt that adds "commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)".)
**User prompt (verbatim), for this diary:** "ask them to write all detailed diaries for their work and add those to the ticket too, see diary skill for the format."
**Orchestrator brief (not the user's words):** a task message received at 15:43:49 UTC that opens: "Write two chromobench intern guides: **CHB-010 "Darkroom printing"** and **CHB-015 "Extensions"**." For CHB-010 it lists six stages and the acceptance criteria:
- the stages: real-enlarger mode as the default; printer lights and balance; multi-exposure printing; density masking; a fast path for filter changes; darkroom procedures;
- the acceptance criteria: the §2.8 laws, linearity of multi-exposure sums, and test-strip numbers that a darkroom worker would recognise.

The message also points to the common brief at `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md`, which the orchestrator wrote too.
**Assistant interpretation:** Write one intern guide per ticket, grounded in the CHB-001 sources. Return each with a staged task list and a related-file list, in the brief's block format.
**Inferred user intent:** A new engineer or agent can pick up CHB-010 and build the darkroom features without prior context.
**Commit (code):** none. Repository HEAD at the start was a731130 ("CHB-001: architecture and work plan; create tickets CHB-002..CHB-015").

### What I did
- At 15:43:51 UTC, read the brief (full path above).
- Listed the CHB-001 ticket directory and counted words:
```bash
cd /home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/
ls -R | head -100
wc -w design-doc/*.md
wc -l /home/manuel/.claude/skills/ticket-research-docmgr-remarkable/references/writing-style.md
```
- Read `design-doc/01-chromobench-architecture-and-work-plan.md` (5,164 words) in full.
- Read `/home/manuel/.claude/skills/ticket-research-docmgr-remarkable/references/writing-style.md` (73 lines).

### Why
- The brief requires the contract's names to be used exactly: `OpDef`, `ArgSpec`, `FrameRecipe`, `Mutation`, and the domains such as `paper-logH`. Anything new must be proposed in a section titled "Proposed contract additions (for CHB-002)".

### What worked
- The architecture document supplied everything the guide's system section needed:
  - the v0 op catalog entries this ticket owns: `print.expose`, `print.lights`, `print.preflash`, `darkroom.testStrip`, `darkroom.ringAround`, `darkroom.contactSheet`, and `mask.*` jointly with CHB-009;
  - the recipe fields `print.enlarger`, `print.lights`, `print.exposures`, `print.grade` and `print.preflash`;
  - the critical path 002 → 003 → 005 → 010 → 013 and milestone M4, "Darkroom".

### What didn't work
- No failures observed.

### What I learned
- The brief gives 5,000–10,000 words as typical for a ticket of this size but says "let the content decide". The final CHB-010 guide came to about 11,600 words.
- The brief says to treat the analysis reports as maps and to open the source before citing a line range. Verifying line numbers therefore became its own phase (Step 13).

### What was tricky to build
- N/A (reading only).

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Read the brief, then `design-doc/01-chromobench-architecture-and-work-plan.md` §5 (contracts) and its ticket map.

### Technical details
- Constraints recorded from the brief:
  - read-only on `/home/manuel/code/wesen/chromobench/ttmp/` and `~/code/wesen/go-go-golems/goja-cv`;
  - scripts only in `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/`;
  - return markers from `=====BEGIN GUIDE CHB-0NN=====` to `=====END RELATED CHB-0NN=====`, 8–20 tasks, 5–8 related files;
  - every fenced block has a language tag, no raw HTML, no nested fences.

## Step 3: Textbook study (chapter 2, §3.6–3.9, §4.1–4.4)

The textbook *The Mathematics of the Colour Negative* is the project's reference for the physics. I read the chapter on the forward model (film, paper, eye), the balance and limits sections of chapter 3, and the binding-time and table sections of chapter 4. This gave the guide its laws and most of its reference numbers.

One read failed because the requested range was too large for a single call. I split it into smaller ranges, with no loss of content.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Collect the physics and the golden numbers that the CHB-010 stages rest on.
**Inferred user intent:** The guide teaches from first principles and uses real numbers from the textbook.
**Commit (code):** none.

### What I did
- Mapped the sections of `sources/The Mathematics of the Colour Negative.md` (1,399 lines) with `grep -n "^#"`.
- Read lines 373–532 (§2.1–2.5), 530–709 (§2.6–2.9, with the chapter's exercises and key points), 917–996 (§3.6–3.9), 1050–1149 (§4.1–4.2) and 1149–1228 (§4.3–4.4).

### Why
- The orchestrator's brief names §2.6 (∂x/∂v matrices, 0.4 points per CC, the neutral pack), §2.8 (laws) and §3.6 (balance in log exposure) as required content.

### What worked
These numbers went into the guide; all of them are **textbook** numbers:
- §2.6, ∂x/∂v per CC without normalisation: R (−0.0092, −0.0007, 0.0000), G (0.0000, −0.0087, −0.0016), B (0.0000, 0.0000, −0.0100).
- §2.6, ∂x/∂v with normalisation: (−0.0061, 0.0024, 0.0038; 0.0031, −0.0056, 0.0023; 0.0031, 0.0031, −0.0061).
- §2.6, the neutral pack for Portra 400 on Portra Endura: C 0, M 51.57, Y 52.53.
- §2.6, at the grey card: paper dyes (0.665, 0.548, 0.499) and paper slopes (2.36, 1.98, 1.95).
- §2.6, the NaN convention: reading missing spectral data as transparent instead of opaque costs 0.18 log H in red for Portra 400.
- §2.7, grey card visual density 0.755 and paper white 0.09, both with the Studio's flare and a 5,000 K light.
- §2.7, +10 red points takes the grey from 0.746 to 0.956, with a* −20.7.
- §2.8, lights factor out of the spectral sum (check error 2×10⁻¹⁶).
- §2.8, 0.1 log H moves the green dye by 0.219 at the grey card and by 0.021 near paper white; a density offset with the same effect at the grey card is 0.198.
- §3.6, against a scale shot at 5,500 K, printer lights leave at most 2.4 ΔE00 and a constant density shift up to 14.6. The lights are (+0.085, +0.002, −0.079) log H.
- §3.6, α = 0.75 for integrate-to-grey, and the foliage frame's chroma of 19.4 at full correction.
- §2.4: convolve only in linear exposure.
- §2.9: lights act as a scaling of the paper's sensitivities.

### What didn't work
- My first attempt to read lines 373–712 in one call (offset 373, limit 340) failed:
```text
File content (26219 tokens) exceeds maximum allowed tokens (25000). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file. To read it anyway, up to what still fits in your context, call Read again with allow_large: true — only if you genuinely need all of it or the user asked for the whole file.
```
- Recovery: I read the range in two calls of 160 and 180 lines.

### What I learned
- The textbook gives the filter derivatives but no filter factors in seconds and no test-strip densities. Those had to be computed (Steps 8, 9, 11 and 12).
- The law "a curve does not commute with a shift" can be written as a testable ratio: 0.021 against 0.219.

### What was tricky to build
- N/A (reading only).

### What warrants a second pair of eyes
- The G/Y entry of the unnormalised matrix: the textbook gives −0.0016, and my computation in Step 8 gives −0.0015.

### What should be done in the future
- N/A.

### Code review instructions
- Read textbook §2.6 (lines 530–554), §2.8 (588–604) and §3.6 (917–947) against guide sections 2.4, 3.2 and 6.4.

### Technical details
- Paper log exposure: x_k = log10 Σ_λ L(λ)·F(λ)·10^(−D(λ))·s_k(λ)·Δλ + ℓ_k.

## Step 4: Chromogen Studio code and its analysis report

Chromogen Studio is the closest existing implementation of a printer-lights workflow. I read its print module, its parameter module, the aim and warmth-vector code, its shader constants and shaders, the grey pick and ring-around code, and the analysis report's pipeline and approximation sections. I wanted to know what to port as it is, what is wrong, and what is missing.

The main outcome was a port list and four known defects. Chromogen has no filter model at all. Its burns add log exposure instead of light. Its flash comes after the grade. Its Exposure "points" readout is wrong.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Map the Chromogen code that stages 2, 3 and 6 port, with verified line ranges.
**Inferred user intent:** The intern knows exactly which code to port and which bugs to fix.
**Commit (code):** none.

### What I did
All commands ran in `.../CHB-001.../various/extracted/chromogen-studio`, between 15:44:22 and 15:46:13 UTC:
- `sed -n '792,864p' 05-inline.js`: print.js (`Lights`, `makePrinter`, `greyPatch`, `latd`).
- `sed -n '2087,2193p' 05-inline.js`: params.js (`colourOffset`, `autoLights`, `frameParams`, `paperX`, `frameStats`).
- `sed -n '1790,1860p' 05-inline.js`: `aim` and the warmth vector.
- `sed -n '934,1002p' 05-inline.js`: the constants `K`, `PT`, `STOP`.
- `sed -n '1903,2086p' 05-inline.js` and a grep for the shader markers: `FS_DYES` 1918, `FS_PD` 1946, `FS_PRINT` 1988, `FS_OUT` 2027, burns at 2015, flash at 2020.
- Read `various/analysis-chromogen-studio.md` (821 lines): lines 154–418 (§2, the pipeline) and 669–823 (§6).
- `grep -n "lightsToSliders\|ringAround\|...\|neutralise"` found 4222, 4236 and 4329.
- `sed -n '4200,4360p'` (grey pick, lightsToSliders, ring-around) and a grep for `ringStep`.
- `sed -n '4040,4060p'` (`rollInfo`).

### Why
- Stage 2 ports `print.js` and `params.js`. Stages 3 and 6 replace the Studio's burns, flash and ring-around.

### What worked
These are **source** facts, checked against the code:
- `Lights` stores log H, and `shift` throws on a density with a message citing Hunt 14.17 (799–825).
- `aim` computes the warmth vector from a blackbody at 5,500 K ± 20 mired seen through the film (1818–1833), with the lamp fixed at 3,200 K.
- `colourOffset`: warmth × 1.3 mired per unit, and tint along (−⅓, ⅔, −⅓) (2090–2094). `autoLights` applies α (2095).
- `FS_PRINT` adds burns in log H (2015–2016), applies the crossover pads (2017–2018), the grade (2019), then the flash (2020).
- Ring-around: six one-step moves and a density strip at ±1, ±2 steps. The default step is 4 points (`ringStep`).
- The report confirms that there are no dichroic filters and no enlarger optics (§6.2).

### What didn't work
- No tool failures in this step.

### What I learned
- Masked burns at a feathered edge come out wrong in the Studio, because log-domain addition is not light addition. Step 12 quantifies the error.
- The Exposure aside at line 1018, `aside: (v) => \`${sign(-v / STOP * STOP / PT, 0)} pt\``, evaluates to −v/PT, which is −40 points per stop instead of about −12. I verified this at 16:05:52 with `sed -n '1016,1019p'`.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- My reading that the flash belongs before the grade rests on physics (light adds before the paper responds), not on a Studio test.

### What should be done in the future
- Port with the fixes listed in guide section 5.1.

### Code review instructions
- Compare guide section 5.1's table with `05-inline.js` at the cited lines.

### Technical details
- PT = 0.025 log H per point; STOP = log10 2.

## Step 5: Filmbench IDE code, macros and data summary

Filmbench already contains what Chromogen lacks: a dichroic filter model, a mid-grey normalisation, and a graph in which masked enlarger exposures are summed. I read its analysis report, its graph builder, its node evaluator, its control macros, its examples, and the decoded data summary with the neutral packs.

The result was the design model for stage 3. Filmbench sums exposures in linear light through masks, with one log at the end. I also found two shortcuts not to copy: its masks read scene pixels, and with `normalize: true` each enlarger node is normalised separately.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Extract the filter model, the normalisation, the multi-exposure arithmetic and the darkroom macros, with line ranges.
**Inferred user intent:** The intern can port the right parts and avoid the shortcuts.
**Commit (code):** none.

### What I did
All commands ran in `.../CHB-001.../various/extracted/filmbench-ide`.

Between 15:44:59 and 15:45:35 UTC:
- `cat ../../analysis-filmbench-ide.md` (70 lines) and listed the directory.
- `sed -n '2135,2200p' 01-inline.js`: `GraphBuilder` (2141–2172).
- `cat -n vfs/controls.js`.
- `ls vfs/examples vfs/lib vfs/agent vfs/docs`, then `cat -n vfs/examples/05-graph.js` and `cat -n vfs/lib/pushpull.js`.
- `sed -n '130,152p;350,384p' 01-inline.js`: `enlargerIlluminant` and the `lut1` normalisation.
- `sed -n '1627,1660p' 01-inline.js`: `_run`.
- Two `python3 -I -c` probes of `film-data-summary.json`: its keys, and the neutral packs for Portra 400 and Gold 200 on eight papers.

At 15:58:04–15:58:09 UTC:
- `sed -n '2750,2765p'` (`matchScope`).
- A grep that found `matchScope` at 2756, `mosaicGrid` at 2764, `mosaic(o)` at 2857, the `enlarger`/`mask`/`sum` node cases at 1633/1643/1648, `enlargerIlluminant` at 137 and `memo('lut1'` at 355.

At 16:05:52 UTC:
- A grep found `function neutralFilters` at 314 and `function buildPlan` at 325.
- `sed -n '118,122p'` showed the enlarger defaults.

### Why
- Stage 1 ports the filter model, stage 3 follows the graph model, and stage 6's ring-around reuses `matchScope`.

### What worked
These are **data and source** facts:
- Neutral packs for `kodak_portra_400`, as C/M/Y in CC:

| Paper | C | M | Y |
|---|---|---|---|
| portra_endura | 0.0 | 51.568 | 52.534 |
| ultra_endura | 0.0 | 49.876 | 49.489 |
| endura_premier | 0.0 | 55.159 | 55.883 |
| ektacolor_edge | 0.0 | 52.963 | 55.768 |
| supra_endura | 0.0 | 50.730 | 55.565 |
| fujifilm_crystal_archive_typeii | 0.0 | 68.407 | 76.800 |
| kodak_2383 | 0.0 | 57.809 | 63.611 |
| kodak_2393 | 0.0 | 65.157 | 75.534 |

- Enlarger defaults (118–122): `illuminant: 'TH-KG3'`, `print_exposure: 1`, `comp: true`, `normalize: true`.
- `enlargerIlluminant` (137–147) multiplies the lamp by Π_j [1 − (1 − F_j)(1 − 10^(−CC_j/100))].
- `_run`: an enlarger node multiplies its linear exposure by the mask, and `sum` adds 10^x and takes one log.
- `matchScope`: a secant iteration on log2 `print_exposure`. It drives the midgray region to L* 50, runs at most 3 iterations with a 0.4 tolerance, and clamps to 0.25–4.
- Macros in `controls.js`: warmth −24 Y with +8 C eased in (19–21), tint −16 M, and a grade-to-gamma morph of 0.7–1.8 that adds +¼ stop per grade above 2 when not normalised. The "darkroom" scheme is at 54–72.

### What didn't work
- No failures observed.

### What I learned
- `case 'mask'` reads scene pixels, which a negative scan does not have. Chromobench masks are therefore defined on the frame.
- With `normalize: true`, a burn through a different filter costs no light. This is the behaviour real mode exists to remove.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The guide cites `controls.js` 14–46 for the macros and 54–72 for the scheme. Both come from my `cat -n` reading.

### What should be done in the future
- N/A.

### Code review instructions
- Check guide section 5.2's table against `01-inline.js` and `vfs/controls.js` at the cited lines.

### Technical details
- `examples/05-graph.js`: a second enlarger node at `print_exposure` 0.35 through a luminance mask, summed with the main exposure.

## Step 6: Chromogen Studio book chapters

The Studio ships a book that explains each control in prose. I searched it for the features the brief mentions and read the chapters on printer lights (2), the print window (3) and roll balancing (9), plus the "not built" list (10). It gave me the photographer-facing explanations that the guide's balance section paraphrases.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Use the book to explain the controls the way the Studio does, and to confirm what is not built.
**Inferred user intent:** The guide's darkroom explanations agree with the existing documentation.
**Commit (code):** none.

### What I did
All commands ran in `.../chromogen-studio/st-data/book`, between 15:46:17 and 15:46:33 UTC:
- `grep -n -i "learned\|estimator\|not built\|faded\|restor\|re-shoot\|reshoot" *.md`.
- `sed -n '1,110p' 05-ch5.md`, `sed -n '30,75p' 09-ch9.md` and `sed -n '150,170p' 10-ch10.md`.
- `grep -n "^#" *.md`.
- `cat 02-ch2.md`, and the first 60 lines of chapter 6.
- `sed -n '1,90p' 03-ch3.md`.

### Why
- The orchestrator's brief asks for points, warmth in mireds, tint, roll consistency and match frame. The book defines each.

### What worked
These are **book** statements:
- Chapter 2: Warmth +100 is ±130 mired, and "removes about 5 points of red light and adds about 5 points of blue".
- Chapter 2, Tint: "At +100 the green layer receives 10 points more than red and blue, which is two and a half CC10 steps of magenta in the print."
- Chapter 3, the print window: from Dmin + 0.04 to 90 % of Dmax, "about 1.2 log H" for Portra Endura's red layer (−0.50 to +0.68 about grey).
- Chapter 9: roll consistency is the stand-in for the learned estimator, which is not built.

### What didn't work
- No failures observed.

### What I learned
- My computed warmth vector (Step 11) gives 6.4 points at +100 through the TH-KG3 lamp. The book's "about 5 points" is for its 3,200 K lamp.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Guide section 6.4 condenses the book's Tint sentence to "±100 is ±10 points of green". See Step 17.

### What should be done in the future
- N/A.

### Code review instructions
- Read `02-ch2.md` lines 53 and 70, and `03-ch3.md` line 30.

### Technical details
- N/A.

## Step 7: Decoding the Filmbench data blob (decode.py)

To compute anything I needed spektrafilm's spectra and curves. Filmbench embeds them as a compressed JSON blob, and CHB-001's script 06 documents the format. I wrote a small decoder that keeps four stock profiles and drops the large LUT fields, and wrote the result to a JSON file in the scratchpad.

It worked on the first run. The decoded data shows how missing spectral rows are stored: base density 99.0 with zero dye channels, so the film reads as opaque there. That is spektrafilm's convention, which real mode must keep.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Get the lamp, dichroic filter, stock and paper data in a form the scripts can read.
**Inferred user intent:** The guide's numbers are computed from the project's own data, not quoted second-hand.
**Commit (code):** none (scratchpad only).

### What I did
- 15:47:20 UTC: read the first 60 lines of `scripts/06-decode-filmbench-film-data.py`. The blob is base64 of a zlib/deflate stream of JSON, and each stock's `lut` is a further base64 + deflate int16 table.
- 15:47:32–15:47:36: grepped Filmbench's helpers (`prof` 59, `illum` 80, `transTables` 304, `midDensity` 345) and read lines 55–100 and 300–350.
- 15:47:44: wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/decode.py` and ran it:
```bash
cd /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides
python3 -I decode.py /home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/00-film-data.bin.txt data.json
```
```text
['wl', 'cmf', 'illuminant', 'dichroic', 'rgb2xyz_cat16', 'xyz2rgb', 'illuminant_xyz', 'neutral_filters', 'profiles']
['stock', 'name', 'type', 'support', 'use', 'antihalation', 'ref', 'view', 'target_print', 'logSens', 'nanRows', 'chan', 'base', 'curves', 'model', 'role', 'lut'] [0, 1, 2, 3, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80] None
-rw-rw-r-- 1 manuel manuel 69840 Nov 11 10:47 data.json
```
- 15:47:52: probed the data with `python3 -I -c`. It printed:
  - Portra 400 `base`: 99.0 at the missing rows, `chan` 0 there;
  - Portra Endura `nanRows`: [0–4, 64–80];
  - the dichroic pass values (C, M, Y) at 500 nm (1.0, 0.5, 0.0297), 600 nm (0.892, 0.0386, 1.0) and 620 nm (0.0108, 0.961, 1.0);
  - Portra 400 `curves`: 256 samples.

### Why
- The textbook's numbers had to be reproduced from the same data before they could serve as golden numbers, and new numbers had to be computed (filter factors, test strips).

### What worked
- `data.json` (69,840 bytes) keeps `kodak_portra_400`, `kodak_portra_endura`, `kodak_gold_200` and `kodak_supra_endura`, plus all the non-profile keys.

### What didn't work
- No failures observed.

### What I learned
- Sensitivities (`logSens`) have values at every row; only `base`/`chan` mark the missing rows. A check on 2026-11-11 (Step 17) confirmed that Endura's base is also 99.0 at rows 0, 4, 64 and 80.
- The paper's characteristic curves are stored as a three-term error-function model (`model.amps`, `centers`, `sigmas`), and the film's as a 256-sample table over −3 to +4 log H.

### What was tricky to build
- The blob may be zlib-wrapped or raw deflate. `decode.py` tries `zlib.decompress(b)` first and falls back to `zlib.decompress(b, -15)`. It does not print which path it took.

### What warrants a second pair of eyes
- Only four profiles are kept. Any later script that needs another stock must re-decode.

### What should be done in the future
- CHB-004's exporter should replace this decoder as the data source for fixtures.

### Code review instructions
- Re-run the command above. The scratchpad directory is shared with other writer agents, and only the files named in this diary are mine.

### Technical details
- SHA-256 of `data.json` (first 16 hex digits, 2026-11-11): 0cc9486b701677d6.

## Step 8: Filter derivatives, filter changes and Jacobian preview errors (enlarger.py)

This was the first real check. I evaluated the enlarger's spectral sum at the grey card for Portra 400 on Portra Endura, through the TH-KG3 lamp and the dichroic filters, and differentiated it with respect to the three dials. Both textbook matrices reproduced to four decimals, except one entry that differs in the last digit.

The same script measured what a 10 CC dial change does in each layer, and how well a Jacobian "equivalent light" predicts a filter change over a set of 56 negatives. That second measurement became the basis for the stage 5 fast path.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Verify the textbook §2.6 matrices and quantify filter moves for stages 1 and 5.
**Inferred user intent:** Golden numbers the implementation can be tested against.
**Commit (code):** none (scratchpad only).

### What I did
- 15:48:17 UTC: wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/enlarger.py` (64 lines). What it does:
  - film density D = chan·cmy + base;
  - filter pack F = Π_j [1 − (1 − P_j)(1 − 10^(−v_j/100))];
  - x_k = log10 Σ lamp·F·10^(−D)·s_k, with no normalisation;
  - grey dyes from the film curve at log H 0;
  - J by central differences of ±0.5 CC at the neutral pack (0, 51.568, 52.534);
  - the normalised J obtained by removing the column mean;
  - the preview error measured over 8 axis points (−1.5 to +2.0 log H), each with seven variants (no offset, or one layer at a time offset by ±0.4 log H).
- Ran `python3 -I enlarger.py data.json` from the scratchpad guides directory.

### Why
- The orchestrator's brief asks for the §2.6 matrices and the 0.4 points per CC rule. A fast path needs a measured error bound.

### What worked
The output, verbatim (all values **computed**):
```text
grey dye (raw curve at logH 0): [0.6865, 0.7044, 0.8635]
x at grey, neutral pack [0.0753, 0.0761, 0.0629]
dx/dv (rows layers R,G,B; cols filters C,M,Y), per CC, no normalisation:
   [-0.0092, -0.0007, -0.0]
   [-0.0, -0.0087, -0.0015]
   [-0.0, -0.0, -0.01]
normalised (column mean removed):
   [-0.0061, 0.0024, 0.0038]
   [0.0031, -0.0056, 0.0023]
   [0.0031, 0.0031, -0.0061]
+10 Y dx logH [-0.0004, -0.014, -0.0999] points [-0.02, -0.56, -4.0] stops [-0.001, -0.047, -0.332] mean stops -0.127
+10 M dx logH [-0.0066, -0.0858, -0.0001] points [-0.26, -3.43, -0.0] stops [-0.022, -0.285, -0.0] mean stops -0.102
+10 C dx logH [-0.0911, -0.0, -0.0] points [-3.64, -0.0, -0.0] stops [-0.302, -0.0, -0.0] mean stops -0.101
+20 Y dx logH [-0.0007, -0.0255, -0.1999] points [-0.03, -1.02, -7.99] stops [-0.002, -0.085, -0.664] mean stops -0.25
+10M+10Y dx logH [-0.007, -0.1022, -0.1001] points [-0.28, -4.09, -4.0] stops [-0.023, -0.34, -0.332] mean stops -0.232
Jacobian preview [0, 0, 10] max err logH 0.00592 points 0.24 at (-0.5, (0, -0.4, 0))
Jacobian preview [0, 10, 0] max err logH 0.00916 points 0.37 at (2.0, (0.4, 0, 0))
Jacobian preview [0, 5, 5] max err logH 0.00505 points 0.2 at (2.0, (0.4, 0, 0))
Jacobian preview [0, 20, 20] max err logH 0.01548 points 0.62 at (2.0, (0.4, 0, 0))
Jacobian preview [10, 0, 0] max err logH 0.01331 points 0.53 at (2.0, (0.4, 0, 0))
```
- Every matrix entry matches the textbook (§2.6) to four decimals, except G/Y (computed −0.0015, textbook −0.0016).
- Real cyan and magenta reach 92 % and 87 % of the ideal −0.01 per CC (computed from the diagonal).

### What didn't work
- No failures observed.

### What I learned
- At the neutral pack the grey card's three layers lie within +0.15, +0.19 and −0.34 points of their mean (computed from the x values above; rechecked in Step 17). The guide therefore says "within ±0.35 points".

### What was tricky to build
- The missing spectral rows: the script uses the stored base of 99.0, so 10^(−D) is zero there (opaque). Reading them as transparent would shift red by 0.18 log H (textbook §2.6).

### What warrants a second pair of eyes
- The dichroic pass curves are the ones Filmbench embeds, not a measured enlarger head (guide section 10).
- The −0.0015 vs −0.0016 difference may be rounding or the 5 nm grid; it is below the 0.0002 tolerance the guide sets for stage 1.

### What should be done in the future
- Turn these numbers into `fixtures/golden/chb010-enlarger.json` once the f64 reference reproduces them.

### Code review instructions
```bash
cd /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides
python3 -I enlarger.py data.json
```

### Technical details
- SHA-256 of `enlarger.py` (first 16 hex digits): 267bb36f008430b4.

## Step 9: The whole print chain at the grey card (printchain.py)

Next I extended the model to the print: paper curves, the paper's dye spectra, a D50 viewing light and CIELAB. I wanted the numbers a printer would see, meaning visual densities, colours and the exposure time needed to hold density after a filter change, in both real and normalised mode.

The grey card reproduced the textbook's paper dyes and slopes exactly. The filter-factor search gave ×1.119 for 10 M, close to Kodak's "1 % per unit of magenta". The script's first test-strip design was not useful (see "What didn't work"), so Step 12 replaced it.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Compute filter factors, real vs normalised behaviour and test-strip densities.
**Inferred user intent:** Acceptance numbers that "a real darkroom worker would recognise" (the orchestrator's brief).
**Commit (code):** none (scratchpad only).

### What I did
- 15:48:45 UTC: read Filmbench lines 228–300 and 384–432 (paper curves, scan stage).
- 15:49:13 UTC: wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/printchain.py` (85 lines). What it does:
  - paper dye = Σ amps·Φ((x − centers)/sigmas), from the Endura `model`;
  - viewing: reflectance 10^(−D_p) under D50 with the CIE 1931 CMFs, normalised to the white, then CIELAB;
  - real mode: a calibration factor fM fixed at the neutral pack (the geometric mean of the grey's three exposures);
  - normalised mode: fM recomputed for each pack;
  - time compensation by 60-step bisection on log t until the grey's visual density returns;
  - a −1 to +1 stop test strip and an equal-increment strip.
- Ran `python3 -I printchain.py data.json`.

### Why
- The textbook has no filter factors and no test strips, and the acceptance criteria ask for both.

### What worked
The output, verbatim (all values **computed**):
```text
grey paper dye [0.665, 0.548, 0.499] visual density 0.758 Lab [48.83, -0.34, -4.36]
paper white Y 0.813 Lab [92.27, -0.14, 0.96]

TEST STRIP (grey card; highlight = film logH +1.5; shadow = film logH -1.5), real mode, neutral pack
  -1.00 stop  t=  5.0 s  Dvis(highlight, grey, shadow) = [0.09, 0.265, 2.031]
  -0.67 stop  t=  6.3 s  Dvis(highlight, grey, shadow) = [0.09, 0.383, 2.174]
  -0.33 stop  t=  7.9 s  Dvis(highlight, grey, shadow) = [0.09, 0.545, 2.277]
  +0.00 stop  t= 10.0 s  Dvis(highlight, grey, shadow) = [0.091, 0.758, 2.352]
  +0.33 stop  t= 12.6 s  Dvis(highlight, grey, shadow) = [0.093, 1.023, 2.407]
  +0.67 stop  t= 15.9 s  Dvis(highlight, grey, shadow) = [0.099, 1.322, 2.446]
  +1.00 stop  t= 20.0 s  Dvis(highlight, grey, shadow) = [0.113, 1.616, 2.47]

EQUAL-INCREMENT STRIP 4,8,12,16,20 s (base 12 s at aim):
   4 s  (-1.58 stop)  grey Dvis = 0.145
   8 s  (-0.58 stop)  grey Dvis = 0.418
  12 s  (+0.00 stop)  grey Dvis = 0.758
  16 s  (+0.42 stop)  grey Dvis = 1.094
  20 s  (+0.74 stop)  grey Dvis = 1.385

FILTER CHANGES at grey, real mode vs normalised mode
  +10 Y real: Dvis 0.720 (d -0.038)  L* 50.77 a* +0.81 b* -16.98
  +10 Y norm: Dvis 0.811 (d +0.053)  L* 46.27 a* +0.88 b* -17.27
     time factor to restore grey Dvis: x1.039 (+0.055 stop)
  +10 M real: Dvis 0.647 (d -0.111)  L* 54.57 a* -10.23 b* +2.85
  +10 M norm: Dvis 0.716 (d -0.042)  L* 50.97 a* -10.40 b* +3.07
     time factor to restore grey Dvis: x1.119 (+0.163 stop)
  +10 C real: Dvis 0.682 (d -0.076)  L* 52.71 a* +8.94 b* +1.31
  +10 C norm: Dvis 0.751 (d -0.007)  L* 49.17 a* +9.12 b* +1.57
     time factor to restore grey Dvis: x1.080 (+0.111 stop)
  -10 Y real: Dvis 0.803 (d +0.045)  L* 46.64 a* -0.02 b* +9.15
  -10 Y norm: Dvis 0.709 (d -0.049)  L* 51.29 a* -0.15 b* +8.94
     time factor to restore grey Dvis: x0.959 (-0.061 stop)
  +5 M real: Dvis 0.700 (d -0.058)  L* 51.77 a* -5.41 b* -0.69
  +5 M norm: Dvis 0.736 (d -0.022)  L* 49.93 a* -5.45 b* -0.61
     time factor to restore grey Dvis: x1.059 (+0.083 stop)

PRINTER LIGHT +10 points red only (0.25 logH), real mode:
  Dvis 0.972  Lab [39.02, -21.97, -17.55]

PAPER SLOPES at grey (dye per logH): [2.36, 1.98, 1.95]
```
- The paper dyes (0.665, 0.548, 0.499) and slopes (2.36, 1.98, 1.95) equal the textbook's (§2.6).
- The visual density of 0.758 without flare, against the textbook's 0.755 with flare and 5,000 K, is consistent.
- The +10 red-points result (0.972, a* −22.0) sits next to the textbook's 0.746 → 0.956, a* −20.7 with flare.

### What didn't work
- The first strip design put "highlight" at film log H +1.5 and "shadow" at −1.5. The highlight printed at paper white (0.09–0.113) for every time, and the shadow sat near Dmax, so the strip showed almost nothing outside the grey. It was not a tool failure. strip.py (Step 12) uses the scene's 90 % white and 3 % black instead.

### What I learned
- Real-mode filter factors: ×1.119 for 10 M, ×1.039 for 10 Y and ×1.080 for 10 C. These compare with Kodak's rule of thumb in Step 10.
- Normalised mode holds the mean of the three log exposures, not visual density: +10 Y darkens the normalised print by 0.053.

### What was tricky to build
- Calibration: one scalar factor fM in real mode, recomputed for each pack only in normalised mode. A per-layer factor would cancel the filters' colour effect.

### What warrants a second pair of eyes
- No viewing flare and D50 instead of the Studio's 5,000 K with 0.48 % flare. This shifts absolute densities by a few thousandths.
- The paper curve uses the parametric fit from Filmbench's data, not spektrafilm's tabulated curves.

### What should be done in the future
- The f64 reference must reproduce these numbers before they become fixtures (guide section 9.2).

### Code review instructions
```bash
cd /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides
python3 -I printchain.py data.json
```

### Technical details
- SHA-256 of `printchain.py` (first 16 hex digits): ffc2e4eb51b83e26. extra.py, strip.py and fade.py execute the part of this file above `pack = [0, 51.568, 52.534]`.

## Step 10: External sources for the darkroom: Kodak E-4020 and masking literature

I needed a real-world check on the computed filter factors, and the usual starting values a printer uses. I searched for Kodak's colour-paper datasheet, retrieved Ultra Endura's E-4020 (September 2008) and extracted its text with `pdftotext`. I also searched for Ctein's descriptions of contrast, unsharp and highlight masks.

The datasheet confirmed the computed behaviour: a start pack of 40M + 50Y, about 1 % per unit of magenta, and yellow changes that "do not usually affect the apparent print density". The masking search found only forum summaries, so the guide cites Ctein's *Post Exposure* and says its recipes must be checked before defaults are chosen.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Cite real darkroom practice for filters, timing, reciprocity and masks.
**Inferred user intent:** The guide teaches an intern who has never been in a darkroom, with correct practice.
**Commit (code):** none.

### What I did
- 15:52:30 UTC, WebSearch: "Kodak Professional Endura paper technical data reciprocity exposure time 0.1 to 10 seconds filter adjustment RA-4". The results pointed to E-4020 and gave the exposure range of 50 ns to 10 min.
- 15:52:40, WebFetch of `https://125px.com/docs/paper/kodak/e4020-2.pdf`. The tool could not parse the PDF and saved the binary.
- 15:52:50, copied the PDF to `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/kodak/e4020.pdf` and ran `pdftotext -layout`, which produced `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/kodak/e4020.txt`.
- 15:52:54, `sed -n '95,160p' kodak/e4020.txt`: the white-light method and the filter-factor table.
- 15:54:30, WebSearch: "darkroom highlight mask contrast mask Ctein "Post Exposure" highlight mask made from negative high contrast film sandwiched when exposing contrast mask".

### Why
- Computed filter factors needed a practical reference, and the masks section needed a source.

### What worked
From the datasheet text, **Kodak E-4020** (sheet lines in parentheses):
- "Start with a filter pack of 40M + 50Y to make a test print."
- CP filter factors: 10Y 1.1, 10M 1.3, 10C 1.2.
- "A rule of thumb for magenta dichroic filtration is to change the exposure time by one percent for every unit of" magenta (lines 165–166, with the 20 percent example at 170).
- "Changes in yellow dichroic filtration do not usually affect the apparent print density" (170–171).
- Tricolor times at f/8 for an 8× enlargement of a Portra negative: red 2.4 s, green 3.3 s, blue 4.9 s (191–196).
- Features: "Unique high-intensity reciprocity characteristics" and an "Exceptional exposure range of 50 nanoseconds to 10 minutes".

### What didn't work
- WebFetch on the PDF returned "The text is a raw PDF file. Its page content is compressed (Flate-encoded) binary, so the readable text is missing." The tool saved the binary to the session's tool-results folder, and `pdftotext` recovered the text.
- The Ctein search returned forum posts only, and I did not verify the book. In particular, the highlight-mask procedure and the location of the masking chapter are unverified.

### What I learned
- The computed ×1.119 for 10 M (Step 9) agrees with Kodak's rule of about ×1.10. The computed ×1.039 for 10 Y agrees with "do not usually affect".
- Kodak's acetate factors are larger because they include the filter surfaces.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- E-4020 is for Ultra Endura, while the computations use Portra Endura's data. The guide uses the datasheet only for practice, not for curve data.

### What should be done in the future
- Check Ctein's *Post Exposure* before choosing default mask parameters (guide section 6.6).

### Code review instructions
- `grep -n -i "percent\|apparent\|2.4\|3.3\|4.9" kodak/e4020.txt`, run in the scratchpad guides directory.

### Technical details
- Search queries contained only bibliographic and technical terms, with no project or personal details.

## Step 11: Preview variants, split filtration, flash colour and the warmth vector (extra.py)

Four design questions needed numbers before drafting:
1. Is the Jacobian preview clearly better than the two simpler models a developer might write?
2. Is global split filtration on colour paper different from one filtration?
3. What colour does a flash take through an empty gate?
4. What is the physical warmth vector for this film, lamp and pack?

extra.py answered all four. The preview with J is two to ten times more accurate than either simpler model. Split filtration is nearly one filtration. An open-gate flash is strongly orange-red. The warmth vector is (−0.00124, 0, +0.00124) log H per mired.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Quantify the claims of stages 3, 5 and the warmth control.
**Inferred user intent:** The design's decisions rest on measured numbers.
**Commit (code):** none (scratchpad only).

### What I did
- 15:56:23 UTC: wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/extra.py` (61 lines). It executes the top of printchain.py and then:
  - computes J at the grey card;
  - compares the preview error over the same 56 samples for J, for a diagonal "0.4 points per CC" model, and for the normalised J used in real mode;
  - models a 50/50 split with +30 M, fitting the equivalent lights at grey and taking the worst deviation over the samples;
  - compares an open gate (D = 0) with light through the film base (cmy = 0), both at the neutral pack;
  - computes the warmth vector from blackbodies at 1e6/(1e6/5500 ± 20) K through Portra 400's sensitivities, developed, read as printing density, divided by 40, with the mean removed.
- Ran `python3 -I extra.py`.

### Why
- These numbers drive Decision record 3 (Jacobian preview), the split-filtration finding, the `through: 'base'` default and the warmth vector.

### What worked
The output, verbatim (all values **computed**):
```text
preview [0, 10, 0] with J(grey): max err 0.37 points
preview [0, 10, 0] with diag 0.4pt/CC: max err 0.87 points
preview [0, 10, 0] with J_norm in real mode: max err 1.63 points
preview [0, 0, 10] with J(grey): max err 0.24 points
preview [0, 0, 10] with diag 0.4pt/CC: max err 0.84 points
preview [0, 0, 10] with J_norm in real mode: max err 1.77 points
preview [0, 20, 20] with J(grey): max err 0.62 points
preview [0, 20, 20] with diag 0.4pt/CC: max err 1.24 points
preview [0, 20, 20] with J_norm in real mode: max err 6.23 points
split 50/50 with +30M: equivalent lights at grey (points) [-0.32, -4.26, -0.01]
  max deviation from single equivalent exposure over samples (points): 0.482
open gate minus through-base paper logH per layer [0.394, 0.647, 0.784] colour part (points) [-8.6, 1.5, 7.0]
warmPerMired (logH per mired, mean removed): [-0.00124, -1e-05, 0.00124]  x130 mired in points: [-6.43, -0.03, 6.46]
```

### What didn't work
- No failures observed.

### What I learned
- Split filtration on colour paper mostly matters as a local tool. The physics does not give a separate crossover effect.
- spektrafilm's `_compute_raw_preflash` flashes through the base, and these numbers show why.

### What was tricky to build
- The warmth vector's sign: the textbook defines PD so that x = clear − PD. The script returns −x as PD up to a constant and then applies Chromogen's −(p1 − p0)/40 convention.

### What warrants a second pair of eyes
- The 56 test negatives lie on and around the neutral axis. Strongly saturated negatives are not in the set.

### What should be done in the future
- Make the two broken preview variants part of the stage 5 parity test (guide section 9.3).

### Code review instructions
```bash
cd /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides
python3 -I extra.py
```

### Technical details
- SHA-256 of `extra.py` (first 16 hex digits): c45ed9c643dd09f9.

## Step 12: Test strips, grade, preflash, feathered burns and optics units (strip.py)

The acceptance criteria ask for test-strip numbers that a darkroom worker would recognise, so I redid the strip with scene patches a printer looks at: the 90 % white, the 18 % grey card and the 3 % black. The same script computed the grade table, the preflash effect, the feathered-burn difference between linear and log-domain sums, and the magnification and f-stop units used in guide section 2.2.

The third-stop strip moves the grey by 0.2–0.3 D per step. That is the familiar result that makes printers fine-tune in sixths of a stop.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Produce the stage 6 golden tables and the multi-exposure linearity number.
**Inferred user intent:** Recognisable, testable darkroom numbers.
**Commit (code):** none (scratchpad only).

### What I did
- 15:56:43 UTC: wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/strip.py` (34 lines). It sets white at film log H +0.689 (log10(0.9/0.184)) and black at −0.788 (log10(0.03/0.184)), and computes:
  - a third-stop strip from a 10 s base;
  - the grade as gamma about the grey's x;
  - Chromogen's preflash formula, 0.35·p/100·10^(g − 0.6);
  - a one-stop burn at mask 0.5, as a linear sum and by log interpolation;
  - the optics units.
- Ran `python3 -I strip.py`.

### Why
- These numbers are the golden numbers in guide sections 6.8 and 9.2, and the 0.17609 linearity law.

### What worked
The output, verbatim (all values **computed**):
```text
1/3-stop strip, base 10 s f/8: Dvis (white 90%, grey 18%, black 3%)
    5.0 s  -1.00 st   [0.097, 0.265, 1.219]
    6.3 s  -0.67 st   [0.109, 0.383, 1.52]
    7.9 s  -0.33 st   [0.134, 0.545, 1.789]
   10.0 s  +0.00 st   [0.181, 0.758, 2.0]
   12.6 s  +0.33 st   [0.259, 1.023, 2.152]
   15.9 s  +0.67 st   [0.374, 1.322, 2.261]
   20.0 s  +1.00 st   [0.533, 1.616, 2.34]
grade (gamma about grey): Dvis white/grey/black
  g 0.7 [0.28, 0.758, 1.688]
  g 0.85 [0.224, 0.758, 1.859]
  g 1.0 [0.181, 0.758, 2.0]
  g 1.2 [0.141, 0.758, 2.143]
  g 1.45 [0.112, 0.758, 2.269]
  preflash 0 [0.181, 0.758, 2.0]
  preflash 20 [0.193, 0.776, 2.004]
  preflash 40 [0.206, 0.795, 2.009]
burn +1 stop, m=0.5: linear sum shift 0.1761 log-interp 0.1505
Dvis grey linear 1.247 loginterp 1.17
mag 7.06 -> 14.1 time factor 3.51 stops 1.81
f/8 -> f/11 nominal logH -0.277 exact one stop -0.301
```
- The equal-increment grey densities (0.145, 0.418, 0.758, 1.094, 1.385) came from printchain.py (Step 9).

### What didn't work
- No failures observed.

### What I learned
- Equal-second strips step unevenly: from 12 s they are −1.58, −0.58, 0, +0.42 and +0.74 stops. This is the known weakness that f-stop timing fixes.
- The preflash lifts the white (0.181 → 0.206 at p = 40) and barely moves the black (2.000 → 2.009).

### What was tricky to build
- The grade: gamma about the aim grey's x keeps the grey at 0.758 for every g, which is why no time compensation is needed.

### What warrants a second pair of eyes
- The preflash here is applied per layer after the main exposure, without a base colour. The guide's stage 6 design compiles it as a flash through the base instead.

### What should be done in the future
- N/A.

### Code review instructions
```bash
cd /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides
python3 -I strip.py
```

### Technical details
- SHA-256 of `strip.py` (first 16 hex digits): 8fa023710b09be49.

## Step 13: Line-number verification in Chromogen, Filmbench and goja-cv

Before drafting, I opened every source location I planned to cite, because the brief requires it. This covered the Chromogen functions the guide names, its global pass and shader lines, Filmbench's `matchScope` and node cases, and goja-cv's `within`, mask and sheet ops.

All the planned citations resolved. One wrong Filmbench line range was still in the draft and was fixed in review (Step 15).

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Make every cited line range correct.
**Inferred user intent:** The intern can open each reference and find what the guide describes.
**Commit (code):** none.

### What I did
- 15:56:55 UTC, a grep in `chromogen-studio/05-inline.js` for the defining lines. Results: `Lights2` 799, `makePrinter` 827, `greyPatch` 846, `latd` 855, `printSetup` 1763, `aim` 1810, `pdAt` 1818, the warmth mireds at 1830, `dw.map` 1833, the `aim` return 1839, `colourOffset` 2090, `autoLights` 2095, `frameParams` 2100, `fadeK` 2120, `paperX` 2158, `frameStats` 2167, `N3` 1628, `C_RANGE` 1631, `printingChannels` 1717, `pdTable` 1744.
- 15:57:00, `sed -n '3022,3070p'`: the global pass with the guided-filter bases.
- 15:57:25, `cd ~/code/wesen/go-go-golems/goja-cv && git log --oneline -1`, which returned `5a93095 Merge pull request #8 from go-go-golems/task/root-flag-once`. I also listed `pkg/cv/ops`.
- 15:57:28, `sed -n '1,80p' pkg/cv/ops/composite.go` and `grep -n "Name:" pkg/cv/ops/mask.go pkg/cv/ops/sheet.go`.
- 15:58:04–15:58:09, Filmbench `matchScope` and the node-case lines (see Step 5).
- 15:58:18, the hue families: `targets` at 1523 (25, 55, 100, 145, 250, 320°) and `shoulder` at 2073 and 3117.
- 15:59:18–15:59:23, `sed -n '1761,1788p'` (`reshootMap`, `STAIN`, `printSetup`) and the numbered `FS_PRINT` lines 1997–2025.

### Why
- The brief: "Before you cite a specific line range or number in a guide, open the source and check it."

### What worked
- goja-cv's `within` documents blending "in the image's space (img.as("linear") for linear light)", which supports the multi-exposure rule. The mask ops (`mask.luminance`, `mask.box`, `mask.ellipse`, `mask.gradient`, feather) supply the argument shapes for chromobench's `mask.*`.

### What didn't work
- The tool output of the 15:58:04 command was too large (63 KB) and was saved to a file. I re-ran it as a targeted grep at 15:58:09. This was not an error.

### What I learned
- `FS_PRINT` order: tone ops (1999–2012), burns (2015–2016), pads (2017–2018), grade (2019), flash (2020).

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- goja-cv was read at 5a93095. Line ranges may drift if it moves.

### What should be done in the future
- N/A.

### Code review instructions
- Open the cited lines. `05-inline.js` and `01-inline.js` are static extracts in CHB-001.

### Technical details
- N/A.

## Step 14: Drafting the CHB-010 guide

With the sources mapped and the numbers computed, I wrote the complete guide in one pass to a scratch file, following the brief's teaching order. The draft fixed the guide's design decisions:
- real mode is the default, with κ a single scalar;
- the darkroom sign of exposure;
- the Jacobian preview with a background table rebuild;
- the physical density mask belongs to CHB-010, and the guided-filter mask to CHB-015;
- flashes go through the film base;
- at most four packs per frame;
- the reciprocity hook is off by default.

The first draft was about 11,200 words. A word count showed it was above the brief's typical range, but the brief lets the content decide, and nothing was cut for length.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Write the full guide (first pass of the two-pass procedure).
**Inferred user intent:** A complete, technical intern guide.
**Commit (code):** none (scratchpad only).

### What I did
- 16:05:30 UTC: wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb010.md` (70,351 characters).
- 16:06:23: `wc -w chb010.md` reported 11,199 words.

### Why
- The brief's two-pass procedure: draft completely, then reread as the intern and revise.

### What worked
- The structure:
  1. purpose and scope;
  2. the darkroom from first principles, with a units table;
  3. the enlarger equation and filter numbers;
  4. system fit, with domains, ops and dependencies;
  5. sources (Chromogen, Filmbench, goja-cv, spektrafilm);
  6. design, with module layout, a recipe example, TS/WGSL sketches and three decision records;
  7. a traced flow;
  8. the implementation plan;
  9. testing;
  10. risks;
  11. proposed contract additions;
  12. references.

### What didn't work
- No tool failures. Content defects found in review are listed in Step 15.

### What I learned
- The traced flow (section 7) reuses the computed values to show the whole chain:
  - +10 M drops the grey from 0.758 to 0.647;
  - the time compensation is ×1.119, giving 11.19 s;
  - the burn is 11.19·(2^0.5 − 1) = 4.64 s.

### What was tricky to build
- Separating the two "mask" meanings: the frame masks used for dodging and burning (top-level `masks`), and the density masks sandwiched with the negative. The draft first named both `masks`, and review renamed one (Step 15).

### What warrants a second pair of eyes
- Decision record 1 (real mode as default) is marked "Proposed; confirm with the photographer".

### What should be done in the future
- Reconcile section 11's contract additions with CHB-002.

### Code review instructions
- Read the filed guide: `ttmp/2026/11/11/CHB-010--darkroom-printing-real-enlarger-multi-exposure-masks-density-masking-test-strips/design-doc/01-intern-guide-darkroom-printing.md`.

### Technical details
- N/A.

## Step 15: Review pass and revision of the CHB-010 guide

I reread the draft as an intern would, checked its line citations again, and applied revisions in small scripted batches with an exact-match replace helper. The review caught a few real defects:
- a wrong Filmbench line range;
- a recipe field name that collided with the top-level `masks` map;
- a wrong colour direction for a burn through extra yellow;
- a claim that normalised filters never change density, which Step 9's numbers contradict;
- ambiguous "§" references that mixed the guide's own sections with the textbook's.

One revision batch failed on an assertion, before writing anything, because one of its search strings did not occur in the file. I replaced the inline script with a helper that reports a missing or ambiguous string and stops, and re-applied the batch.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Second pass of the two-pass procedure: fix the gaps and errors an intern would hit.
**Inferred user intent:** A correct guide with no review notes left in it.
**Commit (code):** none (scratchpad only).

### What I did
- 16:05:52 UTC: checked `neutralFilters` (it is at 314, not 340–347), the Filmbench defaults (118–122) and Chromogen 1016–1019 (the aside) and 2104–2113 (roll/match).
- 16:06:23: grepped the draft for the passages to revise.
- 16:06:35: an inline Python batch failed (see "What didn't work").
- 16:06:48: wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/rep.py`, which takes a JSON list of [old, new] pairs, stops on "MISSING" or "AMBIGUOUS", and otherwise writes the file. Applied `r1.json` and got "ok". Changes:
  - "§3.2" → "§3.3" for the 10 M points;
  - `neutralFilters` 340–347 → 314–320;
  - added "defaults at 118–122";
  - recipe `"masks": [...]` inside `print` → `"densityMasks"`, with `"polarity": "positive"`;
  - the ring-around vector rewritten as "(−1, ½, ½)·step in log H, the vector (0, 1, 1) with its mean removed and scaled by 1.5";
  - the sky burn changed from "turns slightly less blue" to "comes out darker and bluer". The extra light through 10 more yellow carries less blue, so the blue-sensitive layer forms less extra yellow dye;
  - the curve/shift law became a ratio test;
  - contract item 6, `print.masks` → `print.densityMasks`;
  - the Filmbench reference list → "118–122, 137–147, 314–320, 352–381, 1627–1652".
- 16:07:09: applied `r2.json` ("ok"). It added:
  - definitions of an op and `ArgSpec`, and of a domain, at first use;
  - why κ must not be per-layer;
  - the critical path and milestone M4;
  - an "aim" paragraph;
  - Filmbench's warmth macro, contrasted with the physical vector;
  - Bake as one edit-log transaction;
  - lights applying to the whole exposure sum, while density masks do not apply to a base flash;
  - a softened highlight-mask sentence (Ctein unverified);
  - the §3.6 test's set-up, without DIR.
- 16:07:15: fence check `grep -n '^```' chb010.md | awk 'NR%2==1' | grep -v '```[a-z]'` printed nothing (44 fence lines). `wc -w` gave 11,532.
- 16:07:20–16:07:29: reread lines 1–498.
- 16:07:35: listed every "§" reference.
- 16:07:48: wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/secfix.py`. It rewrites a bare "§" as "section " or, on the listed lines, as "textbook §". Run: `cp chb010.md chb010.bak; python3 -I secfix.py chb010.md 89,93,124,160,365,367,419,463,666`, then a diff check.
- 16:07:56–16:08:03: repaired the lines that secfix mis-handled with `r3.json` ("ok"; 23 "section " references in the file afterwards). Changes:
  - "the textbook's check, textbook §2.8" → "the check of textbook §2.8";
  - "Textbook §3.6 measures it:";
  - the reference list restored to "§2.6 … §2.7 … §2.8";
  - "see 5.4" → "see the list below and section 6.5";
  - normalised-mode wording changed from "filters change colour and never density" to "a filter leaves the grey card's mean log exposure unchanged … (section 3.3 shows that visual density still moves a little)";
  - "Two facts" → "Three facts".
  
  Then `rm chb010.bak`.
- 16:08:07: reread lines 496–625.
- 16:14:52: grepped both guides for first-person phrasing. 16:14:59: applied `r5.json` ("ok"), making four CHB-010 sentences impersonal. One of them now says how the 56 preview samples were built and that the table gives the largest error.
- 16:15:23: applied `r8.json` ("ok"): the flash law now reads "an unmasked flash adds the same H to every pixel, with the colour of light through the base".
- 16:15:26–16:15:32: reread the whole file. Final count: 11,608 words.

### Why
- The brief requires a reread as the intern, correct citations, and no review notes in the guide.

### What worked
- Every revision batch after rep.py was written applied cleanly ("ok"), and every fence carries a language tag.

### What didn't work
- At 16:06:35 the inline batch stopped on its assertion:
```text
Exit code 1
Traceback (most recent call last):
  File "<stdin>", line 21, in <module>
AssertionError: `01-inline.js` 137–147, 340–381, 1627–1652
```
- Cause: the search string started with a backtick before `01-inline.js`, but the draft has "`various/extracted/filmbench-ide/01-inline.js` 137–147…". The backtick sits before `various/`, so the string did not occur.
- Scope: the script asserts every pair before writing, so no partial edits reached the file.
- Recovery: rep.py with the needle "01-inline.js` 137–147, 340–381, 1627–1652".

### What I learned
- An assert-all-then-write helper is the safe way to revise a long file in batches. A missing string stops the batch with nothing written.

### What was tricky to build
- secfix's context rule decides from the 14 characters before each "§" whether a reference is the textbook's, the architecture document's, the report's, or the guide's own. It mis-handled a few cases ("textbook's check", the bibliography line), which `r3.json` fixed by hand.

### What warrants a second pair of eyes
- The sky-burn colour direction (corrected to "darker and bluer") is reasoned from the physics, not computed. A two-pack exposure run in the reference would confirm it.

### What should be done in the future
- N/A.

### Code review instructions
- Diff the first and final drafts. Only the final draft survives in the scratchpad, and the revision pairs are in `r1.json`–`r8.json` (`r4`, `r6` and `r7` apply to CHB-015).

### Technical details
- SHA-256 of the final `chb010.md` (first 16 hex digits): 3197760d6e84dd3e.

## Step 16: Hand-back to the orchestrator

I returned both guides, with their TASKS and RELATED blocks and a short summary of findings and evidence limits, in one SubagentHandback call. The orchestrator filed the CHB-010 guide, its 16 tasks and its related files in commit 1a35a0c.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Deliver the result in the brief's block format.
**Inferred user intent:** The orchestrator can file the guides without editing them.
**Commit (code):** none by me. The orchestrator filed the guide in 1a35a0c, "CHB-010, CHB-015: intern guides, staged tasks, related files, diaries" (2026-11-11 11:22:30 −0500).

### What I did
- 16:22:02 UTC: SubagentHandback with a 138,406-character message. The result was `{"success":true,"message":"Report delivered to your caller."}`.
- The message contained the summary, `=====BEGIN GUIDE CHB-010=====` with the full guide, 16 tasks (stage 1: 3, stage 2: 3, stage 3: 3, stage 4: 1, stage 5: 2, stage 6: 4) and 8 related files (textbook, `05-inline.js`, `01-inline.js`, `vfs/controls.js`, `vfs/examples/05-graph.js`, `00-film-data.bin.txt`, `analysis-chromogen-studio.md`, goja-cv `mask.go`), then the CHB-015 blocks.

### Why
- The brief's return format.

### What worked
- The filed guide equals the scratch draft. A diff on 2026-11-11 that ignored blank lines and the frontmatter found no differences (Step 17).

### What didn't work
- No failures observed. The transcript shows a second, identical hand-back entry after the context compaction. It is an `api-request-blob` record (replayed context), not a second delivery.

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The summary's "Limits of the evidence" list: Wilhelm not opened, Ctein not verified, Chromogen's "half the error" claim unverifiable, Newson's WebGPU cost unmeasured.

### What should be done in the future
- N/A.

### Code review instructions
- `git show --stat 1a35a0c`.

### Technical details
- N/A.

## Step 17: Diary preparation: transcript dump, re-runs and checks

For this diary I rebuilt the work history from my session transcript rather than from memory. I re-ran the five check scripts and checked the filed guide against my draft. All five scripts reproduced their original output exactly, and the filed guide matches the draft.

The checks found one imprecise sentence in the guide. Two small failures occurred while preparing the diary, both recorded below.

### Prompt Context
**User prompt (verbatim):** see Step 2 ("ask them to write all detailed diaries …").
**Assistant interpretation:** Write an evidence-backed investigation diary for each ticket, starting at Step 2.
**Inferred user intent:** The ticket keeps a reliable record of how the guide was made and what its numbers rest on.
**Commit (code):** none (scratchpad only; nothing was written into the ticket).

### What I did
- Read the diary skill and its references.
- Dumped the transcript `/home/manuel/.claude/projects/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/subagents/agent-ae164a825561967ca.jsonl` with `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/diary010/dump.py`. The output is `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/diary010/full.txt` (491,330 bytes).
- Hashed the scratch files, re-ran enlarger.py, printchain.py, extra.py, strip.py and fade.py, and compared each output with the original tool result in the transcript. All five were "identical".
- `git show --stat 1a35a0c`. Extracted the filed guide without its frontmatter and diffed it against `chb010.md` with blank lines removed: no differences.
- Re-checked the book's Tint and Warmth sentences (`02-ch2.md` lines 53 and 70) and Chromogen's `colourOffset` (2090–2094).
- Re-ran the hand arithmetic: grey x deviations of +0.15, +0.19 and −0.34 points.

### Why
- The diary must record evidence, not memory.

### What worked
- The re-runs give byte-identical outputs, so the guide's computed numbers are reproducible from the scratch files.

### What didn't work
- The first command, `cat SKILL.md; echo ======; …`, stopped in zsh with `(eval):1: ===== not found` (exit code 1) after printing SKILL.md. Under zsh's `=command` expansion, `======` is looked up as a command. Re-running with `echo "-----"` fixed it.
- My first dump script failed:
```text
  File "<string>", line 16
    if t=="text": out.write(f"\n### [{i}] {role} TEXT\n{b[\"text\"][:6000]}\n")
                                                                              ^
SyntaxError: f-string expression part cannot include a backslash
```
  Recovery: rewrote it as `dump.py`, with %-formatting, in a file.

### What I learned
- The guide's section 6.4 says Tint "±100 is ±10 points of green". The book (`02-ch2.md` line 70) and the code (2092) say the green layer receives 10 points more than red and blue. In absolute terms green rises 6.7 points and red and blue each fall 3.3. The guide's wording should be made precise.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The Tint sentence above.

### What should be done in the future
- Correct the Tint sentence in `design-doc/01-intern-guide-darkroom-printing.md` section 6.4.
- If the orchestrator wants the scripts kept, copy them from the scratchpad into the ticket. The scratchpad is session storage.

### Code review instructions
```bash
cd /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides
sha256sum data.json decode.py enlarger.py printchain.py extra.py strip.py fade.py rep.py secfix.py chb010.md chb015.md
python3 -I enlarger.py data.json; python3 -I printchain.py data.json; python3 -I extra.py; python3 -I strip.py
```

### Technical details
SHA-256 prefixes (first 16 hex digits) on 2026-11-11:

| File | Prefix |
|---|---|
| data.json | 0cc9486b701677d6 |
| decode.py | 168c489ebcccf09d |
| enlarger.py | 267bb36f008430b4 |
| printchain.py | ffc2e4eb51b83e26 |
| extra.py | c45ed9c643dd09f9 |
| strip.py | 8fa023710b09be49 |
| fade.py | 7b9e9307a1a4db50 |
| rep.py | 14936f0f07a399f5 |
| secfix.py | 07815f0d6e878855 |
| chb010.md | 3197760d6e84dd3e |
| chb015.md | 0b5ee9bc6282eb3a |

## Step 18: M2 implementation: real-mode enlarger, calibration, grade and balance tools (stages 1–2)

This step implements stages 1 and 2 of the guide in `packages/core` and lowers the result into `packages/gpu`, on the worktree branch `task/chb-010-printing`. The real-mode enlarger now has time, f-stop and magnification as exact log-exposure offsets, κ is one scalar fixed at the calibration, the grade is a gamma about the aim grey, and the balance tools (aim, warmth, integrate-to-grey, roll tools, grey pick, hold density, lights → filtration, Bake) exist as tested core functions.

The main finding was a bug that made the filter dials and the timer useless at the grey card: core fitted the aim lights per chain, so three free per-layer lights absorbed every filter and time change. The aim is now fitted once at the calibration. A second finding corrects the guide's warmth vector.

### Prompt Context
**Orchestrator brief (verbatim):** "You implement the M2 slice of ticket CHB-010 (darkroom printing) in the chromobench monorepo, in your own git worktree. Read the common brief and follow its rules (branch `task/chb-010-printing`, commits at milestones with green checks, Co-Authored-By trailer, no push/merge, stay in your lane, CONTRACT-REQUESTS.md instead of contract edits, investigation-format diary appended to the ticket diary, check off tasks with docmgr, short final reply): /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/impl-brief-common.md

Spec: ttmp/2026/11/11/CHB-010--*/design-doc/01-intern-guide.md and its tasks (`docmgr task list --ticket CHB-010`).

Scope for now (milestone M2, "the photographer converts his own roll"): **Stage 1 (the real-mode enlarger) and Stage 2 (printer lights and balance)** — enlarger time in seconds/stops, signed filtration, paper grade, printer lights/balance, replacing core's `RealExposureModel` stub and the `gradeToGamma` placeholder, in the reference engine (packages/core) first and, where the op already exists there, the GPU engine (packages/gpu) so both stay in conformance. Stages 3–6 (multi-exposure, density masks, fast filter path, procedures) stay open unless they fall out cheaply.

Context you need (things changed since the guide was written):
- Contract is now 0.2 (CHB-017): `print.expose.filtration` is a **signed shift on the database neutral pack** (range −100…200 CC); `print.expose` gained `aim` and `aimView` arguments; the ring-around takes `step_pt` (printer points, default 4); `cam16-ucs` was renamed `oklch`. See packages/contract/CONTRACT-DECISIONS.md "Contract 0.2".
- One physics: packages/gpu now uses packages/core as its oracle and data source (CHB-017 diary Steps 2–3 in ttmp/2026/11/11/CHB-017--*/diary/01-diary.md).
- Known gaps CHB-017 left for you: the mock's `testStrip` filtration vary still steps an absolute pack from 0 while the studio steps the shift; `mask.paint` is empty in the mock.
- A parallel agent is switching core/gpu default data to CHB-004's packs (packages/data); don't do that switch yourself, use the PhysicsData interface as it is.
- Stage tasks moved here from other tickets are marked "[from CHB-0NN …]".

Checks green at each commit: pnpm typecheck, pnpm lint, pnpm test (baseline 1936 on this tree), pnpm gen:check, pnpm contract:check, and `STUDIO_PORT=4451 CI=1 pnpm test:browser` (baseline 42; never reuse port 4173). Use the textbook numbers from the guide as goldens. Be pragmatic; the user asked not to overdo polish.

Final reply (short): branch and commits, test counts, stages done/open, contract requests, what CHB-019/CHB-020 (studio and roll workflow) can now rely on."
**Assistant interpretation:** Make the enlarger's time, aperture, magnification, signed filtration and grade physically meaningful in core and the GPU engine, port the balance tools, prove them with the guide's numbers, and leave stages 3–6 open.
**Inferred user intent:** The photographer can print his own roll on the darkroom's terms (seconds, CC, grade, printer lights), and the studio and roll-workflow tickets get a stable physics API to build on.
**Commit (code):** bfe7258 — "CHB-010: real-mode enlarger, calibration, grade and balance tools (stages 1-2, core + gpu)"

### What I did
- Read the common brief, the guide (all 763 lines), the tasks, `CONTRACT-DECISIONS.md` "Contract 0.2", core's `print/*.ts`, `ops/ops.ts`, `engine-ref.ts`, the contract's print and darkroom catalog, `graph.ts` compile, the mock's darkroom ops and `packages/gpu/src/physics/core.ts`. No `[from CHB-0NN]` tasks are in CHB-010's `tasks.md` on this tree.
- Baseline: `pnpm install --frozen-lockfile --offline`, then `pnpm test`: 42 files, 1936 tests passed.
- Probe (scratch file `packages/core/probe.tmp.ts`, deleted): with the default aim `grey-0.184`, a +10 M or +10 Y shift and real-mode time left the grey card at D_vis 0.7352, L* 49.98, a* 0.00, b* 0.00 in both modes; only `aim: 'midgray-normalised'` showed filter effects.
- `packages/core/src/print/enlarger.ts`: removed `RealExposureModel`/`STUB_REAL_EXPOSURE`; added `EnlargerOptics`, `REFERENCE_OPTICS` (10 s, f/8, ×8), `opticsLogH` (log10 t/t_ref − 2 log10 N/N_ref − 2 log10 (m+1)/(m_ref+1)), `EnlargerSetup.optics` and `.calibration`, `Enlarger.kappa`, `.optics_logH`, `.printingDensity`; real mode fixes κ at the calibration pack; `dxdCC` pins that pack for its shifted enlargers.
- `print/chain.ts`: `referencePack` option (default the absolute `filtration` when given, else the database neutral), `optics` option; the aim lights are fitted on the reference enlarger (reference pack, reference optics); new fields `neutral`, `reference`, `grey`, `aimX`.
- `print/paper.ts`: `GRADE_GAMMA` (Filmbench `vfs/controls.js` GRADE: 0.7, 0.82, 1, 1.2, 1.45, 1.8), `gradeToGamma` by interpolation, `gradeX` (x′ = pivot + γ(x − pivot)).
- `ops/ops.ts`: `ExposeSettings.magnification`; `PhysicsEnv.chain` passes optics in real mode and drops them from the key in normalised mode; the tabulated pd table is keyed by film, paper, lamp and pack only; `gradePivot` and `developerAt` (shared with the GPU); `print.develop` uses them; new value op `darkroom.lightsToFiltration`.
- `print/balance.ts`: `frameStats`, `warmthVector`, `printWindow`, `aimOf`, `autoLights`, `rollMean`, `rollConsistency`, `meanX`, `matchFrame`, `greyPickSliders`, `holdDensity`, `lightsToFiltration`, `filtrationForLights`, `bakeMutations`, `chainOptionsOf`, `bakeRecipe`.
- `packages/gpu`: `CorePhysics.developRow(paper)` is the grade-2 paper row and `CorePhysics.grade(ctx, grade)` gives γ and the pivot; `print.develop` lowers to `OP.DEVELOP` with flag 1, p0 = pivot, p1 = γ; `kernels/pointwise.wgsl` case 5 applies x′ = p0 + p1·(x − p0) before `lut1c`. The parity frame gained a real-mode node (14 s, +10 M, lights (0.02, 0, −0.01), grade 4) and the spec `darkroom chain (real mode, 14 s, +10 M, grade 4)`.
- `packages/engine-mock/src/ops.ts`: the filtration test strip steps the signed shift `(band − (steps − 1)/2)·step` instead of `band·step` (the gap CHB-017 left).
- Tests: `fixtures/golden/chb010-enlarger.json` + `packages/core/test/chb010.golden.test.ts` (20), `packages/core/test/chb010.balance.test.ts` (15), `packages/core/src/laws/chb010.laws.ts` (4 laws, 4 mutants, n = 100), `packages/gpu/test/darkroom.test.ts` (3), `packages/engine-mock/test/test-strip.test.ts` (1).
- `packages/core/CONTRACT-REQUESTS.md`: C1–C4 appended.
- Guide errata: the §6.4 Tint sentence (task nxhz) and the warmth vector in §6.4 and §9.2 (new task hjan).

### Why
- Fitting the aim at the calibration is the guide's own design (§3.1: κ fixed "at the reference time, aperture, magnification and the database's neutral pack"; §6.3: "the aim lights absorb that residual"). Per-setting aim lights are exactly the per-layer κ that the guide says "would absorb whatever colour the filters produce".
- The pd table depends on film, paper, lamp and pack only (PD = clear − x), so keying it on time or mode rebuilt a 33³ table on every timer change.
- The grade pivots about the aim grey so it needs no time compensation (guide §6.8); applying it in the kernel before the grade-2 row keeps the row's interpolation error at its grade-2 size.
- `filtrationForLights` iterates the first-order solve on the exact chain (≤ 4 Newton steps) and rounds the dials to 0.1 CC and 0.01 s, so Bake's residual is measured, not assumed.

### What worked
- Golden numbers (all within the guide's tolerances): grey card D_vis 0.7562 (guide 0.758), L*a*b* 48.92, −0.33, −4.36; paper white Y 0.8130; J real and normalised to the 4th decimal (G/Y −0.0015); +10 Y/M/C: Δx (−0.02, −0.56, −4.00), (−0.26, −3.43, −0.00), (−3.64, 0.00, 0.00) points, real ΔD_vis −0.0383/−0.1104/−0.0756, normalised +0.0524/−0.0423/−0.0069, time factors ×1.0387/×1.1193/×1.0797; +10 red points 0.9699, a* −21.98; f/8 → f/11.31 −0.30103, f/11 −0.277, m 7.06 → 14.1 ×3.510; the time strip of §6.8 within 0.0065 D; grade 0/2/4: 0.279/0.756/1.685, 0.180/0.756/1.998, 0.112/0.756/2.268.
- §3.6 balance: lights 2.427 ΔE00 (textbook 2.4); density shift 14.50 (textbook 14.6), 13.97 from 1 log H above the grey to white ("near 14"), with paper dye amounts floored at 0.
- Bake on a recipe with lights (0.05, −0.025, 0.04): one undo unit, the grey card's x moves < 0.5 points, `undo()` restores the recipe exactly. `filtrationForLights` residuals 0.004–0.027 points.
- Grey pick on the sliders converged in 2 iterations (|a*, b*| 1.8e-4) on a cast patch.
- GPU parity (SwiftShader): darkroom chain export 0.057 levels, preview vs core tabulated 0.059 levels, max 1 in 8 bits; it differs from the default print by up to 138 levels, so the settings do reach the GPU.

### What didn't work
- `node packages/core/probe.tmp.ts` written through a heredoc in Bash was refused: "This agent is isolated in the worktree …, but this command is too complex to verify that it stays inside the worktree." Recovery: write files with the Write tool and run plain commands. The same guard refused appending this diary step with a heredoc; it is appended with the Edit tool.
- First browser run: 2 failed, 41 passed, both with `Error: page.evaluate: Execution context was destroyed, most likely because of a navigation.` (chain.spec.ts `darkroom chain …` and spatial.spec.ts `GpuEngine evaluates every domain …`). Cause: I edited `packages/engine-mock/src/ops.ts` while Playwright ran, and Vite reloaded the parity page. Recovery: rerun without edits.
- Second browser run: 42 passed, 1 failed: `chain:darkroom {"export":{"maxLevels":0.12924633410865496,…,"max8bit":1},"preview":{"maxLevels":0.13649460169095382,…,"max8bit":1},…}` against my bound of 0.1 levels. Cause: the grade was baked into the 512-sample develop row, whose linear-interpolation error grows with γ² (×2.1 at γ 1.45). Fix: grade-2 row plus the affine step in the kernel (flag 1); after it 0.057/0.059 levels.
- Mock test first run: `ChromobenchError: E_ARG_RANGE: darkroom.testStrip: step for time must be in (0, 2]` (I used step 10 for both strips). Fixed by step 0.5 for time.

### What I learned
- The guide's warmth vector, (−0.00124, 0, +0.00124), does not reproduce: core gives (−0.00107, 0.00001, +0.00106). Rerunning the guide's `extra.py` on `data.json` reproduces −0.00124. The film side agrees (mean-removed ∂u/∂mired (0.00205, 0.00023, −0.00228) in both, consistent with the textbook's 3,800 K shift (0.166, 0.021, −0.187) over 81.3 mired), film gamma at 0 agrees (0.4876, 0.4939, 0.5262), ∂PD/∂c agrees to 4 decimals. The difference: `extra.py`'s `bb(T)` is absolute Planck radiance, while Chromogen's `blackbody` (05-inline.js 301–309) and core's divide by the value at 560 nm. With absolute radiance the ±20 mired exposures sit −0.41/−0.48/−0.58 log H away from the grey card, on a non-linear part of the curves. Core's number is the faithful port; the fixture stores it with this note.
- The textbook's 14.6 needs the paper dye amounts to stay ≥ 0; without that floor the density shift reaches 19.6 ΔE00 (its yellow correction is −0.176 dye, which a paper cannot have).
- The guide's §3.3 numbers are without aim lights (`aim: 'midgray-normalised'`): the grey card has b* −4.4 there. With the default aim it prints neutral at 0.184 by construction.

### What was tricky to build
- The calibration has to be the same in both modes or "real − normalised is a scalar" fails: real mode uses κ at the calibration pack plus optics, normalised mode κ at the current pack; at the calibration they coincide, and the aim lights are fitted on a real-mode reference enlarger, so one set serves both modes.
- `dxdCC` in real mode built shifted enlargers without a calibration, so each re-normalised at its own pack and returned the normalised J. It now passes the calibration pack explicitly.
- `lightsToFiltration` with a dial at its floor: M+Y free with cyan held; if M or Y would go below 0, that dial is pinned at 0 and cyan is freed (Kodak's "no three-colour packs").

### What warrants a second pair of eyes
- The calibration semantics for absolute `filtration`: `makePrintChain({ filtration })` takes that pack as the reference unless `referencePack` is given (keeps fixed-pack setups such as Chromogen's neutral at lights 0). The engines always pass a shift, so their reference is the database neutral.
- Recipes with `mode: 'real'` or a filtration shift now print differently (that was the bug). No stored value changed.
- `darkroom.lightsToFiltration` in the reference engine uses print.expose's defaults until request C1 gives it the print settings.

### What should be done in the future
- Stages 3–6 (multi-exposure, density masks, filter fast path, procedures), `mask.paint` rasterisation, preflash through the base and the reciprocity hook (task 1cg3: the grade part is done).
- Contract requests C1–C4 (task gbmp).
- Roll analysis on real frames (LATD from the GPU, CHB-020) to feed `autoLights`, `rollConsistency` and `matchFrame`.

### Code review instructions
- Start with `packages/core/src/print/chain.ts` (`makePrintChain`: reference enlarger and aim), then `print/enlarger.ts`, `print/balance.ts` (from "the aim, warmth and the darkroom tools"), `ops/ops.ts` (`gradePivot`, `developerAt`, `darkroom.lightsToFiltration`), `packages/gpu/src/engine-gpu.ts` (`print.develop` case) and `kernels/pointwise.wgsl` case 5.
- `pnpm vitest run packages/core/test/chb010.golden.test.ts packages/core/test/chb010.balance.test.ts packages/core/test/laws.test.ts packages/gpu/test/darkroom.test.ts`
- `STUDIO_PORT=4451 CI=1 pnpm test:browser` (the `darkroom chain` spec prints its numbers).

### Technical details
- x_k = log10 Σ L·F_pack·pass·10^−D·s_k + κ + optics + ℓ_aim,k + ℓ_k, with κ = −mean_k log10 raw_k(mid-grey) at the calibration pack (real) or the current pack (normalised); optics = 0 in normalised mode.
- Grade: x′ = x*_k + γ(x_k − x*_k), x* = `chain.aimX` of the upstream print.expose (for the default aim, the x that prints a neutral 0.184 under `aimView`), [0, 0, 0] without one.
- GPU DEVELOP op: `flags = 1`, `p0 = pivot`, `p1 = [γ, γ, γ]`; the curve row id is `${paper}|1`.
- Warmth vector with TH-KG3 and the neutral pack: (−0.001069, 0.000007, 0.001063) log H per mired; +100 = (−5.56, 0.04, +5.53) points.
- Bake example (real mode, lights (0.1, 0, −0.05) log H): pack C 0, M 61.2, Y 68.2 (shift M +9.6, Y +15.7), 12.79 s (+0.355 stop), residual (0.004, 0.004, −0.008) points.

## Step 19: Validation gate and an intermittent timeout in a GPU tiling test

Milestone entry for the checks on bfe7258 and the follow-up commit. All checks pass; one pre-existing unit test timed out intermittently and now has an explicit timeout.

### Prompt Context
**Orchestrator brief:** see Step 18.
**Commit (code):** see the commit after bfe7258 ("CHB-010: diary steps 18–19, tasks, guide errata; tiles test timeout").

### What I did
- `pnpm typecheck` (clean), `pnpm lint` ("import boundaries ok (88 file checks)"), `pnpm gen:check` ("ok (18 files)"), `pnpm contract:check` ("20 change(s), 4 breaking", exit 0: the same 0.1.0 → 0.2.0 list as on main, no contract file touched).
- `pnpm test` five times: 1989 passed three times; twice "1 failed | 1988 passed". The saved run (`scratchpad/probe/unit-loop-2.txt`) names it: `FAIL packages/gpu/test/tiles.test.ts > planTiles: properties > every pixel belongs to exactly one tile core; read rects stay in the frame` with `Error: Test timed out in 5000ms.` (it took 5251 ms).
- Gave that test a 30 s timeout. It is CHB-005's pure tile-planning property test (60 random frames up to 3000², a coverage array per frame); nothing in it changed in this ticket, and it was close to vitest's 5 s default under parallel load.
- `STUDIO_PORT=4451 CI=1 pnpm test:browser`: 43 passed (baseline 42 + the darkroom chain).
- Tasks checked: ljn7, oldo, cr9o, do56, i6gs, 33os, nxhz, hjan. Added gbmp (contract requests C1–C4).

### What warrants a second pair of eyes
- The tiles test timeout is a test-only change in packages/gpu; CHB-005 may prefer fewer random frames instead.

