---
Title: Diary
Ticket: CHB-004
Status: active
Topics:
    - data
    - color-science
    - film-emulation
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:22.699444855-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-004 and CHB-014 (data pipeline and black-and-white). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-stock-and-reference-data-pipeline-from-spektrafilm.md` (10915 words), added 16 staged tasks, and related the primary source files.

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

I started by reading the material that every intern guide had to conform to: the orchestrator's common brief, the writing-style guide, the CHB-001 architecture and work plan, and the two analysis reports. Then I read the textbook *The Mathematics of the Colour Negative* in sections, because it is the source of the golden numbers and of the "NaN is opaque" finding that CHB-004's design turns on. I did this orientation once for both tickets (CHB-004 and CHB-014), so the same step appears in both diaries.

The result was a fixed vocabulary: the domain names, `OpDef`, `ArgSpec`, `FrameRecipe` and the `packages/...` paths. I also had a list of what CHB-004 had to explain: the textbook's grid (§1.1), the grey card (§1.2), the base gap (§1.6), the hanatos table (§1.8), printing and "NaN is opaque" (§2.6), and calibration with `data.js` (§3.7).

### Prompt Context
**User prompt (verbatim), for the guides:** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
**User prompt (verbatim), for this diary:** "ask them to write all detailed diaries for their work and add those to the ticket too, see diary skill for the format."
**Orchestrator brief (not the user's words), opening lines verbatim:** "Write two chromobench intern guides: **CHB-004 "Stock and reference data pipeline from spektrafilm"** and **CHB-014 "Black-and-white negatives and papers"**. First read the common brief and follow it exactly, including its return format: /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md". For CHB-004 the brief listed six stages: the exporter from upstream spektrafilm, the pack format, the missing-data convention, measured camera and LED data, synthetic frames, and licensing. It also named the existing Filmbench and Chromogen fixtures.
**Assistant interpretation:** Write a self-contained intern guide for the data pipeline (exporter, packs, loader, conventions, fixtures, licensing), plus 8–20 staged tasks and 5–8 related files, in the brief's block format. I may not write into the ticket.
**Inferred user intent:** An intern should be able to start building `tools/spektrafilm-export` and `packages/data` without rediscovering what the upstream data means or where the prototypes disagree.
**Commit (code):** none. All work was read-only on the repository; drafts were kept in the scratchpad.

### What I did
- Read `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md` and `/home/manuel/.claude/skills/ticket-research-docmgr-remarkable/references/writing-style.md`.
- Read `C1/design-doc/01-chromobench-architecture-and-work-plan.md` in full, where C1 = `/home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`.
- Read `C1/various/analysis-filmbench-ide.md` in full, and `C1/various/analysis-chromogen-studio.md` at lines 1–60, 410–490 and 669–820.
- Listed the textbook headings with `grep -n "^#"`, then read the textbook in ranges 1–215, 267–376, 376–535, 535–705, 706–755 and 874–1008.

### Why
- The brief requires the architecture's vocabulary to be used exactly, and asks that any report be verified before it is cited. Reading the sources before drafting avoided inventing contract shapes.

### What worked
- The architecture doc gave the planned paths (`packages/data`, `tools/`, `fixtures/`) and the CHB-003 row's "interim data from Filmbench and Chromogen". The guide's interim-pack design is built on that row.

### What didn't work
- `Read` of the textbook at offset 376 with limit 330 failed: `File content (25600 tokens) exceeds maximum allowed tokens (25000). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.` I re-read it as 376–535 and 535–705.

### What I learned
- The textbook already records the decisive finding (§2.6, "A finding: NaN is opaque", a* = −19 for the grey card under the zero-density reading). It also attributes measured cameras to Chromogen's `data/cameras/measured.json` (§3.7), a file that later turned out to be absent from the imported bundle (Step 8).

### What was tricky to build
- N/A for this step (reading only).

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Start with the architecture doc §5 (contracts) and §8 (work plan) to check that the guide's names match.

### Technical details
- Grid: 81 samples, 380–780 nm in 5 nm steps (textbook §1.1).

## Step 3: Studied the prototype data (Filmbench bundle and Chromogen st-data)

The brief named two existing sources of stock data. I read the CHB-001 scripts that decode them and inspected the decoded data directly with small read-only scripts. The aim was to describe each prototype's layout field by field, and to find how each one encodes missing values.

The key observation came from `fb_inspect.py` on Portra 400. Filmbench lists `nanRows` [0–3, 65–80] and sets the base to 99.0 D and the dyes to 0 in those rows. Chromogen keeps JSON `null`, and its loader turns a null dye or base value into 0.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Document what exists today and how it can serve as interim fixtures.
**Inferred user intent:** Let CHB-003 and CHB-005 start before the exporter exists.

### What I did
- `wc -l` on and `cat` of `C1/scripts/06-decode-filmbench-film-data.py`, `02-inventory-chromogen-st-data.py` and `03-check-chromogen-stock-data.py`.
- Read `C1/various/extracted/filmbench-ide/film-data-summary.json` with `python3 -I -c ...`. Top-level keys: `wl`, `cmf`, `illuminant{D50,D55,D65,T,K75P,TH-KG3}`, `dichroic`, `rgb2xyz_cat16`, `xyz2rgb`, `neutral_filters`, `profiles`.
- Wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/fb_inspect.py`, which base64-decodes, zlib-decompresses and prints Portra 400's keys, `nanRows`, base and dye rows. It ran on `C1/various/extracted/filmbench-ide/00-film-data.bin.txt`.
- Ran `python3 -I scripts/03-check-chromogen-stock-data.py various/extracted/chromogen-studio/st-data/cg` from C1.
- Grepped `01-inline.js` for `nanRows|decodeLuts|neutral_filters` and read lines 60–160 (profile access, LUT decoding, `enlargerIlluminant`).
- Read Chromogen's loader, `C1/various/extracted/chromogen-studio/05-inline.js` lines 430–475, and confirmed the line numbers with `grep -n` (447 grid refusal, 450 dye `Number.isFinite(v) ? v : 0`, 459 base `v || 0`).

