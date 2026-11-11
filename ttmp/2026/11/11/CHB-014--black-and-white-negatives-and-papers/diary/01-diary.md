---
Title: Diary
Ticket: CHB-014
Status: active
Topics:
    - black-and-white
    - film-emulation
    - darkroom
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:26.228892732-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-004 and CHB-014 (data pipeline and black-and-white). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-black-and-white-negatives-and-papers.md` (10463 words), added 17 staged tasks, and related the primary source files.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Requested milestone: a complete intern guide plus a task breakdown for this ticket.
**Inferred user intent:** The ticket can be picked up by a new engineer or agent without prior context.

### Evidence and commits
- Brief: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md` (session scratchpad); shared map: CHB-001 `design-doc/01-chromobench-architecture-and-work-plan.md`.
- Filed with `python3 -I CHB-001/scripts/07-ingest-intern-guides.py <agent output> .` and checked with `scripts/08-check-guide-markdown.py` (fences tagged, no raw HTML).
- Writer agent: one background general-purpose agent for CHB-004 + CHB-014; ran data checks (NaN convention, prototype-vs-upstream deltas, grey-card error) in the session scratchpad; CHB-014 marks the development model, Callier model and VC-paper fit as speculative.
- The writer's own summary, kept as returned:

> Both guides are finished. Each has its GUIDE, TASKS and RELATED blocks below. The same text is assembled in /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/final-output.md if copying from a file is easier.
> 
> - **CHB-004** (about 10.9k words) covers the spektrafilm exporter, the pack format and the loader. I checked its key claims by running scripts against the data: how upstream treats NaN, how much the prototypes differ from upstream, and the grey-card error. If missing (NaN) densities are read as zero instead of opaque, the red layer comes out 0.18 log H too high. Its median spread across 128 film–paper pairs is 0.032 when NaN is read as opaque and 0.52 when it is read as zero.
> - **CHB-014** (about 10.5k words) covers black-and-white negatives and papers. It is research-led and marks unproven parts as **speculative**: the development model, the Callier specularity model (how much a condenser enlarger raises contrast) and the variable-contrast paper fit.
> - In the last pass I added the type definitions for the development model, renamed formula symbols that clashed, fixed the direction of the speed-shift term, and corrected the time–temperature check (within ±0.25 min; the worst point is 0.17 min off at 22 °C). I also added the warning code `W_DEV_EXTRAPOLATED`.
> 

### Noteworthy decisions or failures
- The guide's "Proposed contract additions (for CHB-002)" section, where present, is a proposal. It must be reconciled with CHB-002 before implementation.
- Numbers the writer computed for the guide (not from the textbook) are labelled as such in the guide. They are not independently re-verified here.

### Remaining requirements and next action
- Implementation has not started. Tasks in `tasks.md` are open.
- Next: review the guide, settle the open decisions it lists, and start stage 1.

## Step 2: Orientation: brief, writing guide, architecture and textbook

I read the orchestrator's common brief, the writing-style guide, the CHB-001 architecture, the two analysis reports and the textbook in sections. I did this once for both tickets (see also the CHB-004 diary). For CHB-014 the important findings were these: the architecture reserves a `silver-density` domain but defines nothing for it, and the textbook mentions silver only in §1.2, where it gives the Callier coefficient (about 2 for silver, at most 1.1 for dyes).

