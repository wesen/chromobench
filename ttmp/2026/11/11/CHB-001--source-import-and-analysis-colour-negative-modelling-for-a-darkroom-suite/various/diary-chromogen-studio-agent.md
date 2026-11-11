---
Title: "Diary: Chromogen Studio 1.2 reverse-engineering (CHB-001)"
Ticket: CHB-001
Status: active
Topics:
    - color-science
    - film-emulation
    - image-pipeline
    - js-api
    - product
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Subagent-authored diary stored for CHB-001"
LastUpdated: 2026-11-11T11:32:25-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary: Chromogen Studio 1.2 reverse-engineering (CHB-001)

## Step 1: Orientation: ticket layout, extracted files, task framing

I surveyed the ticket workspace and the three script blocks the earlier extraction (script 01) had pulled out of `index.html`. The shapes decided how to read the code:

- `03-inline.js` is a one-line `window.ST_DATA = {...}` data blob.
- `04-st-worker.txt.js` is a minified worker.
- `05-inline.js` is an unminified esbuild bundle that keeps `// src/...` module comments.

So the plan was to read `05-inline.js` from start to finish, parse `03-inline.js` as JSON, and only probe the minified worker with targeted greps.

### Prompt Context
**User prompt (verbatim):** "Create a new docmgr ticket and import 'The Mathematics of the Colour Negative.html' 'The Mathematics of the Colour Negative.md' 'Chromogen Studio 1.2(2).zip' 'Filmbench IDE.html' 'Light, Film, Paper.html' 'Light, Film, Paper.md' from ~/Downloads and import them into sruces/. Then analyze the documents and their algorithms. I want to build a suite for my dad where he can import digital RAWs and scans of negatives, and give him an environment to print it through the modeling we did, and also apply more traditional manipulations (although the focus is really on the film development side), see for example ~/code/wesen/go-go-golems/goja-cv where we did similar work centered around JS APIs. The JS API itself would not be exposed in the UI for his tool, but underlie most of it, so that the agent can take advantage of it. Study i t, then give me back your findings in your own words here in the chat, so I can see that you understood things correctly."