### Why
- The convention for missing data is the ticket's most consequential decision. It had to be shown from code, not from the reports.

### What worked
- `fb_inspect.py` output: `nanRows [0, 1, 2, 3, 65, ..., 80]`; base `(380, 99.0) ... (720, 99.0)`; dye rows 705–780 all `[0.0, 0.0, 0.0]`; profile keys `['stock', 'name', 'type', 'support', 'use', 'antihalation', 'ref', 'view', 'target_print', 'logSens', 'nanRows', 'chan', 'base', 'curves', 'model', 'role', 'lut']`.
- Script 03 printed null ranges and peaks per layer, for example `fujifilm_c200 layer 0: null [(380.0, 380.0), (750.0, 780.0)]`. It also printed the Portra 400 grey card as `D(0)=[0.687, 0.704, 0.864]`.

### What didn't work
- No failures in this step.

### What I learned
- Filmbench's 99.0 D is spektrafilm's opaque reading expressed without NaN. It also destroys real dye values in those rows: for Portra 400, the 385–395 nm dyes that Chromogen still has.

### What was tricky to build
- Filmbench's `nanRows` is the union of base-NaN and dye-NaN rows, so it cannot be inverted to separate the two. That is why the guide gives `interim-filmbench` only `missing.supported: ['opaque']`.

### What warrants a second pair of eyes
- The claim that a zero-density policy cannot be reproduced from interim-filmbench (Section 5.5 of the guide).

### What should be done in the future
- The `interim.py` converter should assert the union property instead of assuming it.

### Code review instructions
- Re-run `python3 -I fb_inspect.py C1/various/extracted/filmbench-ide/00-film-data.bin.txt`, then compare with guide Section 5.1.

### Technical details
- Filmbench LUT: base64 deflate of 12,288 int16 values, log₂ × 1024, decoded by `FB.decodeLuts` (`01-inline.js` lines 96–106).

## Step 4: Cross-checked Filmbench against Chromogen

I wrote a read-only comparison of the two prototypes over their 11 shared stocks. The guide's tolerance table (Section 5.3) and the exporter's planned `crosscheck` command both rest on these numbers.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** The brief asks how to cross-check the exporter against the interim fixtures; that needs measured tolerances.

### What I did
- Wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/crosscheck.py`, which takes the Filmbench blob and the Chromogen `st-data/cg` directory as arguments, then ran it.

### Why
- Tolerances written down before the exporter exists make the cross-check a real test.

### What worked
- Per stock, for example `fujifilm_c200: logSens max|d|=5.00e-05 ... chan(excl nanRows) max|d|=0.00e+00 ... base(excl nanRows) max|d|=0.00e+00 ... curves max|d|=5.00e-05`.
- `nanRows==cg base-null rows: True` for C200, with `FB base at nanRows: {99.0}` and `FB chan at nanRows all 0: True`.

### What didn't work
- No failures. One expected mismatch: for `fujifilm_crystal_archive_typeii`, `nanRows==cg base-null rows: False`, because papers have dye nulls but no base nulls. This confirms that `nanRows` is a union of base and dye NaN rows.

### What I learned
- The differences are pure rounding: 4 decimals in Filmbench (5 × 10⁻⁵) and 5 decimals in Chromogen.

### What was tricky to build
- Rows have to be excluded per array (`nanRows`) before comparing `chan` and `base`; otherwise the 99.0 sentinel dominates the maximum.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- Port `crosscheck.py` into `tools/spektrafilm-export/crosscheck.py` with the guide's tolerances.

### Code review instructions
- `python3 -I crosscheck.py <C1>/various/extracted/filmbench-ide/00-film-data.bin.txt <C1>/various/extracted/chromogen-studio/st-data/cg`

### Technical details
- Tolerances adopted in the guide: 5 × 10⁻⁵ against Filmbench, 5 × 10⁻⁶ against Chromogen, and exact for dyes and base outside the NaN rows.

## Step 5: Cloned upstream spektrafilm and mapped its data layout

The brief asked for the upstream repository's actual layout, cited. I shallow-cloned spektrafilm into the scratchpad and read the modules that define, load, interpret and normalise the data. Every line reference in guide Sections 2 and 4 comes from this checkout.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Research the repository's real profile and data layout ("Research the repo's actual profile and data layout and cite it", orchestrator brief).

### What I did
- `timeout 120 git clone --depth 1 https://github.com/andreavolpato/spektrafilm.git` into `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/upstream/spektrafilm`, then `git log -1 --format='%H %ad %s'`.
- Read `LICENSE`, `SPEKTRAFILM_LICENSE.txt`, `src/spektrafilm/profiles/io.py` (`cat -n`, lines 1–394), `config.py`, `runtime/params_builder.py` (lines 30–75, 75–100, 145–160, 161–252), `model/illuminants.py`, `model/color_filters.py` lines 1–135, `utils/io.py` lines 354–430, `utils/spectral_upsampling.py` lines 18–60, 95–118, 263–274 and 333–368, `runtime/stages/printing.py` lines 60–125, `model/develop.py` lines 1–40, `model/couplers.py`, `runtime/params_schema.py` (the classes `GrainParams`, `HalationParams` and `DirCouplersParams`) and `utils/morph_curves.py` lines 78–132.
- Listed the 28 profiles and the keys of `data/filters/neutral_print_filters.json`.
- Decoded the header of `hanatos_irradiance_xy_coeffs_250304.lut` with `struct.unpack('=4i', b[:16])` and read the `.npy` header.

