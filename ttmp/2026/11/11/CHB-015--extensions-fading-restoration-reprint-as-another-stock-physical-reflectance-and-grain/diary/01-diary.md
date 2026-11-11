---
Title: Diary
Ticket: CHB-015
Status: active
Topics:
    - film-emulation
    - color-science
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:26.575162293-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-010 and CHB-015 (darkroom printing and extensions). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-extensions.md` (8657 words), added 13 staged tasks, and related the primary source files.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Requested milestone: a complete intern guide plus a task breakdown for this ticket.
**Inferred user intent:** The ticket can be picked up by a new engineer or agent without prior context.

### Evidence and commits
- Brief: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md` (session scratchpad); shared map: CHB-001 `design-doc/01-chromobench-architecture-and-work-plan.md`.
- Filed with `python3 -I CHB-001/scripts/07-ingest-intern-guides.py <agent output> .` and checked with `scripts/08-check-guide-markdown.py` (fences tagged, no raw HTML).
- Writer agent: one background general-purpose agent for CHB-010 + CHB-015.
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

I started by reading the orchestrator's task message, then the common brief, the shared architecture document and the writing guidance the brief points to. I wanted the constraints and the contract's vocabulary fixed before opening any source code, because CHB-015's extensions touch several domains (film dyes, printing density, paper dyes, the output transform), and each proposal has to use the contract's names.

This step produced no files. It settled the rules for the rest of the work:
- existing material is read-only;
- scripts go only into the session scratchpad and run with `python3 -I`;
- the imported HTML apps are not opened or executed;
- web research is allowed but must be cited, and queries must carry no personal or project details;
- the guide is returned as text in a fixed block format.

### Prompt Context
**User prompt (verbatim), for the guides:** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
(This is the text the coordinator relayed. Step 1 quotes a longer form of the same prompt that adds "commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)".)
**User prompt (verbatim), for this diary:** "ask them to write all detailed diaries for their work and add those to the ticket too, see diary skill for the format."
**Orchestrator brief (not the user's words):** a task message received at 15:43:49 UTC that opens: "Write two chromobench intern guides: **CHB-010 "Darkroom printing"** and **CHB-015 "Extensions"**." For CHB-015 it asks for six extensions, each with its physics explained and a feasibility, data and plan assessment, and with speculative parts marked:
1. faded-negative restoration in dye space, citing the dye-stability literature (e.g. Wilhelm);
2. reprinting as another stock, inverting the curves and the DIR coupling;
3. Saunderson double-pass reflectance (§2.7, US 6,633,408) and the refit it needs;
4. Newson Boolean-model grain, with its cost against the Poisson–binomial model;
5. the digital finishing operators and their place relative to the gamut knee;
6. a learned light estimator.

The message points to the common brief at `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md`, which the orchestrator also wrote.
**Assistant interpretation:** Write one intern guide per ticket, grounded in the CHB-001 sources and cited literature. Return each with a staged task list and a related-file list.
**Inferred user intent:** CHB-015's extensions can be evaluated and built later by someone without prior context.
**Commit (code):** none. Repository HEAD at the start was a731130 ("CHB-001: architecture and work plan; create tickets CHB-002..CHB-015").

### What I did
- At 15:43:51 UTC, read the brief.
- Listed the CHB-001 ticket directory and counted words:
```bash
cd /home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/
ls -R | head -100
wc -w design-doc/*.md
wc -l /home/manuel/.claude/skills/ticket-research-docmgr-remarkable/references/writing-style.md
```
- Read `design-doc/01-chromobench-architecture-and-work-plan.md` (5,164 words) and `writing-style.md` (73 lines) in full.

### Why
- The brief requires exact contract names and an explicit "Proposed contract additions (for CHB-002)" section for anything new.

### What worked
- The architecture document defines the domains the extensions attach to (`film-dyes`, `printing-density`, `paper-dyes`, `print-xyz`, `display-rgb`) and the op catalog. Its catalog row puts `finishing` on `display-rgb`, which became a central finding (Step 13).

### What didn't work
- No failures observed.

### What I learned
- CHB-015 is off the critical path and joins CHB-014 in milestone M7.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Read the brief, then the architecture document's domain list and op catalog.

### Technical details
- Constraints recorded from the brief:
  - read-only on `/home/manuel/code/wesen/chromobench/ttmp/` and `~/code/wesen/go-go-golems/goja-cv`;
  - scripts only in `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/`;
  - return markers from `=====BEGIN GUIDE CHB-0NN=====` to `=====END RELATED CHB-0NN=====`;
  - every fenced block has a language tag, no raw HTML.

## Step 3: Textbook study (chapter 2, §3.6–3.9, §4.1–4.4)

The textbook *The Mathematics of the Colour Negative* supplies the models every extension builds on:
- the DIR coupling model for the reprint inverse;
- the Poisson–binomial grain model that Newson's model competes with;
- the single-pass reflectance and Saunderson's correction;
- the gamut knee that the finishing operators must precede;
- the limits of what three channels can recover.

I read chapter 2 in full, §3.6–3.9 and §4.1–4.4. One read failed because the range was too large; reading in smaller ranges fixed it.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Collect the models, numbers and limits that CHB-015's extensions rest on.
**Inferred user intent:** Each extension is explained from first principles, with real numbers.
**Commit (code):** none.

### What I did
- Mapped the sections of `sources/The Mathematics of the Colour Negative.md` (1,399 lines) with `grep -n "^#"`.
- Read lines 373–532 (§2.1–2.5), 530–709 (§2.6–2.9), 917–996 (§3.6–3.9), 1050–1149 (§4.1–4.2) and 1149–1228 (§4.3–4.4).

### Why
- The orchestrator's brief cites §2.5, §2.7 and §3.8 directly, and E2 depends on §2.3.

### What worked
These numbers went into the guide; all of them are **textbook** numbers:
- §2.3: spektrafilm's coupling matrix M = (0.336, 0.353, 0.302; 0.154, 0.319, 0.353; 0.168, 0.226, 0.273).
- §2.3: the inhibition at the grey card is (0.485, 0.663, 0.692) log H.
- §2.3: the effective gamma matrix J(0) = (0.610, −0.056, −0.065; −0.154, 0.740, −0.107; −0.145, −0.171, 0.874), whose rows sum to the neutral slopes.
- §2.3: the inhibitor spreads over about 20 µm plus a 200 µm exponential tail.
- §2.5: the Poisson–binomial grain model; crystal areas of 0.2 µm² × (1.6, 1.6, 3.2) per channel × (2, 1, 0.5) per sublayer; Portra 400 RMS granularity 9.1, 7.4 and 13.8 at D = 1.
- §2.7, Saunderson: k1 ≈ 0.04, k2 ≈ 0.6, 38.6 % escaping (Hunt 13.9), dD′/dd = 5, 2.9 and 2.0. Reading measured dyes as internal ones darkens the grey from 0.755 to 1.12 and paper white from 0.09 to 0.21.
- §2.7, the densest black: 2.37 on a densitometer, 2.09 with the Studio's flare, 1.35 with k1 fully seen.
- §2.7: a gain of 1.25 after the knee sends 0.9 to 1.048.
- §2.8: a curve does not commute with a shift.
- §3.6: foliage chroma 19.4 at full integrate-to-grey.
- §3.7: grouped splits and the cluster bootstrap in Chromogen's `data.js`/`evaluate.js`.
- §3.8: the stock cannot be identified from the solve's residual (below 10⁻⁶ D), DIR cannot be read from one frame, and the scene spectrum cannot be recovered.

### What didn't work
- My first attempt to read lines 373–712 in one call (offset 373, limit 340) failed:
```text
File content (26219 tokens) exceeds maximum allowed tokens (25000). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file. To read it anyway, up to what still fits in your context, call Read again with allow_large: true — only if you genuinely need all of it or the user asked for the whole file.
```
- Recovery: I read the range in two calls of 160 and 180 lines.

### What I learned
- The textbook's Saunderson sketch shows why the paper dyes must be refitted before the model is switched on: its un-refitted grey goes to 1.12.

### What was tricky to build
- N/A (reading only).

### What warrants a second pair of eyes
- M is spektrafilm's single matrix for all negative stocks ("just eyeballed, optimize!" per the textbook's quote). E2's inverse is only as good as M.

