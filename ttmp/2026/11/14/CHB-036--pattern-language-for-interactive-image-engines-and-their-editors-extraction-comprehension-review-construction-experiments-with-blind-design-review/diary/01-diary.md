---
Title: Diary
Ticket: CHB-036
Status: active
Topics:
    - architecture
    - agent
    - patterns
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///Users/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/pattern-extraction-with-agent-validation.md
      Note: the method as a vault playbook
    - Path: repo://docs/patterns/00-overview.md
      Note: 'the language: names, map, conventions, all-patterns sketch'
    - Path: repo://docs/patterns/build-artifact.py
      Note: one HTML page from the chapters for the claude.ai artifact
    - Path: repo://docs/patterns/experiments/README.md
      Note: construction experiment design, run layout, after-the-batch steps
    - Path: repo://docs/patterns/experiments/analysis/02-behaviour.sql
      Note: per-run behaviour; failures read from output (pi records no exit codes)
    - Path: repo://docs/patterns/experiments/analyze.py
      Note: go-minitrace convert and analysis queries
    - Path: repo://docs/patterns/experiments/review-design.py
      Note: blinded review workspaces for Opus reviewers; rubric prompt; change requests
    - Path: repo://docs/patterns/experiments/run-impl.py
      Note: one isolated pi implementation run (prompt with the broken node --test command)
    - Path: repo://docs/patterns/experiments/score.py
      Note: hidden and own tests per run in an isolated copy; own test files listed explicitly
    - Path: repo://docs/patterns/review/README.md
      Note: comprehension review method and results (20/20 controls)
ExternalSources: []
Summary: 'Pattern language (docs/patterns): extraction, comprehension review by isolated DeepSeek agents, construction experiments (24 pi runs, hidden tests, go-minitrace), blind design review by Opus subagents, playbook in the vault, claude.ai artifact.'
LastUpdated: 2026-11-14T18:36:05.307362-05:00
WhatFor: 'Continuing or auditing the pattern-language work: what was built, how it was validated, what failed, where the files and runs are.'
WhenToUse: Before revising a chapter, rerunning the experiments, or reading the experiment results.
---


# Diary

## Goal

This diary records how the pattern language in `docs/patterns/` was extracted from chromobench, Editor lab and
goja-cv, and how it was validated: first for comprehension (do agents understand a chapter and apply it in a domain
it never mentions), then for construction (do agents who read a chapter build better software than agents who do
not), judged by hidden tests, transcripts, diaries and a blind design review in the spirit of Alexander, Gabriel and
Fowler. Times are local (EST). The work happened on branch `task/pattern-language`, branched from the CHB-035 branch.

## Step 1: Survey and the extraction map

The owner asked for the reusable parts of the three image systems built so far, written up as design patterns, so
that future systems can be built from small, composable parts. The work started with a survey of chromobench (the
contract package, the GPU and reference engines, the render queue, the studio kit and the UI DSL), Editor lab (the
unzipped archive from CHB-035) and goja-cv (`~/code/wesen/go-go-golems/goja-cv`), looking for the same idea written
twice in different systems.

The map listed twelve candidates with their seams, generic share, blockers and three other domains each. The owner
approved it as it was. It became the chapter list: Interned Operation Graph, Unit-Tagged Parameter Catalogue,
Reference Oracle with Negative Controls, Latest-Wins Render Slots, Domain-Typed Image Pipeline, Tabulated Preview
Exact Export, Barrier-Cut Fusion, Reach-Declared Tiling, Vector Edit Document, Two-Vocabulary Layout DSL, Kits with
Policy Passes, Shared Handle Vocabulary.

### Prompt Context

**User prompt (verbatim):** "/anthropic-skills:pattern-extraction once you finish a pattern write up, use
~/code/wesen/go-go-golems/go-go-parc/Research/playbooks/pi-coding-subagents-handbook.md as a guideline and use it to
run a couple of deepseek flash agents to verify if they understnad the pattern properly (ask them to take review
notes) and are able to figure out how to use it in some more general contexts (i.e., validate you have written a true
useful reusable patterns.) Focus on CV / image processing / color / GPU stuff, as well as generative UI for image
editing software / that kind of stuff. don't be precious about the remarkable pdf, just do it." — followed by: "so
i'm asking about the pattern extraction because we are now at a point where there are probably a few things that can
also be consolidated or are present in various different forms across these projects, as well as some that were
thoroughly investigate / implemented by either implementation, and I want to distill and save that knowledge so that
we can build some really elegant / simple / composable / modular systems. [...] so think hard and do a good job." and,
on the map: "nah your first list was great"

**Assistant interpretation:** Run the pattern-extraction skill over the three implementations (CV, image processing,
colour, GPU, generative editor UI), stop at the extraction map, then write the chapters and validate them with
isolated DeepSeek flash agents per the pi handbook; upload the result to the reMarkable without ceremony.

**Inferred user intent:** Turn three separately built systems into a reusable design vocabulary, so that the next
systems (and agents building them) start from proven shapes instead of rediscovering them.