### Why
- The exporter must "ask spektrafilm" rather than re-derive values, so the guide had to name the exact functions and data files.

### What worked
- Commit: `3bb2c2d2801ff68b92019cf1dbcbb133d60832bc 5 months ago fix: vlog midgray exposure`.
- Neutral filters: 8 papers, each `{'TH-KG3': 20}`; Portra 400 on Portra Endura gives `[0.0, 51.56801468495496, 52.53400422349596]`.
- `.lut`: `4194741 (1234, 17039362, 512, 512)`, `trailer bytes 421`, trailer text "spectral upsampling table for Jakob 2019 style sigmoid spectra ...". The `.npy` file is `(192, 192, 81) float16`.
- Profile model: `PROFILE_CHANNEL_MODELS = frozenset({'color', 'bw'})` at `io.py:21`, with validation at 300–339.

### What didn't work
- `grep -rn "channel_model\|'bw'\|..." --include=*.py src | head -30` failed under zsh with `(eval):1: no matches found: --include=*.py`. The unquoted glob was expanded by the shell. I re-ran it without `--include` and filtered `.json` lines with `grep -v`.
- The same zsh error recurred later in a grep over `utils/spectral_upsampling.py`: `(eval):1: no matches found: --include=*.py`. The remaining greps in that command still produced output.

### What I learned
- How NaN behaves is spread across the code. `utils/conversions.py` line 24 makes a NaN density opaque (zero light), while `printing.py` lines 76–77 and `filming.py` lines 96–97 apply `nan_to_num` to 10^log_sensitivity, which makes a NaN sensitivity zero.
- The DIR values are code, not profile data: `params_builder.py` lines 161–215 apply one set and the schema defaults (`params_schema.py` 130–141) are a different set. The guide therefore exports both, as `'applied'` and `'schema-default'`.
- `HANATOS2025_SPECTRA_LUT` is converted to double on load (line 108), so the exporter has to read the `.npy` file directly to keep float16.

### What was tricky to build
- The print-material flag is `stage == 'printing'`, not `support` (Kodak 2383 and 2393 are print films). The guide exposes it as `role`.

### What warrants a second pair of eyes
- The line numbers cited at commit 3bb2c2d. They shift with any upstream change, which is why the guide pins the commit.

### What should be done in the future
- Re-verify the cited line ranges when the pinned commit changes.

### Code review instructions
- `git -C <scratchpad>/upstream/spektrafilm log -1`, then open the files listed in guide Section 4's table.

### Technical details
- Halation presets: still σ 65 µm, cine 50 µm. Strengths for strong antihalation (0.015, 0.005, 0), for weak (0.08, 0.02, 0), for none (0.30, 0.10, 0.015).

## Step 6: Compared upstream with the prototypes and looked for shared arrays

With upstream checked out, I compared it with Chromogen and Filmbench and searched the 28 profiles for identical arrays. This showed that the prototypes are faithful copies of upstream, and that the Supra Endura oddity reported by the Chromogen analysis is upstream's own.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Verify the reports' claims, and the "Supra Endura duplicating others' data" oddity named in the brief.

### What I did
- Wrote and ran `upstream_vs_cg.py` (args: upstream profile directory, Chromogen `cg/stocks`, Filmbench blob). It compares arrays and lists pairwise-identical arrays.
- Wrote and ran `model_check.py`: Filmbench `model` against upstream `density_curves_model`; Portra 400 `midscale_neutral_density` nulls; sublayer sum against curve; Endura null rows.
- Wrote and ran `thkg3.py`: a 3,400 K blackbody times Schott KG3 resampled *linearly*, compared with Filmbench's TH-KG3.
- Ran a one-liner over `kodak_portra_400.json` for curve minima.

### Why
- The cross-check tolerances against upstream, and the `knownIssues` list in the manifest, both need measured evidence.

### What worked
- `upstream versions: {...'0.3.2'} created {'2026-05-28'}`. Every shared stock and array matched with `(5e-06, 0)`: maximum difference 5 × 10⁻⁶ and no null-pattern mismatch.
- `filmbench model vs upstream density_curves_model max |d|: 4.997826722474841e-07`.
- `endura chan null rows nm: [380 ... 400, 700 ... 780]`; `portra400 midscale_neutral_density nulls: 20`.
- TH-KG3: `max rel diff ... 0.0014 at 735`, `median rel diff 0.00026`.
- Curve minima: `0 min -0.000731...`, `1 min -0.000652...`, `2 min -0.000693...` (the guide quotes "about −0.0007").
- Shared arrays: Supra Endura's `log_sensitivity` equals Portra Endura's, and its `base_density` equals Crystal Archive Type II's. Portra 800 Push 1 and Push 2 share all spectra with Portra 800.

### What didn't work
- No failures. TH-KG3 does not match exactly under linear interpolation (0.14 %). I attributed the residual to upstream's Akima resampling (`utils/io.py` lines 374–387) and set the guide's TH-KG3 tolerance to 2 × 10⁻³ unless Akima is reproduced.

### What I learned
- The Supra Endura duplication is upstream data, so the exporter must reproduce it and list it in `knownIssues`, not repair it.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The Akima attribution is inferred from the code path, not proven by reproducing Akima.

### What should be done in the future
- In the exporter tests, check TH-KG3 with `scipy.interpolate.Akima1DInterpolator` to 10⁻⁴.

### Code review instructions
- Scripts are in `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/`: `upstream_vs_cg.py`, `model_check.py`, `thkg3.py`.

### Technical details
- Sublayer sum at index 128: (0.95561, 0.96088, 1.17197) against curve (0.9538, 0.9573, 1.1743). The sum is only approximate, as the guide says.

