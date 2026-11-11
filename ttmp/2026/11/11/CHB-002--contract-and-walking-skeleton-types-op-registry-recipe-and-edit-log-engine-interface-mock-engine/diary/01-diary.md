---
Title: Diary
Ticket: CHB-002
Status: active
Topics:
    - architecture
    - js-api
    - dsl
    - testing
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:22.139464058-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-002 and CHB-007 (contract and DSL runtime). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-contract-and-walking-skeleton.md` (13994 words), added 16 staged tasks, and related the primary source files.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Requested milestone: a complete intern guide plus a task breakdown for this ticket.
**Inferred user intent:** The ticket can be picked up by a new engineer or agent without prior context.

### Evidence and commits
- Brief: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md` (session scratchpad); shared map: CHB-001 `design-doc/01-chromobench-architecture-and-work-plan.md`.
- Filed with `python3 -I CHB-001/scripts/07-ingest-intern-guides.py <agent output> .` and checked with `scripts/08-check-guide-markdown.py` (fences tagged, no raw HTML).
- Writer agent: one background general-purpose agent for CHB-002 + CHB-007; ran a quickjs-emscripten 0.32.0 spike on Node 24.18 in the session scratchpad (guides/spike/); CHB-007 recommends the sync QuickJS variant with host promises over asyncify (DR-2).
- The writer's own summary, kept as returned:

> Both intern guides are below in the brief's block format: CHB-002 "Contract and walking skeleton" and CHB-007 "DSL runtime". I also ran a small spike in the scratchpad: quickjs-emscripten 0.32.0 on Node 24.18, scripts in `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/spike/`. Nothing under `ttmp/` or goja-cv was modified.
> 
> Points you should know before storing them:
> 
> - **CHB-007 recommends against the planned asyncify variant.** It proposes the sync variant with host promises instead (DR-2), and the guide marks this as a change to the ticket plan. The reasons:
>   - Agent code runs as an async function body, so everything after the first `await` executes inside `executePendingJobs`, and that call has no async version in 0.32.0.
>   - In the spike, an asyncified call made after an `await` returned "0 jobs" while it was still suspended. A second eval then ran during the suspension.
>   - The asyncify build is twice the size (1.03 MB against 503 KB) and runs at about 40 % of the speed of the sync build.
> - **Other spike observations, which stage 1 of CHB-007 is to turn into tests:**
>   - host promises work across `await` chains and `Promise.all`;
>   - interrupts stop loops both before and after an `await`, and the same VM keeps working afterwards;
>   - the memory limit raises "out of memory";
>   - `Symbol.toPrimitive` traps fire;
>   - `Function.prototype.toString` keeps the source, comments included;
>   - `Date` can be disabled, but `Eval: false` breaks `evalCode` entirely;
>   - a leaked handle makes `rt.dispose()` abort.
> - **CHB-002 corrects one inconsistency in the architecture doc.** The vocabulary example `{path:'print.lights', value:[0,4,-2]}` should be `print.lights.logH`, with values in log H. This is listed under proposed contract additions.
> - **Both guides use the same mock-engine numbers.** A grey patch goes from (0.370, 0.434, 0.548) to (0.313, 0.434, 0.548) at +4 pt red. The agent's balance proposes lights of −4.5 / −0.5 / +5 pt.
> 

### Noteworthy decisions or failures
- The guide's "Proposed contract additions (for CHB-002)" section, where present, is a proposal. It must be reconciled with CHB-002 before implementation.
- Numbers the writer computed for the guide (not from the textbook) are labelled as such in the guide. They are not independently re-verified here.

### Remaining requirements and next action
- Implementation has not started. Tasks in `tasks.md` are open.
- Next: review the guide, settle the open decisions it lists, and start stage 1.

## Step 2: Orientation: the brief, the writing procedure, the architecture doc and the ticket layout

Before reading any code, I read the orchestrator's common brief, the design-guide writing procedure and the CHB-001 architecture document. The brief fixes the return format and the constraints. The architecture doc fixes the vocabulary every guide must use: domains, units, op names and contract shapes. The aim was to know which names were already decided, so that the guide would only propose changes in a clearly labelled section.

This worked. The architecture doc's §5 contract sketches, §6 layout and §8 plan became the spine of the CHB-002 guide. The ticket directories for CHB-002 and CHB-007 already existed. I wrote nothing into them, as the brief required.

### Prompt Context

**User prompt (verbatim), for the guides:** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."

**User prompt (verbatim), for this diary:** "ask them to write all detailed diaries for their work and add those to the ticket too, see diary skill for the format."

