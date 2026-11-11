---
Title: "goja-cv: how it works and what chromobench can reuse"
Ticket: CHB-001
Status: active
Topics:
    - color-science
    - film-emulation
    - image-pipeline
    - js-api
    - product
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Subagent-authored analysis stored for CHB-001"
LastUpdated: 2026-11-11T11:32:25-05:00
WhatFor: ""
WhenToUse: ""
---

# goja-cv: how it works and what chromobench can reuse

This document explains goja-cv (`github.com/go-go-golems/goja-cv`, `main` at `5a93095`) for the people
planning **chromobench**. Chromobench is a darkroom suite for importing camera RAWs and colour-negative scans,
"printing" them through a physically based film/paper model, and applying darkroom-style edits. Like goja-cv, it
has a goja JavaScript API underneath so that an LLM agent can drive it.

goja-cv is the model the user pointed at. It is a Go image engine that an agent drives through JavaScript.

## 0. Method and evidence legend

All paths are relative to `/home/manuel/code/wesen/go-go-golems/goja-cv` unless they start with `G1`–`G5`.
Those are the ticket directories `ttmp/2026/11/09/GCV-00N--…/`, where `DD` is the design doc and `ref/NN` is a
reference document.

Every claim is tagged:

- **[code]** — I read the source at the cited lines.
- **[run]** — I ran it. I built `cmd/goja-cv` into a scratch directory, ran evals on the synthetic "planted"
  scan and on a 6000×4000 float image, and ran `go test ./... -count=1`, which passed in every package. The
  repository was not modified.
- **[doc]** — taken from README/AGENT.md/guidebook or the GCV ticket docs, and not checked against code.
  - Two helper agents read the ticket docs (GCV-001..003 and GCV-004..005, about 23k lines) and returned
    summaries with line citations.
  - I spot-checked the load-bearing ones and they match: the pi-run evidence, decision D1, the "never read a
    number off a picture" rule, and the annotator feedback numbers.
  - Treat the other [doc] line numbers as good pointers, not as verified quotes.

History: 245 commits over 2026-11-08 → 2026-11-10, almost all agent-authored (`Co-Authored-By: Claude`). The
whole thing was built in about three days by a coordinated set of agents. That is part of what is worth copying
(§3.6).

---

## 1. What goja-cv is

### 1.1 Problem it solves

goja-cv is "a lazy, measurable image API in JavaScript, built for agents that have an eval tool" (README.md:3)
[doc]:

1. An agent sends a few lines of JS, the body of an async function.
2. goja-cv builds a lazy graph of image operations and evaluates it in Go.
3. It answers with YAML text plus up to four images, which it calls "looks".

The verbs are measure (stats, histograms, dust detection), select (masks, regions, morphology), edit (exposure,
levels, masked edits, heal/inpaint) and show (looks, overlays, comparisons, contact sheets) (README.md:5-9) [doc].

**Its home domain is film-scan dust analysis, which is directly relevant to chromobench.**

- The gold tests are gated on `GOJACV_TILES` / `GOJACV_GOLD`: tiles from a "DUST-002" scan-dust project with
  human-labelled dust points (`pkg/cv/ops/realdata_test.go:21-38`, `pkg/cv/ops/peaks_gold_test.go:15-26`)
  [code].
- One test reads a "VueScan LinearRaw DNG" (`realdata_test.go:145`) [code].
- The model task library is `dust/helpers.js` (`pkg/cvsession/testdata/scripts/dust/helpers.js:1`) [code].
- `cv.open(path, { encoding: "linear" })` exists for data such as "density maps, raw scans"
  (`pkg/cvsession/mcp.go` OpenInput, around line 50) [code].

### 1.2 Layering

```
cmd/goja-cv                CLI: run, eval, ops, mcp, help (cobra + glazed help)
pkg/xgoja/providers/cv     xgoja provider (module "cv" for generated binaries)
pkg/cvsession              eval session = go-go-goja replapi app + result processor + MCP server
pkg/gojamod/cv             go-go-goja native module "cv": binding.go (Go side) + prelude.js (JS surface)
pkg/cv/docs, pkg/doc       agent topics (cv.docs) and the human guidebook (goja-cv help)
pkg/cv/look, dataout, text looks (rendered images), saved files, 5x7 bitmap font for captions
pkg/cv/ops                 every op as a registry entry (OpDef) → kernels
pkg/cv/graph               registry, hash-consed node builder, evaluator, cache, workspace, errors
pkg/cv/kernels, parallel   pure-Go pixel kernels, band-parallel loops
pkg/cv/buffer              planar float32 buffers, encodings, decoders, pyramid, resampling
internal/testimage         synthetic test images incl. the "planted-fault" scan with known ground truth
```

The table above is reconstructed from the file tree; AGENT.md:36-46 says the same [code+doc]. Code size is about
25k lines of non-test Go. `examples/` holds only `examples/xgoja/cv-agent/xgoja.yaml`. `testdata/` holds two small
gradient images; the larger fixtures are generated (`make testdata`,
`go run ./internal/testimage/gen -planted`) [code].

### 1.3 Image backend: pure Go, no OpenCV

- **No gocv or OpenCV, and no C in the image path.**
  - `grep` for `gocv|opencv|import "C"` finds nothing. The only image dependency is `golang.org/x/image`, used for
    TIFF LZW (`pkg/cv/buffer/decode_tiff.go:14`) [code].
  - cgo is still required, but only because go-go-goja's session links tree-sitter and SQLite (README.md:52) [doc].
- **Buffer type.** It is planar float32 in linear light: `Buffer{W, H, C int; Pix []float32; Scale float64}`
  with C = 1 (gray or mask) or 3 (RGB). `Scale` is buffer px per doc px (`pkg/cv/buffer/buffer.go:7-14`) [code].
  - Kernels treat inputs as read-only and always allocate outputs, because buffers are shared through the cache
    (buffer.go:8-9) [code].
- **Encodings vs spaces.**
  - `Encoding` is the file's transfer function: `srgb` or `linear`.
  - `Space` is what the values currently are: `linear` or `encoded`.
  - Conversions use exact transfer functions (`pkg/cv/buffer/encoding.go:10-120`) [code].
  - Luminance is Rec.709 weights on linear light (buffer.go:50-70) [code].
- **Preview pyramid.** Each source keeps area-averaged halvings, and previews resample from the coarsest level
  that is still large enough, "so they never read the full buffer" (`pkg/cv/buffer/pyramid.go:11-37, 61-80`)
  [code].
- **Parallelism.** `parallel.Rows` splits rows into bands on GOMAXPROCS goroutines (errgroup), checks the context
  before each band, and recovers panics (`pkg/cv/parallel/parallel.go:16-56`) [code].