## Step 7: Measured the effect of the missing-data convention

This is the experiment behind guide Section 6. I recomputed the textbook's grey-card result under both NaN conventions, then extended it to every film and print pair in the Filmbench data. The recomputation reproduced the textbook exactly under the opaque reading, and showed the table is wrong by tens of CC under the zero-density reading.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** The brief's stage 3, "spektrafilm reads missing values as opaque; Chromogen reads them as zero density. The neutral filter table is only valid with 'opaque'", called for evidence.

### What I did
- Wrote `nan_effect.py`. It takes the Portra 400 grey card's dyes, Filmbench's TH-KG3 and dichroics, the neutral pack (0, 51.57, 52.53) and Endura's sensitivities, computes paper log exposure per layer under each convention, and checks the Filmbench dichroics against the `custom` erf formula.
- Read `filming.py` lines 125–150 (mid-grey at rgb 0.184, no DIR) and `printing.py` lines 102–124 (geometric-mean normalisation) to match spektrafilm's normalisation.
- Wrote `neutral_law.py` to repeat the computation for all 128 negative × print pairs that have a table entry.

### Why
- One convention moves the red layer by 0.18 log H. The size of that effect justifies making the policy a loader decision, with validity masks.

### What worked
- `max |filmbench dichroic - spektrafilm custom erf| = 4.776313188474893e-07`.
- `opaque log10 raw per paper layer (R,G,B): [0.0749, 0.0766, 0.0624]`; `zero ...: [0.2889, 0.106, 0.14]`. After mean removal these give (0.004, 0.005, −0.009) and (0.111, −0.072, −0.038).
- `share of lamp x red sensitivity at >=705 nm (no filters): 0.268`; `share of filtered-lamp x red sensitivity at >=705 nm: 0.313`.
- `opaque pairs 128 median spread 0.0322 max 0.1882 worst ('kodak_portra_800_push2', 'kodak_2393', ...)`; `zero pairs 128 median spread 0.5198 max 1.1698 worst ('kodak_ektar_100', 'kodak_2393', ...)`.

### What didn't work
- No failures.

### What I learned
- The textbook's "27 %" is the *unfiltered* lamp × red sensitivity share (0.268). With the neutral filters applied it is 0.313. The guide uses 0.268 and labels it.

### What was tricky to build
- Matching spektrafilm's normalisation: mean removal across the three layers of log exposure (geometric mean), with the mid-grey dyes read from the curves at log H 0 and without DIR coupling.

### What warrants a second pair of eyes
- The 128-pair law threshold of ≤ 0.06 log H median spread. I set it at about twice the measured 0.032; it is a judgement, not a derived bound.

### What should be done in the future
- Turn `neutral_law.py` into the guide's "Neutral pack balance" property test, and have it run both policies.

### Code review instructions
- `python3 -I nan_effect.py <FB blob> <cg dir>` and `python3 -I neutral_law.py <FB blob>`, run from the scratchpad guides directory; the scripts take their inputs as arguments.

### Technical details
- One printer point = 0.025 log H, so the zero-density red error of 0.18 log H is about seven points.

## Step 8: Licensing and external datasets

I read the spektrafilm data licence and the CC BY-SA legal text, then looked up the licences of the external datasets the brief named: Jiang et al.'s 28 cameras, Butcher's measurements and the CIE functions. The outcome was the ShareAlike analysis and the decision to keep BY-SA and BY-NC-SA data in separate packs.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Brief stage 6: "The stock data is CC BY-SA 4.0. Explain the ShareAlike implications for shipping data packs and derived tables." Brief stage 4: measured cameras.

### What I did
- Read `SPEKTRAFILM_LICENSE.txt` lines 1–200, plus `grep -n` for "ShareAlike", "Downstream recipients", "No downstream restrictions" and "Adapter's License" (lines 206, 272, 280, 286, 368–378). Read the README licence paragraphs (lines 40–60 and 415–440).
- Web: searched for the Jiang et al. database and fetched `https://zenodo.org/records/3245883`. Searched for the CIE CMF licence and fetched `https://cie.co.at/datatable/cie-1931-colour-matching-functions-2-degree-observer` and `https://cie.co.at/publications/open-access-datasets`. Searched for Butcher's ssf-data.
- `timeout 60 git clone --depth 1 https://github.com/butcherg/ssf-data.git` into the scratchpad; read README.md; listed the `spectroscope` and `openfilmtools` folders; read the headers of `Nikon/Z6/spectroscope/Nikon_Z6_ssf.csv` and its README.
- Grepped C1 for `measured.json`, `Butcher` and `Jiang` to find the measured cameras the textbook mentions.

### Why
- Whether derived tables carry ShareAlike decides what may ship, and an NC dataset cannot be merged with BY-SA data.

### What worked
- Zenodo: "Camera Spectral Sensitivity Database - Jiang et al. (2013)", licence "Creative Commons Attribution Non Commercial Share Alike 4.0 International", files `camspec_database.txt` (24.5 kB), 400–720 nm in 10 nm steps.
- Butcher CSV header: `#License:Creative Commons BY-NC-SA 4.0`, `DatasetRangeIntervalNM: 400,715,5`. The spectroscope folders are Nikon D50, D3500, D7000 and Z6.
- CIE: DOI 10.25039/CIE.DS.xvudnb9b; "The page doesn't state a license or terms of use for the dataset."
- C1 grep: only the illustrative `cameras/generic-bayer.json` and `lights/white-led.json` exist ("Not a measured camera", "Not a measured product").

