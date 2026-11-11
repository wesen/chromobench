---
Title: Diary
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
Summary: ""
LastUpdated: 2026-11-11T09:43:38.460011158-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1 — 2026-11-11: create ticket, import sources

**Goal.** Create CHB-001 and import the six files the user listed from `~/Downloads` into `sources/`.

**What was done.**

- `docmgr` was already initialised in the repo (no tickets). Added topic vocabulary (`color-science`, `film-emulation`, `image-pipeline`, `js-api`, `product`) and doc types `analysis`, `diary`, then created `CHB-001`.
- Copied into `sources/`: `The Mathematics of the Colour Negative.{html,md}`, `Light, Film, Paper.{html,md}`, `Filmbench IDE.html`, and `Chromogen Studio 1.2(2).zip` renamed to `Chromogen Studio 1.2.zip` (byte-identical to the older `Chromogen Studio 1.2.zip` and `(1).zip` copies in Downloads). The zip is unpacked to `sources/chromogen-studio-1.2/` (`index.html` + `samples/gold200.png`).
- `scripts/01-extract-embedded-blobs.py` splits each single-file HTML into its `<script>` blocks and data blobs under `various/extracted/<name>/`.

**Findings during import.**

- `Light, Film, Paper.md` is 130 bytes: a title and an empty code block. The book's content is only in the HTML's `book-data` JSON. Of its four chapters only chapter 1 ("From RGB to light") has text; chapters 2–4 are titles plus one-line abstracts.
- `Filmbench IDE.html`'s `film-data` blob is base64 of zlib-compressed data.
- `~/code/wesen/go-go-golems/goja-cv` did not exist locally; it exists as `github.com/go-go-golems/goja-cv` (updated 2026-11-10) and was cloned to that path (read-only use).
- Other related files in `~/Downloads` were *not* imported because the user did not list them: `Filmbench API v2 — pipelines, control schemes, workspace.md`, `FilmBench_Studio_App.zip`, `filmbench-handout-pack.zip`, the `Filmbench/` directory, and Hunt's *The Reproduction of Colour* PDF.

(Step 1 predates loading the diary skill and uses a looser format; later steps use the investigation format.)

## Step 2: Read the textbooks, delegate the code-heavy sources, synthesise

I read *The Mathematics of the Colour Negative* (all four chapters) and the one written chapter of *Light, Film, Paper* myself, because they carry the model the product must implement. Three background subagents analysed the code-heavy sources in parallel: goja-cv, Chromogen Studio, and Filmbench IDE. Their reports came back as text, because the subagent sandbox refused writes of report files. I stored them in `various/` and wrote the synthesis in `analysis/01-…md`.

### Prompt Context
**User prompt (verbatim):** "Create a new docmgr ticket and import 'The Mathematics of the Colour Negative.html' 'The Mathematics of the Colour Negative.md' 'Chromogen Studio 1.2(2).zip' 'Filmbench IDE.html' 'Light, Film, Paper.html' 'Light, Film, Paper.md' from ~/Downloads and import them into sruces/. Then analyze the documents and their algorithms. I want to build a suite for my dad where he can import digital RAWs and scans of negatives, and give him an environment to print it through the modeling we did, and also apply more traditional manipulations (although the focus is really on the film development side), see for example ~/code/wesen/go-go-golems/goja-cv where we did similar work centered around JS APIs. The JS API itself would not be exposed in the UI for his tool, but underlie most of it, so that the agent can take advantage of it. Study i t, then give me back your findings in your own words here in the chat, so I can see that you understood things correctly."
Follow-up (verbatim): "store the agent reports in the ticket as well. ask the agents to write a diary of their investigation (see diary skill for the format) and store that as well"
**Assistant interpretation:**
- Understand the colour-negative model (forward and inverse), the two apps that implement parts of it, and the goja-cv agent-API pattern.
- Report back in my own words.
- Keep all agent output and diaries in the ticket.

**Inferred user intent:** Confirm a shared understanding before designing chromobench: a darkroom suite for their dad with a goja JS API underneath for an agent.

### What I did
- Read the textbook markdown in four slices (lines 1–1399).
- Extracted *Light, Film, Paper* chapter text from `book-data` JSON into `various/extracted/light-film-paper/lfp-ch*.txt`. Only ch. 1 has text.
- Listed the 16 textbook sketches from `hb-data` (self-contained JS with embedded data).
- Spawned three general-purpose subagents with scoped briefs. The Filmbench one could read `~/Downloads/Filmbench API v2 — pipelines, control schemes, workspace.md` for context only.
- Stored their reports:
  - `various/analysis-filmbench-ide.md` (from its summary);
  - `various/analysis-goja-cv.md` + `-summary.md`;
  - `various/analysis-chromogen-studio.md` + `-summary.md`.
- Wrote `analysis/01-source-analysis-….md`, related 5 key files to the ticket index, updated the changelog, and added 3 tasks.
- Sent each agent a request for an investigation diary in the diary-skill format, returned as text.

### Why
- The textbooks are the ground truth and the user wants my own understanding, so I did not delegate them.
- The apps are 0.7–1.4 MB single-file bundles and goja-cv has ~370 files. Parallel delegation kept those dumps out of the main context.

### What worked
- Subagents produced line-referenced reports. The goja-cv agent built the CLI and ran `go test ./... -count=1` (all pass, per its report). The Chromogen agent unpacked `ST_DATA` with `scripts/02-inventory-chromogen-st-data.py`. The Filmbench agent decoded `film-data` and the VFS with `scripts/05-…` and `scripts/06-…`.

### What didn't work
- The subagent sandbox refused report-file writes (each agent reported "subagents may not write report files"). They returned the text instead and I wrote the files.
- The Filmbench agent, resumed with the diary request, was stopped by an API safeguard: "Opus 5.5's safeguards flagged this message", request ID `req_011CgwLHCocrK2ztZn63aSWf`. Its full ~7,000-word report and its diary are therefore not available; only its summary is stored. I did not reconstruct them.
- Two agents finished before the diary request arrived and were resumed with it. Diaries pending at the time of writing.

### What I learned
- The forward (Filmbench/spektrafilm) and inverse (Chromogen Studio) pipelines meet at the negative's dye amounts. That is the natural seam for a suite with two ingest paths.
- No source decodes CFA camera RAW. Chromogen refuses RAW; goja-cv reads LinearRaw DNG only; Filmbench reads 8-bit browser images.
- The stock data everywhere is spektrafilm's, CC BY-SA 4.0.