- **Formats.**
  - Read: PNG 8/16, JPEG, TIFF (8/16-bit int or float32; uncompressed/LZW/Deflate/PackBits), LinearRaw DNG,
    NumPy `.npy` (`pkg/cv/buffer/decode.go:89`) [code]. The TIFF/DNG reader is goja-cv's own
    (`decode_tiff.go:18-21`).
  - **CFA (mosaiced) raw is refused** with `E_FORMAT` ("CFA (mosaiced) raw data is not supported",
    `pkg/cv/buffer/decoders_test.go:234-240`) [code].
  - **There is no ICC handling, no camera colour matrix, and no demosaicing.** A DNG gets a note "camera RGB
    primaries (DNG)", and `toLab` warns on camera RGB [code: decode.go:29; doc: G1 DD:147-151].
  - Write: `.tif`, `.png`, `.npy`, `.jpg`, `.json`, `.csv` via `cv.save` (`pkg/cv/ops/funcs.go:65-74`) [code].

**For chromobench:** the buffer and encoding model is a sound base. Colour management and raw processing would be
entirely new work, covering demosaic, camera→XYZ, spectral film and paper models, and density.

### 1.4 How images cross the Go/JS boundary: they don't

This is the central design idea.

- **Nodes are handles.** JS only ever holds Proxies over `{ __id, __kind }`
  (`pkg/gojamod/cv/prelude.js:3-14, 217-224`) [code].
  - Method tables are generated from the Go registry: `native.__registry()` (prelude.js:18-35).
  - Hash-consed nodes are `===` in JS too, through a `proxies` map (prelude.js:42).
- **What `await` does** (prelude.js:151-158; `pkg/gojamod/cv/binding.go:247-288`) [code]:
  - `await` on a Value or Regions node evaluates it at scale 1 on a separate goroutine, then settles the promise
    by posting back to the runtime's owner goroutine (`svc.PostWithCustomContext`, binding.go:261-286).
  - `await` on an **Image** resolves immediately to a static summary (file, encoding, frame, …) and **computes
    nothing** (binding.go:251-253).
  - Regions arrive as plain arrays of flat items. Each item carries a hidden `[nodeId, index]` link under an
    enumerable Symbol key, so a JS-filtered item still stands for its region's exact pixels when passed back to an
    op (prelude.js:44-55, 61-77) [code].
- **Looks are Go objects.** They implement go-go-goja's `resultcontent.Provider` and are rendered lazily off the
  owner goroutine. The look number is burned in, and the look is encoded as JPEG q85 (colour) or PNG (gray, masks,
  charts, small or zoomed) (`pkg/cv/look/look.go:1-12, 36-51`; `ops/funcs.go:21-39`) [code].
- **The sandbox.** README says the runtime has no filesystem, process or network access (README.md:9) [doc]. This
  matches the code: sessions load only the `cv` and `timer` modules, and `require` refuses files
  (`pkg/cvsession/session.go:162-191`) [code].

---

## 2. The JS API surface

### 2.1 The eval contract and session globals

- **Code is wrapped.** Agent code is the body of an async function, wrapped as
  `__cv_run(async function () {\n … \n})`. Agent line N is line N+1 of the evaluated source, so errors map back to
  the agent's lines (`pkg/cvsession/session.go:298-306`) [code].
- **Globals** (`pkg/cvsession/init.js:1-62`) [code]:
  - `cv` is the module, wrapped in a Proxy that gives did-you-mean errors for unknown members (init.js:47-59).
  - `mem` is a plain object that persists across evals. Top-level `const`/`let` do not persist.
  - `img` is a getter/setter backed by a session name table. `cv.open(path, { name: "ref" })` binds additional
    globals (init.js:29-45).
- **Stale comment.** The package comment at `session.go:2-3` still lists `P`, `show` and `doc` globals. They no
  longer exist: `P` (params) and `show` were removed in GCV-004 [code: grep finds no definitions; doc: G4 D1, D9].
- **Saves and loads finish with the eval.** `__cv_run` waits for every `cv.save` and `cv.load` that the eval
  started, awaited or not. An unawaited failed save fails the eval; other unhandled rejections become an
  `UNHANDLED` warning (init.js:64-108) [code].

### 2.2 The `cv` object

From `prelude.js:239-299` [code]:

| member | what it does |
|---|---|
| `cv.open(path, { encoding, box, origin, name })` | source node. Relative paths try the workspace, then each `--read` dir |
| `cv.help(name?)` | op, kind, `Kind.method`, function or concept reference; never throws, returns `{found:false, didYouMean}` (ops/funcs.go:59-63) |
| `cv.docs.list() / search(text, {limit}) / read(id, {section})` | agent guides embedded in the binary (`pkg/cv/docs/topics/*.md`) |
| `cv.explain(node)` | synchronous; evaluates nothing. Returns id, kind, op, call, frame, encoding, space, path, and a graph listing with "cached" marks |
| `await cv.save(path, x, { depth })` | writes into the workspace; the extension picks the format |
| `await cv.load(path, args)` | runs a script file as `async function (args) {…}`; no cache; nests ≤ 32 deep |
| `cv.scripts()` | `.js` files `cv.load` can run, with their first comment line |
| `cv.<moduleOp>` (`compare`, `sheet`, …) | generated from the registry's receiver-less ops (prelude.js:295-299) |

### 2.3 Ops: one registry and one schema

**Every op is one `graph.OpDef` in `pkg/cv/ops/*.go`.** The registry is "the single source of truth for every op
the agent can call" (`pkg/cv/graph/registry.go:313-318`) [code]. These are all generated from it:

- the JS methods (prelude);
- `cv.help`, the `goja-cv ops` command and the `cv://reference` MCP resource (`pkg/cvsession/reference.go:50-140`);
- did-you-mean errors (`pkg/cv/graph/suggest.go:79`).

**Kinds.** The kinds are `Image`, `Regions` and `Value` (registry.go:15-25). "Mask" is not a kind: it is a type
word meaning "an Image with one channel" (registry.go:27-51). Dotted names create namespaces, e.g.
`mask.luminance` gives `img.mask.luminance(...)`, and `detect.specks` and `check.dust` work the same way
(prelude.js:22-35) [code].

**`ArgSpec` is the option codec** (registry.go:149-182) [code]:

- Name, Type, Unit, Default, Positional, Variadic.
- `Type` covers `"number"`, `"enum:a,b"`, `"box"`, `"point"`, `"Mask"`, `"Regions|Mask"`, `"Image[]"`, `"object"`
  with nested `Options`, and so on.
- `Unit` is one of DocPx, DocPx², Fraction or Level (registry.go:63-72). Lengths are in original-image pixels and
  are rescaled per evaluation scale.
- **Hard limits** `Min`/`Max` raise `E_ARG_RANGE`. The **soft range** `Usual` plus `UsualHint` raises a `RANGE`
  warning without failing.
- `Redirects` map names that agents demonstrably typed to the correct call, e.g. `look({ box })` → `crop`.
- `Doc` is the per-argument help text.

**`OpDef` carries the semantics** (registry.go:235-299) [code]:

