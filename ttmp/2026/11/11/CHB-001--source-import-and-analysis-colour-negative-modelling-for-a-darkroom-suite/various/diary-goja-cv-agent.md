# Diary: goja-cv analysis for CHB-001

## Step 1: Orientation, scoping and delegating the ticket-doc reading

I first had to work out what goja-cv is and how big the job was before reading anything in depth. I read the git
log, the file layout, README.md, AGENT.md and go.mod, and counted lines.

There were about 25k lines of non-test Go and about 23k lines of ticket docs. Reading all of that myself would
have used up my context, so I gave the GCV ticket docs to two helper agents running in parallel. I kept the code
reading for myself, because file:line claims about code needed to be checked first-hand.

### Prompt Context

**User prompt (verbatim):** "Create a new docmgr ticket and import 'The Mathematics of the Colour Negative.html' 'The Mathematics of the Colour Negative.md' 'Chromogen Studio 1.2(2).zip' 'Filmbench IDE.html' 'Light, Film, Paper.html' 'Light, Film, Paper.md' from ~/Downloads and import them into sruces/. Then analyze the documents and their algorithms. I want to build a suite for my dad where he can import digital RAWs and scans of negatives, and give him an environment to print it through the modeling we did, and also apply more traditional manipulations (although the focus is really on the film development side), see for example ~/code/wesen/go-go-golems/goja-cv where we did similar work centered around JS APIs. The JS API itself would not be exposed in the UI for his tool, but underlie most of it, so that the agent can take advantage of it. Study i t, then give me back your findings in your own words here in the chat, so I can see that you understood things correctly."

**Assistant interpretation:** My own task was a brief delegated by the orchestrating agent. These are not the
user's words. In summary, the brief asked me to:

- understand goja-cv (read-only: no edits, commits or pushes) well enough to explain its design and reuse its
  patterns;
- answer five points with file:line evidence:
  1. what it is, its architecture, its backend and how buffers pass between Go and JS;
  2. the JS API surface: modules, the `cv` object, op naming and composition, codecs, lazy vs eager evaluation,
     sessions, handles, saving, sheets, peaks, measure, the model library, prelude, and `--root`/`--read`;
  3. agent ergonomics, from AGENT.md, README and the GCV-001..005 ticket docs, including deviations;
  4. packaging and testing;
  5. what would not transfer to a GUI with GPU or real-time previews;
- write the findings to `…/CHB-001…/various/analysis-goja-cv.md`;
- return a 1200–1800-word summary that separates what was verified in code from what was read in docs.

**Inferred user intent:** The user wants chromobench, a Go core with a hidden goja JS API that an agent can
drive, to reuse what worked in goja-cv. They also want proof that goja-cv was understood correctly before design
starts.

### What I did
- I ran `git log`, a file inventory, `wc -l` on the docs and the Go sources, and read README.md, AGENT.md and
  go.mod.
- I launched two general-purpose helper agents. One covered GCV-001..003 and the other GCV-004..005. Each was
  asked for decisions, workflow, deviations, lessons and GUI/GPU limits, with file:line citations, in about
  1000–1400 words.

### Why
Reading the docs in full would have consumed my context. Code claims needed first-hand verification; doc claims
could be summarised and then spot-checked.

### What worked
The inventory immediately showed the shape of the project:
- `pkg/cv/{buffer,parallel,kernels,graph,ops,look,docs}`
- `pkg/gojamod/cv`
- `pkg/cvsession`
- `pkg/xgoja/providers/cv`
- `cmd/goja-cv`

### What didn't work
N/A in this step.