### What was tricky to build
- N/A (analysis only). The main friction was routing agent output into the ticket when agents could not write files.

### What warrants a second pair of eyes
- The Filmbench report is a summary, not the full document.
- Agent claims marked [inferred] in the reports are not verified.

### What should be done in the future
- Store the remaining diaries.
- Get answers to the open questions in the analysis doc §6.
- Write the architecture design doc.

### Code review instructions
- Start with `analysis/01-…md`, then the three `various/analysis-*.md`.
- Reproduce extractions with `python3 -I scripts/01-extract-embedded-blobs.py <html> <outdir>` and the agents' scripts `02`, `05`, `06`.

### Technical details
- Ticket path: `ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`.

## Step 3: Store the agents' reports and investigation diaries

The goja-cv and Chromogen Studio agents were resumed with the diary request. Each returned a lightly revised full report and an investigation diary between `=====BEGIN/END REPORT=====` and `=====BEGIN/END DIARY=====` markers. I extracted both with `sed` from their persisted outputs and stored them. The revised reports replace the first versions; the diffs are wording, measurement-detail clarifications, and references to the new `scripts/03-…`.

### Prompt Context
**User prompt (verbatim):** see Step 2 (follow-up "store the agent reports in the ticket as well…").
**Assistant interpretation:** Persist every agent report and an agent-authored diary in the ticket.
**Inferred user intent:** Keep the full investigation trail reviewable, not just my synthesis.

### What I did
- `various/diary-goja-cv-agent.md` (9 steps) and `various/diary-chromogen-studio-agent.md` (9 steps).
- Replaced `various/analysis-goja-cv.md` and `various/analysis-chromogen-studio.md` with the agents' revised versions.
- The Chromogen agent added `scripts/03-check-chromogen-stock-data.py`, which reads the stock JSON only.