- `On` / `Returns` kinds.
- `Space` rule: Follows, Physical or Display (registry.go:90-104).
- `Class`: PixelOp, GeometricOp or Decoration, which sets behaviour above scale 1 (registry.go:192-208).
- `Result` encoding rule; `Channels`, `OneChannel` / `ThreeChannel`; `Luma`.
- `Identity`: neutral args return the receiver, so `exposure(0)` is a no-op.
- `Global` (needs the whole image), `AnalysisScale`, `Fields` (result schema), `Validate`.
- `Builders` (lambda argument positions), `Expand` (macros), `Run`, `Doc`, `See`.

A representative op is `exposure` (`pkg/cv/ops/tone.go:17-30`) [code]:

```go
{
    Name: "exposure", On: graph.KindImage, Returns: graph.KindImage, Space: graph.Physical,
    Args: []graph.ArgSpec{{Name: "ev", Type: "number", Positional: true, Min: graph.F(-10), Max: graph.F(10),
        Usual: [2]float64{-3, 3}, UsualHint: exposureHint, Doc: "stops of light: linear values are multiplied by 2^ev"}},
    Identity: func(a graph.Args) bool { return a.Number("ev") == 0 },
    Run: func(ctx context.Context, _ *graph.EvalCtx, in []graph.Value, a graph.Args) (graph.Value, error) { … kernels.Exposure … },
    Doc: "Change exposure by ev stops of light: computed in linear light (values × 2^ev), returned in the image's space. " + exposureHint,
    See: []string{"levels", "contrast", "stats"},
}
```

`levels` (tone.go:33-82) shows the other half of the codec: a `Validate` that returns errors carrying a literal
`WithFix("img.levels({ auto: true }) …")`.

**Chromobench should copy this almost verbatim.** A film-stock or paper op would be an `OpDef` with unit-tagged,
range-checked arguments and one doc string. The GUI and the agent would then share one definition of what the
operation is.

### 2.4 Lazy evaluation, hashing and caching

- **Hash-consed nodes.** A `Node` is immutable and hash-consed. Its hash is
  `sha256(op key, canonical args, metadata, input hashes)`, and it carries its static frame, encoding, space,
  channel count and result fields (`pkg/cv/graph/node.go:17-32`) [code].
  - `Builder.Intern` type-checks arguments, inserts the needed `toGray`/`as` conversion nodes, and returns the
    existing node for a structurally identical call (node.go:38-95) [code].
- **Evaluator and cache.**
  - The cache key is the node hash plus the quantised scale, rounded to 1e-4 (`pkg/cv/graph/eval.go:103-104,
    232-254`).
  - Concurrent identical work is deduplicated with `singleflight` (eval.go:13, 63).
  - Values sit in a byte-capped LRU, 2 GiB by default (`pkg/cv/graph/cache.go:8-13`;
    `pkg/cv/graph/engine.go:12-33`) [code].
  - Warnings are stored with cache entries and replayed on a hit (cache.go:70-86) [code].
- **Two evaluation scales.**
  - `await` evaluates at scale 1.
  - `look()` evaluates at look scale: long side 1568 by default, served from the pyramid.
  - Regions ops pin `AnalysisScale` so that region ids and coordinates are the same at preview and export
    (registry.go:283-287) [code].
- **Op classes under zoom.** A look can render above scale 1 (zoom ≤ 16). Pixel ops are then computed at 1 and
  upsampled. Geometric ops pass through. Decorations such as overlays and annotations draw at render scale, so
  lines stay 1 image px wide (registry.go:192-208) [code].
- **Measured** [run] on a 6000×4000×3 float32 `.npy` of random values, 8 cores, single runs:

| eval | time |
|---|---|
| `img.exposure(0.3).levels({ black: 0.02, white: 0.6 }).look()`, alone in its own process | 0.55 s process wall time, including load; the look is 1568×1045 from the pyramid; RSS 0.6 GB |
| `await img.stats()`, the first full-resolution op of a session | 4775 ms |
| `await img.exposure(0.3).gaussian(2).stats()` | 5065 ms |
| first `await img.exposure(0.3).levels({ black: 0.02, white: 0.6 }).histogram()` | 824 ms |
| the same with `white: 0.5` | 178 ms: the `exposure` node was reused from the cache |
| peak RSS | 1.6 GB (stats/gaussian run), 1.5 GB (histogram run) |

The look-only run suggests that decoding the source is not the dominant cost, so most of the `stats` time is
probably percentile computation. This is an inference; I did not profile it.

### 2.5 Space on the image

This model is the result of a reversal: GCV-001 had space as a per-op property, and GCV-004 moved it onto the
image.

- `cv.open` returns values in file units. `img.as("linear")` is the single explicit conversion.
- Each op Follows its receiver's space, or is Physical (computed in linear light, returned in the caller's space,
  e.g. `exposure`, `heal`, Rec.709 gray), or is Display (drawn in encoded values).
- Masks are never converted.

Sources: registry.go:90-104 and tone.go:17 [code]; G4 DD:804-837 and D2/D3 [doc].

You can see it in `cv.explain`. My eval of `img.within(mask, i => i.exposure(-0.6))` printed this graph [run]:

```
#15 within(mask: #8, edit: #14)                     Image 256×192           enc srgb · space encoded
  #1 source planted-256x192-16bit.tif               Image 256×192  cached   enc srgb · space encoded
  #8 feather(radius: 10 px)                         Image 256×192           enc linear · space linear
    #7 mask.gradient()                              Image 256×192           enc linear · space linear
  #14 as(to: "encoded")                             Image 256×192           enc srgb · space encoded
    #13 exposure(ev: -0.6)                          Image 256×192           enc srgb · space linear
      #2 source planted-256x192-16bit.tif (linear)  Image 256×192  cached   enc srgb · space linear
```

`exposure` ran in linear light, and the builder inserted the conversion back to encoded values automatically.

**For chromobench** this generalises naturally to more spaces: scene-linear camera RGB, XYZ, log exposure,
density, paper-print density, display sRGB or P3. Physical ops such as exposure, film and paper would declare the
space they need, and the builder would insert conversions.

### 2.6 Builder lambdas: dodge and burn already exist

`img.within(mask, i => i.exposure(-0.6))` applies an edit inside a mask (`pkg/cv/ops/composite.go:15-35`) [code]:

1. The lambda runs **once at graph-build time**. It receives a placeholder node.
2. Go substitutes the real receiver (`OpDef.Builders`, registry.go:291-295; prelude.js:89-111).
3. An async lambda is refused.

This is exactly a darkroom dodge or burn: a feathered gradient or ellipse mask plus an exposure change. The mask
vocabulary is:

- `mask.luminance/color/box/ellipse/gradient/flood`;
- `and/or/minus/not`, `feather`, `refine` (guided);
- `erode/dilate`, `components`, `coverage`.