### What I did
- Surveyed the three code bases (sizes, import graphs, module-level state, the authors' own notes).
- Wrote the extraction map in chat: 12 candidates grouped as cleanest, with surgery, ambitious; stopped for approval.

### Why
- The skill makes the map a mandatory checkpoint: it is where the owner redirects cheaply before the expensive writing.

### What worked
- The strongest evidence came from ideas present twice: hash-consed operation nodes (chromobench's interned graph and
  goja-cv's sha256-keyed nodes), document-pixel units (goja-cv's DocPx, "original-image pixels; scaled per
  evaluation", and chromobench's µm-on-film units), slots with generations (chromobench's render queue and Editor
  lab's tile scheduler).

### What didn't work
- N/A at this step.

### What I learned
- The project's bugs are the best implementation notes. One example: the density mask's fixed default µm/px
  (`packages/core/src/print/densityMask.ts:21`, `DEFAULT_FILM_UM_PER_PX = 6`) silently turns film units back into
  pixels; it belongs in the Domain-Typed Image Pipeline and Reach-Declared Tiling chapters as a lesson.

### What was tricky to build
- Keeping candidates portable: each needed three other domains. Candidates that only made sense for film printing
  were folded into others or dropped.

### What warrants a second pair of eyes
- Whether twelve is too many: chapters 5, 6, 8, 10, 11, 12 carry one star (a good form among several).

### What should be done in the future
- N/A

### Code review instructions
- The map lives in the chat; its result is the chapter list in `docs/patterns/00-overview.md`.

### Technical details
- Sources: chromobench (this repo), Editor lab (`~/Downloads/editor-lab-work.zip`, unzipped in the session
  scratchpad), goja-cv (`~/code/wesen/go-go-golems/goja-cv`).

## Step 2: The language — overview and twelve chapters

The overview fixes names, numbers, the star ratings, the pseudocode conventions and the pattern map; each chapter
follows the skill's template (intent, motivation with failures, problem, forces, a bold "Therefore:" solution,
applicability with "do not use it when", structure, collaborations, sketch, 8–11 implementation notes, variations,
consequences, known uses, related chapters). The thirteen files total about 26,000 words.

The running example is chromobench, but every chapter was written so that another domain from its own Motivation can
replace it. The project's own defects are named in the notes ("This is the bug the originating project shipped").

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Write Part 2 of the skill: `docs/patterns/00-overview.md` and one chapter per approved
candidate.

**Inferred user intent:** A durable, portable reference that agents and people can build from.

**Commit (code):** d3d2886 — "Pattern language for interactive image engines and their editors (docs/patterns):
overview and 12 chapters drawn from chromobench, Editor lab and goja-cv; reviewed by isolated DeepSeek flash
subagents [...]"

### What I did
- Wrote `docs/patterns/00-overview.md` and `01-…` to `12-…` with mermaid diagrams where the shape is the point.
- Checked claims about the projects against the code (file and line cited in the notes).

### Why
- Two stars mark near-invariant patterns (1, 2, 3, 4, 7, 9); one star marks a good form among several.

### What worked
- Writing the overview first kept names and numbers consistent across chapters.

### What didn't work
- The skill's checklist asks to render every mermaid block with `mmdc`; the command was denied by the sandbox, so the
  diagrams were not machine-checked (they render in the artifact viewer and in the PDF).

### What I learned
- Chapters written after the comprehension review (7–12) benefited from its lessons: gloss each project at first
  mention, define every term the Solution uses, state lifecycles and error paths, hedge known uses.

### What was tricky to build
- Known uses had to be real systems I could stand behind; several were hedged after review (libvips's cache is
  in-process; React's scheduling; darktable; OpenTimelineIO).

### What warrants a second pair of eyes
- The known-uses sections in chapters 7, 8 and 12, which no reviewer has checked yet.

### What should be done in the future
- Revise chapters 1, 4, 8, 9 from the construction experiments (Step 4 onwards).

### Code review instructions
- Start at `docs/patterns/00-overview.md` (map, conventions, the all-patterns sketch), then chapter 1 and chapter 4.

### Technical details
- Pseudocode conventions table in the overview: `value T:`, `copy(x, f: v)`, `a ⊕ b`, `refuse(kind, …)`, `-- text`.

## Step 3: Comprehension review with isolated DeepSeek agents, and the reMarkable upload

Four chapters (1, 4, 9, 11) went to isolated pi agents (DeepSeek 4.1 flash, thinking high, no tools, no context
files, no skills), one per chapter, following the pi subagents handbook. Each got five comprehension questions (one
of them a trap whose correct answer is "not stated in the chapter"), two transfer contexts the chapter never
mentions, and a request for review notes.

All 20 controls were answered correctly, including the four traps. The reviews produced 21–34 items per chapter;
each finding was checked against the code before it was applied, and two were rejected or reframed with evidence.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Validate that the chapters are understood as written and transfer to other contexts.

**Inferred user intent:** Evidence that the patterns are true and reusable, not a description of one project.

**Commit (code):** d3d2886 (same commit as Step 2; review method, specs and answers in `docs/patterns/review/`)

### What I did
- `docs/patterns/review/run-review.py`: prompt assembly, `pi -p --mode json --no-builtin-tools --no-context-files
  --no-skills --no-prompt-templates`, defensive JSON extraction.
- `spec-01.json`, `spec-04.json`, `spec-09.json`, `spec-11.json`: chapter, contexts, questions.
- Applied the verified findings; uploaded the bundle to the reMarkable at `/ai/2026/11/14/patterns/` ("Pattern
  language for image engines and editors.pdf").

### Why
- Comprehension is cheap to test and catches unclear writing before construction experiments spend hours.

### What worked
- The trap questions: every agent refused to invent an answer.
- A real defect: the chapter 4 reviewer showed a same-key request would render twice; chromobench's queue does exactly
  that and relies on its result cache. The sketch now adopts the running render.
- Transfer exercises produced new variations (one generation for dependent views, ordered diffusion-step streams,
  content-addressed assets for generated pixels).

### What didn't work
- JSON output needed two repairs in practice: raw newlines inside strings (`strict=False`) and unescaped quotes inside
  prose (regex repair; needed for chapter 1).

### What I learned
- A reviewer's confident "doubtful" can be wrong: the chapter 9 reviewer doubted an Editor lab claim that is true
  (`src/workspace.js:410` in its archive); it is now cited instead of removed.

### What was tricky to build
- Questions with answers in the text that are not guessable from general knowledge, so a correct answer shows reading.

### What warrants a second pair of eyes
- Chapters 2, 3, 5–8, 10, 12 had no comprehension review.

### What should be done in the future
- N/A (superseded by the construction experiments, which test more).

### Code review instructions
- `docs/patterns/review/README.md` (method, results table, what changed); `answers/ch0N-a.json`.

### Technical details
- Results: chapter 1: 5/5, understanding 0.93; chapter 4: 5/5, 0.93; chapter 9: 5/5, 0.82; chapter 11: 5/5, 0.86;
  about 16–18 k tokens per run.

## Step 4: Construction experiments — tasks, hidden tests, runner, batch

Comprehension does not show that a pattern helps build good software. The owner asked for agents that build things:
four runs per pattern to see how robustly the pattern is applied, projects in subfolders, a diary per run in the
diary skill's format, transcripts analysed with go-minitrace, and the code reviewed in the spirit of Gabriel,
Alexander and Fowler.

Four tasks were written, one per two-star pattern that fits a small dependency-free TypeScript project: graph
(chapter 1), slots (chapter 4), tiling (chapter 8), document (chapter 9). Each is stated as requirements and an API
in domain terms, never as the solution. Per task: four runs with the chapter, two controls without it; 24 runs.

### Prompt Context

**User prompt (verbatim):** "can you have the subagents actually write code / projects and review their
implementation results, to see how well your patterns actually get applied / how useful they are?" — then: "do 4 per
pattern I think, to validate how robust the pattern usage is. That way you can finetune the pattern definition
etc..." — "you can have them write their proejcts into subfolders, keep a diary, and then for example analyze their
transcripts and diary and use go-minitrace and ofc review the resulting code too." — "ask subagents implement things
to keep a diary (see ~/.codex/skills/diary) as well." — "when assessing the use of the patterns, think like richard
gabriel / christopher alexander in your philosophy, potentially like martin fowler. To give you an idea of what we
are looking for."

**Assistant interpretation:** Design and run a controlled construction experiment with pi agents, measure outcomes
with hidden tests and transcripts, and judge the code with an Alexander/Gabriel/Fowler rubric.

**Inferred user intent:** Find out whether the chapters generate good structure, and use the evidence to refine them.

**Commit (code):** cc407cb — "Pattern experiments: four construction tasks (graph, slots, tiling, document), isolated
pi runner with diaries, batch runner, scoring, go-minitrace analysis SQL, README with the run state"; e9faf21 —
"Pattern experiments README: retry procedure for provider failures"

### What I did
- `docs/patterns/experiments/tasks/{graph,slots,tiling,document}/TASK.md`.
- `run-impl.py`: one isolated run (`pi --tools read,write,edit,bash,ls,find,grep --no-context-files --no-skills
  --no-prompt-templates`, per-run `--session-dir`); copies TASK.md, the diary skill as DIARY-SKILL.md, and CHAPTER.md
  for chapter runs; asks for project/, own tests, DIARY.md, NOTES.md and a JSON self-report.
- `batch.py`: the 24 runs, 8 in parallel, model `lunaroute/deepseek-4.1-flash`, skips runs with answer.json.
- 61 hidden acceptance tests (graph 19, slots 17, tiling 9, document 16), kept in the session scratchpad
  (`hidden-7f3k/`) outside every run directory until all runs finish.
- Feasibility check of the hardest requirement (a wide blur within a 128 × 128 budget): a field approach reached max
  0.016–0.024, mean 0.003–0.006, so the requirement was set to max 0.025, mean 0.005.
- Smoke run (graph, chapter-1) passed 19/19 hidden tests; then launched the batch at 17:48.

### Why
- Two controls per task show what the chapter adds over the model's own design sense; four chapter runs show spread.

### What worked
- Smoke run end to end: files, tools, tests, diary, self-report.

### What didn't work
- Two runs failed after about 98 s with a provider error: `rc=1 98s no answer found` (graph/control-1,
  slots/control-1; pi stderr `upstream_stream_failed`). Retry procedure written into the README (step 0).
- The run prompt told agents to use `node --test project/test/`; on Node 24.18.0 that fails (see Step 7). Noticed
  only after the batch had started; all 24 runs have the same prompt, so the comparison stays fair.

### What I learned
- The first wide-blur tolerance was unreachable by any reasonable approach; an unfair test penalises every run alike.
  Checking satisfiability before launch is now in the playbook.

### What was tricky to build
- Keeping the mechanism out of the task text: the tasks name forces (sliders moving dozens of times per second,
  renders taking seconds, a memory budget) but not slots, generations, interned ids or reach.

### What warrants a second pair of eyes
- `tasks/*/TASK.md` for leaks of the pattern into the requirements; the hidden tests for fairness.

### What should be done in the future
- After the runs: copy the hidden tests into `docs/patterns/experiments/hidden/` and commit them.

### Code review instructions
- `docs/patterns/experiments/README.md` (design, run layout, after-the-batch steps), then `run-impl.py`, `batch.py`.

### Technical details
- Run layout: `<runs-root>/<task>/<variant>-<n>/` with TASK.md, DIARY-SKILL.md, CHAPTER.md (chapter runs), project/,
  prompt.md, session/ (native pi JSONL), events.jsonl, stderr.log, answer.json.
- Runs root: the session scratchpad's `pattern-runs/` (batch.log there).

## Step 5: The playbook in the vault

With the context window running low, the method was written down as a playbook in the go-go-parc vault, so the work
survives a summary and colleagues can compare it with their own.

### Prompt Context

**User prompt (verbatim):** "write up a playbook on how you do these pattern extractions (a colleague is writing their
own as well in the playbooks section of the vault)" — "do it now as we are running out of context window."

**Assistant interpretation:** A vault playbook covering the whole method: survey, map checkpoint, chapters,
comprehension controls, construction experiments, the rubric, the loop, publishing.

**Inferred user intent:** A reusable procedure, shared with the team.

**Commit (code):** go-go-parc 337a82f — "PLAYBOOK: extracting a pattern language from codebases and validating it
with agents [...]" (pushed to origin/main)

### What I did
- Wrote `Research/playbooks/pattern-extraction-with-agent-validation.md` (sections 1–8, pitfalls, files); section 6
  holds the Alexander/Gabriel/Fowler rubric (forces resolved, adapted not copied, generativity, wholeness,
  habitability, piecemeal growth, smells, tests as laws, worse is better).

### Why
- The vault is where the team keeps playbooks; the pi subagents handbook it builds on is there too.

### What worked
- Writing the plan, run layout and scoring commands into files early is what let this work continue after the summary.

### What didn't work
- N/A

### What I learned
- N/A

### What was tricky to build
- Keeping the playbook generic: the vault is public, so nothing from the photographs or the private repo's data.

### What warrants a second pair of eyes
- The rubric's lens list: whether "tests as laws" and "worse is better" belong in a design review.

### What should be done in the future
- Update with the lessons from Step 7 (Step 8).

### Code review instructions
- `~/code/wesen/go-go-golems/go-go-parc/Research/playbooks/pattern-extraction-with-agent-validation.md`, §5–§7.

### Technical details
- N/A

## Step 6: The patterns as a claude.ai artifact

The owner asked for the language as an artifact page. A small builder converts the overview, the twelve chapters and
the review README with pandoc into one page with a chapter rail (a menu on phones), light and dark themes, in-page
links between chapters, and mermaid blocks left for the viewer to render.

### Prompt Context

**User prompt (verbatim):** "can you write the patterns up as an artifact on claude as well?" — then "commit and push"

**Assistant interpretation:** Publish the language as one readable page; commit the builder and push the branch.

**Inferred user intent:** A link to read and share the patterns outside the terminal and the tablet.

**Commit (code):** a5fdb47 — "Pattern language: build-artifact.py (one HTML page from the chapters for a claude.ai
artifact); score.py scores only finished runs, in an isolated copy"; branch pushed to origin
(`task/pattern-language`).

### What I did
- `docs/patterns/build-artifact.py OUT_HTML`: pandoc GFM → HTML per file, cross-chapter `.md` links → `#ch-NN`,
  `<pre class="mermaid"><code>` → `<pre class="mermaid">`, tables wrapped for horizontal scroll.
- Checked the page headless (Playwright, `@playwright/test` from the repo): no horizontal overflow at 1400 px, 390 px
  and in dark mode; no local paths or photo names in the page.
- Published: https://claude.ai/artifact/LNwqPboGzaGFXUyQXptNxH (private until shared).

### Why
- One page with navigation reads better than thirteen files; the builder makes it reproducible after chapter edits.

### What worked
- The 201 KiB page; 7 mermaid diagrams; no unrewritten relative links.

### What didn't work
- `import { chromium } from 'playwright'` → `ERR_MODULE_NOT_FOUND: Cannot find package 'playwright'`; the repo has
  `@playwright/test`, which exports `chromium`.
- A screenshot after a same-document hash navigation showed an empty page with the rail at the bottom: it was taken
  in the middle of the smooth scroll. A fresh load at `#ch-04` with reduced motion showed the correct layout (rail at
  top 24 px, chapter at 0, active link highlighted).

### What I learned
- Mermaid in an artifact needs only `<pre class="mermaid">` with the diagram text; the viewer renders it.

### What was tricky to build
- Pandoc emits `<pre class="mermaid"><code>…</code></pre>`; the inner `<code>` has to go.

### What warrants a second pair of eyes
- The diagrams in the published page (not previewable locally).

### What should be done in the future
- Republish after the chapter revisions (same file path keeps the URL).

### Code review instructions
- `docs/patterns/build-artifact.py`; run `python3 -I docs/patterns/build-artifact.py /tmp/x.html` and open it.

### Technical details
- Page contract: `<title>Image Engine Patterns</title>`, colour tokens on `:root` with dark overrides, side gutters
  `max(16px, env(safe-area-inset-*))`.

## Step 7: Scoring and transcript fixes, and the blind review harness for Opus reviewers

While the batch ran, the scoring and analysis were run on the first finished runs, and three problems in the
experiment's own instruments came out. Each would have produced a wrong conclusion if left alone. The blind design
review was then built as a workspace generator; the owner asked that the reviews run on Opus subagents.

At 18:30, 8 of 24 runs had ended: 6 with answers, all 6 passing every hidden test; the 2 provider failures await the
retry after the batch.

### Prompt Context

**User prompt (verbatim):** "Check scratchpad/pattern-runs/batch.log progress; if the batch has finished, retry
failed runs (see docs/patterns/experiments/README.md step 0), then score (score.py), run go-minitrace analysis, and
start blind design reviews per the playbook." — then "you should review with opus subagents" — "commit scripts and
fill out your diary (see ~/.codex/skill)"

**Assistant interpretation:** Wait for the batch before retrying; meanwhile make scoring, analysis and review ready
and correct; reviews by Opus subagents; commit; write this diary.

**Inferred user intent:** Results that can be trusted, and a record of how they were produced.

**Commit (code):** 5cd521d — "Pattern experiments: analyze.py (go-minitrace convert + queries), review-design.py
(blinded workspaces for Opus reviewers), score.py lists own test files explicitly, behaviour query reads failures
from output; README steps 1, 2, 4"

### What I did
- Scored the finished runs: `python3 -I score.py <runs> <hidden> <eval> interim.json`.
- Fixed own-test scoring: the test files are listed explicitly (`own_test_files`).
- `analyze.py`: converts each finished session once (`go-minitrace convert pi --source-dir <run>/session
  --output-dir <trace>/<task>-<variant>-<n>`), runs `analysis/*.sql` over all archives, writes `.json` and `.txt`.
- `analysis/02-behaviour.sql`: failures from output text, first diary turn and turn count, narrower boundary checks.
- `review-design.py`: builds `<review-dir>/<task>-r<seed>/` with CHAPTER.md, TASK.md, FACTS.md and impl-A … impl-F
  (src/ and test/ only, shuffled by seed, "chapter" and the pattern names redacted to "[ref]"), the key in
  `<review-dir>/keys/`, the reviewer prompt in `<review-dir>/<task>-r<seed>.prompt.md`; `--run-pi` keeps a pi reviewer
  as an option.

### Why
- The hidden tests do not discriminate (every finished run passes them), so the design review carries the comparison
  between chapter runs and controls; it must be blind and the reviewer strong, hence Opus.

### What worked
- Interim scores (hidden / own / diary steps / src lines): document chapter-1 16/16, 58/58, 4, 747; document
  control-1 16/16, 42/42, 5, 642; graph chapter-1 19/19, 48/48, 5, 612; graph chapter-2 19/19, 44/44, 9, 597; graph
  control-2 19/19, 30/30, 3, 468; slots chapter-1 17/17, 40/40, 12, 306.
- Every chapter run read CHAPTER.md at turn 1 or 2, before its first source write (turn 4–13).
- Dry runs of the review workspace: redactions 0–1 per implementation.

### What didn't work
- Own tests scored "0/1": `node --test project/test/` on Node v24.18.0 gives `Error: Cannot find module
  '…/project/test'` (`MODULE_NOT_FOUND`), reported as `not ok 1 - project/test`. The run prompt prescribed this
  command; graph runs that passed had added a `test/index.js` that imports the test files.
- `go-minitrace query run --archive-glob '<trace>/**/*.minitrace.json'` → `Error: archive globs matched no files`:
  the glob has no `**`. Archives are now passed one by one (or as `<trace>/*/active/*/*.minitrace.json`).
- In zsh, `$ARGS` holding several `--archive-glob x` pairs is one word: `Error: unknown flag: --archive-glob …`.
- `failing_test_runs` was 0 everywhere: pi records no exit codes (`exit_code` is null for all 261 tool calls), so
  `coalesce(exit_code, 0) <> 0` never fires. The query now reads `# fail N`, `not ok`, `✖` and `Cannot find module`
  from `result`: 7–9 failing test runs per agent.
- `SELECT … FROM sqlite_master` → `query references disallowed table/view "sqlite_master"`; `SELECT * … LIMIT 1` with
  `--output json` shows the columns instead.

### What I learned
- Agents spent turns probing the broken test command in `/tmp` (3–6 commands in 5 of 6 runs): an instruction error
  in the prompt shows up as boundary crossings in the transcript.
- Diaries were written once, late: the first DIARY.md write came at turn 21–34 of 29–59, despite "write a step
  whenever you finish a design decision". The diary steps are reconstructions, not a log.
- No run reached for the hidden tests or outside its directory except `/tmp`.

### What was tricky to build
- Blinding: chapter runs may cite the chapter in comments. The redaction covers "chapter", "CHAPTER.md", "pattern
  book/language" and the four pattern names; counts go to the key so leaks can be checked. Vocabulary such as "slot"
  or "intern" stays: whether the code speaks the pattern's language is part of what is judged.
- The reviewer must not see the key: it lives in `keys/` beside, not inside, the workspace, and the prompt restricts
  the reviewer to the workspace.

### What warrants a second pair of eyes
- `analysis/02-behaviour.sql` failure detection reads truncated output (`| tail`, `| head` in the agents' commands);
  it can miss or double-count.
- The change requests in `review-design.py` (`CHANGES`): they decide what "piecemeal growth" measures.

### What should be done in the future
- After the batch: retry the two failures, score all runs, run `analyze.py`, build workspaces and run one Opus
  reviewer per task; a second seed per task if reviewer agreement needs checking.
- Fix the run prompt's test command for the rerun after the chapter revisions.
- Remove the stale worktrees under `.claude/worktrees` (agent-a2e261adfc9ef2cdd, agent-afbe3c358e522d549).

### Code review instructions
- `docs/patterns/experiments/score.py` (`own_test_files`), `analyze.py`, `analysis/02-behaviour.sql`,
  `review-design.py` (`REDACT`, `CHANGES`, the prompt).
- Validate: `python3 -I review-design.py graph <runs> <dir> 1 --allow-partial`, then inspect `<dir>/graph-r1/` and
  `grep -rn -i chapter <dir>/graph-r1/impl-*` (should print nothing).

### Technical details
- Behaviour on the first six runs (chapter reads / first chapter turn / first src write / test runs / failing):
  document chapter-1 1/2/13/16/8; document control-1 0/–/4/11/7; graph chapter-1 2/1/4/17/9; graph chapter-2
  1/2/6/17/9; graph control-2 0/–/4/18/9; slots chapter-1 1/2/5/18/9.

## Step 8: Playbook updated with the lessons; artifact without smooth scroll

The lessons from Step 7 are generic, so they went into the vault playbook: read the smoke run's transcript and run
every command the prompt prescribes; list own-test files explicitly; when all runs pass the hidden tests the design
review carries the comparison; pi records no exit codes; go-minitrace globs have no `**`; measure when diaries are
written; how to run the blind review (Opus reviewers, blinding, change requests, the guess last). The artifact page
lost its smooth scrolling, which the owner found slow when jumping between chapters.

### Prompt Context

**User prompt (verbatim):** "update the playbook i the publish vault too, if that helps" — "remove the slow scroll
when selecting a sections in the artifact, please"

**Assistant interpretation:** Add this round's lessons to the vault playbook; make chapter jumps instant.

**Inferred user intent:** Keep the shared method current; a page that is quick to navigate.

**Commit (code):** go-go-parc 3e35caf — "PLAYBOOK pattern extraction: lessons from the first construction runs [...]";
chromobench 825a08d (build-artifact.py without `scroll-behavior: smooth`; artifact version 2)

### What I did
- Playbook §5 (smoke test, scoring, transcript traps), §6 ("How to run it"), pitfalls (instruments can be wrong,
  provider errors), files.
- Removed the `prefers-reduced-motion: no-preference` smooth-scroll rule from `build-artifact.py`, rebuilt, and
  republished to the same URL.

### Why
- The playbook is what a colleague will follow; the traps cost real time here.

### What worked
- Committing only the playbook path (`git commit -- <file>`) left the vault's other work untouched.

### What didn't work
- Not pushed: the vault's `main` also carries two unpushed commits from the agent-operated-engines work (da6fb72,
  3dd7853) and uncommitted files of that work; pushing would publish them too.

### What I learned
- The other vault work (`agent-operated-engines/_validation`) runs a similar build-and-blind-review loop; the two
  playbooks can be compared once both are pushed.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Whether to push the vault now (three commits) or wait for the agent-operated-engines work.

### What should be done in the future
- Push go-go-parc when the other work is ready.

### Code review instructions
- `git -C ~/code/wesen/go-go-golems/go-go-parc show 3e35caf`.

### Technical details
- N/A

## Step 9: Why the tiling runs timed out (transcripts, go-minitrace, the code)

At 18:48 two tiling runs ended `rc=1 3600s` (TIMEOUT). The transcripts, go-minitrace queries over all finished and
timed-out sessions, and the agents' own code give three causes, two of them in the experiment rather than the task.
Interventions made at about 18:55: killed an orphaned test process and a hung test in a live run (details below).

### Prompt Context

**User prompt (verbatim):** "can you look at their transcripts?" — "to figure out why they hung on tiling?" — "look at
go-minitrace skill in ~/.codex/skills btw"

**Assistant interpretation:** Diagnose the two tiling timeouts from the transcripts, using go-minitrace as the skill
describes (source list, schema help, saved SQL, results).

**Inferred user intent:** Know whether the timeouts measure the pattern, the task, or the harness, before deciding on
retries.

**Commit (code):** (this step's commit) — analysis/04-time-budget.sql, analysis/05-stalls-and-slow-tools.sql,
timeline.py

### What I did
- `timeline.py` over each pi session (per message: local time, gap, thinking size, calls, result heads).
- go-minitrace: `convert pi --source-list sources.txt` for the two timed-out sessions; queries 01-time-budget,
  02-longest-model-turns, 03-stalls-and-slow-tools over them and the six finished runs (scratchpad `tiling-hang/`).
- Ran chapter-1's own tests one by one with a 15 s cap (`per-test.py`), then probed the hanging test's calls.
- `ps`/`lsof` on running `node --test` and `pi` processes.

### Why
- A timeout can mean a hard task, a slow model, a hang, or a harness fault; each needs a different fix.

### What worked
- **tiling/chapter-1: an infinite loop in its own code, and nothing to stop it.** At 18:16:24 it ran
  `node --test test/tiling.test.ts`; the call never returned. Its test "empty chain and single pixel images" calls
  `renderTiled` with a 1-pixel budget; `subBlurCount` (`src/index.ts:413`) splits a wide blur into sub-blurs whose
  variances add and loops `while (Math.ceil((3 * radius) / Math.sqrt(count)) > maxRadius) count++` with
  `maxRadius = 0`, which never ends. pi's bash call has no timeout, so the agent waited 32 min until the 3600 s kill.
  The loop came from a rewrite at 18:13 (exact multi-pass streaming instead of the field approximation). Before that it
  thought hard: two turns of 135 k and 132 k thinking characters (7.0 and 4.8 min).
- **tiling/control-1: out of time, nearly done.** 61 assistant turns, 168 k output tokens, 450 k thinking characters
  (graph and document runs: 43–70 k tokens, 63–138 k characters); a 245 k-character first turn (9.1 min); one test run
  of 10.5 min (its wide-blur suite before an optimisation; 11.7 s after); one 5-min provider stall. At 18:47 its 19
  tests passed; it was re-reading its code, with DIARY.md, NOTES.md and the answer still unwritten, when killed.
- **All runs: the provider's concurrency limit.** `OpenAI API error (429): {"code":"CONCURRENT_REQUEST_LIMIT_EXCEEDED",
  "message":"Organization has reached its maximum number of concurrent requests."}` in 8 runs (9 times); each costs
  exactly 5.0 min before pi retries. At 18:55, 26 pi agents were running on this machine: 8 of this batch, 11 builds
  of the agent-operated-engines validation (`~/pattern-validation/builds/…`), 7 reviews under `~/dustdet/review/…`.
  The two early failures (`upstream_stream_failed`, `willRetry: false`) came at launch under the same load.

### What didn't work
- `node --test --test-reporter=spec` (and `tap`, with `--test-isolation=none`) under a `perl -e 'alarm 40'` cap printed
  nothing: a synchronous infinite loop blocks the event loop before the reporter flushes. Running each test alone
  with `--test-name-pattern` and a subprocess timeout found it in one pass.
- `run-impl.py`'s 3600 s timeout kills pi but not its children: chapter-1's test process kept running as an orphan at
  98 % CPU for 37 min, slowing the other runs.

### What I learned
- slots/control-2 hung the same way, differently: an integration test with real timers waited forever (0 % CPU,
  25 min) from 18:29:26. Hangs are a property of agent-written tests, not of one task.
- Interventions (recorded here because they change runs): killed the orphan (pids 66557, 66559, tiling/chapter-1) and
  the hung test of the live run slots/control-2 (pids 90005, 90007) at about 18:55, so that agent could continue.

### What was tricky to build
- Telling model time from tool time: tool results are stamped when the call is issued, so a slow tool shows up as a
  long gap before the next assistant turn; `tool_calls.duration_ms` separates them.

### What warrants a second pair of eyes
- Whether tiling results from 1-hour runs are comparable at all, given 5-min stalls that hit runs unevenly.

### What should be done in the future
- `run-impl.py`: start pi in its own process group and kill the group on timeout; a watchdog that kills any test
  process in the run directory after 5 min (the agent sees it terminated and continues).
- Prompt: bound test commands (`--test-timeout`), write DIARY.md and NOTES.md as you go (also Step 7's finding).
- Parallelism: fit the batch to the provider's shared concurrency limit, counting other users' agents.
- Tiling: rerun all six with the fixes and a 2-hour budget, so chapter and control runs can be compared.

### Code review instructions
- `docs/patterns/experiments/timeline.py SESSION.jsonl`; `analysis/04-time-budget.sql`,
  `analysis/05-stalls-and-slow-tools.sql` (run by `analyze.py`).

### Technical details
- Time budget (recorded min / output tokens / thinking chars): tiling chapter-1 28.1 / 107,826 / 310,396 (then 32 min
  hung); tiling control-1 59.9 / 168,103 / 450,261; document chapter-1 31.2 / 69,605 / 135,072; graph control-2
  31.5 / 43,416 / 62,831.

## Step 10: Harness v2 — supervised runs, a prompt that states time, retried provider failures

The first batch ended at 19:48 with 16 of 24 runs answered. The eight losses were three provider failures
(`upstream_stream_failed`: graph/control-1, slots/control-1, and tiling/chapter-4 after 727 s, which the new check
classified), four tiling runs and slots/control-2 at the 60-minute limit. Step 9 traced the limit hits mostly to the
harness. This step fixes the harness and starts a clean rerun of the two affected tasks.

### Prompt Context

**User prompt (verbatim):** "ok, improve. If you don't have a ticket for it and its diary, create it. commit at
appropriate intervals, keep a diary according to the diary skill in ~/.codex/skills)" — preceded by "what are the
harness fixes? is this all to deal better with 429?"

**Assistant interpretation:** Implement the five harness fixes (process-tree kill, watchdog, prompt, parallelism,
tiling budget) under CHB-036, test them, commit in steps, record them here, and rerun the affected tasks.

**Inferred user intent:** Experiment results that measure the patterns rather than the harness.

**Commit (code):** c7f9b17 — "Pattern experiments: supervise.py, a process-tree supervisor for agent runs [...]";
6d2c9be — "Pattern experiments harness v2: runs under supervise.py [...]"

### What I did
- Read pi's bash tool (`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js`):
  `detached: process.platform !== "win32"` and `timeout: Type.Optional(... "no default timeout")`. Each command is
  its own process group, so killing pi's group can never reach it; only the process tree can.
- `supervise.py`: new session for the agent; every 5 s a `ps` scan of the agent's descendants; a descendant older than
  the watchdog limit has its process group killed (TERM, KILL after 2 s); at the budget, every descendant group and
  the agent's own group are killed. `test_supervise.py`: 6 tests with a fake agent that runs commands detached like
  pi (fast commands untouched; a never-ending `sleep` killed and the agent continues; a CPU-bound `node -e
  'for(;;){}'` killed; the budget leaves no orphans; the agent's own children die with it). 6/6 pass in 16 s.
- `run-impl.py` (harness v2): argparse options `--budget-min`, `--watchdog-min`; prompt states the budget with start
  and stop times, the watchdog, `node --test --test-timeout=60000 project/test/*.test.ts`, scratch files in
  `project/scratch/`, the first diary step before the first source write, `NOTES.md` kept current, and stopping new
  features 15 minutes before the end; `run.json` records settings and outcome; exit code 3 for provider failures.
- `batch.py`: `--tasks`, per-task budgets, `--par` 4, longest tasks first, provider failures retried twice after
  60 s with the failed attempt moved to `_failed/`.
- Checked the new test command on graph chapter-1's tests (48/48) and the provider-failure signature on two real
  failures (last assistant `stopReason: "error"`, `errorMessage: "Error Code upstream_stream_failed: …"`).
- Smoke run: tiling chapter, budget 2 min, watchdog 1 min → `run.json` `timed_out: true`, `outcome: "timeout"`,
  `watchdog.log` "budget 120s reached: killing groups [39635]", no process left.
- Launched v2 at 20:11:32: `batch.py <scratchpad>/pattern-runs-v2 --tasks tiling,slots --par 4 --budget-min
  tiling=120,default=60 --watchdog-min 5 --retries 2` (12 runs). 24 other pi agents were running at launch.

### Why
- One hanging command cost a whole hour; the watchdog turns that into five minutes and a lesson for the agent.
- Rerunning whole tasks keeps chapter and control runs of one task under one harness and one prompt.

### What worked
- The fake-agent tests reproduced both observed hangs (a waiting test and a spinning test) and the orphan.

### What didn't work
- First test run: `python3 -I -m unittest test_supervise` → `ModuleNotFoundError: No module named 'test_supervise'`
  (`-I` drops the current directory from `sys.path`); the file now runs as `python3 -I test_supervise.py -v`.
- Two tests then failed with `PermissionError: [Errno 1] Operation not permitted` from `os.killpg(pgid, 0)`: on macOS a
  group whose leader is an unreaped zombie answers EPERM. Group membership is now read from `ps` (non-zombie members),
  and signals go to the group and to each member.

### What I learned
- tiling/chapter-4's "no answer after 727 s" in v1 was a provider failure, not a timeout.

### What was tricky to build
- Telling the agent's own group from its commands' groups: the agent is the leader of the new session's group
  (`pgid == pid`); everything with another pgid below it is a command the watchdog may kill.

### What warrants a second pair of eyes
- The watchdog was not exercised with real pi (a model cannot be made to hang on cue); its mechanism matches pi's
  detached spawn, which the fake agent copies.
- A legitimate test suite longer than 5 minutes would be killed (v1 tiling/control-1 had one of 10.5 min). The prompt
  now asks for a suite well under a minute.

### What should be done in the future
- After v2: score both roots, run `analyze.py`, compare stalls and watchdog kills with v1, then the Opus reviews.
- The playbook's harness section should get the process-tree lesson.

### Code review instructions
- `docs/patterns/experiments/supervise.py` (`supervise`, `kill_group`, `group_members`), `test_supervise.py`,
  `run-impl.py` (prompt "Time" section, exit codes), `batch.py` (`one`, retries).
- Validate: `cd docs/patterns/experiments && python3 -I test_supervise.py -v`.

### Technical details
- v2 runs root: the session scratchpad's `pattern-runs-v2/` (`batch.log`, `_failed/`); per run `run.json`,
  `watchdog.log`.

## Step 11: v2 results — tiling separates chapter from control; harness fixes confirmed; blind Opus reviews launched

The v2 rerun (tiling and slots, all six runs each, harness v2) finished at 21:36: 12 of 12 runs answered, no provider
retries, one watchdog kill that the agent survived. Scoring both roots gives the experiment's first discriminating
result, and the transcripts confirm the harness fixes. The four blind design reviews now run on Opus subagents.

### Prompt Context

**User prompt (verbatim):** (see Step 7: "Check scratchpad/pattern-runs/batch.log progress; …, then score (score.py),
run go-minitrace analysis, and start blind design reviews per the playbook." and "you should review with opus
subagents")

**Assistant interpretation:** Score, analyse and review now that all four tasks have complete run sets (graph and
document from v1, tiling and slots from v2).

**Inferred user intent:** Evidence on whether the chapters help, judged by tests and by design.

**Commit (code):** (this step's commit) — analysis SQL run label, review-design.py implementation count, diary

### What I did
- `score.py` on `pattern-runs-v2` (tiling, slots) and on `pattern-runs` (graph, document).
- `analyze.py` on both roots; fixed the SQL run label (`instr(…, '/pattern-runs') + 1`, so `pattern-runs-v2` paths
  read as `pattern-runs-v2 slots chapter-1`).
- `review-design.py` workspaces (seed 1): graph from v1 (5 runs, `--allow-partial`; control-1 failed at the provider
  in v1), document from v1, slots and tiling from v2; the prompt now states the number of implementations (it said
  "six" for graph's five). Redactions per implementation 0–3. Four Opus subagents (model opus, read-only, confined to
  their review directory) run the reviews.

### Why
- Only complete run sets can be compared; v1 tiling and slots were lost to the harness.

### What worked
- **Tiling discriminates.** Hidden tests: chapter-1..4 9/9 each; control-1 6/9 (fails "exact: chained blurs with
  pointwise steps between them" and both wide-blur tests), control-2 7/9 (fails "wide: a blur far wider than any
  tile, within budget and tolerance" and "wide: a wide blur followed by a narrow one"). The chapter's hard part
  (wide kernels computed once at reduced resolution) is exactly what the controls miss.
- **Graph, document, slots do not discriminate:** every run passes every hidden test (graph 19/19 ×5, document 16/16
  ×6, slots 17/17 ×6). Own tests all pass (slots 32–45, tiling 20–56, document 39–58, graph 30–48).
- **Harness v2 confirmed:** first diary write at turn 4–5 (v1: 21–34); no 429 stalls in v2 (v1: 9 in 8 runs);
  `tmp_use` 0 in 11 of 12 runs; no outside attempts; slots runs took 7–8 min (v1: 30+); tiling 27–51 min within the
  2-hour budget.

### What didn't work
- N/A in this step.

### What I learned
- Wide kernels are where the chapter's knowledge is not in the model's default design sense; the other three tasks'
  difficulties are solved by the model unaided, so their value (if any) has to show in the design review.

### What was tricky to build
- Comparing across harness versions: graph and document ran under v1 (broken test command, late diaries), tiling and
  slots under v2. Within each task all six runs share one harness, which is what matters for chapter vs control.

### What warrants a second pair of eyes
- Tiling's controls failing may partly reflect the task's tolerance choice (max 0.025, mean 0.005); the feasibility
  check (Step 4) showed a sound field approach reaches it, and all four chapter runs did.

### What should be done in the future
- Collect the four reviews, unblind with `keys/`, combine with tests, transcripts and diaries (playbook §7), revise
  chapters 1, 4, 8, 9.

### Code review instructions
- `docs/patterns/experiments/analysis/*.sql`, `review-design.py`.

### Technical details
- Scores: `<scratchpad>/pattern-eval-v2/results.json`, `<scratchpad>/pattern-eval/results.json`; analysis
  `<scratchpad>/pattern-analysis-v2/`; review workspaces and prompts `<scratchpad>/pattern-review/`.

## Step 12: The blind reviews — chapters shape the code everywhere, improve it in two of four

Four Opus subagents reviewed the four tasks blind (graph 5 runs, document, slots and tiling 6 each), each with the
chapter as yardstick and the rubric of the playbook §6, read-only inside its review directory. Unblinded with the
keys, the results say the chapters are recognisable in every task and better in two.

### Prompt Context

**User prompt (verbatim):** (see Step 11)

**Assistant interpretation:** Collect, unblind and combine the reviews with the tests.

**Inferred user intent:** Know which chapters work and how to fix the others.

**Commit (code):** (this step's commit) — RESULTS.md, reviews/, results-v1/v2.json, extract.py, unblind.py

### What I did
- The reviewers return their report through the hand-back tool, not as message text; `extract.py` reads the last
  fenced JSON from the agent's transcript, including tool-call inputs (the first version looked only at text and
  printed "no json block found").
- `unblind.py` joins each review with its key; `RESULTS.md` combines tests, reviews and the per-chapter changes.

### Why
- Pass rates alone could not tell three of four tasks apart; the design review was the planned second instrument.

### What worked
- Reviewer guesses separated chapter runs from controls perfectly in all four tasks (chapter runs 0.75–0.97, controls
  0.10–0.30).
- Graph: all chapter runs above the control. Tiling: all chapter runs above both controls (and only the controls
  fail hidden tests). Document: mixed (one chapter run last, below both controls). Slots: mixed (a control has the
  highest score, 28/35).
- Each review lists concrete chapter defects and ideas the chapters lack, with file:line evidence (RESULTS.md).

### What didn't work
- The first extraction attempt (text only) found no JSON; fixed as above.

### What I learned
- A chapter can be recognisable and still not help: in slots, chapter 4's sketch put the lane on the slot and
  released before presenting, and the runs that copied it inherited both defects.
- Chapters with sketches teach their sketch's mistakes; Implementation notes that are GPU- or project-specific
  (power-of-two tiles, halo multiples of 8) are applied where they do not fit.

### What was tricky to build
- Reading scores across reviewers: each reviewer's scale differs, so comparisons are within a task, not across.

### What warrants a second pair of eyes
- One reviewer per task: a second seed per task would measure reviewer agreement before large chapter rewrites.

### What should be done in the future
- Revise chapters 1, 4, 8 and 9 from RESULTS.md (keep the old versions), then rerun the same tasks on the revised
  chapters with harness v2 (playbook §7).

### Code review instructions
- `docs/patterns/experiments/RESULTS.md`; `python3 -I unblind.py <review-dir> <task>`.

### Technical details
- Reviews: `docs/patterns/experiments/reviews/<task>-r1.answer.json` with `<task>-r1.key.json`.