**Orchestrator brief (from the orchestrator, not the user's words):** The task message asked this agent to write the CHB-002 "Contract and walking skeleton" and CHB-007 "DSL runtime" guides. It pointed to the common brief at `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md`. The brief requires the following:
- use the architecture doc's vocabulary;
- follow the two-pass writing procedure;
- aim for 5,000–10,000 words;
- tag every code fence and use no raw HTML;
- treat `ttmp/` and goja-cv as read-only and do not write the guide into the ticket;
- return the GUIDE, TASKS and RELATED blocks through SubagentHandback.

**Assistant interpretation:** Write an intern guide for CHB-002 that covers its nine stages, from toolchain to M1. Base it on the existing prototypes and on goja-cv, and return it as text for the orchestrator to file and upload.

**Inferred user intent:** A new engineer should be able to start the contract work, and every parallel ticket should share one vocabulary.

**Commit (code):** none. This agent made no commits; the orchestrator files the guide (Step 1).

### What I did
- Read the common brief (#1, 15:43:51Z).
- Ran `ls -R | head -100 && wc -l design-doc/* various/*.md` in C1 (#2).
- Read `/home/manuel/.claude/skills/ticket-research-docmgr-remarkable/references/writing-style.md` (#3).
- Read `C1/design-doc/01-chromobench-architecture-and-work-plan.md` in full (#4).
- Read `C1/various/analysis-goja-cv.md` and `C1/various/analysis-filmbench-ide.md` in full (#5, #6).
- Ran `ls` in `/home/manuel/code/wesen/chromobench/ttmp/2026/11/11/` and printed the CHB-002 and CHB-007 index and tasks files (#67, 15:45:56Z).

### Why
- The brief requires the architecture doc's names. Reading it first meant that every later deviation could be written up as a proposal rather than drifting into the text.

### What worked
- The ticket listing showed `CHB-002--contract-and-walking-skeleton-types-op-registry-recipe-and-edit-log-engine-interface-mock-engine` and `CHB-007--dsl-runtime-quickjs-sandbox-generated-bindings-agent-ergonomics`, among the fourteen tickets.

### What didn't work
- No failures in this step.

### What I learned
- Contract changes belong in CHB-002's catalog, introduced by a changelog note (architecture doc §8.3). The guide's §7 change process is built on this rule.
- The architecture doc leaves several types open, for example `SourceInfo`, `ImageResult` and the recipe's helper types. The guide defines them as proposals.

### What was tricky to build
- Scope boundaries. CHB-002 touches every other ticket. Each part of the guide had to say what belongs to CHB-003, CHB-005, CHB-006, CHB-007 or CHB-009, so the intern does not build physics, kernels or decoders here.

### What warrants a second pair of eyes
- N/A for this step.

### What should be done in the future
- N/A.

### Code review instructions
- Read the brief and architecture doc §5, §6 and §8 before reviewing the guide.

### Technical details
- In this diary, C1 means `/home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`, and SP means `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/`.
- Tool-call numbers (#n) follow the order of tool-use entries in this agent's transcript, `/home/manuel/.claude/projects/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/subagents/agent-afd006dbea6d43a29.jsonl`, as listed by `SP/diary-002-007/extract.py`. The transcript repeats some entries without timestamps, and those repeats are counted. Times are UTC, taken from the transcript.

## Step 3: goja-cv study: registry, node hashing, argument binding, evaluation cache and errors

goja-cv is the closest existing design for an op registry that generates an API. I read its graph package to see what CHB-002's `OpDef`, `ArgSpec`, binder and hash-consed graph should inherit. The goal was precise line citations and a list of the things that must not transfer.

The registry metadata, the binder rules, the length-prefixed node hash, scale quantisation and warning replay on cache hits all transferred. Three things did not: `Run` inside `OpDef`, live parameters and CPU-only evaluation. Each became a decision record or a "leave behind" note in guide §4.1.

### Prompt Context
See Step 2.

### What I did
- Ran `cd ~/code/wesen/go-go-golems/goja-cv && git log --oneline -1 && wc -l …` (#9, 15:44:01Z).
- Read `pkg/cv/graph/registry.go`, `errors.go`, `node.go`, `cache.go` and `eval.go` in full (#10, #11, #14, #15, #18).
- Ran `grep -n "canonicalJSON\|func normalize" -A30 pkg/cv/graph/*.go | head -80` to find the canonical argument code (#19).
- Later, while writing the binder section, ran `grep -n "^func\|Levenshtein\|damerau" pkg/cv/graph/suggest.go` and `grep -n "EUnknownOption\|Redirects\|EArgRange\|WRange" pkg/cv/graph/args.go` (#108). Then printed `args.go` 735–765 and 1045–1090 and `suggest.go` 20–75 (#109, 15:52:08Z).

### Why
- The DSL (CHB-007) and the UI (CHB-009) both generate their surfaces from the registry, so its semantics had to be pinned down first. goja-cv's report (`C1/various/analysis-goja-cv.md`) explains the design, but the line ranges had to come from the source itself.

### What worked
- The revision was `5a93095 Merge pull request #8 from go-go-golems/task/root-flag-once`. Line counts: `registry.go` 476, `node.go` 474, `eval.go` 453, `cache.go` 136, `errors.go` 133.
- Citations used in the guide:
  - `registry.go`: `ArgSpec` 149–182, `OpDef` 235–299, `Register` validation 326–366;
  - `node.go`: 17–32, 197–217, 406–428;
  - `args.go`: 455–462, 466–500, 741–756, 1045–1080;
  - `suggest.go`: 25–71;
  - `eval.go`: 103–111, 237–264, 289–294;
  - `cache.go`: 12–119;
  - `errors.go`: 15–50.

### What didn't work
- No failures in this step.

### What I learned
- goja-cv keeps `Run` in `OpDef` because it has one engine. Chromobench has three engines, so the guide makes `OpDef` metadata only (DR-1).
- `hashNode` length-prefixes the op key and the canonical JSON. The guide's `nodeId` copies this so that two different `(op, args)` pairs cannot produce the same bytes.
- Cache hits replay the warnings stored with the entry. This became an engine rule in guide §5.9.

### What was tricky to build
- Separating what goja-cv does from what it should do. The report's §3.5 pitfall (`channel(2)` and `channel("b")` hashed differently) is a canonicalisation bug, not a design to copy. The guide notes it as a warning.

### What warrants a second pair of eyes
- The line ranges were read once at `5a93095`. They will drift if goja-cv changes, so a reviewer should spot-check two or three citations.

### What should be done in the future
- When CHB-002 is implemented, port `suggest.go`'s `closest()` with its edit budget `max(1, min(3, len/3))` and test it against goja-cv's own cases.

### Code review instructions
- Compare guide §4.1 with `/home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cv/graph/registry.go` 149–182 and 235–366, and `node.go` 406–428.

### Technical details
- The binder order in guide §5.4 follows `args.go`:
  1. normalise;
  2. unknown key → `E_UNKNOWN_OPTION` with a redirect or did-you-mean;
  3. fill defaults;
  4. type check and non-finite → `E_ARG_RANGE`;
  5. hard range → `E_ARG_RANGE`, soft range → `RANGE` warning;
  6. `validate`;
  7. freeze.

## Step 4: Filmbench IDE study: parameter table, typed taps, edit log and its known bugs

Filmbench's V2 runtime has the most complete existing edit log: `by` tags, ask mode, pending approvals, transactions, undo and a state hash. I read the relevant ranges of the extracted inline script. The goal was to find what to port and what to fix, with line numbers the intern can check.

The model ported well: a closed op set, `by` tags, a pending queue and two hashes. Five problems became "fix rather than port" items in guide §4.2. The edit-log decisions DR-5, DR-6 and DR-7 replace snapshot stacks, timed coalescing and unchecked approvals.

### Prompt Context
See Step 2.

### What I did
- Listed `C1/various/extracted/filmbench-ide` and read lines 1131–1176, the diagnostics helpers (#44).
- Read the parameter table at 1214–1320 (#45) and the typed taps at 1420–1470 (#46).
- Read `Net.insert` at 1500–1570 and the cache keys at 1590–1630 (#47).
- Read the control plane layers at 1796–1880 (#48).
- Read the bench, `apply` and the op set at 2203–2240 and 2290–2420 (#49).
- Ran `grep -n "function hash\|function stable\|const hash\|V2.hash\|V2.by\b\|V2.by =" 01-inline.js` (#50).
- Read `C1/various/analysis-filmbench-ide.md` in full (#6).

### Why
- The CHB-002 `EditLog` must support the UI, the agent's ask mode and undo. Filmbench has all three, so its weak points show where the design needs a firmer rule.

### What worked
- The #50 grep returned:
  - `1121: function stable(v)…`;
  - `1122: function hashStr(s) { // cyrb53`;
  - `1129: const hash = …`;
  - `2125: V2.by = 'script';`;
  - `2324: by = by || V2.by || 'script';`.

  These are the basis for the "53-bit cyrb53 hash" and "mutable global author tag" findings.
- Other citations used in the guide:
  - the parameter table, 44 rows in 8 groups (1214–1316), and clamping in `coerce` (1303–1316);
  - `TAP_TYPE` (1430) and `E_PORT_TYPE` in `Net.insert` (1538–1554);
  - `keyOf` (1596–1613) and the `why(path)` layer printout (1862–1876);
  - `apply` with the 900 ms coalescing (2323–2338), the `_exec` op set (2339–2376) and `tx`/undo/approve (2380–2390);
  - the state and log hashes (2394–2401, 2210).

### What didn't work
- No command failures.

### What I learned
- Five problems to fix rather than port:
  - a second, unreachable `case 'pipe.scene'` at line 2370;
  - structural edits (`rig.insert`, `drop`, `fork`, `engine()`) call `_touch()` directly, so they bypass the log (1522–1563);
  - the author tag is a mutable global;
  - the hash is cyrb53, not cryptographic;
  - undo snapshots are capped at 150 and the log at 600 (2322, 2336), so the two can disagree.
- Filmbench clamps out-of-range values with a `W_CLAMP` warning. The guide refuses silent clamping (DR-2).

### What was tricky to build
- Mapping Filmbench's tap types onto the architecture doc's domain names without inventing a third vocabulary. The guide states that "these are domains under other names" and points to architecture doc §5.1.

### What warrants a second pair of eyes
- The 150/600 caps and the line-2370 duplicate case were read from awk range output. A reviewer could re-check them with `awk 'NR>=2320 && NR<=2372' 01-inline.js`.

### What should be done in the future
- N/A.

### Code review instructions
- Compare guide §4.2 with `C1/various/extracted/filmbench-ide/01-inline.js` 2203–2401.

### Technical details
- DR-6 replaces Filmbench's 900 ms timed coalescing with `preview` during a drag and a single `apply` on release. This follows Chromogen's `set(changes, {commit:false})` at 4136–4160 (Step 5).

## Step 5: Chromogen Studio and textbook study: units, spectrum kinds, the SLIDERS schema, recipe history and laws

Chromogen Studio already enforces units and spectrum kinds with error messages that name their source, and it has a 35-control slider schema. The textbook states the composition laws and the law harness. I read both to fill CHB-002's units, spectrum, registry-hint and law sections with worked numbers taken from the sources.

This produced the unit conversion table, the Hunt 14.17 example and the Beer–Lambert golden numbers. It also produced the `cost` → `class` + `binding` mapping and the law harness API. One count, the number of controls, was wrong in the first draft and fixed in review (Step 9).

### Prompt Context
See Step 2.

### What I did
- Read Chromogen `units.js` at 142–216 (#56) and `spectrum.js` at 218–383 (#57) in `C1/various/extracted/chromogen-studio/05-inline.js`.
- Read `SECTIONS` and the start of `SLIDERS` at 990–1100 (#58).
- Summarised every field value in 1003–1597 with `grep -oE '^\s+(id|cost|domain|kind|section|unit): [^,]+' | sort | uniq -c` (#59).
- Read `state.js` at 3845–3990, then grepped for history and `st:` commands and read 4130–4200 and 4365–4465 (#60–#62).
- Listed the textbook headings (#63). Read §2.8 and §2.9 at lines 588–665 (#64). Grepped for the golden numbers (#65). Read §1.1 and §1.2 at lines 53–60 and 82–98 (#66).
- Grepped the Chromogen analysis for state, recipe and units notes and read its lines 640–670 (#105–#107).

### Why
- The units and spectrum-kind rules guard against the most common bug in this field: a correct operation applied to the wrong kind of number. Taking the numbers from the textbook, rather than making them up, gives the tests real expected values.

### What worked
- The #59 counts:
  - `kind`: macro 17, operator 14, hybrid 4, so 35 controls;
  - `cost`: free 21, spatial 11, rebuild 3, also 35;
  - `domain`: "paper log H" 12, "printing density" 6, "dyes" 5, "output (OKLab)" 4, "output" 3, "print" 2.
- Textbook §2.8: a printer light of 0.1 log H changes the green dye by 0.021 near paper white, 0.219 at the grey card and 0.092 in the shadows. A matched density offset is 0.198 everywhere.
- Textbook §1.2 at line 94: the 550 nm parts −0.0264, 0.888, 0.0022 and 0.6024 sum to 1.4662, and the product of their transmittances is 0.03418 = 10^−1.4662.
- Textbook line 57: the stop conversion is 0.30103, and the error message "a density offset is not a log-exposure shift (Hunt 14.17)".

### What didn't work
- The first draft said "31 controls". The #59 counts sum to 35, and the review pass corrected it (#115). The cause was a miscount while drafting. No command failed.

### What I learned
- Chromogen's `to()` converts only EV→logH and mm↔um. The chromobench unit graph is larger (points, CC, mired) and is listed edge by edge in guide §5.2.
- Chromogen's `st:` links and its history both clamp or snapshot whole settings. The guide keeps the idea of commands generated from the schema and drops the clamping.
- The law harness refuses a law without `justifies`. Its `channels.rebate.zero` law cannot fail, which is why the guide requires a mutant for every test.

### What was tricky to build
- Fitting Chromogen's ten units into the architecture doc's `Unit` set. EV becomes `stop`, while `capture.exposureEV` keeps its photographic name with unit `stop`.

### What warrants a second pair of eyes
- The provisional ranges in the catalog came partly from these schemas and partly from judgement, for example `print.lights.logH` with hard range ±1.5 and usual range ±0.5. The owners should confirm them through the change process.

### What should be done in the future
- N/A.

### Code review instructions
- Check guide §2.2–2.4 and the §9 law table against textbook §1.1, §1.2 and §2.8, and against `05-inline.js` 142–383.

### Technical details
- In `toDensity`, Chromogen clamps T at 1e-8, so a transmittance of zero gives 8 D. This is the `spectrum.zero` law.

## Step 6: Toolchain research: headless WebGPU flags for CI (web search only)

Stage 1 of CHB-002 must prove that WebGPU runs in headless Chromium in CI. I searched for the flag sets that Chromium's own tests and other projects use. Nothing was run: Playwright and Chromium were not installed for this work.

The search gave enough to write the Playwright sketch and a "verify against the pinned version" caveat. It did not give a Playwright-specific, version-checked recipe.

### Prompt Context
See Step 2.

### What I did
- Ran WebSearch `Playwright headless Chromium WebGPU CI flags enable-unsafe-webgpu SwiftShader "use-webgpu-adapter=swiftshader" OR "enable-features=Vulkan" GitHub Actions` (#104, 15:51:41Z).

### Why
- `tools/wgsl-check` and the M1 e2e test both depend on WebGPU working in a GPU-less CI runner. Guessing the flags would cost the intern a day.

### What worked
- The search summary pointed to these sources:
  - Chromium's `third_party/blink/web_tests/FlagSpecificConfig` at commit `901b47f2…` uses `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`;
  - Emscripten's CI adds `--enable-features=Vulkan`;
  - Chrome for Developers' "Supercharge Web AI model testing" post notes that headless Chrome disables the GPU by default.

### What didn't work
- The search found no Playwright-specific source. The tool's own summary said: "I did not verify these flags against current Chromium or Playwright releases." The flag sets also differ between sources.

### What I learned
- On a Linux runner without a GPU, SwiftShader is the only adapter. A real compute dispatch with a readback is therefore needed to prove WebGPU works, which is step 4 of the `wgsl-check` design.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Guide §5.1's `launchOptions.args` and `channel: 'chromium'` are unverified. The guide says so, but the first CI run is the real test.

### What should be done in the future
- In stage 1, run the smoke compute shader (`[0,1,2,3]` → `[1,2,3,4]`) on the actual CI runner, and record the working flag set in the CHB-002 changelog.

### Code review instructions
- Guide §5.1 "Tests" and the `playwright.config.ts` sketch.

### Technical details
- Flags in the sketch: `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --enable-features=Vulkan`.

## Step 7: Check: mock-engine numbers for the guide traces, computed in Python

The guide's end-to-end trace ("+4 points red", then undo) and the M1 test need exact expected numbers. I computed them from the mock formulas with a short Python script, so that the guide's table and the later TypeScript mock engine can be compared to 1e-4. The CHB-007 balance trace numbers were computed in the same session and are recorded here too, because both guides share the M1 grey patch.

All numbers in guide §6 and §9 come from these runs. The script models the zero-filtration, zero-flare case only. That is why the guide's M1 default recipe sets `view.flare = 0`.

### Prompt Context
See Step 2.

### What I did
- Wrote `SP/guides/mock_numbers.py` and ran `python3 -I` on it (#111, 15:56:50Z).
- Ran an inline `python3 -I -c` for the visual density, the f-stop, CC and the Beer–Lambert sum (#113, 16:01:53Z).
- Ran an inline `python3 -I -c` for the CHB-007 balance trace (#118, 16:10:41Z).

### Why
- A guide that states golden numbers must be able to reproduce them. Hand arithmetic over a 10-stage chain is error-prone.

### What worked
- Output of #111:

```text
scanner density [0.6021, 0.699, 0.8451]
lights [0, 0, 0] x [-0.6021, -0.699, -0.8451] paper dyes [0.9469, 0.8015, 0.5824] R [0.113, 0.1579, 0.2616] display [0.3703, 0.434, 0.5484]
lights [0.1, 0, 0] x [-0.5021, -0.699, -0.8451] paper dyes [1.0969, 0.8015, 0.5824] R [0.08, 0.1579, 0.2616] display [0.3133, 0.434, 0.5484]
lights [-0.1125, -0.0125, 0.125] x [-0.7146, -0.7115, -0.7201] paper dyes [0.7782, 0.7828, 0.7699] R [0.1667, 0.1649, 0.1699] display [0.4451, 0.4428, 0.4491]
mean 0.7769 dx logH [-0.1133, -0.0164, 0.1297] points [-4.53, -0.66, 5.19]
12.6 s vs 10 s stops 0.3334237337251918 logH 0.10037054511756291 pt 4.014821804702516
1 stop in points 12.0412
0.03417587186243999 0.03418219914176577
```

- Output of #113:
  - visual D 0.8073 before and 0.7808 after balance;
  - `f/8->f/11.31 stops -0.9999978324617836`;
  - `50 CC T 0.31622776601683794`;
  - `1.4662000000000002`.
- Output of #118:
  - now `[0.94691, 0.80154, 0.58235]`, probe `[1.0219, 0.87654, 0.65735]`, slope 1.5;
  - mean 0.77694, dx `[-0.11332, -0.016406, 0.12972]`;
  - points `[-4.5, -0.5, 5.0]`, after `[0.77816, 0.78279, 0.76985]`;
  - visual 0.80726 → 0.78086.

### What didn't work
- No failures.

### What I learned
- The product of the four rounded transmittances is 0.034176, while 10^−1.4662 is 0.034182. They agree to the four significant figures the guide quotes, 0.03418, but not beyond. Tests should compare at that tolerance.
- When flare is zero and `view.adapt` is the identity, the mock's `view.reflect` → `output.display` chain reduces to `sRGB_encode(R)`. The script relies on this.

### What was tricky to build
- Keeping one pixel across both guides. CHB-002's §6 and CHB-007's §7 use the same grey patch, T = (0.20, 0.10, 0.05) against a rebate of (0.80, 0.50, 0.35), so the numbers cross-check.

### What warrants a second pair of eyes
- The catalog default for `view.flare` is 0.48 %, while the M1 default recipe sets 0 so that the trace arithmetic stays exact. A reviewer should decide whether `defaultRecipe` or the catalog default wins for M1.
- The script omits the filtration term because the trace uses zero filtration. The mock formula table in the guide includes it, untested.

### What should be done in the future
- Stage 7: put these numbers in `fixtures/golden/contract.json` and assert them against the TypeScript `engine-mock`.

### Code review instructions
- Run `python3 -I /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/mock_numbers.py` and compare the output with the guide's §6 table.

### Technical details
- Mock formulas: `x = −c + log10(time_s/10) − 2·log10(fstop/8)` and `a = clamp(0.8 + 1.5(x + 0.7), 0, 2.5)` at grade 2. Reflectance is `R = 10^−a`, followed by the sRGB transfer function.

## Step 8: Drafting the CHB-002 guide

With the sources read and the numbers checked, I wrote the full guide in one pass to a scratchpad file, as the brief asked. The structure follows the brief:
- purpose;
- background;
- fit;
- existing material;
- design by stage;
- a traced flow;
- the change process;
- the plan;
- tests;
- risks;
- proposed contract additions;
- references.

The draft was complete but long, and its decision records were numbered in the order I wrote them rather than the order they appear. Step 9 fixes this.

### Prompt Context
See Step 2.

### What I did
- Wrote `SP/guides/draft-chb-002.md` (#114, 16:07:29Z, 92,134 characters).

### Why
- The orchestrator files the guide. The brief forbade writing it into the ticket, so the scratchpad was the only place to put it.

### What worked
- The draft contained:
  - the twelve sections listed above;
  - seven decision records: OpDef as metadata, no silent clamping, source-pixel coordinates, synchronous SHA-256, per-frame logs with a cursor, gestures instead of timed coalescing, and `expect`/`E_STALE`;
  - the v0 catalog for twelve areas;
  - the traced flow;
  - the proposed additions.

### What didn't work
- There were no tool failures. Problems found in review are listed in Step 9.

### What I learned
- The architecture doc's vocabulary row `{op:'set', path:'print.lights', value:[0,4,-2]}` does not fit its own recipe shape. Under that shape, `print.lights` holds `{logH, auto}`, and the values look like points. The guide uses `print.lights.logH` with values in log H, and records the correction as proposed addition 15.

### What was tricky to build
- Balancing the catalog's completeness against length. Every area needed at least its ops, domains, class, binding and recipe paths so that CHB-007 and CHB-009 can generate from it.

### What warrants a second pair of eyes
- The new catalog ops (`source.pattern`, `print.combine`, `output.frame`) and all ranges and defaults are proposals. The owning tickets should confirm them.

### What should be done in the future
- N/A.

### Code review instructions
- Start with guide §5.5 (catalog), §5.7 (`nodeId`, `compile`), §5.8 (`EditLog`) and §11.

### Technical details
- Draft path: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/draft-chb-002.md`.

## Step 9: Review pass and revision

I reread the draft against the brief and the sources, then applied the corrections with small scripted replacements. Each replacement asserted that its target text existed, so a missed edit would fail loudly. I then ran mechanical checks for fences, raw HTML and pipes inside table code spans. The review was my own second pass; no independent reviewer agent was used.

All replacements applied and all checks passed. The guide stayed over the brief's typical length (13,994 words against 5,000–10,000) and was not trimmed before hand-back. A full read-back of the revised file failed on a size limit (exact error below), and only lines 1–140 were reread.

### Prompt Context
See Step 2.

### What I did
- #115 (16:08:12Z), a Python script with asserted `str.replace` calls:
  - renumbered the DRs into reading order with the mapping `{'DR-3': 'DR-5', 'DR-4': 'DR-6', 'DR-5': 'DR-3', 'DR-6': 'DR-7', 'DR-7': 'DR-4'}`;
  - changed "31 controls" to "35 controls";
  - reworded the validation and cursor steps of the trace ("advances the cursor by one", "moves the cursor back by one");
  - changed the `why()` initial line to `(frame.add by auto, library log)`;
  - added the M1 note `view.flare = 0`;
  - added `OpDef.channels` to the conformance table and to addition 6;
  - added addition 18 (layout).
- Checked the DR references and counts (#116, #117).
- #120 (16:15:49Z), during CHB-007's revision, changed addition 4 of the CHB-002 guide to include `OpDef.dsl?: boolean`, so that both guides list the same flag.
- #121: a raw-HTML scan outside code spans and fences.
- #122: a fence-tag count.
- #124: a scan for `|` inside code spans in table rows.
- #126: checked that the related files exist (`args.go`, `describe.go`, `C1/sources/`).
- Read back lines 1–140 (#123). Tried to read from line 140 to the end (#127).

### Why
- The decision records were cited in tables before their definitions, so the numbering confused the reading order. The control count was wrong. The cross-guide flag had to match.

### What worked
- After #115, the DR set was `['DR-1' … 'DR-7']`, defined in order at lines 432, 477, 561, 677, 766, 780 and 786.
- #116: `wc -w` gave 13979 words, and the file has 1156 lines.
- #122: `draft-chb-002.md: fences=36` (ts 9, text 8, yaml 1), with no untagged opening fence.
- #121 and #124 printed nothing: no raw HTML and no pipes inside table code spans.

### What didn't work
- The read-back from line 140 failed (#127):

```text
File content (33750 tokens) exceeds maximum allowed tokens (25000). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file. Even with allow_large, this is more than fits in the context you have left this turn (other large reads in the same turn share that room).
```

- I did not retry in smaller chunks. The context then ran out, and the session continued from a compacted summary. The guide was therefore not reread in full after revision. Step 10 shows that the handed-back text is byte-identical to this file, so no transcription drift was introduced.

### What I learned
- Scripted replacements with `assert a in s` are a safe way to revise a long file without rereading it, because a stale target fails loudly instead of silently.

### What was tricky to build
- Renumbering DRs with overlapping names (DR-3 → DR-5 while DR-5 → DR-3). The script substitutes through a `@@` placeholder in one regex pass, so no number is renamed twice.

### What warrants a second pair of eyes
- Length: 13,994 words is about 40 % over the brief's typical upper bound. The catalog tables (§5.5) and the existing-material tables (§4) are the largest parts. Trimming was skipped because the coordinator asked to wrap up.
- Lines 141–1156 were not reread after the revision scripts ran. Only the targeted greps covered them.

### What should be done in the future
- If the guide is revised, consider moving the full v0 catalog into a separate reference document generated by `tools/gen-docs` once stage 3 exists.

### Code review instructions
- `grep -n "DR-[0-9]" draft-chb-002.md` should list the definitions in order, 1–7.
- The fence check is the awk command in #122. The HTML and pipe checks are the Python snippets in #121 and #124, kept in the transcript.

### Technical details
- Final file: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/draft-chb-002.md`, 93,729 bytes, 1,156 lines, 13,994 words (`wc -w`), sha256 `03e1e703c1ae3dee1f67973119bbdda01f35c1be532d3e160d2331db6fcc523a`.

## Step 10: Hand-back, a re-send, and these diaries

I returned both guides with their TASKS and RELATED blocks through SubagentHandback. The first call reported success. The coordinator then asked to wrap up, and a harness message said the report had not been delivered, so I sent it again. Afterwards the coordinator asked for these diaries. I reconstructed them from the transcript rather than from memory.

The guide text in every handback is byte-identical to the scratchpad file. The diaries go back in a follow-up handback, which the coordinator allowed; the guides are not sent a third time.

### Prompt Context
**User prompt (verbatim):** see Step 2, for both the guide request and the diary request.

**Coordinator messages (from the orchestrator, not the user's words):**
- "Wrap up now. … return your current CHB-002 and CHB-007 guides immediately, in the brief's block format";
- later, the request for these diaries, in the investigation format, starting at Step 2.

### What I did
- #128 (16:25:04Z): SubagentHandback with a short summary plus the GUIDE, TASKS (16 lines) and RELATED (8 lines) blocks for CHB-002 and CHB-007.
- The coordinator's wrap-up message arrived, and the session continued from a compacted summary because the context ran out. I first replied in plain text that the report had already been delivered.
- #130 (16:33:52Z): sent the same blocks again, with the summary noting the re-send.
- For the diaries:
  - read `/home/manuel/.claude/skills/diary/SKILL.md`, `references/investigation-entry.md` and `references/evidence-levels.md`;
  - wrote `SP/diary-002-007/extract.py` to list every tool call and result from the transcript;
  - pulled the exact commands and outputs used above;
  - extracted the handed-back guide text and compared it with the draft files.

### Why
- The orchestrator files the guide from the handback, so it had to arrive. The diary request asked for exact commands and errors, which only the transcript preserves.

### What worked
- Both handback calls returned `{"success":true,"message":"Report delivered to your caller."}`.
- The CHB-002 guide inside all handbacks hashes to `03e1e703…cc523a`, the same as the draft file.
- The CHB-007 guide differs from its file only on line 78, where the file has a blank line with two spaces and the handback has an empty line.

### What didn't work
- My plain-text reply after the first handback was not delivered. The harness then said:

```text
[handback-send-enforce] Your report has not been delivered. Call SubagentHandback({message: <your full report>}) now; the call ends your run.
```

  The re-send (#130) fixed this.
- While gathering diary evidence, `echo ======` in zsh failed with `(eval):1: ===== not found` (#131). The same zsh behaviour had broken #88 earlier (CHB-007 diary). The skill text itself printed before the error, so nothing was lost.

### What I learned
- In zsh, a word starting with `=` is expanded as a command path. Separators like `====` must be quoted.

### What was tricky to build
- Reconstructing per-step evidence after a context compaction. The extraction script was the only reliable source for exact error texts.

### What warrants a second pair of eyes
- The orchestrator should file the guide from the handback rather than from the scratchpad, because the scratchpad is session-scoped and will not persist.

### What should be done in the future
- If the evidence should outlive the session, copy `SP/guides/mock_numbers.py` into the CHB-002 ticket's `scripts/`. This agent did not do so, because the brief made `ttmp/` read-only.

### Code review instructions
- Rerun `python3 -I /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/diary-002-007/extract.py /home/manuel/.claude/projects/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/subagents/agent-afd006dbea6d43a29.jsonl` to regenerate the tool-call list this diary cites.

### Technical details
- Handback sizes: 175,708 characters for the first and 175,791 for the re-send.
- Repository HEAD when this diary was written: `b49ee56`. That commit is the orchestrator's; this agent made none.

## Step 11: Implementation, stages 1–8: workspace, contract v0, mock engine, conformance

Implementation started on a new branch `task/chb-002-contract` (from `task/chb-work-plan`). This step covers the guide's stages 1 to 8: the toolchain, the whole `@chromobench/contract` package, `engine-mock`, `conformance` and `tools/gen-docs`. It ends with the first milestone commit `a3eca46`, with 468 Vitest tests and 4 Playwright tests passing.

### Prompt Context
**User prompt (verbatim):** (orchestrator brief, summarised) Implement ticket CHB-002 "Contract and walking skeleton" in `/home/manuel/code/wesen/chromobench`: read the architecture doc §3–6 and §8 and the CHB-002 intern guide, settle every other guide's "Proposed contract additions" into contract v0 and record each decision in `packages/contract/CONTRACT-DECISIONS.md`; defaults for the §8.4 open questions (both RAW kinds, all capture setups, B&W later with `silver-density` reserved, files + ICC first, static PWA); stages 1–6 of the guide plus a minimal M1 demo; branch `task/chb-002-contract`, commit at milestones, no push; keep this diary.
**Assistant interpretation:** Build working code for every stage, keep the contract stable enough for 003/004/005/006/007/009 to start in parallel; the guide is a map, not law.
**Inferred user intent:** Unblock six parallel tickets with one compiled vocabulary, a mock engine and a conformance suite.
**Commit (code):** a3eca46 — "CHB-002: workspace, contract v0, engine-mock, conformance suite, gen-docs"

### What I did
- Read the guide in full, the architecture doc §3–6 and §8, and every `Proposed contract additions` section (CHB-003…015; CHB-013 has none).
- Toolchain: pnpm 10.15.1, Node 24.18. Pinned TypeScript 5.9.3 (not 7.0.2, the native port), Vitest 4.1.12, Vite 7.3.8, Playwright 1.65.0, @noble/hashes 2.4.0, @webgpu/types 0.1.74. `tsconfig.base.json` has the guide's flags plus `erasableSyntaxOnly` and `allowImportingTsExtensions`. Every relative import carries `.ts`, so Node runs the tools directly with type stripping; no tsx or build step.
- `pnpm exec playwright install chromium` downloaded chromium-1254 (Playwright 1.65 does not use the cached 1181–1234 builds).
- `tools/wgsl-check/check.spec.ts`: adapter + device, compile every WGSL file (the smoke kernel plus `packages/gpu/kernels/**` when it exists), a broken-WGSL case that must report an error, and the `[0,1,2,3] → [1,2,3,4]` compute kernel.
- Contract files: `errors.ts units.ts domains.ts spectrum.ts spec.ts source.ts recipe.ts graph-types.ts registry.ts catalog/*.ts graph.ts paths.ts mutations.ts editlog.ts engine.ts eval.ts laws.ts index.ts`.
- `engine-mock`: `tiff16.ts` (reader + writer), `ops.ts` (every op), `engine-mock.ts`, `m1.ts`. `tools/fixtures/make-m1.ts` wrote `fixtures/synthetic/m1-negative-96x64.tif` (37004 bytes, sha256 `29ffc4d5…`).
- `conformance`: `generate.ts` (14 case kinds), `run.ts` (`runCases` without a framework, `runConformance` for Vitest), `mutants.ts` (5 mutants), `tiny-tiff.ts`.
- `tools/gen-docs/main.ts` (+ `--check`), `snapshot.ts`, `contract-check.ts`; `tools/scripts/check-boundaries.ts`; `.github/workflows/ci.yml`.

### Why
- One file per catalog *group* rather than per area (four files). This is a cosmetic deviation; the generated docs are still one page per area.
- Lint: a 40-line boundary script instead of ESLint + `no-restricted-imports`, which keeps the dependency count down. The rules are the guide's two plus "contract depends only on @noble/hashes".
- Engines learn nodes through `Engine.adopt(defs)`. The architecture doc's `evaluate(NodeRef)` alone cannot give an engine the node definitions, and the guide's cross-realm rule ("send `closure(id)`, receiver calls `adopt`") made this the natural method.

### What worked
- WebGPU on SwiftShader headless: `adapter: google swiftshader`; 4/4 browser tests passed in 1.9 s.
- The §6 trace numbers came out first time. Patch centre before: (0.3703, 0.4339, 0.5484); after +4 pt red: (0.3133, 0.4339, 0.5484). Every upper node had a run count of 1 after the lights change.
- First full `pnpm test`: 465/468 passed. All 5 mutants were caught on the first run.

### What didn't work
- Scratch typecheck with a tsconfig in the scratchpad: `error TS2688: Cannot find type definition file for 'node'` (type roots resolve relative to the config). I switched to the root `tsc -p tsconfig.json` and filtered the output.
- `tsc` then reported `mutations.ts(59,32): error TS2783: 'enabled' is specified more than once`. Fixed by adding `ExposureInput` (id + kind required, the rest optional) and building the full `Exposure` explicitly.
- Runtime smoke: `EditLog.create` threw `E_RECIPE: missing finishing.values.clarity (+1 more)`. `defaultRecipe` now writes `finishing.values = {clarity: 0, clarity_radius_px: 40}`, so recipes are complete.
- Conformance: `scan.flatField shape/region/determinism` failed with `Cannot read properties of undefined (reading 'slice')`. The mock read an absent optional `flat`. It is now an identity when `flat` is absent.

### What I learned
- The G channel of the trace is 0.43394 with the fixture's 16-bit codes (6554/65535 ≠ 0.1) and 0.43396 with exact T. Both are within 1e-4 of the guide's 0.4340, so the golden file keeps 0.4340 with tolerance 1e-4.
- The "unsorted canonicalJSON" mutant only fails when a *user-supplied* object (cmy/box/point) arrives in another key order. `bindArgs` already fixes the top-level key order. The canonical-id case therefore reverses the keys of object-valued defaults.

### What was tricky to build
- Recipe paths and the registry referenced each other: `registerOp` checks that each argument's recipe path exists, while `settablePaths()` derives from the op arguments. The cycle is broken by `recipe.ts` holding `RECIPE_FIELDS` as plain data, with op-owned leaves marked `{kind:'op'}`. `registry.ts` imports that, and `paths.ts` imports both. A test asserts that every op-owned path has an owner, and `registerOp` refuses two owners of one path whose specs differ (for example `print.paper` on `print.expose` and `print.develop`).
- Node-typed args (`Mask`, `Image[]`) hold node ids in `args` and are appended to `inputs` after the receiver. `adopt` therefore re-interns with only `inputs[0]` as the receiver, and the recomputed id must match.

### What warrants a second pair of eyes
- `checkArgValue` freezes the user's object for cmy/box/point without reordering its keys. Ids stay canonical because `canonicalJSON` sorts them, but the recipe stores the user's key order.
- `EditLog.approve` mutates journal entries in place (`status`, `approvedBy`). The journal is append-only in membership, not in entry contents.

### What should be done in the future
- CHB-007: `defineOp` examples are only *parsed*; executing them is the DSL's job.
- Real `E_STOCK_UNKNOWN` checks need CHB-004 packs (`ArgSpec.valuesFrom` is in place).

### Code review instructions
- Start at `packages/contract/src/index.ts`, then `registry.ts` (`registerOp`, `bindArgs`), `graph.ts` (`nodeId`, `Graph.intern`, `compile`), `editlog.ts`.
- Validate with `pnpm typecheck && pnpm lint && pnpm gen:check && pnpm test && pnpm test:browser`.

### Technical details
- `pnpm test` → `Test Files 5 passed (5) / Tests 468 passed (468)`, 0.9 s.
- `pnpm test:browser` (before the studio page existed) → 4 passed (1.9 s).
- `contract:check` against a doctored baseline printed `breaking print.lights.logH range narrowed` and `breaking op print.old removed`.