### What should be done in the future
- N/A.

### Code review instructions
- Textbook §2.3 (lines 439–482), §2.5 (504–528), §2.7 (556–586), §3.8 (965–973).

### Technical details
- The DIR model as used in the guide: d⁰ = f(u), a = Mᵀ d⁰, d = f⁰(u − a).

## Step 4: Chromogen Studio code and its analysis report

Chromogen Studio implements the starting point of three extensions:
- the forward fade (E1);
- the layer-wise re-shoot (E2);
- the finishing operators (E5).

I read its shaders, its constants and slider table, its print setup and re-shoot map, its global guided-filter pass, and the analysis report's pipeline and approximation sections. I wanted to describe what exists accurately and to name what it leaves out.

Two findings shaped the guide. The re-shoot ignores DIR coupling because the Studio has no DIR model. And the Studio's finishing operators run before its own display shoulder, so they respect the "knee last" rule; the chromobench catalog, by contrast, places finishing on `display-rgb`.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Map the Chromogen code that E1, E2 and E5 start from, with verified line ranges.
**Inferred user intent:** The intern knows what exists, what to port and what to change.
**Commit (code):** none.

### What I did
All commands ran in `.../CHB-001.../various/extracted/chromogen-studio`.

Between 15:44:22 and 15:44:56 UTC:
- `sed -n '934,1002p' 05-inline.js`: the constants `K`.
- `sed -n '1903,2086p' 05-inline.js`: the shaders `FS_DYES`, `FS_PD`, `FS_PRINT` and `FS_OUT`.
- `grep -n "var FS_\|BL = b.x\|B2 = Bref\|float dP\|..."`: `FS_DYES` 1918, `FS_PD` 1946, `FS_GF_PREP` 1983, `FS_GF_AB` 1984, `FS_PRINT` 1988, base reconstruction 2001–2002, `dP` 2005/2012, `FS_BLOOMSRC` 2026, `FS_OUT` 2027, sharpen 2055, OKLab 2061, vibrance 2063, rolloff 2069, colour density 2070, tanh shoulder 2074.
- Read `various/analysis-chromogen-studio.md` lines 154–418 (§2) and 669–823 (§6).

Between 15:56:55 and 15:59:23 UTC:
- A grep found `printSetup` at 1763, `fadeK` at 2120, `C_RANGE` at 1631 and `pdTable` at 1744.
- `sed -n '3022,3070p'`: the global pass.
- Hue `targets` at 1523, `shoulder` at 2073 and 3117.
- `sed -n '1761,1788p'`: `reshootMap`, `STAIN`, `printSetup`.

### Why
- The orchestrator's brief names `FS_OUT` around 2027–2076, the OKLab vibrance and hue shifts, clarity, texture, the guided-filter tone controls, and the report's §2 for re-shoot.

### What worked
These are **source** facts:
- `reshootMap = (A, B) => curveTable((c) => A.curves.map((cv, k) => B.curves[k].at(cv.inverse(c))), ...C_RANGE)` (1761). It is per layer, with no coupling.
- `STAIN` (1762): a Gaussian at 410 nm (σ 38) plus 0.35 × a Gaussian at 470 nm (σ 30), added to the paper base as `fade * 0.14 * STAIN` (1765).
- Fade: `fadeK = [0.4, 0.12, 0.25].map((w) => 1 - w * (s.fade ?? 0) / 100)` (2120), applied to the paper dyes.
- `C_RANGE = [0, 2.6]` (1631).
- Global pass (3054–3060): radii `K.MASK_RADIUS·long` and `K.MID_RADIUS·long`, ε of 0.05² and 0.03².
- `FS_OUT` order: sharpen (2055–2059), bloom (2060), OKLab ops (2061–2070), tanh shoulder above 0.82 (2073–2074).
- The report (§2.4 item 5, §6.2): no DIR model (`pipe.uncouple` is the identity); the texture and sharpness kernels are pixel-scale; the grain tile repeats every 3.07 mm.

### What didn't work
- No failures observed.