### What didn't work
- No Filmbench diary or full report: that agent was stopped by an API safeguard (request `req_011CgwLHCocrK2ztZn63aSWf`). Not reconstructed.
- In both diaries, the quoted sandbox error `<tool_use_error>…` appears with `<` escaped to `<\` by the harness's output filter. The content is otherwise unchanged.

### What should be done in the future
- Tasks `0d32` (user questions) and `f9dt` (architecture design doc) remain open.

## Step 4: Architecture doc, 14 tickets, and parallel guide writing

The user asked for a ticket per work item, each with a detailed intern guide, stored in the tickets and uploaded to reMarkable, with commits along the way and a detailed diary. I wrote the shared architecture and work-plan doc myself first, so 14 independently written guides would use one vocabulary, one set of contracts and one planned repository layout. Then I created the tickets and started seven writer agents, two related tickets each.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable.

commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
Earlier turns (summarised, not verbatim):
- The user narrowed the stack to WebGPU, WebAssembly, HTML and JS, with the Go/goja reference being "mostly for the DSL itself".
- They asked for "chunkier" tickets split by domain and parallelism.
**Assistant interpretation:**
- Create tickets CHB-002 to CHB-015 matching the 14-ticket plan.
- Write one intern guide per ticket (prose, bullets, pseudocode, diagrams, API and file references).
- Store the guides, upload them to reMarkable, commit at milestones, and keep this diary.

**Inferred user intent:** A complete, onboarding-quality work breakdown that people or agents can pick up in parallel.

### What I did
- Created branch `task/chb-work-plan` and committed the CHB-001 import (`75a7d90`).
- Wrote `design-doc/01-chromobench-architecture-and-work-plan.md` (≈5,100 words). It covers:
  - the product;
  - the one-page physics;
  - the system diagram;
  - vocabulary;
  - contract sketches (`Domain`, `Unit`, `OpDef`, `ArgSpec`, `NodeRef`, `Engine`, `FrameRecipe`, `Mutation`, `EvalResult`, `Diagnostic`);
  - the planned repo layout;
  - a source index with line ranges;
  - the ticket table, milestones and critical path;
  - rules and open decisions.
- Before citing goja-cv paths I checked them with a loop of `[ -e "$f" ]`. One path was too short (`look/golden_test.go`) and became `pkg/cv/look/golden_test.go`.
- Added 11 topic vocabulary entries.
- Created CHB-002 to CHB-015 from a TSV with `docmgr ticket create-ticket`, plus `doc add` for an intern guide (design-doc) and a diary in each.
- Committed `a731130`.
- Wrote the shared writer brief `scratchpad/guide-brief-common.md`. It covers:
  - must-read docs (the architecture doc and the writing-style reference with its two-pass procedure);
  - required content;
  - pandoc-safe Markdown rules;
  - read-only constraints;
  - a return format with `=====BEGIN/END GUIDE|TASKS|RELATED CHB-0NN=====` blocks.
- Launched seven background writers:
  - 002 + 007 (contract and DSL);
  - 003 + 012 (physics);
  - 004 + 014 (data and black and white);
  - 005 + 011 (GPU and output);
  - 006 + 013 (ingest and calibration);
  - 008 + 009 (agent and UI);
  - 010 + 015 (darkroom and extensions).
- Wrote `scripts/07-ingest-intern-guides.py`. It parses the blocks, writes each guide after its doc's frontmatter, adds tasks with `docmgr task add`, and relates existing paths with `docmgr doc relate --doc`.

### Why
- **The architecture doc comes first** because parallel writers would otherwise invent conflicting type names and paths. Each guide must propose contract additions explicitly, not redefine shared types.
- **Two tickets per writer, grouped by domain,** keeps related context in one agent (for example, the contract and the DSL that consumes it) and keeps the number of parallel agents at seven.
- **The writers return text, and a script files it,** because subagents cannot write report files. The script keeps roughly 150 KB of guide text out of the orchestrator's context.
- **The writers were not asked for diaries.** The earlier Filmbench agent was stopped by an API safeguard when asked for an investigation diary (Step 3). This diary records their work instead.

### What worked
- The dry run of the ingest script on a fake block printed `CHB-015 | guide 7 words, 1 escaped '<\\' | 2 tasks | 1 related, 1 missing: ['/nonexistent/x']` and left `git status` unchanged apart from the new script.

### What didn't work
- The first dry run printed `guide SKIPPED (doc has a body; use --replace)`. docmgr's design-doc template adds placeholder headings and `<!-- … -->` comments. Fixed: a body made only of headings, comments and blank lines counts as empty.

### What I learned
- docmgr's `doc add` for `design-doc` seeds a template body. Tools that fill docs must recognise it.

### What was tricky to build
- Keeping 14 guides consistent without the orchestrator reading all of them. The solution has three parts:
  - **one authoritative contract doc** with exact names;
  - **a brief that forbids silent redefinition;**
  - **an ingest script that reports escaped `<\` sequences,** which the harness's filter adds when it neutralises tag-like text, so I can spot damaged code samples.

### What warrants a second pair of eyes
- The contract sketches in the architecture doc are proposals. CHB-002's guide may refine them, and other guides may propose additions. A reconciliation pass after all guides land is worthwhile.

### What should be done in the future
- Ingest each writer's output, then run `docmgr doctor` on all tickets.
- Commit in batches.
- Upload to reMarkable under `/ai/2026/11/11/chromobench/`.

### Code review instructions
- Read `design-doc/01-chromobench-architecture-and-work-plan.md` first.
- Check the ingest script with `python3 -I scripts/07-ingest-intern-guides.py <file> <repo> --dry-run`.

### Technical details
- Ticket directories: `ttmp/2026/11/11/CHB-0NN--<slug>/`; guide docs at `design-doc/01-intern-guide-*.md`.

## Step 5: Skill change, guide batches, wrap-up, and the diary backfill request

This step covers everything from the first finished writer to the request for writer diaries. Twelve of the fourteen guides were filed in four commits. Along the way:
- the user changed the reMarkable skill to use a cheaper model for uploads, then asked to commit and push;
- the user asked to stop polishing and "get going";
- the user asked for detailed diaries from every writer, backfilled, including writers that had already finished.

### Prompt Context
**User prompts (verbatim, in order):**
1. "use a cheaper submodel when upload to remarkable, and add that to the skill."
2. "commit and push"
3. "how far are we? the guides don't have to be perfect either, i'd like to get going instead of burning so many tokens. we'll figure out the detail as we go."
4. "ask them to write all detailed diaries for their work and add those to the ticket too, see diary skill for the format. revive older subagents if necessary so that they can do the same"
5. "and properly backfill, right"

**Assistant interpretation:**
1. Make the upload skill prefer a small model in Claude Code.
2. Commit and push what's pending.
3. Cut the writers short.
4. Collect and file per-ticket work diaries from all seven writers, reviving finished ones.
5. Make sure diaries cover past work, mine included.

**Inferred user intent:** Lower token cost, keep momentum, and still keep an auditable trail per ticket.

### What I did
- **Skill change.** Edited `~/.codex/skills/remarkable-upload/SKILL.md` (the `~/.claude/skills` entry is a symlink into that git repo). In Claude Code the skill now says: use the Agent tool with `model: "haiku"`, `"sonnet"` only as a fallback, never the main model just to upload.
  - Committed `2d1a529` on a new branch `task/remarkable-upload-cheap-model`; I did not commit to `main`. Pushed it to `origin` (`github.com:wesen/skills`).
- **Pending chromobench work** committed as `d340a38`. The repo has no remote, so nothing was pushed.
- **Filed the guides as writers finished,** each with the same three commands:
  - `python3 -I scripts/07-ingest-intern-guides.py <persisted agent output> .`
  - `scripts/08-check-guide-markdown.py`
  - `scripts/09-seed-ticket-diary.sh`

  The ingest results:

  | Commit | Ticket | Guide | Tasks | Related files |
  |---|---|---|---|---|
  | `fb6697b` | CHB-006 | 13,764 words | 20 | 8 |
  | | CHB-013 | 7,437 words | 15 | 8 |
  | `1a35a0c` | CHB-010 | 11,612 words | 16 | 8 |
  | | CHB-015 | 8,657 words | 13 | 7 |
  | `8359caf` | CHB-003 | 13,207 words | 16 | 8 |
  | | CHB-012 | 11,754 words | 14 | 8 |
  | `43044ed` | CHB-002 | 13,994 words | 16 | 8 |
  | | CHB-005 | 13,349 words | 18 | 8 |
  | | CHB-007 | 10,735 words | 16 | 8 |
  | | CHB-008 | 13,507 words | 19 | 8 |
  | | CHB-009 | 11,102 words | 19 | 8 |
  | | CHB-011 | 9,511 words | 16 | 7 |

  The Markdown check reported no untagged fences, no raw HTML and no `<\` escapes in any guide.
- **Added scripts** `08-check-guide-markdown.py` and `09-seed-ticket-diary.sh`. The second writes "Step 1: Intern guide written and filed" in milestone format, including the writer's own summary.
- **After prompt 3,** sent a wrap-up message to the five writers still running. The CHB-003/012 writer had already delivered; it was resumed by the message and only confirmed.
- **After prompt 4,** extended `07-ingest-intern-guides.py` to accept `=====BEGIN DIARY CHB-0NN=====` blocks, appended to `diary/01-diary.md`, skipping an entry whose first line is already present.
  - Dry run on a fake block: `CHB-015 | NO GUIDE | 0 tasks | 0 related | diary +5 words, 1 steps`.
  - Sent all seven writers a diary request: investigation format, numbering from Step 2, the user's verbatim prompts, and their brief labelled as the orchestrator's. The three finished writers (006/013, 010/015, 003/012) were resumed by the message.

### Why
- Diaries come back as text blocks for the same reason guides do: subagents cannot write report files.
- The ingest script keeps their text out of the orchestrator's context.
- Diary blocks are append-only and skip duplicates, so a writer that reports twice cannot double an entry.

### What worked
- All twelve ingests ran without manual edits.
- Every guide carries a "Proposed contract additions (for CHB-002)" section where needed, so cross-ticket conflicts are visible rather than silent.

### What didn't work
- Re-running the ingest on an output that also holds TASKS blocks would add the tasks again; the script does not de-duplicate tasks. The diary-only reruns avoid this because diary replies carry only DIARY blocks. Noted as a limitation, not hit so far.

### What I learned
- Writers flagged contract conflicts on their own:
  - **CHB-007** recommends the *sync* QuickJS build with host promises instead of asyncify. Its spike on quickjs-emscripten 0.32.0 found that an asyncified call after an `await` could interleave with a second eval.
  - **CHB-011** wants `finishing.*` ops before `output.display`, so the gamut knee stays last.
  - **CHB-002** corrects the vocabulary example to `print.lights.logH`.
  - **CHB-005 and CHB-011** both propose `EvalTarget.signal` and `Engine.plan`.

  These are inputs for a reconciliation pass in CHB-002, not yet applied to the architecture doc.

### What was tricky to build
- Agent output too large to return inline is saved to `tool-results/*.txt`. The ingest path depends on that file holding the full blocks. The preview the orchestrator sees is truncated, so all checks run on the file, not on the preview.

### What warrants a second pair of eyes
- The skill change sits on a branch; it is live locally because the working tree is on that branch. Merging it to `main` is pending a decision from the user.
- The writers ran verification scripts in the shared session scratchpad (`scratchpad/guides/`). The scratchpad is not persistent. Archiving those scripts into the repo is still to do.

### What should be done in the future
- File the CHB-004/014 guides and all writer diaries.
- Archive the writers' verification scripts.
- Run `docmgr doctor` across tickets.
- Upload with a Haiku subagent.
- Commit.

### Code review instructions
- `git log --oneline task/chb-work-plan`.
- Spot-check one guide per commit; run `python3 -I scripts/08-check-guide-markdown.py ttmp/2026/11/11/CHB-0*/design-doc/01-intern-guide-*.md`.

### Technical details
- Agent outputs live under `~/.claude/projects/-home-manuel-code-wesen-chromobench/<session>/tool-results/`. They are the evidence for each ingest; the guide text in the tickets equals the blocks in those files apart from stripped trailing whitespace.

## Step 6: Upload, writer diaries filed, errata, close-out

This step finishes the work-plan delivery:
- all 15 documents were uploaded to reMarkable by a Haiku subagent;
- every writer's backfilled diary was filed into its ticket;
- the small guide errata the writers reported were applied or recorded as tasks;
- every ticket passes `docmgr doctor` with no errors.

### Prompt Context
**User prompts (verbatim, after Step 5):**
- "no need to crosscheck diaries, it's not that deep"
- "tell the subagents too, no need to edit and revise diaries, it's a log"

The earlier prompts are in Step 5.
**Assistant interpretation:**
- File the diaries as they arrive, without checking them.
- Tell the writers still working to log, not revise.

**Inferred user intent:** Finish cheaply and move on to building.

### What I did
- **Upload.** Delegated to a background subagent with `model: "haiku"`, per the updated `remarkable-upload` skill. Its receipt shows 15 × `OK: uploaded … -> /ai/2026/11/11/chromobench`:
  - CHB-001 "Architecture and work plan";
  - CHB-002 … CHB-015, one guide each.

  No `--force`, no reauthentication, no renders.
- **Diaries.** Filed each writer's diary with `python3 -I scripts/07-ingest-intern-guides.py <output> . --only=DIARY`:

  | Ticket | Words | Steps | Commit |
  |---|---|---|---|
  | CHB-006 | 6,122 | 12 | `b49ee56` |
  | CHB-013 | 4,370 | 12 | `b49ee56` |
  | CHB-003 | 6,829 | 12 | `2eba418` |
  | CHB-012 | 6,999 | 14 | `2eba418` |
  | CHB-008 | 7,293 | 14 | `2eba418` |
  | CHB-009 | 6,384 | 14 | `2eba418` |
  | CHB-004 | 5,093 | 11 | `5bc1eb2` |
  | CHB-014 | 3,848 | 9 | `5bc1eb2` |
  | CHB-010 | 10,035 | 16 | `cbbe60b` |
  | CHB-015 | 7,823 | 15 | `cbbe60b` |
  | CHB-002 | 5,164 | 9 | `8e327b9` |
  | CHB-007 | 6,124 | 14 | `8e327b9` |
  | CHB-005 | 8,317 | 13 | final commit |
  | CHB-011 | 7,131 | 14 | final commit |

- **Errata applied** with `sed` at the writer-given lines:
  - CHB-006: 0.2140, 0.670, 0.17 D, +0.013;
  - CHB-013: LED peak about 1 nm;
  - CHB-012: push-1 shift −0.02…0.00.
- **Errata recorded as tasks:**
  - CHB-003: flipH citation;
  - CHB-004: shipped spectra table size, 192 vs 128;
  - CHB-005: unconfirmed WGSL tolerances;
  - CHB-007: four spike-evidence wordings;
  - CHB-008 and CHB-009: textbook section citations;
  - CHB-010: tint wording;
  - CHB-011: unsourced cICP value and a RELATED note.
- **Hygiene.** Added frontmatter to the stored subagent reports and diaries in `various/`. Added `extracted` to `ttmp/.docmgrignore`, so raw files extracted from the imported apps are not treated as ticket docs. Synced the writers' scripts into `various/guide-verification-scripts/` with a README.

### Why
- The upload went to a small model, as the user asked.
- Errata that need a one-line change at a given line were applied immediately. Anything that needs judgment or research became a task, following the user's "it's not that deep".

### What worked
- The `--only=DIARY` filter prevented duplicate tasks when writers re-sent their guide blocks; four writers re-sent at least once.
- `docmgr doctor` reports zero errors on CHB-001 … CHB-015.

### What didn't work
- The first `docmgr doctor` on CHB-001 reported `[error] YAML/frontmatter syntax error … frontmatter delimiters '---' not found` for the files in `various/`. Fixed with frontmatter and the ignore entry.
- The first ignore line, `various/extracted/`, did not match. The file takes globs or names, so I changed it to `extracted`.
- CHB-001 still has `missing_numeric_prefix` warnings for `various/*.md`. I accepted them, because renaming would break references.

### What I learned
- Several writers found their own errors only while writing diaries (post-hoc checks). The diary request had value beyond record-keeping.

### What was tricky to build
- Writer messages crossed: a wrap-up or diary request often arrived after the writer had already handed back, so each writer resumed and re-sent. Idempotent ingestion was the remedy: guide blocks are not refiled if the doc has a body, diaries are skipped if their first line is present, and the `--only` filter keeps tasks from being re-added.

### What warrants a second pair of eyes
- The reMarkable PDFs for CHB-006 and CHB-013 predate their errata. Replacing them needs `--force`, which deletes annotations, or a new name. That is the user's decision.
- The guides' "Proposed contract additions (for CHB-002)" sections have not been reconciled.
- The `remarkable-upload` skill change is on branch `task/remarkable-upload-cheap-model` in `wesen/skills`, not merged.
- chromobench has no git remote, so nothing is pushed.

### What should be done in the future
- Start CHB-002 (contract and walking skeleton), with a contract reconciliation pass over all the proposed additions as its first task.
- Settle the open decisions in the architecture doc §8.4.

### Code review instructions
- Run `git log --oneline task/chb-work-plan`.
- Read `design-doc/01-chromobench-architecture-and-work-plan.md`, then any ticket's `design-doc/01-intern-guide-*.md` and `diary/01-diary.md`.

### Technical details
- reMarkable folder: `/ai/2026/11/11/chromobench`.
- Writer outputs (evidence): `~/.claude/projects/-home-manuel-code-wesen-chromobench/<session>/tool-results/toolu_*.txt`.

## Step 7: Phase-1 agents finished; merged into task/phase1-integration

Five implementation agents (CHB-003, -005, -006, -007, -009) ran in parallel worktrees from `bd5912a`, each on its own
`task/chb-0NN-*` branch. CHB-004 never launched: the auto-mode classifier denied it (likely the spektrafilm clone and
Python venv), and the user has not decided between approving it and an offline variant. This step merges the five
branches onto `task/chb-002-contract` in a new branch `task/phase1-integration` and runs every check. All green:
1829 unit tests, 42 browser tests. Contract requests (17 across five files) are not yet applied; they need
decisions and are listed for the user.

### Prompt Context

**User prompt (verbatim):** "Dodo everything all the way to the 6 agents finishing CHB-009 and co." (earlier
session; the merge-and-test plan was recorded then).
**Assistant interpretation:** After the agents finish, merge, resolve conflicts, run tests, record the outcome.
**Inferred user intent:** One integrated tree with every Phase-1 package to build on.
**Commit (code):** 74d90f1 — "Merge task/chb-009-studio into phase-1 integration" (merge chain 5c7a5c2, 796f335,
the CHB-006 merge, 0158441, 74d90f1)

### What I did

- `git switch -c task/phase1-integration task/chb-002-contract`, then `git merge --no-ff` in this order: chb-003-physics,
  chb-007-dsl, chb-006-ingest, chb-005-webgpu, chb-009-studio.
- `pnpm-lock.yaml` conflicted on the DSL, GPU and studio merges: resolved each time with `git checkout --ours
  pnpm-lock.yaml && pnpm install --prefer-offline` (regenerates from the merged `package.json`s; rerere recorded it).
- The studio merge also conflicted in:
  - `playwright.config.ts`: kept CHB-009's root-anchored `testIgnore` (`${import.meta.dirname}/.claude/**`) and
    `STUDIO_PORT`, and CHB-005's `webServer` array with the `gpu-parity` server on 4185; the studio server now uses
    `${port}`;
  - `apps/studio/index.html`: took CHB-009's;
  - `apps/studio/src/main.ts`, `controls.ts`: modify/delete — CHB-009 replaced the M1 page with `main.tsx` (it had
    already cherry-picked the restyle 14f5419 that HEAD's modification came from), so took the deletion.
- Checks: `pnpm typecheck` exit 0; `pnpm lint` "import boundaries ok (88 file checks)"; `pnpm gen:check` "ok (18
  files)"; `pnpm contract:check` "no baseline snapshot (first version); everything is additive"; `pnpm test`
  "32 passed (32) files, 1829 passed (1829)" in 27 s; `STUDIO_PORT=4397 CI=1 pnpm test:browser` "42 passed (41.0s)"
  (chromium-webgpu and gpu-parity projects, including conformance 173/173 against `GpuEngine`).

### Why

- `--no-ff` merges keep each ticket's commits and diary steps identifiable.
- A fresh `STUDIO_PORT` and `CI=1` because a worktree's Vite still listens on 4173 (pid 1347785) and
  `reuseExistingServer` would have tested the wrong app — the trap CHB-005 and CHB-009 both reported.

### What worked

- Test count adds up: 468 baseline + 282 (CHB-003) + 80 (CHB-007) + 922 (CHB-006) + 43 (CHB-005) + 34 (CHB-009)
  = 1829.

### What didn't work

- Five merge conflicts on the studio merge (above); no test failures after resolution.

### What I learned

- Agents' package.json edits merge cleanly; only the lockfile conflicts, and regenerating it offline takes ~1 s.

### What was tricky to build

- The studio modify/delete: HEAD's change to `main.ts` was the restyle commit, which CHB-009 had cherry-picked
  before deleting the file, so taking the deletion loses nothing.

### What warrants a second pair of eyes

- **Two physics implementations.** `packages/gpu` carries an interim f64 port of Chromogen (conventions
  `chromogen-interim-0`, `src/physics/oracle.ts`, `TODO(CHB-0NN)` markers); `packages/core` is the oracle
  (`core-v1:opaque/cie1931-2deg/subtract/model-3cdf/midgray-geomean`). Not yet wired together.
- `packages/ingest/src/conditioning/forward-stub.ts` stands in for core's `ScannerForward`.
- WebGPU canvas presentation is untested on real hardware (SwiftShader loses the device on first present; the
  studio falls back to Canvas2D).

### What should be done in the future

- Apply or decide the 17 contract requests: `packages/core` (6), `packages/dsl` (2), `packages/gpu` (2),
  `packages/ingest` (3), `apps/studio` (4 headings, 3 requests).
- Wire core's oracle into gpu and ingest; add `optimizeDeps.exclude` for `@colorhythm/libraw-wasm` when the studio
  imports LibRaw.
- CHB-004 launch decision; Studio toolkit decision (CHB-016: CraftKit shell vs React 19).

### Code review instructions

- `git log --first-parent task/phase1-integration`; conflicts in `playwright.config.ts`.
- Re-run: `pnpm typecheck && pnpm lint && pnpm test && STUDIO_PORT=4397 CI=1 pnpm test:browser`.

### Technical details

- Branch heads merged: chb-003 a9888f9, chb-007 9709f62, chb-006 b7eb54d, chb-005 01dfec7, chb-009 aa0c754.

## Step 8: CraftKit decision, UI tickets CHB-016..022 with guides, Phase-2 agents started

After the CraftKit study (CHB-016 Steps 1–4) the user chose to build the proper UI on a JS API in which the whole
studio is expressed, so that many variants can exist. This step created CHB-017 (non-UI close-out, tasks only) and
CHB-018..022 (shell, studio v2, roll, looks, finish), wrote a shared UI design brief, had six writer subagents fill
the guides in parallel, and started three implementation agents: CHB-004 (approved by the user), CHB-017 and CHB-018.

### Prompt Context

**User prompt (verbatim):** "CHB-004: approve. before we move on, now that we have worked out what to do with
craftkit, let's create the tickets and design guides (remember, no need to be overly correct in the guides, they are
\"guides for impementation\" after all, and we'll sort out details as we work) for the proper UI. Allow the UI to be
entirely expressed using the JS API, so that we can create many different versions of it." Later: "can we start on
tickets?" and "tell subagents to not overdo the reviewing / correctness of the guides, as long as it's good to
implement, it's good".
**Assistant interpretation:** Create and fill the UI tickets; launch CHB-004; then start implementation in
dependency order.
**Inferred user intent:** Move from analysis to building, with guides as working documents.
**Commit (code):** 3c35cf8 — "CHB-016, CHB-018..022: UI implementation guides, tasks, diaries; CHB-017 tasks"
(also b5517ca tickets + brief, 2e9999b wasm files, ed9b514 CHB-016 merge)

### What I did

- Found that the root `.gitignore` (`dist/`) had dropped `vendor/wb/dist` (3 wasm crates, opentype) from the CHB-016
  import; force-added on `task/chb-016-craftkit-study` (2e9999b) and merged CHB-016 into `task/phase1-integration`
  (ed9b514); new branch `task/ui-guides`.
- Created CHB-017..022 (`docmgr ticket create-ticket`), guide and diary docs; wrote
  CHB-016 `various/ui-design-brief.md` (layers `ck` shell → `cb` studio-kit → kits → host + variants; binding times;
  fragments, kits, passes, IRs, diagnostics, explain; recipes as EditLog projections; agent proposals as previews)
  and a writer brief in the scratchpad (`ui-guide-writer-brief.md`).
- Six writers in parallel (CHB-016/018/019 on the default model, 020/021/022 on sonnet), writing directly into their
  tickets; relayed the user's "don't overdo it" mid-run and added it to the writer brief.
- Launched implementation agents in worktrees: CHB-004 (clone and venv outside the repo at
  `~/code/wesen/chromobench-ext/`), CHB-017 (contract 0.2, one physics), CHB-018 (shell port).
- Checks: `08-check-guide-markdown.py` clean on all six (9985, 7990, 7380, 7578, 7802, 7422 words); `docmgr doctor`
  clean on CHB-017..022; CHB-016 had `invalid_frontmatter` for the brief → added frontmatter (now one
  `missing_numeric_prefix` warning, accepted).

### Why

- CHB-017 first because the contract and the shared physics underlie everything; CHB-018 in parallel because the
  shell is generic and touches no other package.

### What worked

- Writers wrote into the ticket files directly (no refusals this time), so no guide text passed through the
  orchestrator.

### What didn't work

- The CHB-017 agent's worktree was created from b5517ca, before CHB-017's tasks and diary Step 1 were committed
  (3c35cf8); told it by message to `git merge --no-edit task/ui-guides` in its worktree.

### What I learned

- Commit ticket scaffolding before launching an agent on that ticket: worktrees snapshot HEAD.

### What was tricky to build

- N/A.

### What warrants a second pair of eyes

- Contract requests accumulated by the guides, for a contract 0.3 after CHB-017: batch `EditLog.preview`
  (CHB-016, CHB-019), `Diagnostic.where` with a file (CHB-016), `scan.baseT`, `scan.flare` as number|Vec3,
  `LoggedMutation.batch`, `FrameRecipe.roll` (CHB-020), `view.frame {orientation, angle_deg, crop}` and
  `retouch.spots.<id>` with null-delete in `checkSet` (CHB-022), a boundary exception for the studio host to import
  core/gpu (CHB-019), the DSL frame vocabulary moved to a shared module (CHB-016, CHB-019).
- Small inconsistency to settle in CHB-019: variants receive `ck`/`cb` as arguments (CHB-019) vs `ck`/`cb` importable
  (CHB-016); compatible (variants take arguments, kits import).

### What should be done in the future

- When CHB-017 lands: CHB-010 basic printing and CHB-011 basic export. When CHB-018 lands: CHB-019, then 020–022.

### Code review instructions

- Guides: `ttmp/2026/11/11/CHB-01{6,8,9}--*/design-doc/01-intern-guide.md`, `CHB-02{0,1,2}--*/…`.

### Technical details

- Open tasks after filing: CHB-016 12, CHB-017 9, CHB-018 16, CHB-019 15, CHB-020 15, CHB-021 18, CHB-022 17.

## Step 9: Close CHB-003, -005, -006, -007, -009 by moving their open tasks

The user asked what was missing for the five Phase-1 tickets and whether they could be closed. Every open task was
either finished, covered by another ticket's result, or belonged to a later ticket; the two errata were one-line
fixes. This step moved 16 tasks to the tickets that will do them, fixed the errata, checked everything off with a
note naming where it went, and closed the five tickets with `docmgr ticket close`.

### Prompt Context

**User prompt (verbatim):** "whats missing for the 3, 5, 6, 7, 9. Do we haev to wait? can we close some of them?",
then "ok, clean up" (taken as approval of the proposal, including the CHB-007 DR-1/DR-2 confirmation).
**Assistant interpretation:** Move or finish open tasks and close the tickets.
**Inferred user intent:** A clean board: closed tickets for finished work, open work where it will be done.
**Commit (code):** see the commit adding this step — "CHB-003/005/006/007/009: close; move open tasks"

### What I did

- Verified CHB-003 d0xa: `classify` (scan/classify.ts), `latd`, `latdFromPD`, `integrateToGrey`, `colourOffset`,
  `lightsToSliders`, `greyPick` (print/balance.ts), `greyPatchX` (print/chain.ts); `warmPerMired` is a parameter.
- Errata: CHB-003 guide §8.3 now cites `05-inline.js` `addSample` line 3916 `flipH: true`; CHB-009 guide now says the
  0.755 grey card is from the chapter-2 introduction.
- Moves (`docmgr task add` with a "[from CHB-0NN id]" prefix; source tasks annotated "— moved to …" and checked):
  CHB-005 6bzj → CHB-011, erm0 → CHB-020, plus untracked items (tiled export → CHB-011, halation/DIR ops → CHB-012);
  CHB-006 w3tp → CHB-013, mnvr+lcz0 → CHB-015, 3wlu → CHB-020, 2c6h → CHB-019, svja → CHB-017;
  CHB-007 44uo → CHB-008, zr25 confirmed; CHB-009 ey84, kygr, grer → CHB-019, rrhv → CHB-008, ex7d superseded,
  o944 done; CHB-003 j90u, i839 → CHB-017 (running), 7zy5 covered by CHB-006's goldens.
- Added a CHB-019 task reconciling CHB-016/CHB-019 on how variants get `ck`/`cb`.
- `docmgr ticket close` on all five, each with a changelog entry; `docmgr doctor` clean on all five.

### Why

- Tasks live where the work will happen; the closed tickets keep the record of what moved and why.

### What worked

- All annotations matched exactly once; doctor clean.

### What didn't work

- No failures.

### What I learned

- `docmgr ticket close` sets status complete and writes the changelog; it does not touch git.

### What was tricky to build

- CHB-017 runs in a worktree from b5517ca/3c35cf8 and may tick CHB-003/CHB-006 tasks there too; expect small
  conflicts in those `tasks.md` files at merge (take the checked state).

### What warrants a second pair of eyes

- CHB-003 is closed while its f64 tables and tabulated mode are still being built inside CHB-017.

### What should be done in the future

- Merge CHB-017 and resolve tasks.md conflicts as above.

### Code review instructions

- `grep -n "moved to\|covered by\|superseded" ttmp/2026/11/11/CHB-00{3,5,6,7,9}--*/tasks.md`

### Technical details

- Remaining open tickets: CHB-004, -017, -018 (running); CHB-008, -010..-016, -019..-022.

## Step 10: Correction — CHB-007 reopened, DR-1/DR-2 not confirmed

In Step 9 I read the user's "ok, clean up" as confirming CHB-007's two decision records. The user corrected that:
the "ok" was general. CHB-007 is reopened with task zr25 unchecked and annotated "awaiting the user's
confirmation"; the DSL worker task stays moved to CHB-008.

### Prompt Context

**User prompt (verbatim):** "no actually the ok was generall, what were the questions in CHB-007?"
**Assistant interpretation:** Undo the confirmation and explain DR-1 and DR-2.
**Inferred user intent:** Decide the two records knowingly.
**Commit (code):** see the commit adding this step — "CHB-007: reopen; DR-1/DR-2 await confirmation"

### What I did

- `docmgr task uncheck --ticket CHB-007 --id zr25`; replaced its note; `docmgr meta update --doc index.md --field
  Status --value active`; `docmgr changelog update` with the reason.

### Why

- A decision recorded as the user's must be the user's.

### What worked

- Status back to active.

### What didn't work

- My Step 9 interpretation of a general "ok" as a specific confirmation.

### What I learned

- When a proposal bundles bookkeeping with a decision, ask for the decision separately.

### What was tricky to build

- N/A.

### What warrants a second pair of eyes

- N/A.

### What should be done in the future

- Close CHB-007 once the user answers DR-1/DR-2.

### Code review instructions

- `docmgr task list --ticket CHB-007`

### Technical details

- DR-1: QuickJS-in-WASM (in a worker) vs plain Web Worker + CSP in a sandboxed iframe. DR-2: QuickJS sync build with
  deferred host promises vs the asyncify build.

## Step 11: CHB-017 and CHB-004 merged; data switch, CHB-010, CHB-011 and the demo (CHB-023) started

CHB-017 (contract 0.2, one physics) and CHB-004 (spektrafilm data packs) finished. This step merged both into
`task/ui-guides`, ran every check (1936 unit, 42 browser, all green), and started four implementation agents: the
data switch (CHB-017 stage 3), the M2 slices of CHB-010 (enlarger, printer lights) and CHB-011 (encoders, colour
management, display, 16-bit GPU export), and a new ticket CHB-023, a demo that puts the real engine behind the
existing React studio so the user can show his father something soon and iterate.

### Prompt Context

**User prompt (verbatim):** "how far are we? at what point can I show something to my dad (even incomplete, but
showcasing some of the functionality) so we can iterate?", then "do we need to wait for subagents or so?", then
"commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)".
**Assistant interpretation:** Get to a demo as early as possible without waiting for the shell-based studio;
keep committing and logging.
**Inferred user intent:** Put real functionality in front of the photographer early and let his feedback steer.
**Commit (code):** db11105 — "CHB-023: demo ticket (current studio on the real engine)"; merges 5d8ec90
(task/chb-017-closeout), 09733fe (task/chb-004-data)

### What I did

- `git merge --no-ff task/chb-017-closeout`: one conflict in CHB-003 `tasks.md` (my Step-9 annotations vs CHB-017
  checking j90u/i839); took ours and rewrote "moved to CHB-017 (stage 2, running)" → "done in CHB-017 (99b5f57)".
- `git merge --no-ff task/chb-004-data`: clean. `pnpm install --prefer-offline`.
- Checks: typecheck clean; lint "import boundaries ok (88 file checks)"; gen:check ok (18 files); contract:check
  "20 change(s), 4 breaking" (0.1.0 → 0.2.0, allowed under 0.x, each with a change note); `pnpm test` "42 passed
  (42) files, 1936 passed (1936)" (1865 from CHB-017 + 71 from packages/data); `STUDIO_PORT=4431 CI=1 pnpm
  test:browser` "42 passed (47.8s)".
- Read the CHB-010 and CHB-011 guides' stage lists to scope the M2 slices (CHB-010 stages 1–2; CHB-011 stages 1–3
  plus the moved GPU 16-bit export and tiled driver).
- Created CHB-023 with 9 tasks and committed before launching (lesson from Step 8), then launched four worktree
  agents: data switch (sonnet; `task/chb-017-data-switch`), CHB-010 (`task/chb-010-printing`), CHB-011
  (`task/chb-011-output`), CHB-023 (`task/chb-023-demo`). Each got its own browser-test port (4441, 4451, 4461,
  4471) because of the stale server on 4173.

### Why

- The demo does not need to wait: signed filtration and the shared physics are merged, so the print ops work on the
  real engine now; CHB-010's refinements and CHB-011's 16-bit export slot in when they land (the demo exports 8-bit
  PNG behind a swappable function).
- The demo uses the React studio although CHB-019 replaces it: its engine wiring, storage and presenter carry over,
  and the photographer's feedback shapes CHB-019/CHB-020.

### What worked

- Both merges and all checks.

### What didn't work

- No failures.

### What I learned

- CHB-017 report: export display vs core exact improved from 1.10 to 0.05 levels by integrating per pixel; preview
  vs core exact is 1.59 levels, the same as core's own tabulated mode (table interpolation, not GPU error).

### What was tricky to build

- Four agents touch neighbouring areas: data switch (core index, gpu data.ts), CHB-010 (core print chain), CHB-011
  (new packages/output, core print/colour.ts and gamut.ts, output.wgsl), CHB-023 (apps/studio, boundary exception).
  Each prompt names the others' areas; the demo passes `data:` explicitly rather than changing defaults.

### What warrants a second pair of eyes

- CHB-017's six "(review)" decisions in packages/contract/CONTRACT-DECISIONS.md (signed filtration range −100…200;
  aimView duplicating view.illuminant in node ids; cam16-ucs renamed to oklch; ring-around default 4 pt; per-pixel GPU
  export cost unmeasured; stock ranking golden only under Chromogen conventions).
- CHB-004's licence questions for the user (commercial use, GPL reach of TS ports, hanatos/CIE/filter licences, the
  name, illustrative pack licence).

### What should be done in the future

- Merge the four branches as they land; then CHB-019 when CHB-018 lands; try the demo on a real GPU.

### Code review instructions

- `git log --first-parent task/ui-guides`; CHB-017 diary Steps 2–3; CHB-004 diary Steps 13–15.

### Technical details

- Running agents: CHB-018 (shell), data switch, CHB-010, CHB-011, CHB-023.

## Step 12: Data switch and shell merged; CHB-019 studio-kit started (outside apps/studio)

The data switch (core and GPU default to CHB-004's packs) and the shell port (CHB-018, stages 1–4) finished and
were merged into `task/ui-guides`; all 2028 unit tests pass. CHB-019 was started limited to packages/studio-kit and
its variants, because the demo agent (CHB-023) is editing apps/studio at the same time.

### Prompt Context

**User prompt (verbatim):** "how far is the demo?" (answered from the demo worktree's git log: data switch merged,
no own commits yet); otherwise continuing the plan from Step 11.
**Assistant interpretation:** Keep the pipeline moving without colliding with the demo.
**Inferred user intent:** Demo first, Studio v2 in parallel.
**Commit (code):** e9b5045 (merge data switch), d492d84 (merge task/chb-018-shell)

### What I did

- Sent the demo agent the data-switch details and asked it to merge `task/chb-017-data-switch` (it did: 9471cfe).
- Merged `task/chb-017-data-switch` (clean; 1936 tests) and `task/chb-018-shell` (clean; `pnpm lint` "import
  boundaries ok (221 file checks)"; `pnpm test` "51 passed (51) files, 2028 passed (2028)").
- Launched CHB-019 (`task/chb-019-studio-kit`) with an explicit lane: packages/studio-kit, four headless variants
  with explain snapshots, a dev host page with its own Playwright port; no apps/studio edits.
- Added the session cost to the user's status line (`~/.claude/statusline-command.sh`, `.cost.total_cost_usd`).

### Why

- apps/studio is the demo's file set right now; the studio-kit and variants do not need it to start.

### What worked

- Both merges clean; the ingest dust timeout seen by CHB-018 did not recur on the merged tree (CHB-017 raised that
  test's timeout to 30 s).

### What didn't work

- No failures.

### What I learned

- CHB-018 API deviations from the CHB-019 guide (fragment methods use `this`; `run(ctx, ...args)`; lr/tb compare as a
  split; services at start/mount) — passed to the CHB-019 agent.

### What was tricky to build

- N/A.

### What warrants a second pair of eyes

- CHB-018's playwright change starts the shell demo server on every browser run (Playwright starts all listed
  servers).

### What should be done in the future

- After CHB-023 lands: a second CHB-019 run migrating apps/studio onto studio-kit.

### Code review instructions

- CHB-018 diary Steps 2–3; `pnpm --filter @chromobench/shell demo` → http://localhost:4186/demo/

### Technical details

- Running: CHB-010, CHB-011, CHB-023, CHB-019 (studio-kit).

## Step 13: CHB-010, CHB-019 (studio-kit) and the CHB-023 demo merged

Three agents finished and were merged into `task/ui-guides`: CHB-010's printing slice (real-mode enlarger, grade,
balance tools; it fixed a bug where filters and time had no effect at the grey card), CHB-019's studio-kit (the
shell-based studio with four variants on the mock engine), and CHB-023, the demo: the existing studio on the real
engine, opening real scans and printing them through the film model. The merged tree passes 2141 unit tests and the
studio's production build succeeds. The demo is ready for the user to try on a real GPU.

### Prompt Context

**User prompt (verbatim):** "how far is the demo?", "how far now?", "was that the demo?"
**Assistant interpretation:** Report progress; merge as agents land; get the demo into the user's hands.
**Inferred user intent:** Show the photographer something real soon.
**Commit (code):** 8c1c50e (merge CHB-010), e98c23f (merge CHB-019 studio-kit), 7b2959a (merge CHB-023 demo)

### What I did

- Merged `task/chb-010-printing` (clean; 2081 tests) and told the demo agent to merge it (it did: 901b576).
- Relayed the user's shell-demo feedback (no film strip, text-only cells, label-only Navigator) to the CHB-019 agent;
  its host now shows print thumbnails and a Navigator picture; it could not reproduce the hidden strip in Chromium
  (likely a saved hidden-panels workspace; `?fresh` avoids it).
- Merged `task/chb-019-studio-kit` (clean; lint 266 file checks; 2131 tests).
- Merged `task/chb-023-demo`: conflict in `tools/scripts/check-boundaries.ts` (HEAD added a shell rule with `skip`,
  the demo added a host-file `except` list); kept both fields and both checks. Then lint "import boundaries ok (270
  file checks)", typecheck clean, `pnpm test` "61 passed (61) files, 2141 passed (2141)",
  `pnpm --filter @chromobench/studio build` "✓ built in 2.24s".

### Why

- Merge as soon as each lands, so later agents start from the integrated tree.

### What worked

- All merges; the demo builds.

### What didn't work

- The boundary-checker merge conflict above (resolved by combining).
- Browser tests were not re-run on the merged tree: the demo agent's timing run left Vite servers on 4471 and 4185
  (pids 2027709, 2027766) that the agent was not permitted to kill; I left them for the user to decide.

### What I learned

- The demo agent added engine glue: `openDecoded()`, an optional `cacheLimit` (unbounded per-step image caches),
  film base computed once per frame on the GPU, and an aperture-only GPU densitometer.

### What was tricky to build

- N/A.

### What warrants a second pair of eyes

- Demo gaps: dodge/burn/masks unimplemented in both real engines (`print.combine`, `mask.*`); 8-bit export at
  working size; rotation/crop not wired; film base from the brightest 5 % of columns (wrong with sprocket holes); no
  scanner flare correction; reference-engine fallback takes seconds per change and blocks the UI.

### What should be done in the future

- User tries the demo on a real GPU (CHB-023 diary Step 3 checklist); then CHB-019's apps/studio migration run; merge
  CHB-011 when it lands.

### Code review instructions

- `apps/studio/DEMO.md`, `apps/studio/src/host/{engines,studio-engine,first-print,export}.ts`.

### Technical details

- Run: `pnpm --filter @chromobench/studio build && pnpm --filter @chromobench/studio preview` →
  http://localhost:4173 (Chrome/Edge); `?engine=gpu|reference|mock`, `?long=0` for full size.