### What didn't work
- `WebFetch https://files.cie.co.at/CIE_xyz_1931_2deg.csv_metadata.json` returned `The server returned HTTP 404 Not Found.`, and so did `.../CIE_lms_cf_2deg.csv_metadata.json`. I fell back on the dataset page and the open-access page, neither of which states a licence.
- `cat ssf-data/LICENSE* ...` in zsh gave `(eval):1: no matches found: ssf-data/LICENSE*`. The repository has no LICENSE file; the licence is stated per dataset in the CSV and README headers.
- `grep -rl "measured.json\|Butcher\|Jiang" --include=*.md ...` gave `(eval):1: no matches found: --include=*.md` (zsh glob). The second part of the command still ran and found the textbook mentions; a follow-up grep without `--include` covered `st-data` and the textbook sketches.

### What I learned
- The textbook's `data/cameras/measured.json` is not in the imported Studio bundle, so this stage has to fetch the measurements from Zenodo and ssf-data.
- Butcher's repository also re-hosts camspec and third-party sets, so the guide says to take only his four spectroscope measurements.

### What was tricky to build
- Separating the two licence questions: the GPL question (ported code) and the CC BY-SA question (data and derived tables). Section 12 of the guide keeps them apart.

### What warrants a second pair of eyes
- The licensing section is an engineering reading, not legal advice. The owner's list (Section 12.4) must be decided by the owner.

### What should be done in the future
- Ask hanatos about the table's licence and the CIE about its data; decide on NC packs if the project is ever commercial.

### Code review instructions
- Compare guide Section 12.2 against `SPEKTRAFILM_LICENSE.txt` §3(a), §3(b)(1)–(3), §2(a)(5)(c) and §4.

### Technical details
- No personal or project-identifying data was sent in web requests; queries named only public datasets.

## Step 9: Inputs for the synthetic frames and the illustrative pack