Source: Instructions in `pkg/cvsession/reference.go:15-45` [code].

### 2.7 Looks, sheets, compare and overlay

- **Looks.** `node.look(label | { zoom, ruler, grid, interp, maxSide, format })` queues a look. Every look created
  in an eval is delivered, whether or not it is returned, up to 4 per eval and 8 MiB in total. The rest are named
  in a `LOOKS` warning.
  - Captions show the chain and scale, e.g.
    `[look 1: burn top — open(…) → within(…, …) (256×192, 1 image px = 1.0 doc px)]`.
  - Sources: `ops/funcs.go:21-46`, `session.go:39-47` [code]; caption from my run [run].
- **Contact sheet.** `cv.sheet(items, { views, size, zoom })` is one picture of magnified crops around many items
  (36 cells at defaults). Its caption lists the cell ids, so the agent can map cells back to data rows
  (`pkg/cv/ops/sheet.go:304`) [code].
- **Compare and overlay.** `cv.compare([a, b], { mode: "side" | "split" })` and
  `img.overlay(items | mask, { labels })` are decorations (`pkg/cv/ops/present.go:109-130`) [code].
- **Rulers.** `crop(...).look({ zoom: 8, ruler: 8 })` adds rulers labelled in absolute doc px (ops/funcs.go:31-33)
  [code].

### 2.8 Measurement: `peaks`, `measure`, `stats`, `profile`, `sample`

- **`stats`** returns a fixed record (`meanL`, `p01`, `p99`, `clipLow`, `clipHigh`, …) and can be restricted to a
  `box` or `mask` (`ops/measure.go:128-140`) [code].
- **`measure(items)`** reports how much each item stands out from its surroundings
  (`ops/regionmeasure.go:317-346`) [code]:
  - `step` is the core/ring difference, with core radius `r` and ring [1.5r, 2.5r];
  - `spread` is p90 − p10 of the ring, and `snr = step/spread`;
  - `stepChroma` is ≈ 0 for neutral spots such as dust;
  - the measurement is in the image's space.
- **`peaks({ radius: [2,4,8], snr, polarity })`** returns local maxima of that same step at several radii
  (`ops/peaks.go:64-86`) [code]:
  - sub-pixel centres, as disks `{ id, cx, cy, r, step, spread, snr, ringCoverage, … }`;
  - sorted by |snr|;
  - searched at analysis scale 1.
- **Design rationale** [doc: G5 DD:155-158]: "never make a model read a number off a picture; every look comes
  with the data it shows". Peaks give coordinates, tables give rows, and sheet captions give cell ids.
- **`profile(a, b, { width })` and `sample(points)`** cover lines and points (`ops/measurement.go:326-346`) [code].

### 2.9 Data out and the workspace

**`cv.save` writes only into the workspace** (`ops/funcs.go:65-74`) [code]:

- one save per path per eval (`E_DUPLICATE`);
- never through a symlink, and never over a file the session opened (`E_ACCESS`);
- written as a temp file and renamed;
- TIFF and PNG record the encoding and frame.

**The workspace is built on Go's `os.Root`** (`pkg/cv/graph/workspace.go:15-76`) [code]:

- `--root` is the one read-write directory.
- `--read` directories (repeatable) are read-only.
- The standard library refuses `..` and symlink escapes.
- Saved temp files use `O_EXCL` with random names (workspace.go:350-353) [code].

**Hardening history:**

- `--root` may be given only once (`cmd/goja-cv/eval.go:34` `onceString`) [code]. A multi-root form had
  silently made a gold directory writable [doc: G5 ref/02:224-237].
- `require` loads no files in cv sessions (`session.go:185-191` `noFileModules`) [code]. Agents had found that
  `require("/abs/x.js")` bypassed the workspace "within two runs" [doc: G5 ref/06:1116-1119].

### 2.10 Task libraries, prelude and the "model library"

- `cv.load(path, args)` runs a file as `async function (args) { … }`.
- `--prelude FILE` (repeatable) loads files at session start; their looks and output are discarded
  (`session.go:227-259`) [code].
- Functions put on `mem` show up in the context block with signature and doc line (§3.3).
- The "model library" is the example task library `pkg/cvsession/testdata/scripts/dust/helpers.js`, which the
  docs tests load [code; doc: G5 DD:2169]:

```js
// dust/helpers.js: helpers for annotator agents on DUST-002 gold tiles (goja-cv v2)
mem.img = img
mem.lin = img.as("linear")
mem.spots = async ({ snr = 1, radius = [2, 4, 8] } = {}) => { // peaks with the speck view's step: sp = spStep
  const pk = await mem.lin.peaks({ radius, snr })
  return await mem.lin.view("speck").measure(pk, { prefix: "sp" })
}
mem.sheet = (items, size = 40) => // contact sheet of up to 15 items: tile | speck view, captioned with their ids
  cv.sheet(items.slice(0, 15), { views: [mem.img, mem.img.view("speck")], size, zoom: 4, stretch: "cell" })
return "dust helpers ready"
```

Why this exists [doc: G5 ref/01:34-44, spot-checked]: 39 Sonnet annotator agents each **pasted** a 3 KB helper
file into evals (29 pastes), and none of them opened `cv.docs` or `cv.help`. `cv.load` and `--prelude` make the
library a first-class, discoverable, documented object.

### 2.11 Representative snippets

All of these are from the agent topics, every one of which is executed by tests (§4.4) [code: `pkg/cv/docs/topics/`]:

```js
// exposure: measure, then use literal numbers (09-recipes.md:22)
const s = await img.stats()                 // options are numbers: await the measurement first
const fixed = img.levels({ black: s.p01, white: s.p99 }).exposure(0.25)
cv.compare([img, fixed], { mode: "side" }).look("before / after")
mem.fixed = fixed
const { meanL, clipLow, clipHigh } = await fixed.stats()
return { meanL, clipLow, clipHigh }
```

```js
// masks compose; masked edit = dodge/burn (05-masks-and-regions.md:19, 09-recipes.md:74)
const sel = img.mask.luminance({ above: 0.45 })
  .and(img.mask.gradient({ from: "top", to: 0.6 }))
  .minus(img.mask.box([0, 0, 40, 40]))
  .feather(6)
const out = img.within(sel, i => i.exposure(-0.6))
return { coverage: await sel.coverage(), look: img.overlay(sel, { color: "lime" }).look("selection") }
```

```js
// regions are arrays: filter/sort with plain JS, pass items back to ops (05-masks-and-regions.md:31, 09-recipes.md:46)
const dust = (await img.detect.specks()).filter(r => r.score >= 0.5)
const healed = img.heal(dust, { radius: 3 })
cv.compare([img, healed], { mode: "split" }).look("before | healed")
return { after: await healed.check.dust() }
```

```js
// data, not pixels, for positions (09-recipes.md:93)
const pk = await img.as("linear").peaks({ radius: [2, 4], snr: 2, polarity: "both" })
return { sheet: cv.sheet(pk.slice(0, 12), { views: [img, img.view("speck")], size: 32, zoom: 4 }).look("candidates") }
```