### Prompt Context
**User prompt (verbatim), for the guides:** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
**User prompt (verbatim), for this diary:** "ask them to write all detailed diaries for their work and add those to the ticket too, see diary skill for the format."
**Orchestrator brief (not the user's words), CHB-014 part verbatim opening:** "**CHB-014 scope.** Black and white. Nothing in the sources models it, so this guide is research-heavy. Cite the literature you use: Hunt; James, *The Theory of the Photographic Process*; Ilford and Kodak datasheets; and others." It then listed the topics: silver against dye images, the B&W film model, variable-contrast papers, system integration, and a staged plan (research → data → model → integration) with speculative parts marked.
**Assistant interpretation:** Write a research-led intern guide that collects the physics and data, proposes a model and integration, and clearly marks what is speculative, plus tasks and related files in the brief's block format.
**Inferred user intent:** The photographer also prints black and white; the system should handle it physically (enlarger geometry, VC paper filtration, split-grade), not with a curve stretch.
**Commit (code):** none (read-only research; drafts in the scratchpad).

### What I did
- Read the brief, `writing-style.md`, the architecture doc, `analysis-filmbench-ide.md`, parts of `analysis-chromogen-studio.md`, and the textbook in ranges (1–215, 267–376, 376–535, 535–705, 706–755, 874–1008).

### Why
- The guide has to use the architecture's names (`silver-density`, `print.expose`, `Exposure`, `FrameRecipe`) exactly, and propose additions explicitly.

### What worked
- The architecture's §5.1 domain list and §5.4 `Exposure` (kinds `main`, `dodge`, `burn`, `flash`, `split`) gave the integration points.

### What didn't work
- `Read` of the textbook at offset 376 with limit 330 failed: `File content (25600 tokens) exceeds maximum allowed tokens (25000). ...` I re-read it in two smaller ranges.

### What I learned
- The textbook's laws (flat wedge, §3.7; composition laws, §2.8) carry over directly to silver, and became the B&W tests.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Architecture §5.1 (`silver-density` reserved) and §8 (CHB-014 depends on 003 and 010).

### Technical details
- Textbook line 96 holds the Callier sentence that the guide quotes in §2.1.

## Step 3: Searched the sources and upstream for anything black-and-white

Before turning to literature I checked what the imported sources and upstream spektrafilm already have. Nothing models B&W. Upstream reserves a `'bw'` channel model without using it, and Filmbench's "grade" is a colour-paper curve stretch. The masked multi-exposure graph in Filmbench, however, is exactly the structure that split-grade printing needs.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Establish what exists so the guide can say what to reuse and what to leave behind.

### What I did
- Grepped the textbook and analyses for `silver|black-and-white|Callier|monochrome|...` with context.
- In `C1/various/extracted/filmbench-ide/vfs`, grepped for `split|grade|flash|g.sum` and read `vfs/controls.js` line 9 and `vfs/examples/05-graph.js` lines 8–14.
- Read `C1/various/extracted/filmbench-ide/01-inline.js` lines 2141–2172 (graph builder and `sum`), and located `enlargerIlluminant` (137–147) and `densitySpectral` (148).
- In the upstream checkout, ran `grep -rn "channel_model\|'bw'\|\"bw\"" src tests scripts | grep -v "\.json:"` and read `profiles/io.py` lines 200–394.
- Read `utils/morph_curves.py` lines 78–132 (sum-of-CDFs per channel) and grepped for `density_curves_layers` users.

### Why
- The guide's "What exists and what to reuse" table (§5.1) must point at real code.

### What worked
- Upstream: `io.py:21 PROFILE_CHANNEL_MODELS = frozenset({'color', 'bw'})`, `io.py:114 channel_model: str = 'color'`, `io.py:223/227` (`is_color` and `is_bw`), `io.py:311–312` (validation). No profile uses `'bw'`, and validation still requires 3 columns.
- Filmbench `controls.js` line 9: `GRADE = [[0, 0.7], [1, 0.82], [2, 1], [3, 1.2], [4, 1.45], [5, 1.8]]`, a curve stretch.

### What didn't work
- `grep -rn "channel_model\|'bw'\|..." --include=*.py src | head -30` failed: `(eval):1: no matches found: --include=*.py` (a zsh glob). I re-ran it without `--include` and with `grep -v "\.json:"`.

### What I learned
- If upstream ever ships B&W profiles, they will need a different validation path. The guide therefore defines its own B&W stock types and a `tools/bw-data/` writer.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- Watch upstream for B&W profiles and map them onto `BwFilmStock`.

### Code review instructions
- Check the rows of guide §5.1 against the cited lines.

### Technical details
- The DIR kernel used as the adjacency analogue: a 20 µm Gaussian plus 6 % of a 200 µm exponential (`params_schema.py` 130–141; textbook §2.3).

## Step 4: Literature and datasheets (web research)

Most of the guide's B&W facts come from manufacturers' datasheets and the photographic literature. I searched for and fetched them. Several fetches failed, either with HTTP errors or because the PDF text was compressed. When WebFetch had saved the PDF binary, I read the pages with the Read tool instead.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** "Cite the literature you use: Hunt; James ...; Ilford and Kodak datasheets; and others."

### What I did
- Web searches: Ilford Multigrade spectral sensitivity; Ilford Multigrade RC Deluxe ISO R values; Callier Q for condenser against diffusion; Ilford "Contrast control" colour-head settings; Kodak Tri-X F-4017; Ilford HP5 Plus; Kodak T-MAX 400 F-4043; Nelson 1971 on adjacency; ISO 6846 ISO range; the contrast-index construction of Niederpruem, Nelson and Yule (1966).
- Fetched `https://en.wikipedia.org/wiki/Callier_effect`: Q = D_dir/D_dif, no numerical values.
- Read the saved PDFs with `Read` (pages): Multigrade IV RC (`webfetch-1794412250753-f24dr2.pdf`, pp. 1–6, from freestylephoto), *Contrast control* (`webfetch-1794412281608-0pgyaq.pdf`, pp. 1–4, from ilfordphoto.com wp-content), Kodak F-4017 (`webfetch-1794412320313-uzfim5.pdf`, pp. 1–16, from 125px.com), HP5 Plus (`webfetch-1794412345369-trohyx.pdf`, pp. 1–6, from kennethleegallery.com). All are in `/home/manuel/.claude/projects/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/tool-results/`.

### Why
- Golden numbers for the B&W tests must be traceable to a page.

### What worked
- MG IV RC (June 2010): ISO R 180, 160, 130, 110, 90, 60, 40 for filters 00–5; ISO P 200 (00–3½), 100 (4–5), 500 unfiltered; spectral sensitivity at D 0.5, 1.0 and 1.5 over 400–560 nm; example effective density range 1.32 → R 130 → filter 1.
- *Contrast control* (April 2010): the three-emulsion quote (p. 1); Kodak-CC single-filter settings 199Y … 199M (p. 3); Durst 150Y … 170M; "condenser enlargers give about an extra grade of contrast", little change for XP2 Super (p. 4); colour heads have "slightly lower" maximum contrast; cold-light heads.
- F-4017 (September 2002): "diffusion enlarger" statement (p. 4); D-76 small-tank times 8, 6¾, 6¼, 5½ and 4¾ min at 18, 20, 21, 22 and 24 °C; large tank 7¾ min at 20 °C; RMS granularity 17 (HC-110 B, CI 0.56, 48 µm); spectral sensitivity at D 0.3 and 1.0 above gross fog, 0.5 s, erg/cm²; reciprocity +1/+2/+3 stops with −10/−20/−30 % development; base-plus-fog about 0.3 (35 mm) and 0.2 (120).
- HP5 Plus (June 2010): wedge spectrogram at 2,850 K; ID-11 stock 7½, 10½ and 14 min for EI 400, 800 and 1600; temperature example 4 min at 20 °C = 3 at 23 °C = 6 at 16 °C; continuous agitation "reduce these times by up to 15 %".

### What didn't work
- `WebFetch https://www.ilfordphoto.com/amfile/file/download/file/1954/product/745`: `The server returned HTTP 403 Forbidden.` The same 403 came from `.../file/1824/product/1/` (Contrast control) and `.../file/1903/product/691` (HP5 Plus).
- `WebFetch https://www.physics.wisc.edu/.../ILFORD_Multi_Grade_IV_RC.pdf`: `REDIRECT DETECTED ... Status: 301 Moved Permanently`. The redirect target `https://pages.physics.wisc.edu/...` then returned `HTTP 403 Forbidden`, as did `.../ILFORD_Contrast_Control.pdf`.
- `WebFetch https://www.freestylephoto.com/pdf/product_pdfs/ilford/Ilford_MGIVRC.pdf`: "I couldn't find any of the requested information ... its page text is stored in compressed streams". The binary had been saved, so I read it with `Read` and `pages: "1-6"`. The Contrast-control, F-4017 (125px.com) and HP5 PDFs were recovered the same way.
- `WebFetch https://kodakprofessional.com/.../f4017_trix_320400.pdf`: "The text is a compressed PDF ... created November 14, 2014, one page", with no data. I used the 16-page 125px.com copy instead.
- The Multigrade RC Deluxe values (ISO R 160, 130, 110, 90, 70, 60, 50; P 240/220) come only from a search-result summary. The guide marks them "verify on the sheet itself".

### What I learned
- Kodak's 2002 spectral-sensitivity legend appears inverted (the upper curve is labelled D = 1.0). The guide tells the intern to check another edition before digitising.
- Ilford's spectrogram includes the 2,850 K lamp, so it must be divided by a blackbody to give equal-energy sensitivity.

### What was tricky to build
- The PDFs had to be read as images or pages, not text. Numbers were transcribed from the rendered pages and cross-checked between tables (for example, the time–temperature table against the computed k).

### What warrants a second pair of eyes
- The Photrio forum figures (condenser Q about 1.2; CI targets 0.56–0.58 diffusion and 0.43–0.45 condenser). The guide labels them "weak evidence".
- The citation details of Nelson (1971) and Niederpruem, Nelson and Yule (1966) are marked "check volume and pages".

### What should be done in the future
- Obtain James (4th ed.) ch. 17 and the ISO 6846 text. The ISO-range construction in the guide is "commonly quoted" and must be verified.

### Code review instructions
- Open the four saved PDFs at the cited pages and compare them with the guide's golden table (§8).

### Technical details
- Downloaded PDFs are untrusted data. They were only read as documents, never executed.

## Step 5: Numerical checks of the datasheet relations

I checked the numbers the guide derives from the datasheets: the blackbody correction for Ilford's spectrogram, the temperature coefficients, and the Selwyn constant for Tri-X's granularity.

### Prompt Context
**User prompt (verbatim):** see Step 2.

### What I did
- `python3 -I -c` with Planck's law for 2,850 K and 3,400 K, the Kodak and Ilford temperature coefficients, and G = (σ/1000)²·π·24² for RMS 17.

### Why
- Every derived number in the guide had to be recomputable.

### What worked
- `2850 ratio 650/450 = 5.02 ... log10(650/450)= 0.7`; `3400 ratio 650/450 = 2.88`.
- `k Kodak 0.08688282060554768 pred 22C 5.673333498973251 pred 21C 6.1882954937583134`.
- `k Ilford +3 0.09589402415059362  -4 0.1013662770270411`.
- `G for RMS17 0.5229620794871714`.

### What didn't work
- No tool failures. The draft's wording around these numbers was later found to overclaim (Step 9).

### What I learned
- The grain model's crystal area follows: a = 0.523 / (2.7 × 1 × (1 − 0.97/2.7)) ≈ 0.30 µm², with an illustrative D_max of 2.7 and u = 0.97.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- D_max = 2.7 is an illustrative choice (the top of Kodak's 12-minute D-76 curve), so a ≈ 0.30 µm² is illustrative too.