The synthetic frames need named patch spectra, scanner parameters and the upstream regression cases. I pulled the sigmoid coefficients of the running example's patches from the textbook's sketch data, measured the illustrative camera and LED from Chromogen's files, and read upstream's regression baselines.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Brief stage 5, synthetic frames with known truth (Chromogen's `data.js` design).

### What I did
- Inspected `C1/various/extracted/colour-negative/00-hb-data.json` and `light-film-paper/00-book-data.json` (keys, sketch names), then extracted `PRESETS` from sketch `01-spectra-and-density/sigmoid-upsampler`.
- Ran `python3 -I -c` over `st-data/cg/cameras/generic-bayer.json` and `lights/white-led.json` for peak, approximate FWHM and LED samples.
- Listed `tests/baselines` and read `tests/regression_baselines.py` lines 1–60 and `pyproject.toml` lines 15–32.

### Why
- The generator must use spektrafilm plus an independent numpy scanner model, so that a shared mistake in the TypeScript engines cannot pass. The truth values must come from the textbook.

### What worked
- `PRESETS = { skin: [1.742, 0.029, -0.944], foliage: [-17.641, 15.066, -4.062], sky: [2.270, -3.410, 0.238]`.
- `R peak 600.0 ... FWHM approx 80.0`, `G peak 535.0 ... 90.0`, `B peak 460.0 ... 70.0`; LED samples from 380 to 780 nm.
- Upstream dependencies include `numpy~=2.4`, `scipy~=1.17`, `colour-science~=0.4.6`, `numba~=0.64`, `OpenImageIO~=3.1.11`, `pyfftw`, `rawpy`, `exiv2` and `lensfunpy`. The baselines are 5 `.npz` cases, imported through `from .conftest import make_fast_test_params`.

### What didn't work
- No failures.

### What I learned
- The stored baselines depend on `make_fast_test_params`, so the guide records those parameters next to the converted fixtures.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The heavy native dependencies (`OpenImageIO`, `pyfftw`, `lensfunpy`) may block `import spektrafilm`. The guide's fallback is to import submodules only.

### What should be done in the future
- Try `uv` installs of the pinned upstream early in Stage 1.

### Code review instructions
- Compare the guide's Section 11.2 table with textbook §2.4 (halation edge), §3.5 (noise σ) and §3.7 (flare wedge).

### Technical details
- Noise σ for the Gold 200 rebate: (0.0090, 0.0069, 0.0122) D (`st-data/book/10-ch10.md` line 61).

## Step 10: Drafted the CHB-004 guide

I wrote the full first draft in one pass. Its 18 sections run from background, system fit and upstream facts through the prototypes, the missing-data decision, pack format, loader API, exporter, cameras, synthetic frames and licensing, to a traced flow, plan, tests, contract additions, risks and references.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Draft completely before reviewing, per the writing guide's two-pass procedure.

### What I did
- `Write` `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb004-draft.md` (73,485 characters).

### Why
- The brief forbids writing into the ticket, so the draft lived in the scratchpad.

### What worked
- Every number in the draft came from Steps 3–9.

### What didn't work
- No tool failures. The review in Step 11 found content errors.

### What I learned
- N/A.

### What was tricky to build
- Keeping current behaviour (the prototypes), the proposed design and open decisions visibly distinct; the guide uses decision records for the convention, the container and the precision.

### What warrants a second pair of eyes
- The proposed contract additions in Section 16 (`FrameRecipe.data`, `ArgSpec.valuesFrom`, `TableKey` content hashes, diagnostic codes) need CHB-002's agreement.

### What should be done in the future
- N/A.

### Code review instructions
- Read the guide top to bottom as an intern would.

### Technical details
- Decisions: keep NaN in packs, with the loader applying `opaque | zero-density | extend-flat` and returning validity masks; safetensors plus JSON sidecars; F64 per stock and F16 for the hanatos table.

## Step 11: Review pass and revision

I reread the whole draft in sections, as the intern would, re-verified the cited line ranges against the upstream checkout, and applied the corrections with scripted, asserted replacements.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** The second pass of the writing procedure.

### What I did
- Read `chb004-draft.md` in ranges 1–120, 120–250, 249–369, 368–508, 507–597, 596–676 and 675–755.
- Re-verified line ranges with `grep -n` in `runtime/stages/printing.py` (`_compute_exposure_factor_midgray` at 102, `return 1 / raw_midgray_geomean` at 124), `color_filters.py` (`apply` 47–49, `apply_cc` 53) and `spectral_upsampling.py` (window normalisation 360–368).
- Read `params_builder.py` lines 75–100 and 145–160 to confirm the signatures of `digest_params(params, apply_stocks_specifics=True)` and `init_params`.
- Applied three revision scripts (`python3 -I -` heredocs with `assert s.count(a)>=1` before each replacement), each of which printed `ok`.

### Why
- Several line references in the first draft had been taken from reads of neighbouring ranges and were off by a few lines.

### What worked
- First script: `printing.py` 98–124 → 102–124. The base-gap statement was made precise (Vision3 250D/200T/500T only below 400 nm; slides and papers have no base gaps). The grey-card dyes are now explained as curves read at log H 0. I added `presets/grain.json` next to the halation preset, and a paragraph on CC BY-SA §4 ("Sui Generis Database Rights").
- Second script: added the typed `PackManifest` interface and a "How it is used" paragraph for the loader (Section 8).
- Third script: "three more items" became "four more items" for CHB-012. Window normalisation 359–367 → 360–368; `filming.py` 125–145 → 125–150; Endura dye nulls stated. First-person "I recomputed/I compared" became neutral provenance sentences. The interim-filmbench manifest field `missingFidelity: 'opaque-only'` was replaced by `missing.supported: ['opaque']`, to match the manifest schema. The synthetic sets went from five to six (adding `neutral-wedge`), with "class masks" instead of a class map. The `grey-ramps` truth now names the stored outputs. The TH-KG3 fallback tolerance was relaxed from 10⁻⁶ to 10⁻⁴, because Filmbench stores 5 decimals.

### What didn't work
- No tool failures.

### What I learned
- N/A.

### What was tricky to build
- The scripted replacements had to match the draft text exactly; the asserts made any miss fail loudly instead of silently leaving old text.

### What warrants a second pair of eyes
- The DIR `'applied'` against `'schema-default'` distinction (guide Section 8). It depends on reading `digest_params` correctly.

### What should be done in the future
- N/A.

### Code review instructions
- Diff the final `chb004-draft.md` against the guide text in the hand-back. They are identical apart from the fix in Step 12.

### Technical details
- Final length: 10,915 words (`wc -w`).

## Step 12: Final checks, assembly and hand-back

After the context was compacted, I ran mechanical checks on the Markdown, verified that every RELATED path exists, wrote the TASKS and RELATED blocks, assembled the output and handed it back. While reading the assembled text I found and fixed one wrong file reference.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Orchestrator message (not the user's words):** "Wrap up now. The user wants to move on, and good enough is fine. Skip any further research or revision passes and return your current CHB-004 and CHB-014 guides immediately, in the brief's block format (GUIDE, TASKS and RELATED blocks for each ticket)." Later, a second message asked for these diaries.

### What I did
- Fence and raw-HTML lint: an `awk`/`grep` one-liner, then `lint_md.py` (fence tags, fence balance, HTML-like tags outside code and inline code).
- Path check with `[ -e "$C1/$p" ]` for all 13 related files.
- Wrote `tasks004.txt` (16 tasks across stages 1–6) and `related004.txt` (8 paths), then assembled `final-output.md` with the block markers.
- `sed -i` replaced "as Chromogen refuses one (`stock.js` line 447)" with "(`05-inline.js` line 447)" in both `chb004-draft.md` and `final-output.md`.
- Called `SubagentHandback` with the summary and the six blocks.

### Why
- The PDF renderer needs tagged fences and no raw HTML, and RELATED must list only existing files.

### What worked
- `chb004-draft.md fences 22 balanced`, with no raw HTML outside code. All 13 paths printed `OK`. `grep -c '05-inline.js` line 447'` gave 2 in `final-output.md`.

### What didn't work
- The first lint one-liner exited 1: `Exit code 1`. The cause was the trailing `grep -n '^=====' $f`, which found no matches as expected. Its HTML-like hits (`Promise<StockData>` and similar) were all inside code blocks, which `lint_md.py` then confirmed.
- Reading the diary skill with `cat ...; echo ======; ...` failed under zsh: `(eval):1: ===== not found` (zsh treats `=====` as `=command` expansion). I re-ran it with `echo '-----'`.

### What I learned
- In this zsh environment, separators like `=====` and unquoted globs such as `--include=*.py` must be quoted.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- The orchestrator stores the guide and diary in the ticket; this agent may not write there.

### Code review instructions
- `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/final-output.md` holds the handed-back blocks.

### Technical details
- The scratchpad drafts are at `.../scratchpad/guides/chb004-draft.md` and `.../scratchpad/guides/chb014-draft.md`.

## Step 13: Implementation start: upstream clone, exporter venv and the stage-1 exporter

Implementation of CHB-004 began in the worktree branch `task/chb-004-data`. I cloned upstream spektrafilm outside the repository, built a minimal Python environment for the exporter, read the upstream modules the exporter imports, and wrote `tools/spektrafilm-export`. It writes four packs into `packages/data/packs/` (the spektrafilm pack, two interim packs from the CHB-001 extracts, and the illustrative camera and lights), converts the five upstream regression baselines, and cross-checks the result against the prototypes. All cross-checks pass with the tolerances of guide §5.3.

### Prompt Context
**User prompt (verbatim):** not available to this agent; the work was assigned by the orchestrator.
**Orchestrator brief (not the user's words), opening lines verbatim:** "You implement ticket CHB-004 (stock and reference data pipeline from spektrafilm) in the chromobench monorepo, in your own git worktree." Ticket notes in the brief, verbatim excerpt: "The user has explicitly approved cloning upstream spektrafilm and creating a Python virtual environment for the exporter. Clone OUTSIDE the repository, at /home/manuel/code/wesen/chromobench-ext/spektrafilm, and check out the pinned commit from the guide (3bb2c2d). [...] Install only what the exporter actually needs [...] Do not run upstream code you have not read". The brief also asks that packs plus a TypeScript loader implement core's `PhysicsData`, that the interim provider keeps working, that `packages/gpu` is not touched, and that packs over ~5 MB are generated on demand.
**Assistant interpretation:** Stage 1 (exporter) and stage 2 (pack format, loader, interim packs) solidly, then the missing-data laws, then as much of stages 4–6 as time allows, with a TypeScript `PhysicsData` adapter for CHB-003.
**Inferred user intent:** CHB-003 and CHB-005 can switch from the interim JSON to verified, hashed packs by changing one import.
**Commit (code):** the first commit on the branch, "CHB-004: spektrafilm exporter, four data packs and converted regression baselines" (hash in Step 14).

### What I did
- `git checkout -b task/chb-004-data`; `pnpm install --frozen-lockfile --offline`; baseline `pnpm test`: 32 files, 1829 tests passed.
- `git clone https://github.com/andreavolpato/spektrafilm.git /home/manuel/code/wesen/chromobench-ext/spektrafilm`, then `git -C <abs path> checkout 3bb2c2d` → HEAD `3bb2c2d2801ff68b92019cf1dbcbb133d60832bc` ("fix: vlog midgray exposure"); the clone is 148 MB.
- `uv venv --python 3.13 /home/manuel/code/wesen/chromobench-ext/venv`; installed numpy 2.5.4, scipy 1.18.1, colour-science 0.4.7, opt-einsum 3.4.0, safetensors 0.8.0, pytest 9.2.0, then matplotlib 3.11.2 and numba 0.68.1 (with llvmlite 0.50.0). The frozen list is `tools/spektrafilm-export/requirements.lock`.
- Not installed, because nothing the exporter calls needs them: OpenImageIO, exiv2, rawpy, lensfunpy, pyfftw, scikit-image, pyside6, napari, qtpy, pyconify, markdown.
- Read before running: `src/spektrafilm/__init__.py`, `config.py`, `profiles/io.py` (all), `model/illuminants.py`, `model/color_filters.py`, `model/stocks.py`, `utils/io.py` (header and 300–402), `runtime/params_builder.py`, `runtime/params_schema.py`, `model/couplers.py` 1–80, `utils/spectral_upsampling.py` 1–140 and 250–425, `model/density_curves.py` 1–60, `runtime/stages/printing.py` 60–123, `runtime/stages/filming.py` 90–150, `tests/regression_baselines.py`, `tests/conftest.py`. Grepped the module-level statements of `gamut_compression.py`, `morph_curves.py`, `fast_gaussian_filter.py`, `fast_interp.py` and `fast_interp_lut.py`, and grepped all imported modules for `subprocess|os.system|urllib|requests|socket|eval(|exec(|pickle` (no hits).
- Wrote `tools/spektrafilm-export/`: the `sfx.py` launcher; `spektrafilm_export/{upstream,packwriter,spektrafilm_pack,baselines,interim,illustrative,crosscheck,verify,cli}.py`; tests `tests/{conftest,test_packwriter,test_export,test_interim}.py`; `pyproject.toml`; `LICENSE` (GPLv3 text copied from upstream); `.gitignore`.
- Ran `/home/manuel/code/wesen/chromobench-ext/venv/bin/python -I tools/spektrafilm-export/sfx.py all --upstream /home/manuel/code/wesen/chromobench-ext/spektrafilm` (export, baselines, interim, illustrative, crosscheck, verify).
- Tests: `SPEKTRAFILM_CHECKOUT=/home/manuel/code/wesen/chromobench-ext/spektrafilm /home/manuel/code/wesen/chromobench-ext/venv/bin/python -I -m pytest -q -p no:cacheprovider tools/spektrafilm-export/tests` → `13 passed in 1.75s`.

### Why
- `import spektrafilm.<anything>` runs `spektrafilm/__init__.py`, which imports the whole simulator, rawpy, OpenImageIO and exiv2. So importing "only submodules" (guide §9.3) is not enough on its own. `upstream.py` registers `spektrafilm`, `spektrafilm.runtime` and `spektrafilm.utils` as bare packages, so their `__init__` files never run.
- The guide's principle "ask spektrafilm, do not re-derive" holds. The arrays come from `load_profile`, `standard_illuminant`, `DichroicFilters`, `read_neutral_print_filters`, `digest_params(init_params(...))` with `compute_dir_couplers_matrix`, the dataclass defaults, and the shipped `.npy`.

### What worked
- Pack `spektrafilm@0.3.2+3bb2c2d`: 28 stocks (20 films, 8 prints), 50 items, 67 files. The committed size is about 1.2 MB (`du -sb`: stocks 1,084,509 B, other files 115,287 B). The hanatos table is 5,972,304 B, so it is on demand: its manifest entry has an `onDemand` hint, and `packages/data/.gitignore` ignores `packs/*/upsampling/`.
- The shipped `irradiance_xy_tc.npy` header is `{'descr': '<f2', 'fortran_order': False, 'shape': (192, 192, 81)}`. This resolves the task "check the shipped irradiance_xy_tc.npy size": it is 192 × 192 × 81. The `lut_size=128` default only applies when the table is regenerated.
- The missing rows reproduce the guide: Portra 400 base `[380, 395, 705, 780]` and dyes `[380, 380, 750, 780]`. Vision3 250D, 200T and 500T have base gaps only below 400 nm; slides and print materials have no base gaps.
- The pairwise comparison found these known issues: Supra Endura's log sensitivity equals Portra Endura's; Supra Endura's base equals Crystal Archive Type II's; Portra 800, push 1 and push 2 share sensitivities, dyes, base and midscale neutral. Upstream's `# problematic` comment on `kodak_ultra_endura` is also recorded.
- DIR matrices: applied for Portra 400 `[[0.336, 0.353, 0.302], [0.154, 0.319, 0.353], [0.168, 0.226, 0.273]]`; schema default `[[0.341, 0.355, 0.305], [0.154, 0.324, 0.358], [0.171, 0.225, 0.273]]`; the Velvia override starts `[[0.108, 0.108, 0.054], ...]`.
- Cross-check (`sfx.py crosscheck --pack 'spektrafilm@0.3.2+3bb2c2d'`):
  - Chromogen, 11 stocks: max diff 4.9998e-6 (tolerance 5e-6), identical null patterns.
  - Filmbench, 28 stocks: logSens 4.99996e-5, curves 4.9998e-5, chan and base outside nanRows ≤ 4.9985e-6, curve models 4.998e-7. For all 28, nanRows equals the union of missing base and dye rows.
  - Filmbench reference data: neutral table identical, custom dichroics 4.78e-7, illuminants ≤ 4.99e-7, CMF 4.90e-7.
- Grey card, normalised paper log H: opaque (0.0039, 0.0047, −0.0086), zero-density (0.1110, −0.0729, −0.0381). The guide has (0.004, 0.005, −0.009) and (0.111, −0.072, −0.038).
- Balance law over 128 pairs of a negative film and a print material: opaque median 0.0324, max 0.188 (2393 / Portra 800 push 2).
- Determinism: a fresh export in the pytest process reproduces the committed `manifest.json` byte for byte. The round trip is bit-exact (`tobytes()` equality, NaN included) for every tensor of all 28 profiles and for the curve models.

### What didn't work
- The first export failed inside colour-science: `RuntimeError: OpenImageIO.__path__ is not available: the exporter stubs OpenImageIO because it only reads data and never decodes or writes images` (raised from `colour/io/image.py` line 116, `from OpenImageIO import ImageSpec`). My global stub made colour-science believe OpenImageIO was installed. Fix: the stand-ins exist only while `spektrafilm.utils.io` is imported, and are then removed from `sys.modules`.
- The determinism tests failed: `AssertionError: interim-chromogen@1 ... At index 558 diff: b'b' != b'9'`. The `safetensors` package keeps `__metadata__` in a hash map, so the header's key order changes between processes (an earlier single-key probe had looked deterministic). Fix: `packwriter.st_save`, a 25-line deterministic writer (sorted names and metadata keys, header padded to 8-byte alignment). The `safetensors` package stays as the reference reader in the tests.
- The illustrative camera differed from Chromogen's by 1.085e-5, above the 6e-6 tolerance. Cause: FWHM→σ with the exact 2√(2 ln 2) = 2.35482, while the prototypes (and core's `gaussian()`) use 2.3548. With 2.3548: camera 4.96e-6, white LED 4.81e-6.
- The harness refused `git -C spektrafilm checkout` (relative path) and multi-command heredoc shells. I re-ran with absolute paths and wrote scripts with the Write tool.

### What I learned
- The guide's zero-density balance figures (median 0.52, worst 1.17 on 2393) come from Filmbench data, where the dye rows marked missing had been zeroed. On upstream data, where those dye values are real, zero-density gives median 0.205 and max 0.529 (Crystal Archive / Ektar 100). Recomputed on `interim-filmbench@1`: median 0.5175, max 1.169 (2393 / Ektar 100). Both fail the ≤ 0.06 law, which is all the law needs; the cross-check reports both.
- The illustrative white LED is 0.45 · Gaussian(450 nm, FWHM 22) plus an asymmetric Gaussian at 565 nm (σ 45 nm below, 70 nm above), normalised to peak 1 (least-squares fit, residual 5.4e-6). The camera is exactly Gaussian at 600, 535 and 460 nm with FWHM 80, 90 and 70 nm.

### What was tricky to build
- Keeping upstream's import graph small without editing upstream: bare package modules plus temporary stubs, the checkout appended (not prepended) to `sys.path`, and every run under `python -I`.

### What warrants a second pair of eyes
- `upstream.load` refuses a dirty or unpinned checkout. It shells out to `git -C <checkout> rev-parse HEAD` and `git status --porcelain`.
- The licence of `illustrative@1` is `LicenseRef-chromobench-illustrative` until the owner decides (guide §12.4).

### What should be done in the future
- Measured cameras (stage 4) and synthetic frames (stage 5) are not started.

### Code review instructions
- Start with `tools/spektrafilm-export/spektrafilm_export/spektrafilm_pack.py` (`export`), then `packwriter.py` (`st_save`, `content_hash`, `PackWriter.finish`), `upstream.py` and `crosscheck.py`.
- Re-run with the venv python: `python -I tools/spektrafilm-export/sfx.py all --upstream <checkout>`; afterwards `git status` must show no changes. Then run the pytest command above.

### Technical details
- Pack id `<source>@<profile version>+<commit7>`. packHash = sha256 of the `manifest.json` bytes. File hashes are in `manifest.files`. An item's `contentHash` = sha256 of the canonical JSON of its meaning without licence keys, followed by its tensor bytes in name order.
- Interim packs: `interim-chromogen@1` (11 stocks, all policies) and `interim-filmbench@1` (28 stocks, `missing.supported: ['opaque']`, curve models, neutral table under `TH-KG3`, custom dichroics, 6 illuminants, CMF, `film_exposure_lut64_log2` 64 × 64 × 3).