---

## 3. Agent ergonomics

### 3.1 What the agent is told

- **MCP server instructions** (`Instructions`, `pkg/cvsession/reference.go:11-45`) [code] are kept under 4000
  characters on purpose. They contain:
  - the eval contract;
  - the "nodes are lazy, `await` gives data" rule;
  - "never read a coordinate off a picture";
  - "errors carry a literal fix: apply the fix";
  - about 20 of the most-used calls.
- **The eval tool description** (reference.go:47-48) restates the contract in one paragraph. The cv eval tool
  replaces replmcp's generic eval, whose description promised "last expression is the result"
  (`pkg/cvsession/mcp.go:89-97`) [code].
- **Resources and prompt** (mcp.go:103-150) [code]:
  - `cv://reference` is generated from the registry;
  - `cv://docs/<id>` are the agent topics;
  - `cv://guide/<slug>` are the human guidebook pages;
  - prompt `cv-agent` = instructions + reference.
- **In-eval self-help:** `cv.docs.search`, `cv.docs.read`, `cv.help(name)` (never throws), and
  `cv.explain(node)`.
- **Tool input descriptions say when to omit optional fields**, because "agents invent values for unexplained
  options" (mcp.go:45-52 `OpenInput`) [code]. This is a small but very reusable trick.

### 3.2 What the agent gets back

The `ResultProcessor` produces YAML text (`pkg/cvsession/processor.go:22-89`) [code]:

- **Size cap.** The result is capped at 9000 chars (`session.go:42-43`), with a `# CUT …` note.
- **Nothing returned.** That case says so explicitly: "end the code with `return …`; the last expression is not
  returned" (processor.go:80-82).
- **Compact tables** (`pkg/cvsession/tables.go:16-29`) [code]:
  - An array of at least two flat records renders as a literal block: a header line plus one line per row.
  - Tables are exempt from the item and string caps but share a budget of two-thirds of the result cap, with a
    paging note.
  - This came from evidence: the item cap fired in 40 evals, and agents were joining rows into strings
    themselves [doc: G5 DD:562-569].
- **Warnings** carry the agent's line number.
- **A context block** goes at the end of every result (§3.3).
- **Looks** are delivered as image content over MCP, or as files with `--out` on the CLI.

Output from my run [run]:

```yaml
meanL: 0.50104
n: 40
top: |-
  id  x    y    w   h  cx      cy      area  aspect  contrast  localNoise  sharpness  score  meanL    polarity
  31  147  133  15  5  154.66  135.24  57    3.0417  0.12344   0.0043291   0.74102    1      0.65401  bright
  6   219  22   13  4  225.5   23.93   46    3.1232  0.13166   0.0053002   0.68357    1      0.47896  dark
look: '[look 1: burn top — open(planted-256x192-16bit.tif) → within(…, …) (256×192, 1 image px = 1.0 doc px)]'

context:
  images: img = planted-256x192-16bit.tif (256×192, 16-bit TIFF, srgb)
  functions: mem.helper(x)
  new functions: |-
    mem.helper(x): halve a value
```

### 3.3 The context block: signatures and doc lines from source

After every eval, the block lists the following (processor.go:470-540) [code]:

- the open images;
- every `mem` key with its kind;
- every `mem` function with a short signature;
- the **full signature and doc line** of each function that is new or whose source changed since the agent last
  saw it.

How the doc line is read (`pkg/gojamod/cv/describe.go:1-30`) [code]:

- The doc line is "the comment that opens the body". In `mem.probe = async (x, y) => { // the best point within 2 px`,
  the doc line is "the best point within 2 px".
- It is read with goja's `Function.prototype.toString`, which returns exact source.

The effect is that the agent always knows what it has defined, without re-reading files.

### 3.4 Errors built to be applied

Every failure is a `graph.Error{Code, Message, Path, Hint, Fix, Valid, Line}` (`pkg/cv/graph/errors.go:15-50`)
[code]:

- **Fixed codes**, including `E_UNKNOWN_METHOD`, `E_UNKNOWN_OPTION`, `E_ARG_TYPE`, `E_ARG_RANGE`,
  `E_NOT_AWAITED`, `E_WRONG_KIND`, `E_TIMEOUT`, `E_FRAME`, `E_FORMAT`, `E_ACCESS`, `E_INTERNAL`.
- **Warning codes**: `RANGE`, `LOOKS`, `CUT`, `UNHANDLED`, among others.
- **In JS** it becomes an `Error` whose `name` is the code and which has `code/path/hint/fix/valid` properties
  (`binding.go:65-97`) [code].
- **Panics.** Go panics in ops become `E_INTERNAL` (`errors.go:115-127`; `parallel.Recover`).

Three outputs from my runs [run]:

```yaml
error:
  code: E_UNKNOWN_OPTION
  message: 'levels has no option "blak". Valid options: black, white, gamma, auto.'
  where: 'line 1: return img.levels({ blak: 0.1 })'
  hint: Did you mean "black"?
  fix: 'levels({ black: 0.1 })'
  valid: [black, white, gamma, auto]
---
error:
  code: E_NOT_AWAITED
  message: 'stats() is a lazy node: read .p01 after awaiting it.'
  where: 'line 2: return img.levels({ black: s.p01 })'
  path: open(planted-256x192-16bit.tif) → stats → ✗ p01
  hint: Nothing has been computed yet; awaiting the node evaluates it.
  fix: (await img.stats()).p01
---
error:
  code: E_UNKNOWN_METHOD
  message: Image has no method "exposre".
  where: 'line 1: return img.exposre(1)'
  path: open(planted-256x192-16bit.tif) → ✗ exposre
  hint: Did you mean "exposure"?
  fix: img.exposure(…)
```

**The proxies catch the mistakes LLMs actually make** (prelude.js:7-13, 140-215) [code]:

- coercing a lazy node to a number (`Symbol.toPrimitive`/`valueOf` → `E_NOT_AWAITED`);
- assigning to a node (`E_IMMUTABLE`);
- reading a data field before awaiting it;
- calling a method that does not exist.

The proxies also deliberately let through the probes that generic JS machinery makes (`constructor`, `inspect`,
`$$typeof`, …), so that console and JSON code does not crash.

**Exit codes:** 0 ok, 1 cv error (the structured error is still printed), 2 usage error (README.md:73) [doc;
exit codes 1 and 2 were observed in my runs].

### 3.5 Determinism

- **Same call, same node.** Hash-consing plus canonical arguments (defaults filled before hashing) make the same
  call produce the same node and the same cache key (node.go:17-24) [code].
  - A noted pitfall: `channel(2)` and `channel("b")` hash differently [doc: G1 DD:1620-1622].