### What I learned
- Chromogen's fade acts on print dyes (forwards). Restoration of a negative's dyes is not built.
- The Studio keeps "knee last" because its shoulder comes after the OKLab operators.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The report notes that the Studio's book gives a different order inside the output group (bloom, OKLab, sharpness) from the code's (sharpen, bloom, OKLab). The guide keeps the code's order.

### What should be done in the future
- N/A.

### Code review instructions
- Check guide section 7.1's table against `05-inline.js` at the cited lines.

### Technical details
- N/A.

## Step 5: Chromogen Studio book chapters

The Studio's book states what is built and what is not. I searched it for re-shoot, fading, restoration and the learned estimator. Then I read chapter 5 (film character: re-shoot and fade), chapter 9 (roll balancing and the learned-estimator caveat), the "not built" list in chapter 10, and the start of chapter 6 (tone operators).

It confirmed that restoration, the learned estimator and noise-matched grain reduction are not built. It also gave the macro/operator distinction the guide uses to frame E1–E6.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Use the book to state accurately what the Studio does and lacks.
**Inferred user intent:** The guide does not overstate the existing code.
**Commit (code):** none.

### What I did
All commands ran in `.../chromogen-studio/st-data/book`, between 15:46:17 and 15:46:33 UTC:
- `grep -n -i "learned\|estimator\|not built\|faded\|restor\|re-shoot\|reshoot" *.md`.
- `sed -n '1,110p' 05-ch5.md`, `sed -n '30,75p' 09-ch9.md` and `sed -n '150,170p' 10-ch10.md`.
- `grep -n "^#" *.md`, and the first 60 lines of chapter 6.

### Why
- The orchestrator's brief: the learned estimator is listed as not built; re-shoot ignores DIR.

### What worked
These are **book** statements:
- 05-ch5.md line 101: "The inverse problem, restoring a faded *negative*, needs the same model in the other direction and is not built yet (design document 4.11)."
- 09-ch9.md line 60: "The design's learned estimator (§12.7), which predicted lights with less than half the error of integrate-to-grey in simulation and was to learn from the frames you balance, is not built yet."
- 10-ch10.md lines 154–164, "What is not built yet": the learned light estimator, and restoration mode for faded and expired negatives.
- 01-ch1.md: macros vs operators. Re-shoot amount "is physical only at 0 and 100 %".
- 08-ch8.md line 38: grain reduction "is not the noise-spectrum-matched reduction of the design document (4.5)".

### What didn't work
- No failures observed.

### What I learned
- The design document the book cites (§4.11, §12.7) is not in the project, so the "half the error" claim cannot be checked.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- If the Chromogen design document turns up, check §12.7 before building E6.

### Code review instructions
- Read the cited lines in `st-data/book/`.

### Technical details
- N/A.

## Step 6: Decoding the Filmbench data blob (decode.py)

Two CHB-015 computations needed spektrafilm's stock and paper data: the fading example (E1) and the slope bound for the DIR inverse (E2). Filmbench embeds that data as a compressed JSON blob. I wrote a small decoder that keeps four profiles and writes them to a JSON file in the scratchpad. It worked on the first run. This step was shared with CHB-010.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Make the project's own data available to the check scripts.
**Inferred user intent:** The guide's numbers are computed from the project's data.
**Commit (code):** none (scratchpad only).

### What I did
- 15:47:20 UTC: read the first 60 lines of `scripts/06-decode-filmbench-film-data.py` for the format (base64 of zlib/deflate JSON).
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

### Why
- The fade example and the DIR slope bound both need the curves and spectra.

### What worked
- `data.json` keeps Portra 400, Portra Endura, Gold 200 and Supra Endura.

### What didn't work
- No failures observed.