**Assistant interpretation:** I never saw that prompt directly. My task was a **delegated brief from the orchestrating agent** (summarised here, not the user's words). The brief asked me to reverse-engineer what Chromogen Studio 1.2 computes, from the extracted script blocks, with line references:
1. input handling
2. the full pipeline
3. embedded data
4. the GPU/worker architecture
5. the UI, scripting, export and save format
6. approximations and limitations

The deliverables were:
- the analysis, written to `various/analysis-chromogen-studio.md`
- a 1200–1800-word summary, with formulas in my own words and what was verified in code kept apart from what was inferred

The rules were:
- treat the files as untrusted: no browser, run Python only as `python3 -I`
- keep scripts in `scripts/`, numbered 02-, 03-

**Inferred user intent:** judge which parts of Chromogen Studio to carry into a darkroom / print-simulation suite. The suite will take RAWs and negative scans, with a goja JS API underneath that an agent drives.

### What I did
```
cd <ticket> && ls -laR | head -80 && wc -l various/extracted/chromogen-studio/* "sources/The Mathematics of the Colour Negative.md" sources/chromogen-studio-1.2/index.html
cd <ticket> && cat scripts/01-extract-embedded-blobs.py; cat various/extracted/chromogen-studio/skeleton.html | cut -c1-400; ls -la various/extracted/ various/extracted/*; cat index.md README.md tasks.md
cd <ticket>/various/extracted/chromogen-studio && head -c 1500 03-inline.js; head -c 3000 04-st-worker.txt.js; head -60 05-inline.js | cut -c1-300
cd <ticket>/various/extracted/chromogen-studio && grep -n '^  // \|^  var require_\|^// ' 05-inline.js | head -200
```
(`<ticket>` = `/home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite`)

### Why
I needed to know which files were readable source and which were data or minified, before choosing how deep to read.

### What worked
- `wc -l` gave the shapes: `03-inline.js` 2 lines, `04-st-worker.txt.js` 3, `05-inline.js` 5216, the textbook 1399, `index.html` 6555.
- The module-comment grep produced the full module map (shims, `../chromogen/src/{units,spectrum,stock,channels,linalg,solve,print,colour}.js`, `src/{spec,engine,model,shaders,params,decode,source,render,export,state,gpu,accel}.js`, `src/ui/*.jsx`, `src/markdown.js`, `src/main.jsx`).
- The first bytes of `03-inline.js` already showed the stock licence string "Copyright (c) 2026 Andrea Volpato. Licensed under CC BY-SA 4.0."

### What didn't work
N/A

### What I learned
- The app is an esbuild bundle of a separate `chromogen` library plus Studio code.
- The skeleton HTML's meta description says it develops "colour-negative scans into prints: printer lights, paper, film character and finishing operators on the GPU".

### What was tricky to build
N/A

### What warrants a second pair of eyes
N/A

### What should be done in the future
N/A

### Code review instructions
Start with the module map in the report, which comes from the grep above.

### Technical details
`03-inline.js` starts `window.ST_DATA = {"cg":{"stocks/fujifilm_c200.json":"{\"info\":...`. Line 2 of the worker begins with a `process` shim and esbuild's `__commonJS` helpers, minified.

## Step 2: Reading the spectral library (`05-inline.js` 89–932)

I read the fs shim and the eight `chromogen/src` modules in full. This is the physics core:
- the 81-sample grid
- the spectrum kinds
- stock loading
- the channel sets
- the solver
- the printer
- colorimetry

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** I needed points 2 and 3 (pipeline maths, data formats) from the source itself.
**Inferred user intent:** see Step 1.

### What I did
I read `05-inline.js` at offsets 89 (480 lines) and 569 (370 lines) with the Read tool.

### Why
The solve, the forward model and the printer model determine everything downstream.

### What worked
Verified in code:
- `Grid(380,780,5)` gives n = 81 (225–237).
- The **CMFs are an analytic multi-Gaussian fit** (325–337), not CIE tables.
- `daylight` throws "needs the CIE S0, S1, S2 tables, which the prototype does not ship; use blackbody" (365).
- The stock loader refuses any grid other than 380–780/5 (447), turns null dye entries into 0 (450), and makes curves strictly monotone (396).
- `Channels.read` = −log10 Σ P̂ 10^−D with P̂ normalised (496–503); `analytical` gives K (508–511).
- Status M comes from an embedded table (526–538). `apd()` reads `channels/apd.txt` (540).
- The solver (652–787): closed-form Jacobian, LM with Marquardt damping, an active set, start at K⁻¹(d − Dbase), bounds 0–4.
- The printer (827–854): logE = log10 Σ L·10^−D·s + lights; `greyPatch` fits the lights to reach 0.184; points = v/0.025.
- `colour.js`: Bradford, sRGB, Lab, CIEDE2000.

### What didn't work
N/A

### What I learned
`units.js` encodes domain rules as errors. Examples: "a density offset is not a log-exposure shift (Hunt 14.17)", and "densities add; multiply transmittances instead".

### What was tricky to build
N/A

### What warrants a second pair of eyes
The CMF coefficients look like the Wyman–Sloan–Shirley multi-lobe fit. That is my identification [inferred]; I did not compare them numerically.

### What should be done in the future
Port these modules to goja and run them against the textbook's quoted numbers.

### Code review instructions
Read solve.js 652–787, spectrum.js 325–337 and print.js 827–854.

### Technical details
The active-set test (727–735) is: a dye is held when it sits on a bound (x ≤ lo or x ≥ hi) and its gradient points out of the box (g > 0 at lo, g < 0 at hi). The loop stops when the largest free |g| falls below gtol.

## Step 3: Studio spec, model tables and shaders (`05-inline.js` 934–2193)

I read the constants and slider schema, the table builders, all fragment shaders, and the parameter mapping.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** points 2 (the pipeline in order, the finishing operators with their parameters) and 4 (what each shader computes, LUT sizes).
**Inferred user intent:** see Step 1.

### What I did
I read offsets 934 (340 lines), 1273 (345), 1614 (480) and 2093 (330).

### Why
The shaders define the actual per-pixel order. `frameParams` defines how sliders become uniforms.

### What worked
Verified in code:
- `K` constants (950–992), `SECTIONS`, all 34 `SLIDERS` (1003–1597), `SCANNERS`, `FILMS`.
- `model.js`: N3 = 33, N1 = 512; ranges A [−0.25, 2.55], C [0, 2.6], X [−2.5, 2.5], CP [0, 2.7]. The lamp is a 3200 K blackbody (1718). The viewing light is 5000 K plus Bradford to D65 (1763–1787). The fade STAIN spectrum is at 1762. `aim` and `warmPerMired` are at 1810–1840.
- Shaders FS_DYES, FS_PD, FS_BLUR, FS_GF_PREP/AB, FS_PRINT, FS_BLOOMSRC, FS_OUT, FS_VIEW, FS_COPY (1903–2085).
- `frameParams` (2100–2157), `paperX` and `frameStats`.

### What didn't work
N/A

### What I learned
Most "macros" are coordinate changes in paper log H, so they never touch a table. The output order in code is Sharpness → Bloom → OKLab (2055–2072).

### What was tricky to build
Tracing the halation data flow across three places:
1. emit: FS_DYES 1929 writes `vec4(pow(10,x).xy, pow(10,x).xy)` = (E_R, E_G, E_R, E_G);
2. blur: FS_BLUR 1976 applies `kw[i].xxyy`, and `blurKernel` (2970–2982) puts kernel 0 in .x and kernel 1 in .y;
3. consumption: FS_DYES 1933–1934 uses ½(h.x + h.y) for red and ½(h.z + h.w) for green.

Red therefore receives the σ₁ blur of red and green averaged, not the comment's "(E_R σ1, E_R σ2, E_G σ1, E_G σ2)".

### What warrants a second pair of eyes
- **The halation bug** above. Verified by reading only; not executed.
- **The Exposure aside** (1018): `sign(-v / STOP * STOP / PT, 0)` reduces to −v/PT, so the label shows 40 pt per stop. Verified by reading.

### What should be done in the future
Render a white point light with Halation 100 and inspect the R and G channels separately to confirm the halation bug.

### Code review instructions
Read 1918–1945, 1973–1982, 2970–2982 and 3022–3033 together.

### Technical details
Guided-filter packing in FS_GF_PREP is (I, I², I, I²) with `.xxyy` kernels (rL, rM), which is correct. Only halation is mispacked.

## Step 4: Input, source, renderer, export, compute backends, state and UI (`05-inline.js` 2195–5215)

I read the rest of the bundle: decoders, source handling (rebate, flat field, noise), the WebGL2 renderer and tiled export, the file writers, the WebGPU kernels, the worker pool and benchmark, the `Studio` store, and the React UI.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** points 1, 4 and 5.
**Inferred user intent:** see Step 1.

### What I did
I read offsets 2423 (275 lines), 2694 (540), 3230 (380), 3606 (245), 3845 (340), 4185 (335), 4514 (400) and 4914 (305).

### Why
Input formats, rebate estimation, backends, the `st:` scripting links, the recipe format and the exports all live here.

### What worked
Verified in code:
- **Decoders** (2259–2412):
  - the RAW refusal message (2410);
  - CFA DNG refused (2289);
  - `encodedHint` is "srgb" for 16-bit PNG (2387);
  - `maxv = (1 << bits) - 1` (2296).
- **Rebate**: either a picked box, or auto = the 99.7th percentile × 1.02 of the frame (2628–2645).
- **Noise and flat field**: `sigmaD` (2508–2537), the flat-field grid (2453–2499).
- **Sample loader**: (u/16 − 2), floored at 0.05, divided by 4000 (2690).
- **Renderer**: needs WebGL2 and `EXT_color_buffer_float` (2717–2722); global pass (3022–3069); tiled export with an 8-px halo (3180–3227); output shoulder at 0.82 (3117); P3 matrix (3102).
- **WGSL kernels**: SOLVE and SPECTRAL (3409–3519); gtol floored at 1e-6 (3592).
- **Workers**: a pool started from the `st-worker` blob (3631–3644); backend order (3721–3727); benchmark with flips (3796–3842).
- **Studio store**:
  - autosave keyed by frame name (3955, 4204);
  - `st:` verbs (4370–4442);
  - recipe shape (4453–4456);
  - screen-size 16-bit export built from bytes × 257 (4484);
  - saving through `window.claude.use("downloads")` (3356–3387).
- **UI layout and keyboard shortcuts** (4514–5199); the global `window.studio` (5204).

### What didn't work
N/A

### What I learned
- The only "slow path" check in the shipped app is the table benchmark. There is no CPU reference for the per-pixel chain. `printOf` replicates only the macro stage, for the readout and grey pick.
- The app was built to run as a claude.ai hosted artifact (its downloads API).

### What was tricky to build
N/A

### What warrants a second pair of eyes
- The claim that a 32-bit integer TIFF yields NaN or Infinity follows from JS shift semantics (`1 << 32 === 1`). I did not run it.
- The "paper white ≈ 0.957 linear" claim assumes the paper-white XYZ maps to roughly equal RGB, so each channel hits the shoulder about equally [inferred]. The scalar itself was computed in Step 8.

### What should be done in the future
Decode a known 16-bit PNG and a 32-bit integer TIFF in a test harness to confirm both decoder issues.

### Code review instructions
Read 2403–2412, 2628–2645, 3100–3121, 3172–3227 and 4370–4456.

### Technical details
Ring-around moves are mapped back to sliders by least squares onto the Warmth and Tint vectors, plus the mean as Exposure (`lightsToSliders`, 4222–4228).

## Step 5: Unpacking ST_DATA with scripts/02

I wrote `scripts/02-inventory-chromogen-st-data.py` to parse `03-inline.js` as JSON. It strips the `window.ST_DATA =` prefix, so nothing in the blob is executed. The script inventories the data files, the sample metadata and the bundled book, and unpacks them into `various/extracted/chromogen-studio/st-data/`.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** point 3: which stocks, papers and illuminants, how they are stored, and on what grid.
**Inferred user intent:** see Step 1.

### What I did
```
cd <ticket>/various/extracted/chromogen-studio && tail -c 600 03-inline.js; grep -o '"[a-z_]*":{' 03-inline.js | head; grep -o '"stocks/[^"]*"\|"cameras/[^"]*"\|"lights/[^"]*"\|"channels/[^"]*"\|"[a-z]*/[a-z0-9_.-]*\.\(json\|txt\)"' 03-inline.js | sort | uniq
cd /tmp && T=<ticket> && python3 -I $T/scripts/02-inventory-chromogen-st-data.py $T/various/extracted/chromogen-studio/03-inline.js $T/various/extracted/chromogen-studio/st-data
cd <ticket>/various/extracted/chromogen-studio/st-data && ls -R | head -40; python3 -I -c "import json ... print(json.dumps(d['samples'],indent=1))"
```
The last command was an inline one-off that read `../03-inline.js` and printed the sample metadata. It was not saved as a script; see Step 8.

### Why
I needed to know the stock list, the licence, the data shapes, and whether any data was missing.

### What worked
The script 02 output, abridged:
- 13 `cg` files:
  - `cameras/generic-bayer.json` ("Illustrative Bayer camera … Not a measured camera");
  - `lights/white-led.json` ("Illustrative white LED … Not a measured product");
  - 11 stocks.
- Every stock has 81 wavelengths from 380 to 780, `log_exposure` n = 256 over (−3.0, 4.0), and the licence "Copyright (c) 2026 Andrea Volpato. Licensed under CC BY-SA 4.0."
- Null counts in `channel_density`: 22 for the films, 37 for Crystal Archive II, 64 for Portra Endura and Supra Endura.
- Samples: `gold200` is 1292×863, encoding "u16, v = u/16 − 2 (black-subtracted raw counts, 6×6 X-Trans blocks)", film `kodak_gold_200`, scanner `xt5-fitted`, rebate [98,100,20,680], frame [126,60,1090,754], camera "Fujifilm X-T5 (X-Trans), ISO 125, 1/6 s per LED", files DSCF4457–4459.RAF.
- The sample's caveats: "no flat field…", "…FWHM 20 nm assumed".
- The book has 13 chapters (ch0–ch10, perf, ch11), with their `st:` links listed.

### What didn't work
N/A

### What I learned
- `channels/apd.txt` is not among the embedded files, so `apd()` would throw. The Studio never calls it.
- Bundled chapter 10 has an explicit "What is not built yet" list.

### What was tricky to build
N/A

### What warrants a second pair of eyes
The CC BY-SA 4.0 licence on all the stock data matters for the product.

### What should be done in the future
N/A

### Code review instructions
Run script 02 as above. It writes only to the given output directory.

### Technical details
The output directory contains `book/00-ch0.md` … `book/12-ch11.md`, `cg/stocks/*.json`, `cg/cameras/generic-bayer.json` and `cg/lights/white-led.json`.

## Step 6: Worker bundle, bundled book chapters, dead code and constant usage

I confirmed that the minified worker runs the same engine with the same solver options. I read bundled chapters 1 and 10, and part of 5, 6 and 8. I grepped for unused library functions and constants, and for any interlayer-coupling code.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** points 4 and 6.
**Inferred user intent:** see Step 1.

### What I did
```
awk '{print NR": "length($0)}' 04-st-worker.txt.js; grep -o 'onmessage.\{0,1500\}' 04-st-worker.txt.js | head -c 3000; grep -o '"[^"]\{3,60\}"' 04-st-worker.txt.js | sort | uniq -c | sort -rn | head -50
grep -o '.\{80\}activeSet:!0.\{120\}' 04-st-worker.txt.js; grep -o 'var [A-Za-z]\{1,3\}=33[,;].\{200\}' 04-st-worker.txt.js; grep -c 'FINE_RADIUS' 05-inline.js; grep -n 'FINE_RADIUS\|MID_RADIUS\|MASK_RADIUS\|GRAIN_SIGMA\|HAL_RADII' 05-inline.js | cut -c1-160; grep -n -i 'coupl\|interlayer\|inter-layer\|DIR \|interimage\|gamma matrix' 05-inline.js | cut -c1-200 | head
for w in 'developed(' 'parametric(' 'deltaE2000(' 'latd(' '"copy"' 'pass("copy"' 'toSRGB(' 'fromSRGB(' '\.residual(' 'minSingular(' 'Lights2(' 'apd()' 'lookup' 'emitE: 1' 'sigma: false' 'FS_COPY' 'Quantity' 'windowHistogram(' 'variant(' 'chroma(' 'hex('; do printf '%-18s %s\n' "$w" "$(grep -n -F "$w" 05-inline.js | cut -d: -f1 | tr '\n' ' ')"; done
grep -n -i 'todo\|fixme\|not yet\|prototype\|placeholder\|illustrative\|unused\|not supported\|approximat\|hack' 05-inline.js | cut -c1-220; grep -n -i 'not built\|not yet\|approximat\|placeholder\|illustrative\|caveat' st-data/book/*.md | cut -c1-260 | head -40
grep -n '\.maths\|\.chapter\b\|sl\.domain\|sl\.cost\|\.cost\b' 05-inline.js | cut -c1-160 | head; grep -n 'katex' 05-inline.js | cut -c1-120
cd <ticket>/sources/chromogen-studio-1.2 && grep -n -o '<script[^>]*>' index.html | cut -c1-300; grep -n -o '<link[^>]*>' index.html | cut -c1-300; grep -c '' index.html; grep -n -o '<style[^>]*>' index.html
```
I also read `st-data/book/10-ch10.md` and `01-ch1.md` in full, and `05-ch5.md` lines 15–40 and 50–58.

### Why
- To check that the worker is not a different algorithm.
- To separate shipped-but-unused code from active code.
- To get the authors' own list of limitations.

### What worked
- **Worker handler** (line 3): jobs `solve`, `pd` and `print` over node ranges; solver options `br={activeSet:!0,gtol:1e-9}`; `var oe=33`, with the same ranges.
- **`FINE_RADIUS`** appears once, at its definition (976). It is never used.
- **Unused functions:** `developed(`, `parametric(`, `deltaE2000(`, `latd(`, `toSRGB(` and `fromSRGB(` appear only at their definitions; `"copy"` and `pass("copy"` have no hits. So FS_COPY is compiled (2731) but never run.
- **Slider metadata:** `.maths`, `sl.domain` and `sl.cost` are never read by the UI.
- **CDN scripts** in `index.html`: react 18.3.1, react-dom 18.3.1 and KaTeX 0.16.9 from cdnjs (lines 1328–1330). The `st-worker` is a `text/plain` script at line 1334.

### What didn't work
The coupling grep matched only false positives, so the absence of DIR coupling rests on the textbook (Step 7), not on this grep:
```
96:      var isDir = (p) => {
1978:    vec2 d = dir * float(i);
```

### What I learned
The bundled docs give the output order as Bloom → OKLab → Sharpness (ch10 step 12). The code differs. Ch.10 also says "16-bit files" default to linear, which is true only for TIFF.

### What was tricky to build
N/A

### What warrants a second pair of eyes
N/A

### What should be done in the future
N/A

### Code review instructions
Re-run the `for w in …` loop to check the unused-function list.

### Technical details
The TODO/limitation grep found these in code:
- line 365 (daylight not shipped);
- line 1992 ("unused" burn components);
- TIFF and PNG "not supported" errors at 2262, 2290, 2305, 2347, 2352 and 2354.

## Step 7: Cross-referencing the textbook

I mapped Studio features to textbook sections, using the textbook's own statements about the Studio. That covers:
- coupling (§2.3)
- halation (§2.4)
- grain (§2.5)
- grey balance (§3.6)
- calibration (§3.7)
- tables (§4.2)
- GPU, workers and fast-vs-slow checks (§4.4–4.7)

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** the brief asked for cross-references to the textbook's four chapters.
**Inferred user intent:** see Step 1.

### What I did
```
cd <ticket>/sources && grep -n '^#' "The Mathematics of the Colour Negative.md" | head -120
sed -n 439,530p "The Mathematics of the Colour Negative.md"
grep -n -o '.\{0,200\}Studio.\{0,250\}' "The Mathematics of the Colour Negative.md" | cut -c1-520      # failed, see below
python3 -I -c "<print ±220/260 chars around each 'Studio' match>" | head -120                         # inline one-off, not saved
sed -n 1194,1300p "The Mathematics of the Colour Negative.md" | cut -c1-1500
sed -n 1087,1100p ... | cut -c1-1200; sed -n 917,948p ... | cut -c1-900
grep -n -i -c 'calibrat\|sigmoid(' various/extracted/chromogen-studio/05-inline.js; grep -n 'sigmoid(\|calibrat' ...; sed -n 949,964p "sources/The Mathematics of the Colour Negative.md" | cut -c1-700
```

### Why
The textbook documents this exact code and reports measurements from test scripts that are not in the HTML.

### What worked
- §2.3 states "Chromogen has no DIR model: `pipe.uncouple` is the identity with a warning".
- §4.7 lists the external checks: workers bitwise equal, GPU solve within 2.15e-6 with 0 flips, tiled export within 1 level.
- §4.2 confirms the three 33³ tables and their ranges.
- `calibrat` has no hits in `05-inline.js`; `sigmoid(` appears only at its definition (317) and in `fromSpec` (371). So the Studio has no calibration step and no spectral upsampling.

### What didn't work
The ugrep context grep failed:
```
$ grep -n -o '.\{0,200\}Studio.\{0,250\}' "The Mathematics of the Colour Negative.md" | cut -c1-520
ugrep: error: error at position 84
xbf][\x80-\xbf]*){0,250}
                        \___exceeds complexity limits
```
I replaced it with an inline `python3 -I -c` passage printer. That worked, but ended with a harmless message because the output was piped into `head`:
```
Exception ignored on flushing sys.stdout:
BrokenPipeError: [Errno 32] Broken pipe
```

### What I learned
- `grep` in this environment is ugrep, and it rejects large bounded repeats on UTF-8 input.
- The textbook confirms several of my code readings: the halation constants, `GRAIN_SIGMA` on a 24 µm aperture, the flare default of 0.48 %, and integrate-to-grey with α = 0.75.

### What was tricky to build
N/A

### What warrants a second pair of eyes
The textbook's numbers come from scripts I did not see (`m05_classes.mjs`, `studio-bench.cjs`, …). They are [textbook], not [code].

### What should be done in the future
Obtain the Chromogen repository and its tests if a CPU/GPU equivalence suite is needed.

### Code review instructions
Use the Appendix A table in the report.

### Technical details
N/A

## Step 8: Stock-data checks (inline Python first, then scripts/03)

I checked the paper and film data for nulls, peaks, duplicated arrays and neutral slopes, and computed where paper white lands after the output shoulder. I first ran these as inline `python3 -I -` heredocs. That broke the brief's rule to keep scripts in `scripts/`. After the coordinator's follow-up I put them into `scripts/03-check-chromogen-stock-data.py` and re-ran it; the output matched.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** point 3 (data quality) and point 6 (approximations), plus a numeric check of the paper-white claim.
**Inferred user intent:** see Step 1.

### What I did
The original inline runs, not saved:
```
cd <ticket> && python3 -I - <<'EOF'  # null dye ranges, peaks for Endura/CA-II/Gold200/Supra; camera/LED peaks; shoulder value
cd <ticket>/various/extracted/chromogen-studio/st-data/cg/stocks && python3 -I - <<'EOF'  # identical arrays; slope -0.5..0.5; D(0)
```
The consolidated, saved version:
```
cd /tmp && T=<ticket> && python3 -I $T/scripts/03-check-chromogen-stock-data.py $T/various/extracted/chromogen-studio/st-data/cg
```

### Why
- To back the data claims in the report with numbers.
- To follow the brief's rule about where scripts live.

### What worked
Script 03 output, abridged:
- **Identical arrays:** `fujifilm_crystal_archive_typeii == kodak_supra_endura: ['base_density']` and `kodak_portra_endura == kodak_supra_endura: ['log_sensitivity']`.
- **Paper dye nulls:** Portra Endura at (380–400) and (705/700–780); Crystal Archive II at (725–780).
- **Slopes:** films 0.46–0.70 (e.g. Gold 200 [0.536, 0.492, 0.568]); papers 1.574–2.239.
- **Camera peaks:** R 600, G 535, B 460 nm. **White LED peak:** 565 nm.
- **Paper white after the shoulder:** "0.9571 linear, sRGB 0.9809 = 250/255".

### What didn't work
The process: I first ran the checks inline, outside `scripts/`, contrary to the brief. I fixed that by adding script 03.

### What I learned
Supra Endura appears to share sensitivity data with Portra Endura and base data with Crystal Archive II. This may be how the upstream data was built [inferred]; it is worth checking against spektrafilm.

### What was tricky to build
N/A

### What warrants a second pair of eyes
The film slope range in the earlier summary said 0.48–0.70. The minimum per layer in the output is 0.46 (Pro 400H green); the report now says 0.46–0.70.

### What should be done in the future
Compare the duplicated paper arrays with the upstream spektrafilm profiles.

### Code review instructions
Run script 03 as above; it only reads JSON.

### Technical details
The script's shoulder line computes s + (1 − s)·tanh((1 − s)/(1 − s)) with s = 0.82. That assumes each RGB channel of paper white is about 1.0 [inferred].

## Step 9: Writing up and delivery

I wrote the full analysis as markdown for `various/analysis-chromogen-studio.md`. The harness refused the write, so I returned the full document plus a summary through the hand-back. After the coordinator's follow-up I added script 03 (Step 8) and am returning the report and this diary as text, without retrying the file write.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** the brief asked for the analysis file plus a summary. The coordinator later asked for the full report and an investigation diary between markers, and said not to work around write blocks.
**Inferred user intent:** see Step 1.

### What I did
- A Write-tool call to `<ticket>/various/analysis-chromogen-studio.md`.
- First hand-back: the 1200–1800-word summary plus the full document.
- This hand-back: a short summary, the REPORT block (updated to cite script 03, and the film slope range corrected to 0.46–0.70), and this DIARY block.

### Why
The orchestrator stores the documents in the ticket.

### What worked
The hand-back delivery.

### What didn't work
The Write tool refused the analysis file:
```
<\tool_use_error>Subagents should return findings as text, not write report files. Include this content in your final response instead.<\/tool_use_error>
```
I did not retry through Bash or any other route.

### What I learned
Report files must come back as text from subagents in this environment. Scripts and data extractions can still be written.

### What was tricky to build
Keeping the tags (verified / docs / textbook / inferred) consistent across a long document.

### What warrants a second pair of eyes
The bug claims in report §6.3: halation packing, the Exposure aside, paper white, output order, 16-bit PNG hint, 32-bit TIFF, the screen-size 16-bit export and autosave keying. All come from reading the code; none was executed.

### What should be done in the future
- Store the REPORT block as `various/analysis-chromogen-studio.md` and this diary in the ticket.
- Relate scripts 02 and 03 and the `st-data/` directory to the ticket (`docmgr doc relate`).
- If runtime confirmation is wanted, run the Studio in a sandboxed headless browser on the bundled sample.

### Code review instructions
Check the report's line references against `05-inline.js`. Re-run scripts 02 and 03 from the ticket root.

### Technical details
Files created during this work:
- `scripts/02-inventory-chromogen-st-data.py`
- `scripts/03-check-chromogen-stock-data.py`
- `various/extracted/chromogen-studio/st-data/` (`book/`, `cg/`)