- **Stable region ids.** `AnalysisScale` means region ids and coordinates do not depend on preview size [code].
- **Cross-architecture floats.** A fixture differed between amd64 and arm64 in the 5th significant digit, so the
  `localNoise` column was dropped from the fixture (commit `0e96cce`) [code: git log]. The lesson recorded is to
  keep fixtures off the last digits of float reductions [doc: G5 ref/06:1175-1194].
- **Sorts.** An unstable sort broke weighted-quantile ties [doc: G3 ref/03:236].

### 3.6 Evidence-driven design and the multi-agent process

This is the most transferable meta-pattern.

**1. Measure real agents using the API, then delete what they do not use.** All of the following are [doc]:

- GCV-004 analysed 18 pi runs with a small model (deepseek-4.1-flash, 751 eval calls) (G4 ref/01:22-30,
  spot-checked):
  - params and sliders were used **0** times;
  - value lifting was used 4 times;
  - agents wrote `{space}` 198 times;
  - `await` appeared 1139 times against 85 for `cv.evaluate`;
  - only 14 of 246 synonym keys were ever typed.
- What v2 deleted: params, lifting, the Mask kind, `.where/.sortBy`, `show`, and the synonym tables (net
  −2,950 / +900 lines) (G4 DD:160; D1 at DD:1765-1779, spot-checked).
- Outcome:
  - `E_ACCESS` errors dropped to 0, and use of the removed API dropped to 0;
  - median calls fell (51→39 on one benchmark);
  - recall did not change: "the agent's ranking was the limit, not the API" (G4 ref/06:1440-1462).
- GCV-005 analysed 39 Sonnet annotators (374 evals, 0 errors). That analysis produced `cv.load`, the context-block
  signatures, compact tables, sheet captions with ids, and `peaks` (G5 ref/01).

**2. Roles.** One coordinator, one design writer (consistent vocabulary across guides), independent cold
"review-read" reviewers, and one implementer per ticket on stacked branches [doc: G1 ref/01:50-136]:

- Review findings are ranked P1/P2/P3. The writer must fix all P1 and P2 items and dispose of each P3 in a table.
- P1 counts went 15 → 0 over rounds.
- The coordinator noted that fixes themselves introduce new defects.

**3. Deviations.** Implementers append numbered "deviations" to the design doc: what they did differently and
why, while leaving the design text unchanged. GCV-004 has 50 and GCV-005 has 45 (G4 DD:2749-2907; G5 DD:2400-2555)
[doc]. The categories are:

- data and gold-label drift;
- goja runtime realities;
- phase and merge sequencing;
- extra deletions;
- performance-driven kernel changes;
- numeric precision;
- doc size caps;
- error-fix wording.

Instructive examples:

- **G4 #37.** A "regression" in speck ranking was actually tiles re-exported with density as code values but
  read as sRGB. **This matters for chromobench**, because scan files whose encoding is mis-declared will silently
  skew any analysis.
- **G4 #19.** `as()` folding avoids full-size copies.
- **G4 #4.** goja's interrupt is sticky, so a timeout test cannot tell passthrough from conversion.
- **G5 #33-34.** Per-goroutine band work beat finer synchronisation: 187→101 ms.

**4. Things that were designed, built and then deleted**, because evidence showed they were noise [doc]:

- **`UNUSED_NODE` lint.** 18 of its 19 warnings were false. It went through three design revisions before being
  deleted (G5 DD:75-76, D10).
- **`OpDef.Halo` and the `CROP_FIRST` lint** (G5 D25) [code: commit `5c26122`].
- **`grow`/`shrink`**, replaced by `erode`/`dilate`.
- **The synonym tables**, replaced by `Redirects`, used only for names agents actually typed (G4 D12).

### 3.7 Key design decisions by ticket, including reversals

| ticket | decision | status today |
|---|---|---|
| GCV-001 | Encoding belongs to data; linear = "declared encoding undone"; conversions are graph nodes inserted by the builder, never inside kernels (G1 DD:1047-1097) | conversions-as-nodes **kept** [code: `as` nodes in explain] |
| GCV-001 | Working space per op, no image or session default (G1 DD:1099-1108) | **reversed** by GCV-004: space lives on the image |
| GCV-001 | Frames make coordinates absolute in the source file's pixel grid; `x,y` = corner, `cx,cy` = centre (G1 DD:1167-1190) | kept [code: `origin` option, items] |
| GCV-002 | Content-dependent things are nodes (crop); output-raster things are look options (zoom). Three op classes under zoom (G2 DD:83-201) | kept [code] |
| GCV-002/003 | One way per thing; flat fields with one naming rule; removed names throw with a literal fix rather than aliasing (G3 DD:715-748) | kept and extended in GCV-004 |
| GCV-001 | Params (`P.slider`) with per-param cache signatures for interactive tweaking (F:87, 142-146) | **deleted** in GCV-004 (0 agent uses) [code: no `Param` in graph] |
| GCV-004 | Literal options; data dependencies through `await` | current [code: prelude.js:13] |
| GCV-004 | Masks are 1-channel images; regions are arrays with `[node,index]` links (revision 1 used ids, rejected because renumbering picks the wrong region) | current [code] |
| GCV-004 | One `await`, one `look`, one `save`, one workspace | current [code] |
| GCV-005 | `cv.load` + `--prelude` (over an `eval_file` MCP tool, because it works in CLI, MCP and embedded alike); context block with signatures; compact tables; peaks; erode/dilate only | current [code] |

---

## 4. Packaging and testing

### 4.1 CLI

`cmd/goja-cv` uses Cobra plus Glazed help pages (`pkg/doc/*.md`) wired with `help_cmd.SetupCobraRootCommandE`
(`cmd/goja-cv/root.go:60-76`, `ops.go:112`) [code]. The commands are not Glazed commands. They are:

- `run SCRIPT.js` and `eval -e CODE`, with flags `--image`, `--root` (once), `--read` (repeatable), `--out`,
  `--prelude` (repeatable), `--json` and `--timeout-ms`. Output is YAML to stdout and looks are written as files
  (`cmd/goja-cv/eval.go:33-74`) [code].
- `ops [--kind K] [--json]`: the registry.
- `help NAME`: a guide page, command help, or op/kind/function/concept.
- `mcp`: an MCP server over stdio, or `--http ADDR` (loopback unless `--allow-remote`; there is no auth).
  `--root` is required (`cmd/goja-cv/mcp.go:33-78`) [code].

### 4.2 go-go-goja integration (the part to copy most directly)

**Module registration** (`pkg/gojamod/cv/module.go`) [code]:

- `Module` implements `modules.NativeModule` (`Name`, `Doc`, `Loader`) and is registered globally in `init()`
  with `modules.Register(New())` (module.go:63-98, 180-182). This is the standard go-go-goja pattern.
- `Registrar` implements `engine.RuntimeModuleRegistrar` for `engine.NewRuntimeFactoryBuilder().WithModules(...)`.
  It creates **one engine per runtime**, stores it in the runtime values (`cv.engine`), and registers a loader
  bound to it (module.go:155-178).