### What I learned
- Missing spectral rows are stored as base 99.0 with zero dye channels (opaque, spektrafilm's convention).
- Film curves are 256-sample tables over −3 to +4 log H. Paper curves are a three-term error-function model.

### What was tricky to build
- `decode.py` falls back from zlib to raw deflate (`zlib.decompress(b, -15)`) and does not print which path it used.

### What warrants a second pair of eyes
- Only four profiles are kept, so the slope bound in Step 11 covers Portra 400 and Gold 200 only.

### What should be done in the future
- Replace with CHB-004's exporter for fixtures.

### Code review instructions
- Re-run the command above. The scratchpad guides directory is shared with other writer agents.

### Technical details
- SHA-256 of `data.json` (first 16 hex digits): 0cc9486b701677d6.

## Step 7: The base print model (printchain.py)

The CHB-015 fading example needed a full print chain: film dyes, printing through the enlarger, the paper's curves and dyes, D50 viewing and CIELAB. I built it for CHB-010 in printchain.py, and fade.py (Step 10) executes its model code. The grey card reproduced the textbook's paper dyes and slopes, which made the model trustworthy enough to use for the fading example.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Build and validate a print model to reuse for E1's numbers.
**Inferred user intent:** E1's crossover numbers come from the same validated model as CHB-010's.
**Commit (code):** none (scratchpad only).

### What I did
- 15:49:13 UTC: wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/printchain.py` (85 lines). The model:
  - film density = chan·cmy + base;
  - the dichroic pack;
  - TH-KG3 lamp × pack × 10^(−D) × paper sensitivity;
  - calibration fixed at the neutral pack (0, 51.568, 52.534);
  - paper dye from the error-function model;
  - D50 reflectance → XYZ → CIELAB.
- Ran `python3 -I printchain.py data.json`.

### Why
- E1's claim, that printer lights leave crossover on a faded negative, needs numbers along a tone scale.

### What worked
These are **computed** values; the full output is in the CHB-010 diary, Step 9:
- `grey paper dye [0.665, 0.548, 0.499] visual density 0.758 Lab [48.83, -0.34, -4.36]`. The dyes equal the textbook's (§2.6).
- `paper white Y 0.813`.
- `PAPER SLOPES at grey (dye per logH): [2.36, 1.98, 1.95]`, also equal to the textbook's (§2.6).

### What didn't work
- No failures observed in the parts fade.py reuses.

### What I learned
- No viewing flare and D50 give 0.758 for the grey. The textbook's 0.755 includes the Studio's flare and a 5,000 K light.

### What was tricky to build
- fade.py, extra.py and strip.py reuse the model by executing the part of printchain.py above the line `pack = [0, 51.568, 52.534]`, with the `json.load(open(sys.argv[1]))` call replaced by `json.load(open('data.json'))`. They must therefore run from the scratchpad guides directory.

### What warrants a second pair of eyes
- The paper curve uses the parametric fit from Filmbench's data, not spektrafilm's tabulated curves.

### What should be done in the future
- N/A.

### Code review instructions
```bash
cd /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides
python3 -I printchain.py data.json
```

### Technical details
- SHA-256 of `printchain.py` (first 16 hex digits): ffc2e4eb51b83e26.

## Step 8: Literature on dye fading and digital unfading

The orchestrator's brief asks for the dye-stability literature (e.g. Wilhelm) to be researched and cited. I searched for Wilhelm's book and its chapters, the Gschwind and Frey restoration paper, and the 2023 "digital unfading" paper. I fetched the Canadian Conservation Institute note and a JAIC article on natural ageing.

I could not open Wilhelm's book. Its publisher's table of contents reset the connection, and searches found only secondary references. The fading facts in the guide therefore come from Anderson and Ellison (JAIC 1992) and CCI Notes 16/5. Wilhelm and Brower is cited as the general survey only. Gschwind and Frey, and Chatterjee et al., are cited from secondary or abstract-level information.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Find citable facts on which dyes fade, how fast, and how restoration has been done.
**Inferred user intent:** E1's model and its limits rest on the literature.
**Commit (code):** none.

### What I did
- 15:49:46 UTC, WebSearch: "Wilhelm "Permanence and Care of Color Photographs" dark fading cyan dye color negative film chapter". It confirmed the book (1993; prints, slides, colour negative film) and the CCI "limiting dye" definition. It did not surface the chapter.
- 15:49:47, WebSearch: "Gschwind Frey "Electronic imaging, a tool for the reconstruction of faded color photographs" Journal of Imaging Science and Technology 1994". The citation was confirmed from reference lists (J. Imaging Sci. Technol. 38, 1994, 520–525), with no abstract or DOI.
- 15:50:02, WebFetch of `https://p.gyb.elementfx.com/2571-9408/6/4/181`, which failed (below).
- 15:50:15, WebSearch: ""Digital Unfading of Chromogenic Film Informed by Its Spectral Densities" Heritage 2023". It returned Chatterjee, Trumpy and Ruedel, Heritage 6(4), 2023, 3418–3428, doi 10.3390/heritage6040181, with an abstract: fading is estimated from neutral areas and the dyes are reconstructed from known spectral densities.
- 15:50:25, WebFetch of `https://www.mdpi.com/2571-9408/6/4/181/xml`, which failed (below).
- 15:50:28, WebFetch of `https://ntnuopen.ntnu.no/ntnu-xmlui/handle/11250/3101572`, which redirected (not followed).
- 15:50:34, WebSearch: "wilhelm-research.com book pdf chapter "color negative films" dark storage stability cyan dye least stable". It returned no chapter, but a snippet pointed to Kodak's Arrhenius testing on Ektacolor 37 RC paper.
- 15:50:45, WebFetch of the IPI booklet `https://s3.cad.rit.edu/ipi-assets/publications/negatives_poster_booklet.pdf`. The tool could not parse the PDF and saved it.
- 15:50:54–15:50:59, copied it to `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/ipi/neg.pdf`, ran `pdftotext`, and read the colour section in `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/ipi/neg.txt`. It says "Chromogenic color dyes are not permanent" and "early Kodacolor negatives are now unprintable". I did not cite it.
- 15:51:03, WebFetch of `https://www.wilhelm-research.com/book_toc.html`, which failed (below).
- 15:51:05, WebSearch for the chapter "Dark Fading and Yellowish Stain Formation": nothing direct.
- 15:51:15, WebFetch of the CCI page *Care of Colour Photographic Materials* (CCI Notes 16/5).
- 15:51:34, WebFetch of `https://cool.culturalheritage.org/jaic/articles/jaic31-02-005_4.html` (Anderson and Ellison).

### Why
- E1's design depends on per-dye rates differing and not being predictable for a given roll.

### What worked
These are **literature** facts as cited in the guide:
- CCI Notes 16/5 (1986, revised 1996 and 2007): longevity is the time until "the limiting dye (i.e. the weakest dye) has lost 10% of its dye density". Dyes fade in the dark, and stains can build up. The note does not say which dye is weakest.
- Anderson and Ellison, "Natural Aging of Photographs", JAIC 31(2), 1992, 213–223:
  - "Our Arrhenius testing on KODAK EKTACOLOR 37 RC Paper … predicts that cyan is the least stable image dye";
  - "8.49 (SD 2.24) years for a 10% loss of cyan dye" at 24 °C and 40 % RH;
  - for Ektacolor Plus, "a rapid loss of magenta dye … followed by a leveling off".

### What didn't work
- `https://p.gyb.elementfx.com/2571-9408/6/4/181`: `getaddrinfo ENOTFOUND p.gyb.elementfx.com`.
- `https://www.mdpi.com/2571-9408/6/4/181/xml`: "The server returned HTTP 403 Forbidden."
- `https://ntnuopen.ntnu.no/ntnu-xmlui/handle/11250/3101572`: "REDIRECT DETECTED … Status: 301 Moved Permanently" to `https://hdl.handle.net/11250/3101572`. I did not follow it.
- `https://www.wilhelm-research.com/book_toc.html`: `read ECONNRESET`.
- The IPI booklet: WebFetch reported "a raw PDF file dump", and `pdftotext` recovered the text.

### What I learned
- No source gave a rate table for colour negative films. The guide therefore says rates must be estimated from the frame or the roll.
- The first-order per-dye scale is a model choice. Anderson and Ellison's magenta behaviour (fast, then levelling) shows its limits.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The guide's description of Chatterjee et al.'s method comes from the search result's abstract, not the paper.
- Gschwind and Frey is cited from reference lists only.
- Wilhelm and Brower is cited as a survey without my having read it.

### What should be done in the future
- Obtain the full Chatterjee et al. paper (open access via MDPI or NTNU) and Wilhelm's dark-fading chapter before building the automatic estimator.

### Code review instructions
- Check the guide's section 3.1 citations against the sources above.

### Technical details
- Search queries contained only bibliographic and technical terms, with no project or personal details.

## Step 9: Literature on Boolean-model grain (Newson et al., Zhang et al.)

E4 needed the Boolean model's definition, its two algorithms, their complexity and measured cost. The full-resolution IPOL PDF was too large to fetch, and the landing page had only the abstract. The low-resolution PDF downloaded as binary, and `pdftotext` turned it into readable text, from which I took the model, the algorithms, the default filter and the timing.

A search found the 2023 follow-up by Zhang, Wang, Tian and Pappas, which renders the same model analytically in real time when grains are not individually visible.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Get Newson's model and cost precisely enough to compare with the Poisson–binomial model.
**Inferred user intent:** E4's feasibility rests on measured numbers.
**Commit (code):** none.

### What I did
- 15:49:47 UTC, WebSearch: "Newson Faraj Delon Galerne "Realistic film grain rendering" IPOL 2017 Boolean model computational cost". It returned the citation (IPOL 7, 2017, 165–183) and the 2023 follow-up.
- 15:50:00, WebFetch of `https://www.ipol.im/pub/art/2017/192/article.pdf`, which failed (below).
- 15:50:14, WebFetch of `https://ipol.im/pub/art/2017/192`: the abstract only, and the note that the full-resolution PDF is about 66.5 MB.
- 15:51:47, WebFetch of `https://www.ipol.im/pub/art/2017/192/article_lr.pdf`. The tool could not parse it and saved the binary (979.2 KB).
- 15:52:00, copied it to `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/newson/a.pdf` and ran `pdftotext -layout`. The output, `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/newson/a.txt`, has 1,011 lines.
- 15:52:04–15:52:19, read lines 170–300, 545–575, 575–680, 680–760 and 760–830, and grepped for timing, N, defaults and colour.
- 15:52:23, WebSearch: ""Film Grain Rendering and Parameter Estimation" ACM Transactions on Graphics 2023 authors Boolean model analytical".

### Why
- The orchestrator's brief: "Cover its cost compared with the Poisson–binomial model."

### What worked
These are **paper** facts:
- The coverage probability is 1 − exp(−λE[πr²]), and λ(y) = (1/E[πr²])·log(1/(1 − ũ(y))) (text lines 177–195). Radii are constant or log-normal (205).
- Grain-wise and pixel-wise algorithms (320–533), with complexities C0 and C1 (552–577).
- The Gaussian filter defaults to 0.8 output pixels (725).
- Colour grain is "applying grain independently in each color channel" (848–856).
- Parallelisation uses OpenMP (686–687).
- Timing, lines 888–891: "for a 512 × 512 constant image (equal to 128 everywhere), the parallelized grain-wise and pixel-wise algorithms take, respectively, 40 seconds and 2.4 seconds".
- Zhang et al. (from the search result): ACM TOG 42(4), 2023, article 63, doi 10.1145/3592127; analytical statistics of the Boolean model; real time when grains are not visible.

### What didn't work
- `https://www.ipol.im/pub/art/2017/192/article.pdf`: `maxContentLength size of 10485760 exceeded`.
- `article_lr.pdf`: WebFetch reported "the raw internal structure of a PDF file", and `pdftotext` recovered the text.

### What I learned
- 2.4 s / 512² ≈ 9.2 µs per pixel. Extrapolated to 24 MP × 3 layers, that is about 11 minutes. This is a **computed** extrapolation, rechecked in Step 16 (10.99 min).

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The hardware behind the 40 s / 2.4 s timing is not identified in the lines I read. The guide calls it "a parallel CPU implementation" on the basis of the OpenMP remark.
- I did not read Zhang et al.'s paper; the claims are from the search summary.

### What should be done in the future
- Measure a WGSL pixel-wise kernel before deciding where E4 is offered (guide section 6.5).

### Code review instructions
- `sed -n '880,900p' newson/a.txt`, run in the scratchpad guides directory.

### Technical details
- Search queries contained only bibliographic and technical terms.

## Step 10: The fading example: why printer lights cannot fix a faded negative (fade.py)

E1's central claim is that fading scales each dye, which lowers each layer's contrast, while printer lights only shift exposure, so lights cannot undo it. I tested the claim with the validated print model. I faded Portra 400's dyes along a tone scale by k = (0.70, 0.90, 0.85), rebalanced with lights at the grey card as a printer would, and compared each patch with the unfaded print.

The grey is exact after rebalancing, but black, shadow, light and white are off by 4.8–5.7 ΔE*ab in opposite directions. That is crossover, and it became the worked example in guide section 3.2.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Quantify why fading must be corrected in dye space.
**Inferred user intent:** E1 is justified with concrete numbers.
**Commit (code):** none (scratchpad only).

### What I did
- 16:09:35 UTC: wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/fade.py` (19 lines). It:
  - takes five scene points on Portra 400's curves (log H −0.788, −0.4, 0, +0.4, +0.689 for black 3 %, shadow, grey, light and white 90 %);
  - multiplies their dyes by k;
  - computes the lights that restore the grey's paper exposure;
  - prints CIELAB and visual density for the original, for faded plus lights, and for faded without lights, with ΔE76.
- Ran `python3 -I fade.py`.

### Why
- The orchestrator's brief: "Dyes fade at different rates; that is a per-dye scale."

### What worked
The output, verbatim (all values **computed**; the k values are an illustrative choice, cyan fastest, not measured rates):
```text
faded grey dyes [0.481, 0.634, 0.734] orig [0.687, 0.704, 0.864]
lights to rebalance grey (points) [-9.0, -3.4, -5.3]
black 3%   orig Lab [9.0, -1.7, -1.8] D 2.000 | faded+lights Lab [12.6, 2.3, -0.9] D 1.826 dE76 5.4 | faded no lights Lab [7.2, -2.5, -1.5]
shadow     orig Lab [24.0, -1.0, -3.5] D 1.387 | faded+lights Lab [27.8, 2.8, -2.8] D 1.270 dE76 5.4 | faded no lights Lab [16.1, -7.1, -2.7]
grey       orig Lab [48.8, -0.3, -4.4] D 0.758 | faded+lights Lab [48.8, -0.3, -4.4] D 0.758 dE76 0.0 | faded no lights Lab [32.6, -14.3, -5.0]
light      orig Lab [73.4, -1.2, -4.6] D 0.340 | faded+lights Lab [69.9, -4.5, -5.5] D 0.391 dE76 4.8 | faded no lights Lab [55.0, -19.7, -8.4]
white 90%  orig Lab [85.0, -0.6, -2.0] D 0.181 | faded+lights Lab [81.2, -4.6, -3.6] D 0.231 dE76 5.7 | faded no lights Lab [69.6, -18.6, -8.0]
```

### What didn't work
- No failures observed.

### What I learned
- After rebalancing, the shadows go red (a* +2.3 to +2.8), the light tones go green-blue, and contrast falls at both ends (2.00 → 1.83, 0.18 → 0.23).
- Dividing c′ by k restores every patch exactly, because the model is exactly invertible. This was stated, not run.

### What was tricky to build
- The lights are fitted on paper log exposure at the grey (x_orig − x_faded), so the grey is exact by construction.

### What warrants a second pair of eyes
- ΔE is CIE76 (ΔE*ab), and the guide labels it as such.
- The fade is applied to dye amounts read from the film's datasheet curves at the scene points, without DIR or the scanner.

### What should be done in the future
- Store this table as the E1 golden fixture after the f64 reference reproduces it (guide section 3.6).

### Code review instructions
```bash
cd /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides
python3 -I fade.py
```

### Technical details
- SHA-256 of `fade.py` (first 16 hex digits): 7b9e9307a1a4db50.

## Step 11: Slope bound for the DIR-aware inverse (inline Python)

E2 needs the coupled film map u ↦ c to be invertible, so that reprinting can recover layer exposures. The argument in the guide has two parts:
1. The Jacobian's second factor (I − Mᵀ diag f′) is a nonsingular M-matrix if each column is diagonally dominant, that is, if f′_j × (row sum j of M) < 1.
2. A P-matrix Jacobian on a rectangle makes the map injective (Gale–Nikaidô).

I computed the row sums of M and the steepest datasheet slopes to check the condition. It holds with margin: the products are at most 0.65, 0.49 and 0.46.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Check numerically the condition the injectivity argument needs.
**Inferred user intent:** E2's "well-posed 3×3 solve" claim is backed by numbers.
**Commit (code):** none (no file; an inline `python3 -I -c`).

### What I did
- 16:09:43 UTC, run in the scratchpad guides directory:
```bash
python3 -I -c "
import json
d=json.load(open('data.json'))
for s in ['kodak_portra_400','kodak_gold_200']:
    cur=d['profiles'][s]['curves']; h=7/255
    mx=[max((cur[i+1][c]-cur[i-1][c])/(2*h) for i in range(1,255)) for c in range(3)]
    print(s,'max datasheet slope per layer',[round(v,3) for v in mx])
M=[[0.336,0.353,0.302],[0.154,0.319,0.353],[0.168,0.226,0.273]]
print('row sums of M (donor rows)',[round(sum(r),3) for r in M])
"
```

### Why
- The orchestrator's brief: "In spektrafilm's model that is a monotone 3×3 per-pixel solve."

### What worked
The output, verbatim (**computed**; M itself is the textbook's §2.3 matrix):
```text
kodak_portra_400 max datasheet slope per layer [0.659, 0.59, 0.689]
kodak_gold_200 max datasheet slope per layer [0.617, 0.57, 0.648]
row sums of M (donor rows) [0.991, 0.826, 0.667]
```
- Products for Portra 400: 0.653, 0.487 and 0.460 (computed by hand, rechecked in Step 16). For Gold 200: 0.611, 0.471 and 0.432. All are below 1.

### What didn't work
- No failures observed.

### What I learned
- On neutrals, the layer-wise inverse f_A⁻¹(c) is exact, because the datasheet curves already contain a grey's inhibition (textbook §2.3). So Chromogen's re-shoot is right on the neutral axis and wrong for colours.

### What was tricky to build
- Matching indices: entry (i, j) of Mᵀ diag(f′) is M_ji·f′_j, so column j's off-diagonal sum is f′_j·Σ_i M_ji, the row sum j of M.

### What warrants a second pair of eyes
- The bound uses the maximum slope of the datasheet curves (central differences on the 256-sample table, h = 7/255 log H). It assumes the first development in spektrafilm's model uses those curves.
- Only two stocks were checked.
- Gale–Nikaidô needs the domain to be a rectangle in u.

### What should be done in the future
- Check the bound for every negative stock in CHB-004's pack, and record Newton iteration counts when building the table (guide section 4.3).

### Code review instructions
- Re-run the command above.

### Technical details
- Gale and Nikaidô, Mathematische Annalen 159, 1965, 81–93.

## Step 12: Verifying the finishing operators in the source

Before writing E5's operator table, I numbered the exact shader lines, read the slider definitions for the tone operators, and checked the `FINISHING` set and the Look strength slider. Every formula and constant in guide section 7.1's table was then taken from these lines.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Make E5's table exact.
**Inferred user intent:** The intern can port the operators from the cited lines.
**Commit (code):** none.

### What I did
All commands ran in `.../chromogen-studio`:
- 16:10:01 UTC: `awk 'NR>=2054 && NR<=2075'`, `awk 'NR>=1938 && NR<=1943'` and `awk 'NR>=1953 && NR<=1963'` on `05-inline.js`, plus a grep for the slider ids.
- 16:10:07: `grep -n "var FINISHING"` (1599) and `sed -n '1581,1597p'` (the `look` slider).
- 16:10:09: `sed -n '1361,1380p;1412,1446p'` filtered to ranges and `maths` strings.

### Why
- The orchestrator's brief: "Cover their parameters and where they sit in the pipeline."

### What worked
These are **source** facts:
- `FINISHING = new Set(SLIDERS.filter((s) => ["tone", "colour", "detail"].includes(s.section) && s.id !== "look").map((s) => s.id))` (1599).
- Look strength: 0–150 %, default 100, "Scales every finishing operator at once; the physical print (macros) is untouched."
- Mask: `B' = B_{ref} + (1 - 0.6 m/100)(B - B_{ref})`. Clarity: `PD_k += 0.8 c/100 (Ȳ − B_mid)`. Texture: `PD_k += 1.2 t/100 core(Ȳ − G*Ȳ)`. All three range from −100 to 100.

### What didn't work
- No failures observed.

### What I learned
- Sharpening multiplies XYZ by a luminance ratio, which keeps chromaticity. Bloom adds blurred highlight light in linear XYZ.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- `awk 'NR>=2054 && NR<=2075' 05-inline.js`.

### Technical details
- Hue families: reds 25°, skin 55°, yellows 100°, greens 145°, blues 250°, purples 320° (1523).

## Step 13: Drafting the CHB-015 guide

I wrote the complete guide in one pass to a scratch file. It starts with the six extensions in a table and a pipeline diagram showing where each attaches, then gives one section per extension (physics, model, pipeline position, limits, feasibility, data, tests). It ends with a recommended order, testing, risks and contract proposals.

The draft's main conclusions:
- correct fading in dye space, with estimation from three or more neutral patches;
- E2 is a well-posed coupled inverse that can be tabulated;
- E3 needs a data refit before it can be switched on;
- E4 is probably export-only unless a GPU kernel proves fast;
- every finishing operator must precede `output.display`, which conflicts with the catalog;
- E6 ships only if it beats the baselines.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** First pass of the two-pass procedure for CHB-015.
**Inferred user intent:** A complete, technical guide with speculative parts marked.
**Commit (code):** none (scratchpad only).

### What I did
- 16:13:39 UTC: wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb015.md` (53,787 characters).

### Why
- The brief's two-pass procedure.

### What worked
- Every extension section ends with feasibility, data and tests. **Speculative** labels mark:
  - E1's automatic estimation and monotone curves;
  - E2's cross-stock layer mapping;
  - E3's effect size;
  - E4's dye-cloud adaptations;
  - E6's formulation.
- The E1 identifiability count uses picked neutral patches. One patch gives 3 equations and 4 unknowns. Two patches give 6 and 5 if there is no cast. With a cast (two degrees of freedom), P patches give 3P equations and 5 + P unknowns, so three are needed.
- E4's scale arithmetic was done by hand and rechecked in Step 16:
  - a 50 cm print from 36 mm is a 13.9× enlargement;
  - 300 ppi gives 84.7 µm per print pixel, which is 6.1 µm of film;
  - the disc diameters run from 0.45 to 1.3 µm.

### What didn't work
- No tool failures. Wording fixes are in Step 14.

### What I learned
- The architecture's catalog row for `finishing` on `display-rgb` contradicts textbook §2.7's "knee last". The guide proposes moving the operators to `film-dyes`, `printing-density` and `print-xyz`.

### What was tricky to build
- Placing the tone operators. An equal ΔPD in all channels is a neutral exposure change, which the paper then renders with its own contrast, the same place as CHB-010's density masks.

### What warrants a second pair of eyes
- The E2 claim that Newton from the layer-wise guess converges quickly. Review softened it to a prediction to be measured (Step 14).

### What should be done in the future
- File the contract proposals (guide section 12) with CHB-002.

### Code review instructions
- Read the filed guide: `ttmp/2026/11/11/CHB-015--extensions-fading-restoration-reprint-as-another-stock-physical-reflectance-and-grain/design-doc/01-intern-guide-extensions.md`.

### Technical details
- N/A.

## Step 14: Review pass and revision of the CHB-015 guide

I reread the draft as an intern would, re-checked the line numbers I had added last, and applied wording fixes in three small batches with the exact-match replace helper from the CHB-010 review. The review made the guide more precise about its sources and less confident where nothing had been measured:
- the conservation-standard history;
- the knee's origin;
- the conformance-check exception for `measure.*` ops;
- the two-patch case;
- Newton's convergence.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Second pass: fix claims that overreach and references that are loose.
**Inferred user intent:** A correct guide with no review notes in it.
**Commit (code):** none (scratchpad only).

### What I did
- 16:13:57 UTC: `awk 'NR>=3051 && NR<=3060'` (global pass) and `awk 'NR>=990 && NR<=993'` (`BLOOM: 0.6`, `GRAINRED: 1`), plus a grep of the draft's "§" references. Only "report §6.2" and textbook references appeared, so no section-reference rewrite was needed.
- 16:14:19: applied `r4.json` with `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/rep.py` ("ok"). Changes:
  - the fade table's header became "Visual density, new → faded and rebalanced";
  - "Kodak's Arrhenius tests on Ektacolor 37 RC paper" became "Arrhenius tests on Kodak Ektacolor 37 RC paper";
  - the Wilhelm sentence was rewritten: "standard survey of dark fading, light fading and stain for prints, slides, negatives and motion-picture films … Accelerated dark-stability tests by the Arrhenius method are standardised in ANSI IT9.9-1996 and its successor ISO 18909";
  - `E_UNDERDETERMINED` now applies below 3 patches, or 2 with `assumeNoCast`;
  - the knee is attributed to CHB-003/CHB-011, following spektrafilm (CAM16-UCS chroma with a Reinhard knee after a one-sided lightness knee, textbook §2.7);
  - the conformance check now exempts `output.encode` and the `measure.*` ops.
- `wc -w` gave 8,644. The fence check printed nothing.
- 16:14:23: reread lines 40–119.
- 16:14:52: grepped for first-person phrasing. The only CHB-015 hits were the matrix symbol "I", which is correct.
- 16:14:59: applied `r6.json` ("ok"): "The best a printer can do with lights is to rebalance" became "A printer would rebalance with lights". 8,640 words.
- 16:15:04: reread lines 186–225.
- 16:15:13: applied `r7.json` ("ok"):
  - "Newton's method converges from a good start" became "a damped Newton iteration from a good start can find it";
  - "converges in a few steps" became "should need only a few steps on moderately saturated colours; record the iteration counts when building the table".
- 16:15:35–16:15:39: reread lines 119–418 and 418–487.

### Why
- The brief requires a reread as the intern. Unmeasured claims must not read as facts.

### What worked
- All three batches applied ("ok"), and every fence is tagged.

### What didn't work
- No failures in this ticket's revision batches. A system notice at 16:14:19 said `chb015.md` "changed on disk since you last read it". The change was my own rep.py edit, not someone else's.

### What I learned
- The JAIC page reports the authors' own Arrhenius testing ("Our Arrhenius testing"). The neutral wording avoids attributing the tests to Kodak on the strength of a search snippet.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The ANSI IT9.9-1996 → ISO 18909 succession is stated from general knowledge, not from a source fetched in this session.

### What should be done in the future
- N/A.

### Code review instructions
- The revision pairs are in `r4.json`, `r6.json` and `r7.json` in the scratchpad guides directory.

### Technical details
- SHA-256 of the final `chb015.md` (first 16 hex digits): 0b5ee9bc6282eb3a.

## Step 15: Hand-back to the orchestrator

I returned both guides, with their TASKS and RELATED blocks and a short summary of findings and evidence limits, in one SubagentHandback call. The orchestrator filed the CHB-015 guide, its 13 tasks and its related files in commit 1a35a0c.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Deliver the result in the brief's block format.
**Inferred user intent:** The orchestrator can file the guides without editing them.
**Commit (code):** none by me. The orchestrator filed the guide in 1a35a0c, "CHB-010, CHB-015: intern guides, staged tasks, related files, diaries" (2026-11-11 11:22:30 −0500).

### What I did
- 16:22:02 UTC: SubagentHandback with a 138,406-character message. The result was `{"success":true,"message":"Report delivered to your caller."}`.
- The CHB-015 blocks: the full guide, then 13 tasks:

| Stage | Extension | Tasks |
|---|---|---|
| 1 | E5 | 3 |
| 2 | E1 | 3 |
| 3 | E3 | 1 |
| 4 | E2 | 2 |
| 5 | E4 | 2 |
| 6 | E6 | 2 |

- Then 7 related files: the textbook, `05-inline.js`, `analysis-chromogen-studio.md`, `st-data/book/05-ch5.md`, `st-data/book/06-ch6.md`, `00-film-data.bin.txt` and the architecture document.

### Why
- The brief's return format.

### What worked
- The filed guide equals the scratch draft. A diff on 2026-11-11 that ignored blank lines and the frontmatter found no differences (Step 16).

### What didn't work
- No failures observed. The transcript shows a second, identical hand-back entry after the context compaction. It is an `api-request-blob` record (replayed context), not a second delivery.

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The summary's limits: Wilhelm not opened, Chromogen's "half the error" claim unverifiable, Newson's WebGPU cost unmeasured.

### What should be done in the future
- N/A.

### Code review instructions
- `git show --stat 1a35a0c`.

### Technical details
- N/A.

## Step 16: Diary preparation: transcript dump, re-runs and checks

For this diary I rebuilt the work history from my session transcript rather than from memory. I re-ran fade.py and printchain.py and repeated the inline slope check, then re-did the hand arithmetic and diffed the filed guide against my draft. Everything reproduced exactly. Two small failures occurred while preparing the diary, both recorded below.

### Prompt Context
**User prompt (verbatim):** see Step 2 ("ask them to write all detailed diaries …").
**Assistant interpretation:** Write an evidence-backed investigation diary for each ticket, starting at Step 2.
**Inferred user intent:** The ticket keeps a reliable record of how the guide was made and what its numbers rest on.
**Commit (code):** none (scratchpad only; nothing was written into the ticket).

### What I did
- Dumped `/home/manuel/.claude/projects/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/subagents/agent-ae164a825561967ca.jsonl` with `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/diary010/dump.py`. The output is `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/diary010/full.txt`.
- Re-ran the five check scripts and compared each output with the original tool result. All were identical, including fade.py and printchain.py.
- Re-ran the slope check: the same output as Step 11.
- Re-did the arithmetic in one `python3 -I -c` call:
  - products of row sums and slopes: (0.653, 0.487, 0.460);
  - IPOL cost: 9.155e-06 s per pixel, so 10.99 min for 24 MP × 3;
  - enlargement 13.89×, 84.67 µm per print pixel, 6.096 µm of film;
  - disc diameters 0.451 and 1.277 µm.
- `git show --stat 1a35a0c`. Extracted the filed guide without its frontmatter and diffed it against `chb015.md` with blank lines removed: no differences.

### Why
- The diary must record evidence, not memory.

### What worked
- All of CHB-015's computed numbers reproduce from the scratch files.

### What didn't work
- The first command, `cat SKILL.md; echo ======; …`, stopped in zsh with `(eval):1: ===== not found` (exit code 1) after printing SKILL.md. zsh's `=command` expansion treats `======` as a command name. Re-running with `echo "-----"` fixed it.
- My first dump script failed:
```text
  File "<string>", line 16
    if t=="text": out.write(f"\n### [{i}] {role} TEXT\n{b[\"text\"][:6000]}\n")
                                                                              ^
SyntaxError: f-string expression part cannot include a backslash
```
  Recovery: rewrote it as `dump.py`, with %-formatting, in a file.

### What I learned
- N/A beyond confirming reproducibility.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The open source questions from Steps 8, 9 and 14: Chatterjee et al. read at abstract level only, Gschwind and Frey from secondary citations, the Newson timing hardware, and the ANSI/ISO succession.

### What should be done in the future
- If the orchestrator wants the scripts kept, copy `fade.py`, `printchain.py`, `decode.py` and the slope check from the scratchpad into the ticket. The scratchpad is session storage.

### Code review instructions
```bash
cd /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides
python3 -I fade.py
python3 -I printchain.py data.json
```

### Technical details
SHA-256 prefixes (first 16 hex digits) on 2026-11-11:

| File | Prefix |
|---|---|
| data.json | 0cc9486b701677d6 |
| decode.py | 168c489ebcccf09d |
| printchain.py | ffc2e4eb51b83e26 |
| fade.py | 7b9e9307a1a4db50 |
| rep.py | 14936f0f07a399f5 |
| chb015.md | 0b5ee9bc6282eb3a |