### What I learned
- The repo has 245 commits from 2026-11-08 to 2026-11-10, mostly agent-authored, at head `5a93095` ("Merge pull
  request #8 … task/root-flag-once").
- The go-go-goja version is pinned to a pseudo-version (go.mod:11).

### What was tricky to build
N/A.

### What warrants a second pair of eyes
The decision to delegate means that most [doc] citations are second-hand (see Step 8).

### What should be done in the future
N/A.

### Code review instructions
Re-run the inventory commands below in `/home/manuel/code/wesen/go-go-golems/goja-cv`.

### Technical details
- `git log --oneline | head -30` → top commit `5a93095 Merge pull request #8 from go-go-golems/task/root-flag-once`.
- `wc -l ttmp/2026/11/09/*/*.md ttmp/2026/11/09/*/*/*.md | sort -n | tail -50` → `22773 total`. The largest files
  are the GCV-004 design doc (2907 lines) and the GCV-005 design doc (2555 lines).
- `find pkg cmd internal -name '*.go' -not -name '*_test.go' | xargs wc -l | sort -n | tail -40` → `24984 total`.
  The largest files are `pkg/cv/graph/args.go` (1331), `decode_tiff.go` (728) and `processor.go` (581).
- `git log --format='%h %ad %s' --date=short | tail -5` → the earliest commits are dated 2026-11-08.
  `git log --oneline | wc -l` → `245`.

## Step 2: Image backend and buffer model (code)

I needed to know whether goja-cv uses OpenCV or pure Go, and how pixels are represented in memory. The answer is
pure Go: planar float32 linear-light buffers, explicit encodings and spaces, an area-averaged pyramid, and
band-parallel loops. The decoders are goja-cv's own, and mosaiced (CFA) raw files are refused.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Point 1 of the brief: the backend and how images and buffers are represented.
**Inferred user intent:** Decide whether goja-cv's engine can be a base for raw and negative processing.

### What I did
- I read `pkg/cv/buffer/buffer.go`, `encoding.go`, `pyramid.go` and `pkg/cv/parallel/parallel.go`.
- I grepped for OpenCV, gocv and cgo.
- I grepped the decoders for DNG, CFA and ICC handling.

### Why
To verify the backend claims in code rather than trusting the README.

### What worked
- `grep -rln 'gocv\|opencv\|import "C"' pkg cmd internal; echo "exit=$?"` → `exit=1`, meaning no matches.
- `grep -rn 'golang.org/x/image' pkg` → only `pkg/cv/buffer/decode_tiff.go:14: "golang.org/x/image/tiff/lzw"`.
- The decoder grep showed:
  - `decode.go:89 SupportedFormats = "PNG (8/16-bit), JPEG, TIFF (…), LinearRaw DNG, NumPy .npy"`;
  - `decoders_test.go:239` expects "CFA (mosaiced) raw data is not supported";
  - `decode.go:29` notes "camera RGB primaries (DNG)".

### What didn't work
My first grep used an unquoted `--include=*.go` under zsh:

```
grep -n 'import\|"github\|gocv\|opencv\|"C"\|cgo' -r pkg cmd internal --include=*.go | …
```

zsh printed `(eval):1: no matches found: --include=*.go`, and did so twice because the command had two greps.
zsh treats the unquoted pattern as a filename glob. I dropped `--include` and grepped the directories directly.

### What I learned
- `Buffer{W,H,C; Pix []float32 (planar); Scale}`; kernels must not mutate their inputs (buffer.go:7-14).
- Encoding (`srgb`/`linear`) and Space (`linear`/`encoded`) are separate concepts, with exact conversion
  functions (encoding.go:10-120).
- The pyramid serves previews from the coarsest level that is still adequate (pyramid.go:11-80).
- `parallel.Rows` uses errgroup with context checks and panic recovery (parallel.go:16-56).

### What was tricky to build
N/A.

### What warrants a second pair of eyes
The claim "no ICC, no camera matrix" rests on grep plus the ticket docs (G1 DD:147-151). I did not read every
decoder line.

### What should be done in the future
If chromobench reuses `buffer`, assess the cost of adding half-float or tiled storage.

### Code review instructions
Read `pkg/cv/buffer/buffer.go:7-70`, `encoding.go:10-120`, `pyramid.go:11-80` and `decode.go:20-90`.

### Technical details
See the commands above.

## Step 3: Graph, registry, ops, workspace and docs topics (code)

This step covered the core: how an op is declared, how nodes are hash-consed and cached, how the space rules and
op classes work, how the workspace sandbox is built, and what the representative JS looks like in the tested docs
topics. I also checked the model task library and whether the GCV-001 "params" still exist.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Point 2 of the brief: ops naming and composition, codecs, lazy evaluation,
sheets, peaks, measure, the model library and sandboxing.
**Inferred user intent:** Find a template for chromobench's op catalog.

### What I did
- Read `pkg/cv/graph/node.go:1-140` and `registry.go:1-340`. For the second half I used the Read tool with an
  offset, after a shell pipeline failed (see below).
- Read `pkg/cv/ops/tone.go:1-80`.
- Outlined `eval.go`, `cache.go`, `engine.go` and `errors.go`.
- Read `workspace.go:1-80`, `ops/funcs.go:15-100` and the doc strings of sheet, peaks, regionmeasure, present and
  composite.
- Read `pkg/cvsession/testdata/scripts/dust/helpers.js` and extracted the JS blocks from three docs topics with
  awk.
- Grepped for `Param` and for "model library".

### Why
`OpDef`/`ArgSpec` is the single source of truth, so it had to be read exactly.

### What worked
- The full `OpDef` and `ArgSpec` field lists (registry.go:149-299).
- The `exposure` and `levels` definitions (tone.go:17-82).
- `EngineOptions` defaults: 2 GiB cache, LookLong 1568, PyramidMinLong 256 (engine.go:12-33).
- The error codes (errors.go:15-37).
- `os.Root` workspace (workspace.go:15-76).
- "model library": `grep -rn -i 'model library'` matched only the GCV-005 ticket docs (DD:2169, 2464, 2541;
  ref/06:424, 729, 894, 906), which point to `testdata/scripts/dust/helpers.js`.
- Params: `grep -rn 'Param' pkg/cv/graph/*.go | grep -v _test | grep -v 'Placeholder'` → no output, so params are
  gone from the code. `git log --oneline | grep -i param` → M1 commits `29ddb0d` ("P params"), `f742ee3` and
  `97d22c7` ("param store") show that they existed early.

### What didn't work
- **Registry pipeline.** To read `registry.go:140-330` with absolute line numbers I ran
  `sed -n 140,330p pkg/cv/graph/registry.go | cat -n | sed 's/^ *\([0-9]*\)/\1+139/' | awk -F'\t' '{split($1,a,"+"); printf "%d\t%s\n", a[1]+a[2], $2}'`.
  Most lines came out as a bare line number with no content. The cause is that Go source is indented with tabs,
  so `$2` was empty for indented lines. Fix: the Read tool with `offset: 140, limit: 200`.
- **Prelude outline.** A similar `sed | cat -n | awk | grep -E '^[0-9]+\t(  function|…)'` pipeline on
  `prelude.js` printed nothing. Fix: `grep -n '^  function\|^  const\|…' pkg/gojamod/cv/prelude.js`, followed by
  a Read with an offset.

### What I learned
- Ops carry Space rules (Follows/Physical/Display), Class (pixel/geometric/decoration), `AnalysisScale`,
  `Builders` (lambdas) and `Redirects` (agent typos).
- `cv.save` semantics: `E_DUPLICATE`, no symlinks, never overwrite opened files, temp file + rename
  (funcs.go:65-74).
- `img.within(mask, i => …)` is dodge and burn (composite.go:15-35).

### What was tricky to build
N/A.

### What warrants a second pair of eyes
I outlined `eval.go` but did not read it fully. My claims about singleflight and the cache key come from comments
and greps (eval.go:13, 63, 103-104, 232-254).

### What should be done in the future
Read `pkg/cv/graph/args.go` (1331 lines, the binder) if chromobench copies the codec exactly.

### Code review instructions
Read `registry.go:149-299`, `node.go:17-95`, `ops/tone.go:17-82`, `ops/composite.go:15-35`,
`graph/workspace.go:15-76` and `ops/funcs.go:15-100`.

### Technical details
- Docs snippet extraction:
  `awk '/^```js/{p=1;print FILENAME":"FNR; next} /^```/{if(p){print "---"};p=0} p' pkg/cv/docs/topics/01-getting-started.md pkg/cv/docs/topics/05-masks-and-regions.md pkg/cv/docs/topics/09-recipes.md | head -120`.

## Step 4: The JS binding layer (code)

This step was about how Go and JS meet. I read the module registration, the native binding object, the promise
settlement path, and the whole JS prelude that builds the fluent API out of Proxies.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Points 1, 2 and 4 of the brief: handles, lazy vs eager evaluation, and
go-go-goja module registration.
**Inferred user intent:** Reuse the binding pattern in chromobench.

### What I did
- Read `pkg/gojamod/cv/module.go` (whole file).
- Read `binding.go:1-120` and `247-320`.
- Read `prelude.js:1-80` and `140-301`, plus a grep outline.
- Read the header of `describe.go`.

### Why
To confirm that pixels never cross into JS, and to see how promises are settled.

### What worked
- `module.go:63-114`: `NativeModule` plus the prelude loader.
- `module.go:155-182`: `Registrar` and `init()` → `modules.Register(New())`.
- `binding.go:40-63`: the native surface of `__`-prefixed functions.
- `binding.go:247-288`: an Image resolves to a summary; other kinds are evaluated on a goroutine and settled via
  `svc.PostWithCustomContext`.
- `prelude.js:140-215`: the Proxy handler, covering `then`, `toPrimitive` → `E_NOT_AWAITED`, set → `E_IMMUTABLE`,
  and `look`.
- `prelude.js:44-77`: Symbol-linked region items.

### What didn't work
N/A beyond the outline pipeline noted in Step 3.

### What I learned
The pattern is a thin, untyped native binding plus a JS prelude whose method tables come from the Go registry.
Nothing is maintained twice.

### What was tricky to build
N/A.

### What warrants a second pair of eyes
N/A.

### What should be done in the future
N/A.

### Code review instructions
Read `pkg/gojamod/cv/module.go`, `binding.go:40-97, 247-302` and `prelude.js:1-301`.

### Technical details
N/A.

## Step 5: Session, result processor, MCP, CLI and xgoja (code)

This step covered what turns the module into an agent tool. That means the replapi session with its wrapper and
watchdog, the YAML result processor with tables and the context block, the MCP instructions, resources and
prompt, the CLI flags, and the xgoja provider.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Points 3 and 4 of the brief: agent ergonomics and packaging.
**Inferred user intent:** Know which pieces are agent-only and which belong to the core.

### What I did
- Read `pkg/cvsession/session.go:1-200`, `205-294` and `296-420`, plus `init.js` (whole file).
- Read `processor.go:20-115` and `470-545`, plus `tables.go:1-40` and `testdata/representative.result`.
- Read `reference.go:1-140` and `mcp.go:1-100`.
- Grepped the cobra `Use`/`Flags` lines in `cmd/goja-cv/*.go`.
- Read `pkg/xgoja/providers/cv/cv.go` and `examples/xgoja/cv-agent/xgoja.yaml` in full.
- Inventoried the go-go-goja APIs used.
- Read `pkg/doc/10-troubleshooting.md` for the interrupt caveat.

### Why
These files define the agent contract.

### What worked
All of the following were found as expected:
- session limits: 60 s timeout, 9000 chars, 4 looks, 8 MiB (session.go:39-50);
- `noFileModules` (session.go:185-191);
- the wrapper (session.go:298-306) and the watchdog (session.go:370-412);
- `Instructions` and `EvalToolDescription` (reference.go:11-48);
- the MCP tools, resources and prompt (mcp.go:54-150);
- the context block (processor.go:470-540).

### What didn't work
N/A.

### What I learned
- **Finding:** the package comment at `session.go:2-3` lists globals `P`, `show` and `doc`. `init.js` defines only
  `cv`, `mem`, `img` and `__cv_run`. `grep -rn '"show"\|"doc"\|define("P"\|"P"' pkg/cvsession/*.go pkg/cvsession/init.js | grep -v _test`
  printed nothing, so the comment is stale.
- The go-go-goja APIs used are `replapi`, `replsession` (ResultProcessor/BeforeEvalHook/FailureProcessor),
  `replmcp`, `resultcontent` and `runtimebridge`.

### What was tricky to build
N/A.

### What warrants a second pair of eyes
I did not read the CLI's `eval.go` body or `mcp.go` command body beyond the flags.

### What should be done in the future
N/A.

### Code review instructions
Read `pkg/cvsession/session.go`, `init.js`, `processor.go:20-115, 470-545`, `reference.go`, `mcp.go:40-150` and
`pkg/xgoja/providers/cv/cv.go`.

### Technical details
- `grep -n 'Use:\|Short:\|Flags()\.\|AddCommand\|help_cmd\|LoadSectionsFromFS' cmd/goja-cv/*.go | grep -v _test`
  listed the run, eval, ops and mcp commands and their flags.
- Note `--root` is `onceString`, and mcp adds `--http` and `--allow-remote`.

## Step 6: Running the binary: build, sample evals, error formats and timings

I wanted [run]-level evidence for what an agent actually sees, and rough numbers on interactivity. I built the
CLI into the scratchpad, generated the planted test images, ran one feature eval and three error evals, and
timed a 24 MP float image.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Supports points 2, 3 and 5 of the brief with observed behaviour.
**Inferred user intent:** Ground the GUI and performance judgement in measurements.

### What I did
- Built the binary into the scratchpad.
- Generated the test images into `$SP/img`.
- Ran evals and error cases.
- Created and timed a 288 MB `.npy` file, then deleted it.

### Why
The README claims about output, errors and laziness needed to be confirmed, and point 5 needed numbers.

### What worked
**Build.** `GOWORK=off GOFLAGS=-mod=readonly timeout 280 go build -o $SP/gcv/goja-cv ./cmd/goja-cv` printed
`go: downloading github.com/go-go-golems/go-go-goja v0.10.8-0.20261109062017-5e1ba117462e` and produced a
68,516,224-byte binary. `git status --short` was empty afterwards.

**Feature eval** (exit 0):
`./goja-cv eval --root $SP/img --image $SP/img/planted-256x192-16bit.tif --out $SP/looks -e '…stats, detect.specks, within(mask.gradient.feather(10), i => i.exposure(-0.6)), mem.helper with a doc comment, cv.explain(burned).graph…'`
- It printed `meanL: 0.50104`, `p99: 0.70667` and `n: 40`.
- The `top` table had columns `id x y w h cx cy area aspect contrast localNoise sharpness score meanL polarity`.
- Look caption: `'[look 1: burn top — open(planted-256x192-16bit.tif) → within(…, …) (256×192, 1 image px = 1.0 doc px)]'`.
- The explain graph showed `as(to: "encoded")` inserted above `exposure(ev: -0.6)` in linear space.
- The context block listed `functions: mem.helper(x)` and `new functions: mem.helper(x): halve a value`.
- The look was written to `$SP/looks/look-1-burn-top.png`.

**Error evals** (each exit 1):
- `-e 'return img.levels({ blak: 0.1 })'` → `E_UNKNOWN_OPTION` with `hint: Did you mean "black"?`,
  `fix: 'levels({ black: 0.1 })'` and `valid: [black, white, gamma, auto]`.
- `-e 'const s = img.stats()\nreturn img.levels({ black: s.p01 })'` → `E_NOT_AWAITED` with
  `path: open(planted-256x192-16bit.tif) → stats → ✗ p01` and `fix: (await img.stats()).p01`.
- `-e 'return img.exposre(1)'` → `E_UNKNOWN_METHOD` with `hint: Did you mean "exposure"?`.

**Timings.** I created a test file with
`python3 -I -c "import numpy as np; a = np.random.default_rng(1).random((4000, 6000, 3), dtype=np.float32)*0.5; np.save('$SP/img/big.npy', a)"`
(288,000,128 bytes; `nproc` printed `8`).
- `/usr/bin/time -f 'wall=%es rss=%MKB' ./goja-cv eval … -e 'const t0 = Date.now(); const s = await img.stats(); const t1 = Date.now(); const g = await img.exposure(0.3).gaussian(2).stats(); const t2 = Date.now(); const l = img.exposure(0.3).levels({ auto: true }).look("lv"); return { statsMs: t1 - t0, chainMs: t2 - t1, look: l }'`
  → `statsMs: 4775`, `chainMs: 5065`, a look of `1568×1045, 1 image px = 3.83 doc px`, and
  `wall=10.09s rss=1639004KB`.
- Look only, `-e 'return { look: img.exposure(0.3).levels({ black: 0.02, white: 0.6 }).look("lv") }'` →
  `wall=0.55s rss=606300KB`.
- Histogram re-eval: `firstMs: 824`, `secondMs: 178` (only `white` changed: 0.6 → 0.5), with
  `wall=1.35s rss=1545692KB`.
- Then `rm -f $SP/img/big.npy`.

### What didn't work
- **Test image generation, first try:**
  `GOWORK=off go run ./internal/testimage/gen -out $SP/img -planted` failed with
  `open /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/gcv/img/gradient-64x48-16bit.tif: no such file or directory` /
  `exit status 1`. The output directory did not exist.
  - The eval chained after it failed with
    `goja-cv: workspace "…/scratchpad/gcv/img": stat …/scratchpad/gcv/img: no such file or directory` and
    `exit=2`, which is the usage-error exit code.
  - Fix: `mkdir -p $SP/img $SP/looks`, then generate again. That produced `gradient-64x48-16bit.tif`,
    `gradient-64x48-8bit.png` and `planted-256x192-16bit.tif`.
- **Separator line in zsh:** I chained the evals with `echo ======`. zsh printed `(eval):6: ===== not found` and
  the whole command reported `Exit code 1`, even though the first eval had succeeded and printed `exit=0`. zsh's
  `=word` expansion treats `=====` as a command lookup. I re-ran the error cases separated by `echo "-----"`.

### What I learned
- Looks come from the pyramid and are fast even at 24 MP.
- Full-resolution work takes hundreds of milliseconds to seconds.
- The cache makes downstream-only changes cheap: 824 → 178 ms.
- Errors really do carry literal fixes, and the context block really does show doc lines read from source.

### What was tricky to build
N/A.

### What warrants a second pair of eyes
- These are single runs on a random-noise image.
- The claim that `stats` cost is dominated by percentile computation is an inference: the look-only run's
  0.55 s total suggests decoding is cheap. I did not profile it.

### What should be done in the future
Benchmark a real 24–100 MP scan with `-cpuprofile` before deciding on chromobench's preview architecture.

### Code review instructions
Rebuild with the command above and re-run the evals. The scratch binary is at
`/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/gcv/goja-cv`.

### Technical details
`SP` was `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/gcv`.

## Step 7: The test suite and testing strategy

I wanted to confirm that the tests pass on this machine and to classify the kinds of test, since several
patterns there are reusable.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Point 4 of the brief: how it is tested.
**Inferred user intent:** Copy the testing approach for chromobench.

### What I did
- Ran the full suite in the background.
- Read the test headers of `docs_test.go`, `golden_test.go`, `peaks_gold_test.go`, `measure_real_test.go`,
  `realdata_test.go`, `planted.go` and `tables_test.go`.
- Read the Makefile smoke target.
- Listed `.github/workflows`.

### Why
To verify "tests run the docs", the golden and gold distinction, and the smoke flow.

### What worked
`cd …/goja-cv && GOWORK=off timeout 580 go test ./... -count=1 2>&1 | tail -25; git status --short` → all `ok`.
The package times were:

| package | time |
|---|---|
| cmd/goja-cv | 0.887 s |
| internal/testimage | 0.192 s |
| buffer | 0.680 s |
| dataout | 0.016 s |
| docs | 0.018 s |
| graph | 1.733 s |
| kernels | 7.063 s |
| look | 2.444 s |
| ops | 5.004 s |
| parallel | 0.008 s |
| text | 0.004 s |
| cvsession | 9.094 s |
| doc | 0.121 s |
| gojamod/cv | 1.263 s |
| xgoja/providers/cv | 0.035 s |

The command exited 0 and `git status --short` printed nothing.

The workflows directory lists `codeql-analysis.yml`, `dependency-scanning.yml`, `lint.yml`, `push.yml`,
`release.yaml` and `secret-scanning.yml`.

### What didn't work
N/A.

### What I learned
- The golden looks compare the 8-bit image before caption burn-in and JPEG encoding (golden_test.go:19-28).
- The gold tests skip unless `GOJACV_TILES`/`GOJACV_GOLD` are set, and compare two methods in one run
  (peaks_gold_test.go:15-26).
- Every docs JS block runs (docs_test.go:91-104).
- Every documented command parses (doc_commands_test.go:100).

### What was tricky to build
N/A.

### What warrants a second pair of eyes
I did not run with `-v`, so I did not confirm which env-gated tests skipped. I did not run `-race`, `make lint` or
`make smoke`.

### What should be done in the future
N/A.

### Code review instructions
Run `GOWORK=off go test ./... -count=1` in the goja-cv checkout.

### Technical details
`git show --stat 0e96cce` shows the commit message "CI (linux/amd64) printed localNoise 0.005166 where arm64
prints 0.0051662; the fixture pins the format, not the detector's last digits". It changed
`pkg/cvsession/tables_test.go` and `testdata/representative.result`.

## Step 8: Ticket docs (GCV-001..005) via helper agents and spot checks

The two helper agents returned dense, cited summaries. The first covered the image model, looks and measurement,
the multi-agent workflow and the early lessons. The second covered API v2 and agent ergonomics, with the evidence,
deviations, sandbox fixes and goja gotchas. I spot-checked the load-bearing citations against the docs myself.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Point 3 of the brief: decisions, deviations and lessons from the ticket docs.
**Inferred user intent:** Learn the process and its reversals, not only the final API.

### What I did
- Received both reports. The first took about 222 s and 36 tool uses; the second about 249 s and 43 tool uses.
- Ran one spot-check command over the four most important citations.

### Why
The helpers' citations become [doc] claims in the report, so the critical ones needed checking.

### What worked
I ran `sed -n 22,30p` on G4 ref/01, `sed -n 1765,1779p` on the G4 DD, `sed -n 155,159p` on the G5 DD and
`sed -n 34,44p` on G5 ref/01. All four matched:
- G4 ref/01: "18 pi agent runs (751 eval calls, model `lunaroute/deepseek-4.1-flash`)".
- G4 DD: decision D1 "Options are literals; data dependencies go through `await`… Agents used params 0 times and
  lifting 4 times… Decision: (c)".
- G5 DD: "never make a model read a number off a picture; every look comes with the data it shows."
- G5 ref/01: "374 evals … 0 errors … 29 helper pastes … Never used: cv.docs, cv.help, … params".

### What didn't work
N/A.

### What I learned
- Space-per-op (GCV-001) was reversed to space-on-the-image (GCV-004).
- Params were deleted after zero agent uses.
- `UNUSED_NODE`, `Halo` and `CROP_FIRST` were built and then deleted.
- `cv.load` was chosen over an `eval_file` MCP tool.
- Gold labels are human-labelled dust points; golden files are pixel-exact looks.
- One deviation is especially relevant for chromobench: density tiles were mis-read as sRGB.

### What was tricky to build
N/A.

### What warrants a second pair of eyes
All [doc] line citations other than the four above are the helpers' and were not re-verified by me. One example
is "P1 counts 15 → 0" (G1 ref/01). The first helper also flagged its own uncertainty about GCV-004 reversals; the
second helper resolved that.

### What should be done in the future
If the user leans on a specific deviation or decision, re-open the cited lines.

### Code review instructions
Use the `G1`–`G5` path keys in the report and open the cited lines.

### Technical details
See the spot-check command above.

## Step 9: Writing up and handing back

I wrote the full analysis as markdown and tried to save it at the requested path. The Write tool refused, so I
returned the full text plus a summary through the handback instead, without working around the block.

The coordinator then asked for the full report and this diary between markers. I re-sent the report with two
small corrections: the 5.1 s exposure→gaussian→stats timing was added, and the "includes decode" claim about
`stats` was softened to an inference.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Deliver the file and summary. Then, per the coordinator's later message, put the
report and diary verbatim between markers and do not work around write blocks.
**Inferred user intent:** Have the analysis stored in the CHB-001 ticket and have a traceable record of how it
was produced.

### What I did
- Called Write on
  `/home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-goja-cv.md`.
- After it was refused, delivered the summary and full document via the handback.
- Produced this reply with the report and diary.

### Why
The harness forbids subagents from writing report files.

### What worked
The handback was delivered.

### What didn't work
The Write call was refused with:
`<\tool_use_error>Subagents should return findings as text, not write report files. Include this content in your final response instead.<\/tool_use_error>`

### What I learned
In this harness, deliverables from a subagent must travel as text.

### What was tricky to build
Keeping the [code]/[run]/[doc] tags consistent across a long document.

### What warrants a second pair of eyes
- The perf numbers.
- The [doc] citations that were not spot-checked.
- The stale `session.go:2-3` comment finding.

### What should be done in the future
The coordinator should store the report at the path above, and this diary next to it.

### Code review instructions
Compare the report's [code] citations against the goja-cv checkout at `5a93095`.

### Technical details
N/A.
