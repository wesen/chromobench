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