### What should be done in the future
- N/A.

### Code review instructions
- Recompute by hand or with a Planck-law one-liner: B(650 nm)/B(450 nm) at 2,850 K; k = ln(8/4.75)/6; G = (0.017)²·π·24².

### Technical details
- t(T) = t₂₀·e^(−k(T−20)) with k = ln(8/4.75)/6.

## Step 6: Toy variable-contrast paper model (vc_toy.py)

To show the VC mechanism with numbers, I wrote a small illustrative model: three components with equal blue speed, equal contrast and different green speed, as Ilford describes. It computes ISO range against the blue share of the light, condenser against diffusion prints, and the split-grade equivalence. The guide's §6 trace and golden row "Illustrative trace" come from it. The first parameter choice did not reach Ilford's softest grades, so I widened the green offsets.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** The brief asked for split-grade as "a genuine spectral computation"; a worked example makes that concrete.

### What I did
- Wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/vc_toy.py` (docstring: "All parameters are made up for illustration; nothing here is measured."). Components have weight 0.7 and a normal-CDF curve with σ 0.119; the negative is (0.15, 0.62, 1.10).
- First run with green offsets `delta = (0.0, 0.5, 1.0)`.
- Changed it with `sed -i 's/^delta = (0.0, 0.5, 1.0)/delta = (0.0, 0.7, 1.4)/'` and appended `p_for_R` (bisection on blue share) and the per-filter print cases.
- Re-ran it while writing this diary, to confirm the numbers.

### Why
- Pure green gave R = 125 with the first offsets, far from Ilford's 180 for filter 00. The wider offsets reach R = 165.

### What worked
- Final run: `blue share 1.00: ISO R = 39.9`, `0.00: 165.0`; `R 130: blue share 0.0514`, `R 110: 0.1059`, `R 90: 0.1944`, `R 60: 0.4583`, `R 40: 0.9620`.
- `split 1.0 s green + 0.25 s blue == single exposure, blue share 0.2 ISO R 89.0`.
- `R110 filter, Q=1.0: ... {'shadow': 1.698, 'grey': 0.74, 'highlight': 0.109}`; `R110 filter, Q=1.25: ... {'shadow': 1.956, ..., 'highlight': 0.015}`; `R130 filter, Q=1.25: ... {'shadow': 1.677, ..., 'highlight': 0.054}`.

### What didn't work
- First run (offsets 0, 0.5, 1.0): `blue share 0.00: ISO R = 125.0`. The model could not reach filter 00 or 0 (R 180, 160), so I rejected those parameters.
- The final model still cannot reach R 180: `R 180: blue share 0.0000` is the bisection hitting its bound. The guide says so ("pure green R = 165 (Ilford's filter 00 is 180)").

### What I learned
- Under these assumptions split-grade with uniform masks is exactly a single exposure with mixed light, because exposures add linearly per component. This became the guide's split-grade law, with log-exposure summing as its broken variant.

### What was tricky to build
- Defining "blue share" as a fraction of blue-equivalent exposure, so that the mapping from share to R is monotonic and invertible by bisection.

### What warrants a second pair of eyes
- Everything about this model is illustrative and labelled so in the guide. None of it should be mistaken for a fitted Multigrade paper.

### What should be done in the future
- Port it as the first unit test of `print.develop` for VC paper (guide §6), then replace it with a fit to Ilford's data (§5.5).

### Code review instructions
- `python3 -I vc_toy.py`, run in the scratchpad guides directory; compare with guide §6 steps 3–6.

### Technical details
- Condenser trace: Q_eff = 1.25 with s = 1 turns densities (0.15, 0.62, 1.10) into (0.19, 0.78, 1.38).

## Step 7: Drafted the CHB-014 guide

I wrote the full first draft. Its sections cover silver against dye, film and paper background, system fit with a decision record for `silver-density`, design (stock types, development model, Callier model, VC paper, one-channel grain/halation/adjacency, printing, inversion, viewing, head data structures), a traced flow, a five-stage plan, tests, contract additions, risks and references.

### Prompt Context
**User prompt (verbatim):** see Step 2.

### What I did
- `Write` `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb014-draft.md` (64,726 characters).

### Why
- The two-pass writing procedure requires a complete draft before review.

### What worked
- The draft marked speculative parts explicitly: the development model, the Callier specularity form, the paper fit, and adjacency and halation strengths.

### What didn't work
- No tool failures. Content issues were found in review (Steps 8 and 9).

### What I learned
- N/A.

### What was tricky to build
- Choosing the domain semantics. `silver-density` holds net *diffuse* density above base-plus-fog, and each consumer applies its own geometry. The alternatives (silver as a one-dye `film-dyes` image, or silver for prints too) are recorded in the decision record.

### What warrants a second pair of eyes
- The proposed contract additions (§9): `film.developSilver`, `invert.silver`, `measure.isoRange`, the `BwDevelopment` recipe variant, `EnlargerHead`, `'degC'` and the diagnostics.

### What should be done in the future
- N/A.

### Code review instructions
- Read §4.2 (decision record) and §9 together.

### Technical details
- The neutral-silver factorisation: x_k = log₁₀ Σ_i t_i C_k(F_i) − D_eff(d) when ε_Ag is flat.

## Step 8: First review pass and revision

I reread the draft from the start and fixed wording that overstated the evidence, then continued reading through §7.3. At that point the context was compacted.

### Prompt Context
**User prompt (verbatim):** see Step 2.

### What I did
- Applied one revision script to `chb014-draft.md` (asserted replacements, printed `ok`; the word count was then 10,128).
- Read the draft in ranges 1–110, 110–220, 219–349, 348–468 and 467–547.

### Why
- Statements about Q's dependence on grain, the forum evidence and IR dust removal needed precise, sourced wording.

### What worked
- Revised: Q "depends on the grain (coarse, fast emulsions scatter more than fine-grained ones) and it varies with density". The forum evidence is now labelled "weak evidence", with its CI targets and their ratio of about 1.3. The IR-dust statement now refers to scanner documentation for Digital ICE.

### What didn't work
- No tool failures.

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- Items noted for the next pass: type definitions for `Agitation` and `DevelopmentModel`; renaming the development-block symbols that clashed with t (time); clarifying base-plus-fog against net density; hedging the push-time constraint; finishing §§7.4–11.

### Code review instructions
- N/A.

### Technical details
- N/A.

## Step 9: Second revision pass (after context compaction)

After compaction I resumed from the noted items, applied them, and reread §§7.4–11. While applying them I found two errors in the development model's text and corrected both. The toe-shift term had the wrong sign. The claim that the D-76 table is reproduced "to its quarter-minute rounding" was false at 22 °C.

### Prompt Context
**User prompt (verbatim):** see Step 2.

### What I did
- `Edit` §5.2: added `export type Agitation = ...`, `DevelopmentModel { byDeveloper: Record<string, DevelopmentFit> }` and `DevelopmentFit` (kDev_perC, agitationFactor, gammaInf/tauGamma_s, fog0_D/fog1_D_per_s, x0Inf_log10H/dx0_log10H/tauX_s, range_D/toeWidth_log10H/shoulderWidth_log10H, validTime_s/validTemp_C, provenance).
- `Edit` §5.3: filled in the empty `doc` of the `agitation` `ArgSpec`. Rewrote the development block with w_toe, w_sh, D_r, τ_γ, τ_x and Δx; defined bf(t_eff) as the rebate density and d(x) = D(x) − bf; hedged the push-time constraint (`method: 'assumed'`); added `W_DEV_EXTRAPOLATED`.
- Checked the textbook's softplus formula (`sed -n 407,424p`) and the architecture's `ArgSpec` (`grep -n -A14 'interface ArgSpec'`).
- `python3 -I -c` computed the D-76 predictions; asserted replacements fixed §3.2 and §5.3 and added the diagnostic to §9.
- Asserted replacements in the golden table ("≈ 20 R units, this guide's reading of the ISO range table") and in a §3.6 sentence.
- Read §§7.4–11 (lines 467–546 and 560–end) and checked textbook line 96 for the Callier quote.

### Why
- The intern needs the types the sketch referenced, and symbols that do not collide (t was both time and toe width).

### What worked
- D-76 check output: `18 8 8.033`, `20 6.75 6.75`, `21 6.25 6.188`, `22 5.5 5.672`, `24 4.75 4.766`.
- The §5.3 law now reads "reproduced within ±0.25 min ... (the worst point, 22 °C, is 0.17 min off)". §3.2 says "within a quarter-minute, the table's own resolution".

### What didn't work
- Content error (found, not a tool failure): the draft stated x₀(t_eff) = x₀∞ − s₁·e^(−t_eff/τ_s). That moves the toe to *lower* exposure at short development, the opposite of "speed rises with development". I corrected it to x₀∞ + Δx·e^(−t_eff/τ_x) with Δx > 0.
- Content error: "the Kodak D-76 table is reproduced to its quarter-minute rounding: predicted 6.19 and 5.67 min at 21 and 22 °C against 6¼ and 5½". The 22 °C point is off by 0.17 min, more than the 0.125 min that quarter-minute rounding allows. I replaced the claim with ±0.25 min and the full prediction list.

### What I learned
- Small arithmetic claims need recomputing at review, not only at drafting.

### What was tricky to build
- Keeping the renamed symbols consistent across the sketch types (§5.2), the formula block and prose (§5.3), and the diagnostics list (§9).

### What warrants a second pair of eyes
- The development model is phenomenological and speculative in form. Whether γ(t) = γ∞(1 − e^(−t/τ)) is the right form must be checked in James (4th ed.).

### What should be done in the future
- Fit the model to digitised D-76 curves (6, 8, 10, 12 min) and check it against Kodak's CI-against-time curves.

### Code review instructions
- Guide §5.2 (types), §5.3 (formula block, laws) and §9 item 5.

### Technical details
- Final length: 10,463 words (`wc -w`).

## Step 10: Final checks, assembly and hand-back

The orchestrator asked me to wrap up. I linted both drafts, verified the RELATED paths, wrote the TASKS and RELATED blocks, assembled the output and handed it back in the brief's block format. A second orchestrator message then asked for these diaries.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Orchestrator message (not the user's words):** "Wrap up now. The user wants to move on, and good enough is fine. Skip any further research or revision passes and return your current CHB-004 and CHB-014 guides immediately, in the brief's block format (GUIDE, TASKS and RELATED blocks for each ticket)."

### What I did
- Ran `lint_md.py` on both drafts, and checked all related paths with `[ -e ]`.
- Wrote `tasks014.txt` (17 tasks across stages 1–5) and `related014.txt` (7 paths), assembled `final-output.md`, and called `SubagentHandback`.

### Why
- These are the brief's return-format and Markdown rules.

### What worked
- `chb014-draft.md fences 28 balanced`, with no raw HTML outside code. All 7 CHB-014 related paths printed `OK`.

### What didn't work
- The first lint one-liner ended with `Exit code 1` because its final `grep -n '^=====' $f` matched nothing (expected). The TypeScript generics it flagged were inside code blocks.
- Reading the diary skill with `echo ======` failed under zsh: `(eval):1: ===== not found`. I re-ran it with a quoted separator.

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The Multigrade RC Deluxe values in §7.1 are unverified (search-summary only) and flagged in the text.

### What should be done in the future
- The orchestrator files the guide, tasks, related files and this diary in the CHB-014 ticket.

### Code review instructions
- `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/final-output.md`

### Technical details
- The scratchpad draft is `.../scratchpad/guides/chb014-draft.md`. The scripts behind this ticket are `vc_toy.py` and the one-liners recorded in Steps 5 and 9.