- The loader runs the embedded `prelude.js` (compiled once with `goja.Compile`) and passes it a native binding
  object of `__`-prefixed functions (`binding.go:40-63`). It copies the returned object's keys onto
  `module.exports`.
- **Pattern:** a thin native binding with an untyped, underscore surface, plus a JS prelude that builds the
  ergonomic API. The method tables come from the Go registry, so nothing is hand-maintained twice.

**Session** (`pkg/cvsession/session.go:162-293`) [code]:

- **Runtime factory:** `engine.NewRuntimeFactoryBuilder(WithDataOnlyDefaultRegistryModules(false),
  WithRequireOptions(require.WithLoader(noFileModules)))`, then `.UseModuleMiddleware(engine.MiddlewareOnly("timer"))`,
  then `.WithModules(&cvmod.Registrar{…})` and `.WithRuntimeInitializers(&Initializer{…})`.
- **App:** a `replapi.App` with `ProfileRaw`, a `SessionPolicy` (raw eval mode, top-level await, console
  capture, timeout), a custom `ResultProcessor` (replsession `ResultProcessor`, `BeforeEvalHook` and
  `FailureProcessor`), and `resultcontent` limits for images.
- **MCP server:** `replmcp.NewServer(app, WithInstructions, WithLimits, WithExtraTools(…))`, which swaps the
  generic eval tool for the cv one (`mcp.go:54-100`).
- **Threading:** all goja access happens on the runtime owner goroutine. Long work runs elsewhere and posts back
  through `runtimebridge` (`binding.go:15-18, 255-286`).

**Version pin.** go-go-goja is pinned to a pseudo-version from a PR commit (go.mod:11). AGENT.md:21-22 says not
to bump it casually and never to commit a `replace` [code+doc].

### 4.3 xgoja provider

`pkg/xgoja/providers/cv/cv.go:20-98` [code]:

- `Register(registry *providerapi.ProviderRegistry)` adds package `goja-cv` with module `cv`.
- The module has a JSON-schema-validated config (`root`, `read`, `cacheBytes`, `lookLong`; unknown fields are an
  error) and a `NewModuleFactory` that builds one engine per runtime.

`examples/xgoja/cv-agent/xgoja.yaml` (schema `xgoja/v2`) generates a `cv-agent` binary with `run`, `repl`, and the
go-go-goja MCP command set. Its comment notes two things:

- The generic MCP command set uses go-go-goja's default result processor: no cv YAML or tables. `goja-cv mcp` is
  the full experience.
- Provider ids must equal package IDs.

### 4.4 Tests

`go test ./... -count=1` passes in all 15 packages that have tests; package times sum to about 28 s [run]. The
env-gated real-data tests were not enabled, because no `GOJACV_*` variables were set. The kinds of test:

| kind | where | what |
|---|---|---|
| unit | every package | kernels, decoders, args/binding, schema, workspace, etc. |
| golden looks | `pkg/cv/look/golden_test.go:19-28`, `testdata/golden/*.png` | renders a fixed list of looks of the planted scan and compares the 8-bit image **before** caption burn-in and JPEG encoding, exactly; `-update` rewrites |
| planted ground truth | `internal/testimage/planted.go:11-40` | synthetic 256×192 16-bit scan with known specks (position, radii, contrast, polarity), a star and noise; used by tests, docs and smoke |
| gold (real data) | `pkg/cv/ops/*_real_test.go`, `peaks_gold_test.go` | env-gated on human-labelled real tiles; compares **two methods on the same points in one run** instead of asserting absolute counts, because the labels change [code: peaks_gold_test.go:15-26] |
| docs are tests | `pkg/cvsession/docs_test.go:91-104` | every `js` block in agent topics and guidebook runs in a real session |
| documented commands parse | `cmd/goja-cv/doc_commands_test.go:100` | every `goja-cv …` command in README and guide parses |
| result format | `pkg/cvsession/tables_test.go:79-92`, `testdata/representative.result` | pins the exact text an agent sees |
| acceptance | `pkg/cvsession/acceptance_test.go` | end-to-end scenarios (zoomed windows, sheet of 36, redirects, lossless) |
| security | e.g. `TestRequireLoadsNoFiles` | sandbox holes found by agents become tests [doc: G5] |
| smoke | `Makefile:88-100` | builds the binary, generates images, runs `help`, `ops --json` and an `eval --json`, and checks the output with `jq` |

CI runs `-race`, smoke, golangci-lint (pinned), glazed-lint, govulncheck, gosec, CodeQL and secret scanning
(`.github/workflows/*`) [code: file list; doc: README]. Releases go through GoReleaser Pro with Vault/OIDC, with
no repository secrets (AGENT.md:70-79) [doc].

---

## 5. What does NOT transfer well to an interactive GUI with GPU or real-time previews

goja-cv is built around **discrete, text-returning evals by a slow consumer**: an LLM that waits seconds per turn
anyway. Chromobench's main user is a photographer dragging sliders.

### 5.1 Execution model

1. **One single-threaded JS VM per session, with one owner goroutine.** Every node build, promise settlement and
   result render goes through it (binding.go:15-18) [code].
   - That is fine for agent turns, but **the GUI must not route slider events through JS**.
   - The GUI should call the Go core (registry/builder/evaluator) directly. JS should be a peer façade over the
     same core, not the core's only entry point.
2. **Evals are serialized per session and bounded by a timeout** (60 s default). A watchdog interrupts runaway JS
   (`session.go:308-323, 370-412`) [code].
   - There is a goja caveat: an interrupt inside a resumed async continuation leaves the VM unable to run
     promises. The session is then marked broken and must be recreated (`processor.go:314-331`;
     `pkg/doc/10-troubleshooting.md:66-71`) [code].
   - In a GUI that keeps one long-lived runtime, this would mean losing state. Isolate agent runtimes from the
     document state, and keep the document in Go rather than in `mem`.
3. **Live parameters were removed.** GCV-001 had `P.slider` params with per-param cache signatures, which is
   exactly the GUI-friendly design. GCV-004 deleted them because agents never used them [doc: G4 D1; code: no
   `Param` in `pkg/cv/graph`].
   - Chromobench needs the opposite trade-off: **human controls are first-class**.
   - Expect to reintroduce stable, named parameters (or "edit nodes" with mutable settings and stable ids) in the
     document model. Literal-options hash-consing can still be used underneath, for caching.
4. **There is no edit document, undo or history model.** goja-cv graphs are ephemeral per eval, and only `mem`
   persists, in memory, per session [code: init.js; doc: troubleshooting].
   - Chromobench needs a persisted, versioned edit recipe per image: a non-destructive sidecar, like
     Lightroom/darktable XMP.
   - Hash-consed immutable nodes are a good *implementation* of that, but the recipe format, ids and migrations
     are new work.

### 5.2 Rendering and performance

5. **CPU only, full frame, no windowed or tiled evaluation.** Pixel ops are always computed on the whole image at
   the requested scale. Windowed evaluation with per-op halos was designed and then dropped (`OpDef.Halo` was
   deleted) [doc: G3 ref/03:597-609, G5 D25].
   - Measured on 24 MP [run]:
     - a preview look took about 0.55 s process wall time;
     - a full-resolution exposure→levels→histogram took 824 ms, or 178 ms when only the last op changed;
     - exposure→gaussian(2)→stats took about 5.1 s;
     - a first full-frame `stats` took about 4.8 s.
   - That is acceptable for agents and export, and **too slow for 60 fps slider feedback**. Nothing in goja-cv
     targets the GPU, and none of the tickets discusses GPU or real-time work [doc: both helper reports].
6. **Looks are not a display pipeline.**
   - They are JPEG/PNG-encoded files capped at 4 per eval, 8 MiB, and 1568 px, with a burned-in look number and a
     bitmap caption (`look.go`) [code].
   - A GUI needs a continuously updated canvas and colour-managed display output (not the sRGB curve only),
     progressive refinement (preview first, then full resolution), and cancellation of superseded renders.
   - The pyramid plus scale-quantised cache plus context cancellation are useful building blocks. "Last request
     wins" scheduling does not exist yet.
7. **Memory model.** Planar float32 RGB costs about 12 bytes per pixel per intermediate. The cache defaults to a
   2 GiB byte cap, and RSS reached 1.6 GB for one 24 MP image in my run [run].
   - A 100 MP scan is about 1.2 GB per intermediate (the docs cite 0.64 GB for 7256×7326) [doc: G4 DD:2651-2655].
   - A GUI with several open images and undo states needs tiling, half-float GPU textures, or explicit residency
     management.

### 5.3 Colour and inputs

8. **Colour science is out of scope** [code: decode.go:89, decoders_test.go:234-240; doc: G1 DD:147-151]:
   - no ICC profiles;
   - no camera colour matrices;
   - no CFA demosaic (refused);
   - only `srgb` and `linear` encodings.

   Chromobench's core is camera RAW → scene-linear → negative/film density → paper → display. All of that is new.
   The *pattern* of encodings and spaces declared on the image, conversions inserted by the builder, and "physical"
   ops computing in linear light does carry over and should be extended with more spaces.

### 5.4 Agent-only conventions

9. **Agent-specific output shaping is irrelevant to the GUI.** This covers the YAML caps, compact tables, context
   block, `E_NOT_AWAITED` proxies, burned-in look numbers and sheet captions. Keep them in the agent façade, as
   goja-cv does in `cvsession`, and out of the core.
10. **The sandbox model differs.** `--root`/`--read` with `os.Root` is right for the agent. GUI users pick files
    with OS dialogs and expect their library (catalog) to work. The agent should see the catalog through a
    restricted API (e.g. `lib.find(...)`, `lib.open(id)`), not through raw paths.

### 5.5 What transfers well

- **One registry of op definitions** with typed, unit-tagged, range-checked arguments and doc strings. It can
  generate the agent API, the help text, *and* the GUI's control panels: sliders from `Min`/`Max`/`Usual`, enums
  as dropdowns, units as labels.
- **Hash-consed immutable nodes plus a byte-capped cache keyed by (hash, scale), plus a preview pyramid.** This
  gives free memoisation when one slider changes downstream of unchanged nodes. The measured re-eval dropped from
  824 ms to 178 ms when only the last op changed [run].
- **Coordinates in document pixels** with `AnalysisScale`, so that preview and export agree.
- **Op classes** (pixel, geometric, decoration) for zoomed rendering.
- **Masks as one-channel images**, plus `within(mask, edit)` builder lambdas. This is dodge, burn and local
  contrast.
- **Structured errors with literal fixes, redirects mined from real agent typos**, and tool descriptions that
  say when to omit optional fields.
- **"Never make a model read a number off a picture."** For chromobench, this means returning density, Lab and
  clipping numbers alongside every proof print.
- **Tests that execute the docs; golden looks compared before encoding; env-gated gold tests on real
  labelled data; a synthetic image with planted ground truth.** For chromobench the planted equivalent would be a
  synthetic negative with known densities or a target chart (e.g. a step wedge plus a ColorChecker rendered
  through a known film model).
- **The process:** design doc → cold review → numbered deviations → instrumented agent runs → delete what
  agents don't use.

---

## 6. Concept map: goja-cv → chromobench

| goja-cv | chromobench analogue |
|---|---|
| `graph.Registry` / `OpDef` / `ArgSpec` | one op catalog for develop, film, paper and local ops; it generates the JS API, help, and GUI controls |
| node (immutable, hash-consed) | an evaluated step of an edit recipe; the recipe itself needs stable ids, mutable params, persistence and undo |
| encoding + space on the image, `as()` | colour state on the image (camera RGB, XYZ, log-exposure, density, print density, display) with builder-inserted conversions |
| Physical ops (linear light) | exposure, film exposure (H&D / characteristic curves), paper exposure, filtration |
| `within(mask, i => …)` + mask ops | dodge, burn, flashing, local contrast/filtration; split-grade printing per mask |
| `heal` / `inpaint` / `detect.specks` / `peaks` | dust and scratch removal on negative scans; this is literally goja-cv's home domain |
| `stats`, `histogram`, `profile`, `measure` | densitometer readings, clipping checks, base+fog, D-max, neutral checks |
| looks, `compare`, `sheet` | test strips, ring-arounds, contact sheets, before/after |
| `--root` / `--read` workspace | catalog plus export folder; the agent gets a restricted catalog API |
| `cv.load` / `--prelude` task libraries | "printing recipes" or playbooks, e.g. a standard Portra 400 → RA-4 workflow, loadable by the agent |
| planted-fault scan + golden looks + gold tests | synthetic negatives and target charts through a known model; real scans with hand-made reference prints |

## 7. Open questions for chromobench

1. **How the GUI and the agent share state.** Should the GUI and the agent edit the *same* persisted recipe, with
   the agent's JS calls becoming recipe edits the user can see and undo? Or is the agent only an analyser and
   proposer?
2. **Where the GPU fits.** Should the GPU path (WebGPU/Metal/Vulkan shaders) re-implement each op's `Run` for
   preview, with the CPU Go kernels as the reference and the export path? If so, CPU–GPU parity tests with a
   tolerance (goja-cv's "≤1 code on ≤1% of samples" rule from G1 DD:1482-1499) are the model.
3. **The binding style.** Should the agent façade keep goja-cv's "thin underscore binding plus registry-generated
   JS prelude" style? That style avoids hand-maintaining the API in two places.
4. **Whether to expose literal options and params together.** Agents never used sliders, and humans always do.
   One answer: recipe params are named and mutable for the GUI, and the JS API takes literal values that write
   those params.
