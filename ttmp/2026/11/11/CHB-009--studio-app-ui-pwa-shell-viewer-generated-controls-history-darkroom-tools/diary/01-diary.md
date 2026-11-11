---
Title: Diary
Ticket: CHB-009
Status: active
Topics:
    - ui
    - product
    - darkroom
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:24.499496965-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-008 and CHB-009 (agent integration and UI). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-studio-app-ui.md` (11102 words), added 19 staged tasks, and related the primary source files.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Requested milestone: a complete intern guide plus a task breakdown for this ticket.
**Inferred user intent:** The ticket can be picked up by a new engineer or agent without prior context.

### Evidence and commits
- Brief: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md` (session scratchpad); shared map: CHB-001 `design-doc/01-chromobench-architecture-and-work-plan.md`.
- Filed with `python3 -I CHB-001/scripts/07-ingest-intern-guides.py <agent output> .` and checked with `scripts/08-check-guide-markdown.py` (fences tagged, no raw HTML).
- Writer agent: one background general-purpose agent for CHB-008 + CHB-009; checked cited line ranges against Filmbench, Chromogen, goja-cv and replmcp; web research on go-sdk/MCP, Claude Code/Desktop config, TS SDK, WebGPU canvas, FSA/OPFS, React.
- The writer's own summary, kept as returned:

> Summary: both guides are below in the brief's block format. CHB-008 covers the eval channel (sessions, per-session FIFO, deadlines, cancellation, forced termination, all-or-nothing commit, multiple frames and pages); the Go bridge (ServeMux only, go:embed, coder/websocket relay, an MCP server on the official go-sdk with `eval`/`status`/`create_session` tools, resources and a prompt, stdio/HTTP and attach mode, setup for Claude Code and Claude Desktop); the in-app chat (a key-holding reverse proxy, the TypeScript SDK with baseURL, `claude-opus-5-5`, a native `eval` tool, an append-only history to satisfy preserved thinking, approvals, Stop and revert); and playbooks, the replay harness, metrics-driven pruning and privacy. CHB-009 covers a React 19 decision record with a framework-free core, the PWA, FSA, OPFS and IndexedDB, the WebGPU display-p3 presenter, a latest-wins scheduler with draft and screen passes, generated controls in darkroom units, history and provenance, the darkroom tool UIs on mock ops, accessibility and shortcuts, and the chat panel. Both guides have ASCII wireframes and data flows.
> 
> - **Checks.** I checked the source line ranges I cite against the files: Filmbench, Chromogen, goja-cv, and replmcp in the Go module cache. I computed the unit numbers myself and took the rest from the textbook (§2.6–2.8). Web research I used: go-sdk v1.8.0 and MCP revision 2026-07-28 (stateless), Claude Code `claude mcp add`, Claude Desktop config paths, TS SDK `dangerouslyAllowBrowser` and the `anthropic-dangerous-direct-browser-access` header, the WebGPU canvas `colorSpace`/`toneMapping`, File System Access support status (Chromium only), OPFS, and React 19.3.
> - **Correction to the brief's framing.** Filmbench's history compression (01-inline.js 4832–4839) and its regenerated system prompt would break Claude Opus 5.5's prefix check, which is enforced for accounts created on or after 2026-08-31. CHB-008 therefore specifies an append-only transcript with server-side context editing.
> - **Verified and recorded.** I checked the ring-around sign convention against Chromogen's renderRing at 4332: labels name the colour the print moves towards, while the offsets are changes in light. CHB-009 §6 records this and adds a reference-engine test.
> - **Proposed contract additions for CHB-002.**
>   - CHB-008 asks for:
>     - `LoggedMutation.seq` and `frame`;
>     - a `Look` shape;
>     - new diagnostic codes;
>     - an engine `AbortSignal`;
>     - `EvalResult.trace`;
>     - a dust-retouch recipe field.
>   - CHB-009 asks for:
>     - `ArgSpec.ui.display`, `scale` and `aside`;
>     - `ArgSpec.path`;
>     - id-keyed array paths;
>     - `Exposure.enabled`;
>     - vector `MaskSpec` shapes;
>     - `FrameRecipe.probes`;
>     - a `view.inspect` op;
>     - `ImageResult.texture`;
>     - the densitometer result shape.
> - **Draft copies** are in `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb-008.md` and `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb-009.md`. They are identical to the text below.
> 

### Noteworthy decisions or failures
- The guide's "Proposed contract additions (for CHB-002)" section, where present, is a proposal. It must be reconciled with CHB-002 before implementation.
- Numbers the writer computed for the guide (not from the textbook) are labelled as such in the guide. They are not independently re-verified here.

### Remaining requirements and next action
- Implementation has not started. Tasks in `tasks.md` are open.
- Next: review the guide, settle the open decisions it lists, and start stage 1.

## Step 2: Orientation: the brief, the CHB-001 map and the architecture doc

I started by reading the orchestrator's common brief and the CHB-001 material that both guides (CHB-008 and CHB-009) build on. I wanted the vocabulary, contracts and planned paths the guides must use exactly, and the rules for how to work and what to return.

For the studio, the architecture doc defines everything the UI drives: the op registry with `ArgSpec.ui`, `compile`, the `Engine` interface and `EvalTarget`, the recipe, mutations, the edit log with ask mode, and the M1 "walking skeleton" milestone (§8.2). The Filmbench analysis covers its views and control plane. All times in this diary are UTC, taken from the session transcript.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
**Orchestrator brief (not the user's words):** a task message that begins "Write two chromobench intern guides: **CHB-008 "Agent integration"** and **CHB-009 "Studio app UI"**". For CHB-009 it asks for a decision record choosing the UI framework, plus six stages:
- the shell: PWA, File System Access with a fallback, OPFS, IndexedDB, film strip, projects and rolls;
- the viewer: WebGPU in `display-p3`, before/after, a "latest request wins" scheduler, a densitometer, and views;
- controls generated from `ArgSpec.ui`, in darkroom units;
- history: undo/redo, approvals, `why()`, snapshots;
- the darkroom tools, specified against mock ops;
- accessibility, keyboard shortcuts and the chat panel.

It also asks for ASCII wireframes, the data flow from a control change to the canvas, and the M1 slice on the mock engine. The common brief is at `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md`.
**Assistant interpretation:** write a self-contained intern guide for CHB-009, alongside CHB-008, and return it as text in GUIDE, TASKS and RELATED blocks. Do not change existing material and do not write into the ticket.
**Inferred user intent:** a new engineer can start the studio app from the guide alone. The orchestrator files it in the ticket and uploads it to reMarkable.
**Commit (code):** none. This work made no commits; the guides were returned as text.

### What I did
- Read the common brief (15:43:51).
- Ran `ls -R $C1 | head -100; wc -l $C1/design-doc/*.md $C1/various/*.md; cat /home/manuel/.claude/skills/ticket-research-docmgr-remarkable/references/writing-style.md` (15:43:54).
- Read `$C1/design-doc/01-chromobench-architecture-and-work-plan.md` (591 lines).
- Read `$C1/various/analysis-filmbench-ide.md` and listed the extracted Filmbench and Chromogen scripts with `wc -l` (15:43:58).
- Read parts of `$C1/various/analysis-goja-cv.md` (15:44:01 to 15:44:04). Its §5 gives the "document pixels" convention, which the viewer uses.

### Why
- The brief requires the architecture doc's names to be used exactly. Anything new goes under "Proposed contract additions (for CHB-002)".

### What worked
- The architecture doc gave everything the UI consumes: `FrameRecipe`, `Mutation`, `LoggedMutation`, the edit log (fold, cursor, state hash, `why(path)`, ask mode), `OpDef`/`ArgSpec`, `compile`, `Engine`, `EvalTarget`, the planned paths `apps/studio` and `packages/...`, and milestone M1.
- The Filmbench analysis gave its view list and layouts (§1), its control plane (§2), and its unfinished parts (§6), including a mask editor that does not exist.

### What didn't work
- No failures in this step.

### What I learned
- The contract has no fields for a display unit, a stored probe, or an exposure that can be switched off. These became proposed additions (guide §9).

### What was tricky to build
- N/A (reading).

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Compare guide §3 and §9 with architecture doc §5.

### Technical details
- `C1` = `/home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite`.

## Step 3: Filmbench's control plane and control schemes

The orchestrator brief pointed to Filmbench's control plane (01-inline.js 1796–2117) and `vfs/controls.js` as a model for generated controls, macros, layers and `why()`. I read both and recorded the line where each class starts.

From this the guide takes Filmbench's control vocabulary as the shape of a generated control, its darkroom scheme as the default arrangement, and `why()` as the way provenance is presented. It records a decision not to port the layer stack.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** study the existing design for controls the orchestrator brief named.
**Inferred user intent:** generated controls built on proven vocabulary.
**Commit (code):** none.

### What I did
- `F=$C1/various/extracted/filmbench-ide/01-inline.js; sed -n 1790,1900p $F | cut -c1-330` (15:44:46).
- `sed -n 1900,2117p $F | cut -c1-260` (15:44:49).
- `cat -n $V/controls.js; ls $V/agent $V/docs $V/lib $V/examples`, with `V=$C1/various/extracted/filmbench-ide/vfs` (15:44:52).
- `grep -n '^class \|^const WIDGETS\|^function applyOp\|^/\* ---------- '`, keeping matches between lines 1796 and 2120 (16:00:09).

### Why
- The brief asks for controls generated from the registry, in darkroom units. Filmbench is the closest existing generator.

### What worked
- Part C of the Filmbench runtime is titled "parameter store with layers, macros, controls, schemes, presets". Its layers are `['look', 'macros', 'agent', 'pin']`.
- Where each piece starts:
  - `applyOp` 1806;
  - `ParamStore` 1820;
  - `Preset` 1881;
  - `Macro` 1890;
  - `WIDGETS` 1971, with ten kinds: slider, dial, stepper, toggle, select, segmented, wheel, button, choice, text;
  - `Control` 1972;
  - schemes 2030.
- `controls.js` holds three schemes over the same state: engineer, darkroom and colourist.

### What didn't work
- No failures.

### What I learned
- `Control` has the fields `.label .unit .range .step .detents .fmt .widget .requires .opens .disabledWhen`. This maps directly onto a generated `ControlModel` (guide §5.7).

### What was tricky to build
- Deciding about layers. They give presets and an agent layer that can be switched off. In chromobench the recipe has no layers, and agent changes are already marked by `by` and by approvals. The guide's decision record keeps the recipe flat: "switch the agent's changes off" becomes "revert the agent's transactions".

### What warrants a second pair of eyes
- The "no layer stack in v0" decision (guide §5.7). It removes a one-click toggle Filmbench users had.

### What should be done in the future
- N/A.

### Code review instructions
- `sed -n 1820,1878p $F` (`ParamStore`, `why`) and `sed -n 1971,2047p $F` (`Control`, `Scheme.audit`), compared with guide §4.2 and §5.7.

### Technical details
- The guide also uses `wb.apply`'s ask-mode queue and its 900 ms window for merging consecutive edits (2323–2337). I read those with `sed -n 2318,2345p $F` at 15:44:42, for CHB-008.

## Step 4: Chromogen Studio's UI

Chromogen Studio 1.2 is a working scan-to-print app with a React 18 UI. The orchestrator brief pointed to its `SLIDERS` table (05-inline.js 1003–1597) and its UI (4514–5199). I read the slider schema, the React components, the store's render queue, undo and autosave, the ring-around, the views and the colour-space handling, and the UI section of its analysis report.

From this the guide takes Chromogen's layout and keys, the idea of a second readout in another unit, commit on release, the probe readout fields and the ring-around grid. It leaves behind the store's whole-object undo and its autosave keyed by file name.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** port what works from Chromogen into a design with a framework-free core.
**Inferred user intent:** reuse a proven darkroom UI without its structural weaknesses.
**Commit (code):** none.

### What I did
- With `C=$C1/various/extracted/chromogen-studio/05-inline.js`:
  - `sed -n 995,1060p $C` for `SECTIONS` (15:44:55);
  - an `awk` over 1003–1612 listing slider ids, and `sed -n 1590,1612p $C` (15:44:59);
  - a tally of `cost`, `kind`, `type` and `widget` over 1003–1597, and the `paper` entry (15:45:04);
  - the React component list for 4514–5216 (15:45:09);
  - `Slider`, `Panel`, `PrintWindow`, `Snapshots` and `History` (`sed -n 4518,4537p`, `4585,4602p`, `4808,4870p`) (15:45:12);
  - `Left`, `CanvasView` and `RingView` (`sed -n 4904,5020p`) (15:45:17);
  - `Bar`, `Strip` and `App` (`sed -n 5104,5216p`) (15:45:21);
  - the store's methods, 3845–4512 (15:45:26);
  - `queue`/`renderNow`, `set`/undo, the probe and the ring (`sed -n 4056,4105p`, `4136,4200p`, `4258,4281p`, `4330,4348p`) (15:45:30);
  - greps for the view lists and canvas colour spaces (15:45:35 to 15:45:38);
  - the ring steps and `lightsToSliders` (15:45:49).
- Read `$C1/various/analysis-chromogen-studio.md`: the headings, then lines 560–669 for §5 "UI, scripting, export, persistence" (15:45:43 to 15:45:45).
- `grep -n 'MODEL_KEYS = '` (15:55:25).

### Why
- The orchestrator brief named these ranges. Chromogen is the only existing darkroom UI among the sources.

### What worked
- `SECTIONS` starts at 995 and `SLIDERS` at 1003.
- Tally over the sliders:
  - `cost`: 21 free, 3 rebuild, 11 spatial;
  - `kind`: 17 macro, 14 operator, 4 hybrid;
  - `type`: 2 pad, 2 select, 1 hues.
- `paper` (line 1178) is a `select` with `cost: "rebuild"` and default `kodak_portra_endura`.
- `Slider` is at 4518 and `Pad` at 4538.
- The render queue is at 4056–4104. When the renderer is busy it retries with `setTimeout(() => this.queue(), 150)`.
- View names are at 4410 (`["print", "negative", "dyes", "unreachable", "base"]`); the bar labels at 5113 are Develop, Ring-around, Source and Print, Negative, Dyes.
- The P3 canvas is at 3279–3280: `getContext("2d", p3 ? { colorSpace: "display-p3" } : void 0)`, and `ImageData` with `colorSpace: "display-p3"`.
- `ResizeObserver` is used at 4920 and 5022.
- Ring-around: steps `[2, 4, 8]` at 5012, default `this.ringStep = 4` at 3875; `lightsToSliders` at 4222; `MODEL_KEYS = ["paper", "reshoot", "fade"]` at 3861.
- The report confirms that autosaved recipes are merged back when a file with the same name is opened (3955–3956).

### What didn't work
- No failures.

### What I learned
- Chromogen's `cost` field corresponds to the registry's `OpDef.binding`. A change of paper (a "rebuild" cost) calls `engine.prepare` first, and the viewer shows a "building tables" state (guide §5.6).
- Undo there swaps whole settings objects, 200 entries kept in memory. Chromobench rebuilds undo on the edit log.

### What was tricky to build
- Fixing undo for keyboard input. Chromogen's `Slider` commits on every key-up, so a burst of arrow-key presses becomes many undo steps. The guide groups keyboard and wheel steps on one control that arrive within 800 ms into one transaction.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Compare the table in guide §4.1 with `sed -n 4518,4537p $C`, `sed -n 4056,4104p $C` and `sed -n 4916,4982p $C`.

### Technical details
- The UI is React 18 written as `React.createElement` calls, with no JSX build step.

## Step 5: Textbook printing units and golden numbers

Both guides need darkroom units with real numbers. CHB-008 uses them for the agent's vocabulary and for scoring playbook runs; CHB-009 uses them for its controls. I indexed the textbook, grepped it for the darkroom terms and golden numbers, and read the printing sections.

The filter-coupling matrices, the neutral filter pack and the definition of printer lights came from §2.6. The "Try it" numbers came from §2.7 (line 586), and the grey-card density 0.755 from line 377. Step 15 found that the guide labels 0.755 with the wrong section.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** use real textbook numbers, as the common brief requires.
**Inferred user intent:** controls and tests tied to the physics reference.
**Commit (code):** none.

### What I did
- `T="$C1/sources/The Mathematics of the Colour Negative.md"; wc -l "$T"; grep -n '^#' "$T" | head -80; grep -n -i 'printer point\|test strip\|ring-around\|ring around\|0\.755\|f-stop\|f/' "$T" | head -40` (15:45:53).
- `sed -n 530,555p "$T"` (§2.6) and `sed -n 588,632p "$T"` (§2.8 to the start of §2.9) (15:46:00).

### Why
- The controls show darkroom units and their second readout in another unit. Both need the real filter coupling.

### What worked
- The real ∂x/∂v matrix per CC (line 540): diagonal −0.0092, −0.0087, −0.0100, with off-diagonal terms −0.0007 and −0.0016.
- The mid-grey-normalised matrix (line 546).
- The neutral pack C 0, M 51.57, Y 52.53 for Portra 400 on Portra Endura (line 542).
- The grep matched line 377 (grey card 0.755) and line 586 ("Try it": +10 points of red light gives a* = −20.7 and density 0.746 → 0.956).

### What didn't work
- No failures. The section label is dealt with in Step 15.

### What I learned
- One printer point is 0.025 log H. If a filter band covered exactly one paper layer, v CC would shift that layer by −v/100 log H, i.e. 0.4 points per CC. This rule produces the second readout of the filtration sliders ("≈ −4.0 pt B" for +10 Y).

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- See Step 15.

### What should be done in the future
- See Step 15.

### Code review instructions
- `sed -n 536,546p "$T"` and `sed -n 586p "$T"`.

### Technical details
- The "Try it" result assumes flare at 0.48 % and Saunderson correction off (line 586). Its starting density is 0.746, not 0.755.

## Step 6: Filmbench's draft scheduler and History view

The viewer needs progressive rendering and the history panel needs an approval queue. Filmbench has a simple paint scheduler that draws drafts while a control is held, and a History view with an approval section. I read both.

From this the guide takes drafts while dragging and approval cards above the history. It replaces Filmbench's dirty-flag loop with a scheduler that lets the latest request win and can abort superseded renders.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** ground the scheduler and the history panel in existing code.
**Inferred user intent:** a design that improves on what already exists.
**Commit (code):** none.

### What I did
- `sed -n 3826,3860p $F` (15:46:08).
- `grep -n "history:\|function paintHistory\|views.history\|'history'" $F; sed -n 4915,4936p $F` (15:54:27), then `sed -n 4399,4415p $F` (15:54:32).
- `grep -n "^IDE.dragging = false\|^const sched = \|^document.addEventListener('pointerdown'\|^const endDrag" $F` (15:55:25).

### Why
- The orchestrator brief asks for "draft while dragging" and a "latest request wins" scheduler, and for a history with agent approvals.

### What worked
- The `grep` gave `3836:IDE.dragging = false;` and `3837:const sched = (IDE.sched = {`.
- Line 3856 sets `IDE.dragging` on `pointerdown` over `input[type=range], .ruler, .wheel, .fader`.
- Line 3857: `const endDrag = () => { if (IDE.dragging) { IDE.dragging = false; sched.request(); } };`
- The History view is at 4399, with Undo, Redo and Script buttons. The view registry at 4923 has `history: { title: 'History', about: 'every mutation, with undo' }`, and the layouts are at 4930.

### What didn't work
- No failures.

### What I learned
- Filmbench's scheduler has no cancellation. A slow paint delays the next one, and nothing stops an outdated result from being drawn. The guide's `RenderScheduler` keeps at most one evaluation in flight and one waiting slot. A newer request overwrites the waiting slot, and a monotonic `shownGen` counter stops an older result from replacing a newer one on screen.

### What was tricky to build
- Correctness without engine support for aborting. Until the `Engine` accepts an `AbortSignal` (proposed in guide §9), `abort()` cannot stop work already inside the engine. The `shownGen` rule keeps the picture correct anyway.

### What warrants a second pair of eyes
- The `pump()` sketch in guide §5.6, especially when a refine pass is triggered and how `finally` re-pumps.

### What should be done in the future
- Implement the four scheduler tests in guide §8 first.

### Code review instructions
- `sed -n 3836,3857p $F` and `sed -n 4399,4415p $F`.

### Technical details
- Filmbench shows ten views in a tiling dock with five preset layouts (4915–4936). The guide uses a fixed layout with collapsible panels for v0.

## Step 7: Web research on WebGPU canvases, file system access and React

The platform choices depend on current browser support and library versions. I searched for WebGPU canvas configuration (`colorSpace`, `toneMapping`, `rgba16float`), for browser support of the File System Access API and OPFS, and for the current React release. The queries used only generic technical terms.

These results back guide §2.2–2.3 and the decision record on the UI framework.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** cite current platform facts.
**Inferred user intent:** a design that works in the browsers the photographer uses.
**Commit (code):** none.

### What I did
- WebSearch "WebGPU canvas configure colorSpace display-p3 toneMapping extended GPUCanvasConfiguration rgba16float" (15:50:05).
- WebSearch "File System Access API showDirectoryPicker browser support Safari Firefox 2026 OPFS createSyncAccessHandle" (15:50:06).
- WebSearch "React latest version release 2026 react 19.2 react 20" (15:50:20).

### Why
- The guide's platform table and framework decision have to reflect today's support, not older knowledge.

### What worked
- WebGPU: the results included Chrome's "What's new in WebGPU 129" (canvas tone mapping mode, HDR). The summary said the answers were consistent but that no single page covered every setting.
- File access: the results included the web-features explorer page "File system access" and caniuse. Those are the sources for the guide's statements that the pickers exist only in Chromium, and that OPFS has been Baseline since March 2023.
- React: the summary pointed to React 19.3, announced on the official React blog on 9 September 2026, not to React 20. It noted that sources disagree on dates.

### What didn't work
- I did not fetch the MDN `GPUCanvasContext.configure()` page or the caniuse page directly. The guide cites them from the search results.

### What I learned
- File System Access is limited to Chromium, which makes Chromium the first-class browser for the beta. Other browsers need the import fallback (guide §5.5).

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Before stage 2, check on the target browsers that `rgba16float` with `colorSpace: 'display-p3'` and `toneMapping: { mode: 'standard' }` is accepted.
- Confirm the React version in use (19.3) when scaffolding.

### What should be done in the future
- Add a feature-detection test for the presenter (WebGPU or Canvas2D, and which format), as described in guide §5.6.

### Code review instructions
- Guide §2.2, §2.3, §5.1 and §11 (URLs).

### Technical details
- N/A.

## Step 8: Ticket state check

Before drafting, I checked what the ticket directories for CHB-002, CHB-007, CHB-008 and CHB-009 held, so that the guide would not contradict names defined elsewhere. Their guides were still empty stubs. The guide therefore proposes every missing contract field to CHB-002 explicitly, and marks DSL names as CHB-007's to choose.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** avoid conflicts with neighbouring tickets.
**Inferred user intent:** guides that agree with each other.
**Commit (code):** none.

### What I did
- `ls /home/manuel/code/wesen/chromobench/ttmp/2026/11/11/` and `ls -R` of the CHB-002, CHB-007, CHB-008 and CHB-009 directories (15:54:16).
- `wc -l CHB-0*/design-doc/*.md; head -40 CHB-008*/design-doc/*.md; cat CHB-008*/tasks.md CHB-009*/tasks.md | head -60` (15:54:20).

### Why
- The UI consumes CHB-002's types and renders CHB-008's chat session, so it must not define either.

### What worked
- The other tickets' guide files were 53-line stubs with no content.

### What didn't work
- No failures.

### What I learned
- No ticket had yet defined the chat-thread record or the stored probes. The guides split ownership: CHB-009 defines the database and its `threads` store, and CHB-008 defines the record (aligned in Step 14).

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- N/A.

### Technical details
- N/A.

## Step 9: Checking the unit arithmetic (inline Python, shared with CHB-008)

Before writing any conversion into the controls section, I computed the conversions both guides quote with an inline `python3 -I` script that read no files. The time steps, f-number conversions and filtration readouts in CHB-009 come from its output.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** no hand-computed numbers.
**Inferred user intent:** numbers a reader can trust and reproduce.
**Commit (code):** none.

### What I did
- Ran the script below at 16:00:20, without writing it to a file:

```python
import math
print('1/3 stop ratio', 2**(1/3), 'logH', math.log10(2**(1/3)), 'pts', math.log10(2**(1/3))/0.025)
print('stop pts', math.log10(2)/0.025)
for k in (-2,-1,0,1,2): print(k, round(12*2**(k/3),2), round(k*math.log10(2)/3,4), round(k*math.log10(2)/3/0.025,2))
print('f8->f11', 2*math.log10(8/11), 2*math.log10(8/11)/math.log10(2))
print('Y+10 real', [10*x for x in (0.0,-0.0016,-0.0100)], [10*x/0.025 for x in (0.0,-0.0016,-0.0100)])
print('Y+10 norm', [10*x for x in (0.0038,0.0023,-0.0061)], [round(10*x/0.025,2) for x in (0.0038,0.0023,-0.0061)])
print('+10pt red logH', 10*0.025)
print('52.53+10', 52.53+10)
```

### Why
- The controls show darkroom units, and their tests in guide §8 use these numbers.

### What worked
- Output, verbatim:

```text
1/3 stop ratio 1.2599210498948732 logH 0.10034333188799373 pts 4.013733275519749
stop pts 12.041199826559247
-2 7.56 -0.2007 -8.03
-1 9.52 -0.1003 -4.01
0 12.0 0.0 0.0
1 15.12 0.1003 4.01
2 19.05 0.2007 8.03
f8->f11 -0.27660539633256287 -0.9188632372745944
Y+10 real [0.0, -0.016, -0.1] [0.0, -0.64, -4.0]
Y+10 norm [0.038, 0.023, -0.061000000000000006] [1.52, 0.92, -2.44]
+10pt red logH 0.25
52.53+10 62.53
```

### What didn't work
- No failures.

### What I learned
- +10 CC of yellow gives (0, −0.6, −4.0) points with the real coupling, but (+1.5, +0.9, −2.4) points after mid-grey normalisation. The guide explains both, because the second readout uses the isolated-band rule while the engine uses the real coupling.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- Use these as golden values in the tests for `units.ts`.

### Code review instructions
- Rerun the script and compare its output with guide §2.1 and §8.

### Technical details
- One point is 0.025 log H; one stop is log₁₀ 2 = 0.30103 log H.

## Step 10: Checking the dodge, burn and f-number arithmetic

The exposure list and the aperture control need more numbers: seconds withheld by a dodge, seconds added by a burn, the third-stop f-number series, and a 1/6-stop time step. I computed them with a second inline script.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** check every number before it goes into the guide.
**Inferred user intent:** printing scripts that match what a printer would actually do.
**Commit (code):** none.

### What I did
- Ran this at 16:10:15:

```python
import math
print('dodge -1/4 st of 12s withheld', 12*(1-2**-0.25))
print('burn +1/2 st extra', 12*(2**0.5-1))
print('third stop f series', [round(8*2**(k/6),2) for k in range(-3,4)])
print('4pt logH', 4*0.025)
print('2^(1/6)', 2**(1/6), 12*2**(1/6))
```

### Why
- These numbers appear in the exposure-list wireframe, the aperture control and the test-strip step options.

### What worked
- Output, verbatim:

```text
dodge -1/4 st of 12s withheld 1.909243016955426
burn +1/2 st extra 4.970562748477142
third stop f series [5.66, 6.35, 7.13, 8.0, 8.98, 10.08, 11.31]
4pt logH 0.1
2^(1/6) 1.122462048309373 13.469544579712476
```

### What didn't work
- No failures.

### What I learned
- The nominal third-stop labels (5.6, 6.3, 7.1, 8, 9, 10, 11) differ from the true values (5.66 … 11.31). The guide shows the nominal labels and computes with the true values.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Guide §5.7 (the units table), §5.9 (the exposure list) and §8 (golden numbers).

### Technical details
- Dodge −1/4 stop of a 12.0 s exposure: 1.91 s withheld. Burn +1/2 stop: 4.97 s added. 12.0 s plus 1/6 stop: 13.47 s.

## Step 11: Drafting the CHB-009 guide

I wrote the complete first draft in one pass (16:14:37), following the two-pass procedure. The draft had 10,918 words.

The draft covered all six stages, ASCII wireframes of the main layout and the test-strip tool, a data flow from a slider drag to the canvas with concrete scales and hashes, and the M1 slice. It had five decision records:
- the UI framework: React 19 and a framework-free core;
- committing a gesture on release, with an unlogged draft overlay;
- library access;
- no layer stack;
- vector masks.

Its traced flow in §6 contained a self-contradictory paragraph about the ring-around's sign convention, fixed in Step 12.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** produce the full guide before reviewing it.
**Inferred user intent:** a complete guide, not an outline.
**Commit (code):** none.

### What I did
- Wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb-009.md` with the `Write` tool.

### Why
- The brief requires a complete draft before the review pass.

### What worked
- Everything the orchestrator brief asked for is covered: the framework decision record, the six stages, the wireframes, the data flow from control to canvas, and the M1 work on the mock engine.

### What didn't work
- Draft defects fixed in Steps 12 and 13:
  - the §6 sign paragraph;
  - the same key, `?`, used for both provenance and the shortcut list;
  - a typo, "LibraryRAW";
  - a physics check that mixed up the default-recipe density 0.755 with the "Try it" starting density 0.746.

### What I learned
- N/A beyond Steps 3–10.

### What was tricky to build
- Keeping drags out of the edit log. A drag of 120 pointer events must produce one mutation and one undo step, and the agent must never see half a drag. The design keeps an unlogged draft overlay that every recipe read in the UI includes, the probe and the tools among them.
- The framework decision. Most of the UI is ordinary, but the canvas, the probe and the dragged control update at frame rate. The decision keeps all state in a framework-free core, and React components only subscribe to it.

### What warrants a second pair of eyes
- Whether the 800 ms window for grouping keyboard bursts into one transaction feels right to a photographer.

### What should be done in the future
- Run the stage 1 spike that measures time from pointer move to presented draft on the mock engine (budget: ≤ 50 ms at the 95th percentile).

### Code review instructions
- Read guide §5.1, §5.4 and §5.6 together.

### Technical details
- The delivered guide has sections 1–11, as returned in the GUIDE block.

## Step 12: Checking the ring-around sign convention and rewriting §6

The draft's traced flow (§6) clicks the ring-around tile "+G (−M)". Its step 3 contradicted itself: it began "(the print is too magenta, so add green light)", corrected itself mid-paragraph with "Wait: …", and ended by claiming that Chromogen's label means "more green light". I grepped Chromogen's ring table and grid to settle the convention, then replaced the whole of §6.

The convention: a tile's label names the colour the print moves towards, and its vector is a change in light. "+G (−M)" therefore reduces green light relative to red and blue.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** the traced flow must be correct and must state the convention plainly.
**Inferred user intent:** an intern implements the ring-around with the right signs.
**Commit (code):** none.

### What I did
- `grep -n 'const grid = \[T' $C; grep -n 'const moves = ' $C; grep -n 'function Pad' $C; sed -n 4538,4545p $C` (16:14:58).
- At 16:15:18, ran `python3 -I - chb-009.md`, which replaced the text between `## 6. One flow traced end to end` and `## 7. Implementation plan` with a rewritten section. It printed nothing, which meant success.

### Why
- A sign error in the ring-around would make the tool push the print the wrong way.

### What worked
- `4332: const moves = [["+R (−C)", [0, 1, 1]], ["+M (−G)", [0, 1, 0]], ["+B (−Y)", [1, 1, 0]], ["+C (−R)", [1, 0, 0]], ["+G (−M)", [1, 0, 1]], ["+Y (−B)", [0, 0, 1]]];`
- `5010: const grid = [T["+Y (−B)"], T["+R (−C)"], T["+M (−G)"], T["+G (−M)"], T.current, T["+B (−Y)"], null, T["+C (−R)"], null];`
- The new step 3 removes the mean (2/3) from the vector (1, 0, 1) and multiplies by 1.5 × the step (4 points = 0.10 log H). The result is (+0.05, −0.10, +0.05) log H = (+2, −4, +2) points; green light drops, so the print gets more green.
- The new §6 also says that undo returns the state hash to `3f9a…`, and adds a failure case: a tile click during a test-strip render.

### What didn't work
- The first draft's §6, as described above. No command failed.

### What I learned
- More light of one colour makes more of the complementary dye. A tile that moves the print towards green must therefore reduce green light.

### What was tricky to build
- Explaining why the factor is 1.5. After the mean is removed, the largest component is −2/3; multiplying by 1.5 makes it −1, i.e. exactly one step. I took the 1.5 factor from Chromogen's `renderRing` (4330–4347, read at 15:45:30) but did not re-grep it in this step.

### What warrants a second pair of eyes
- Confirm the 1.5 scale factor in `renderRing` (`sed -n 4330,4347p $C`).
- The sign test that guide §6 asks for on the reference engine (M2): the "+G (−M)" tile must have a lower a* than the current tile at a neutral probe, and "+M (−G)" a higher one.

### What should be done in the future
- Write that sign test as soon as CHB-003's reference engine exists. Guide §10 lists the convention as near-blocking until then.

### Code review instructions
- Guide §5.9 (ring-around) and §6, against `05-inline.js` lines 4330–4347 and 5010.

### Technical details
- Tile step options are 2, 4 or 8 points; 4 points = 0.10 log H.

## Step 13: Reviewing and revising CHB-009

I reread the whole draft as an intern would, in four reads (16:15:22 to 16:15:41), and applied the fixes in one exact-string script (16:16:02). Then I checked the code fences.

The fixes:
- a typo;
- a clearer explanation of banding;
- concrete numbers for the render scale in the data-flow trace;
- at most one pointer move handled per animation frame;
- a clash between two shortcuts on the `?` key;
- a physics check that mixed up two different textbook settings.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** the brief's second pass: reread, note the gaps, revise.
**Inferred user intent:** a guide without errors an intern would trip over.
**Commit (code):** none.

### What I did
- Reread `chb-009.md` with `Read` at offsets 1, 120, 320 and 550.
- Script (16:16:02) replaced:
  - "LibraryRAW" with "LibRaw";
  - the 16-bit float sentence, now saying that 8-bit storage of wide-gamut values can show banding in smooth gradients such as skies;
  - the opening of the data flow, now with the scale arithmetic: a 6000-pixel-wide scan in a canvas 2800 device pixels wide gives screen scale ≈ 0.47, and a draft at scale 0.12 is about 720 × 480;
  - `pointermove (many)`, now "(many; the core handles at most one per animation frame)";
  - the provenance key: `?` changed to `i`, because `?` already shows all shortcuts, and an `i` row added to the shortcut table;
  - the physics-check paragraph, which had said "after a ring-around or lights change of +10 pt red, the probe reads a* ≈ −20.7 and density 0.956". It now says: "with the settings of the textbook's "Try it" (§2.7), a printer-lights change of +10 pt red … takes the probe from density 0.746 to 0.956 and a* to −20.7".
- Fence check: `wc -w chb-009.md; awk '/^```/{c++; if(c%2==1 && $0=="```") print NR": untagged open"}' chb-009.md`.

### Why
- These were the errors found on reread.

### What worked
- The script printed no `MISSING` lines. The fence check printed `11101 chb-009.md` and no untagged opening fence.

### What didn't work
- No command failed. The defects listed above were in the draft.

### What I learned
- The textbook's 0.755 (default chain) and 0.746 (the "Try it" settings: flare 0.48 %, Saunderson off) are different setups. A test must say which one it uses.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The shortcut table in guide §5.10, for clashes with browser and OS shortcuts.

### What should be done in the future
- N/A.

### Code review instructions
- Guide §5.4 (data flow), §5.8 (provenance), §5.10 (shortcuts) and §8 (physics checks).

### Technical details
- 11,101 words by `wc -w` after this step; 11,102 after Step 14.

## Step 14: Making shared boundaries consistent and checking the RELATED paths

Two boundaries are described in both guides: chat threads stored in the studio's IndexedDB, and the named probes that playbooks use. Both guides had to describe them the same way, so I aligned the wording in both files. Then I checked that every path planned for the RELATED blocks exists.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** the two guides must not contradict each other, and the RELATED blocks may list only existing files.
**Inferred user intent:** two interns working in parallel agree on who owns what.
**Commit (code):** none.

### What I did
- At 16:16:15, `python3 -I -` with exact-string replacements:
  - `chb-009.md`, the IndexedDB schema comment: `// owned by CHB-008's chat` → `// record format defined by CHB-008`;
  - `chb-008.md`, thread storage and the test-strip playbook row: now refer to CHB-009's database and named probes.
- At 16:16:24, `for f in … ; do test -e "$f" && echo OK || echo "MISSING $f"; done` over the 13 distinct files in both RELATED blocks.

### Why
- If the wording differs, each intern may assume the other owns the record.

### What worked
- `grep` showed `chb-009.md:366:  threads:   { key: string; value: ChatThreadRecord };  // record format defined by CHB-008`.
- All 13 paths printed `OK`.

### What didn't work
- No failures.

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- `grep -n threads chb-008.md chb-009.md` in the scratch folder.

### Technical details
- The CHB-009 RELATED block lists 8 existing files:
  - the architecture doc;
  - Chromogen `05-inline.js`;
  - Filmbench `01-inline.js` and `vfs/controls.js`;
  - `analysis-chromogen-studio.md` and `analysis-filmbench-ide.md`;
  - the textbook;
  - `sources/chromogen-studio-1.2/samples/gold200.png`.

## Step 15: Hand-back, wrap-up and preparing this diary

At 16:24:27 I returned both guides through `SubagentHandback`: a short summary, then the GUIDE, TASKS and RELATED blocks for CHB-008 and CHB-009. The orchestrator's wrap-up message ("Wrap up now…") arrived at the same moment.

The orchestrator then asked for these diaries. I rebuilt the timeline from the session transcript with two small scripts. While checking a textbook citation for the diary, I found that this guide labels the 0.755 grey-card number with the wrong section. I recorded the fix below and left the delivered guide unedited, as the wrap-up asked for no further revision.

### Prompt Context
**User prompt (verbatim), for this diary:** "ask them to write all detailed diaries for their work and add those to the ticket too, see diary skill for the format."
**Orchestrator messages (not the user's words):** "Wrap up now. The user wants to move on, and good enough is fine. …", followed by the request for one diary per ticket, in the investigation format, starting at Step 2.
**Assistant interpretation:** deliver the guides as they are, then a diary per ticket built from the transcript.
**Inferred user intent:** the ticket records how each guide was produced and what still needs checking.
**Commit (code):** none.

### What I did
- At 16:24:27, `SubagentHandback`. Result: `Report delivered to your caller.`
- For this diary:
  - read the diary skill and its investigation-entry and evidence-levels references;
  - wrote `scratchpad/guides/trace.py` and `trace2.py`, which list the tool calls and results in the transcript `/home/manuel/.claude/projects/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/subagents/agent-a6e6dee9bda6ae5a3.jsonl`, and ran them with `python3 -I`;
  - saved the delivered report verbatim to `scratchpad/guides/chb-008-009-handback.md` and compared its guide blocks with the scratch files;
  - recounted words and fences;
  - grepped the textbook for the golden numbers.

### Why
- The diary skill asks for exact commands and diagnostics. Context had been compacted, so the transcript was the reliable source.

### What worked
- The GUIDE block in the delivered report is identical to `chb-009.md` (74,194 characters). TASKS has 19 lines and RELATED 8.
- Final `chb-009.md`:
  - 11,102 words, 762 lines;
  - 30 fence lines, with no untagged opening fence;
  - sha256 prefix `accf7890342cbde3`.
- The copy of the delivered report is 186,377 bytes, sha256 prefix `5b3d76a936b1edb1`.

### What didn't work
- My first diary command, `cat /home/manuel/.claude/skills/diary/SKILL.md; echo ======; cat …`, exited 1 with `(eval):1: ===== not found`. zsh's `=word` expansion read `======` as `=` followed by a command name. I recovered by printing the reference files in a loop with `echo "----- $f"`.
- Citation error the textbook check found: guide line 694 says the grey card "reads visual density 0.755 with the default recipe (§2.6)". That number is on textbook line 377, in the introduction to chapter 2, "The forward model: film, paper and eye as composed functions", not in §2.6. The guide's other textbook citations are correct: the CC matrices and neutral pack in §2.6 (lines 540–546) and the "Try it" numbers in §2.7 (line 586).

### What I learned
- In zsh, a run of `=` signs must be quoted.

### What was tricky to build
- Reconstructing the order of events and their outcomes after context compaction. The transcript has every tool input and result, so every fact in this diary comes from it rather than from memory.

### What warrants a second pair of eyes
- The citation fix above. Line numbers refer to `chb-009.md` as delivered.

### What should be done in the future
- When filing the guide, change "(§2.6)" on line 694 to cite the introduction to chapter 2 ("The forward model").

### Code review instructions
- `grep -n '0.755' chb-009.md` in the scratch folder, and `sed -n 377p` of the textbook.

### Technical details
- Scratch folder: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/`.
- This work wrote nothing under `ttmp/` or goja-cv. All its writes went to the scratch folder.

## Step 16: Starting the implementation: branch, dependencies, core modules, restyle cherry-pick

Implementation of CHB-009 begins on `task/chb-009-studio` (worktree `agent-aeb28d11cd9e9eb7e`), from `bd5912a`. The orchestrator's brief (`scratchpad/impl-brief-common.md`) and this ticket's task: stages 1–4 of the user's numbering (shell and library; viewer; generated controls, history and approvals with `E_STALE`; darkroom tool UIs on the mock ops), replacing the CHB-002 M1 page while keeping `e2e/m1-walking-skeleton.spec.ts` passing.

### What I did
- `git checkout -b task/chb-009-studio`; `pnpm install --frozen-lockfile` (fresh worktree had no node_modules).
- Read the intern guide, `CONTRACT-DECISIONS.md`, `editlog.ts`, `mutations.ts`, `engine.ts`, `recipe.ts`, `registry.ts`, the catalog, `engine-mock.ts`/`ops.ts` and the M1 page and spec.
- Dependencies: `pnpm --filter @chromobench/studio add react@19.3.1 react-dom@19.3.1` and `-D @types/react@19.3.0 @types/react-dom@19.3.0`.
- Config: `tsconfig.json` includes `apps/*/src/**/*.tsx` and `apps/*/test/**/*.ts`; `tsconfig.base.json` gets `"jsx": "react-jsx"`; `vitest.config.ts` includes `apps/*/test/**/*.test.ts`; `apps/studio/vite.config.ts` sets `esbuild.jsx: 'automatic'`.
- Wrote framework-free core: `core/units.ts`, `controls.ts`, `arrangement.ts`, `store.ts`, `gesture.ts`, `scheduler.ts`, `probe.ts`, `frame-session.ts`, `history.ts`.
- Coordinator message mid-work: bring in CHB-002's restyle commit `14f5419` (Chromogen Studio look, `apps/studio/src/studio.css`). My work was uncommitted and deleted the M1 files, so: temporary WIP commit → branch `wip-chb009-tmp` → `git reset --hard HEAD~1` → `git cherry-pick 14f5419` (clean, now `f6290c0`) → `git cherry-pick -n wip-chb009-tmp` → modify/delete conflicts on `src/main.ts` and `src/controls.ts`, resolved with `git rm` after copying the restyled versions to `scratchpad/m1-restyled/` for reference → `git reset`, branch deleted.

### What didn't work
- `@vitejs/plugin-react@6.3.0` warns `unmet peer vite@^8.0.0: found 7.3.8`. Removed it; esbuild's automatic JSX runtime suffices (no Fast Refresh).
- A single `mkdir -p` with brace expansion over the worktree path was refused by the harness ("too complex to verify that it stays inside the worktree"); split into plain commands.

### Decisions
- **No vite-plugin-pwa, no React Aria, no idb** (brief: minimal dependency changes). A hand-written service worker (network-first with cache fallback, so it is harmless under the Vite dev server), native `<input type=range>` with `aria-valuetext`, and a small IndexedDB wrapper.
- **Keyboard bursts** are coalesced before logging (preview, then one `set` after 800 ms idle, blur or another control) instead of one `set` per step sharing a tx: `EditLog.apply` makes every call its own undo unit, so a shared tx would not give one undo step.
- Slider widgets listen with native `input`/`change` listeners, not React `onChange`: the M1 spec sets `el.value` and dispatches synthetic events, which React's value tracker would swallow; it also keeps drags out of React renders.

## Step 17: The studio end to end — UI, presenters, tests, and the headless WebGPU surprise

The studio now runs on the mock engine with every stage the brief asked for: library and film strip with persistence by hash and the OPFS import fallback, the viewer with WebGPU/Display-P3 presentation and a Canvas2D fallback, generated controls with gestures, history and approvals with `E_STALE`, and the five darkroom tool UIs. Commit `7185e57` (studio) plus a follow-up fixing the ring-around signs. Most of the time went into one environment problem (WebGPU canvas presentation in headless Chromium) and two test-infrastructure issues in the shared Playwright config.

### What I did
- UI in `apps/studio/src/ui/` (App, Controls, History, Library, Viewer, tools/Tools, tools/Masks), presenters in `src/present/`, storage in `src/storage/`, boot in `src/main.tsx` (top-level await: IndexedDB, OPFS, `Studio.init()`, service worker, `window.chromobench` hook with `idle`, `pixel`, `canvasPixel`, `chainRuns`, `propose`, `studio`).
- Layout and look from CHB-002's `studio.css`; additions in `studio-app.css` (tabs, film strip, bands, ring grid, contact sheet, exposure table, modal).
- `e2e/m1-walking-skeleton.spec.ts`: one change — `canvasPixel` now calls `window.chromobench.canvasPixel(x, y)` (the canvas is a WebGPU canvas with a viewport transform, so `getContext('2d').getImageData` no longer applies).
- New `e2e/studio.spec.ts` (7 tests), `apps/studio/test/core.test.ts` and `units-tools.test.ts` (34 tests), `fixtures/golden/CHB-009.json`.
- `apps/studio/CONTRACT-REQUESTS.md`: `mask.paint.strokes` as canonical JSON; `mask.ellipse.angle_deg`; ring-around step in points (CHB-010).

### What didn't work
- `pnpm test:browser e2e/m1-walking-skeleton.spec.ts` → `Error: No tests found.` CHB-002's `testIgnore: ['**/node_modules/**', '.claude/**']` matches the absolute path of every file in an agent worktree (`…/.claude/worktrees/…`). Fixed by anchoring: `` `${import.meta.dirname}/.claude/**` ``.
- Next run: `TypeError: window.chromobench.canvasPixel is not a function`. Port 4173 was already served by another worktree's Vite (`ss -ltnp` showed pid 1347785) and `reuseExistingServer` silently tested *that* app. Added `STUDIO_PORT` to `playwright.config.ts`; I ran everything with `STUDIO_PORT=4391`.
- `AbortError: Failed to execute 'mapAsync' on 'GPUBuffer': A valid external Instance reference no longer exists.` Bisecting with throw-away scripts (`e2e/_dbg*.mjs`, deleted): the device was lost (`reason: destroyed`) with no `dispose()` call, independent of format (`rgba16float`/`rgba8unorm`), colour space (`display-p3`/`srgb`), tone mapping, upload format and shader body. A minimal page with a fresh device and a trivial pipeline reproduced it: `plain → "A valid external Instance reference no longer exists."`, `tonemap/p3 → "Device was destroyed."`, `offscreen-only → ok`. In headless Chromium on SwiftShader, **presenting to a WebGPU canvas loses the device**; offscreen rendering and readback work.
- The tools e2e test hung in `locator.click` on a ring tile: `<canvas … aria-label="+2 step"> … intercepts pointer events`. CHB-002's rule `.canvas-wrap canvas { position: absolute; inset: 16px; … }` stretched every tile canvas over the whole viewer. Scoped my tile canvases with `.canvas-wrap canvas.tile-img { position: static; … }`.
- An earlier `page.on('pageerror', (e) => { throw e; })` in the spec turned that hang into a timeout without a location; replaced by collecting errors and asserting in `afterEach`.
- Screenshot review showed the ring-around **+Y and +B tiles swapped**: I had `+Y: (1,1,0)`, `+B: (0,0,1)`. A yellower print needs more yellow dye, i.e. more blue light: `+Y: (0,0,1)`, `+B: (1,1,0)`. Added sign assertions (+Y raises blue light, +B lowers it, +R lowers red, +C raises red) that fail on the old vectors.

### Decisions
- **Presenter fallback.** `WebGpuPresenter.onLost` → the viewer remounts a fresh `<canvas>` (a canvas keeps its first context) with `Canvas2dPresenter` and says so in the status line. `WebGpuPresenter.create(canvas, {offscreen: true})` draws to an offscreen texture; an e2e test imports the module in the page and checks exact pixels through it (`display-p3`, `[94, 111, 140]` for the M1 display value).
- **Ring-around tiles are ordinary display nodes** with a lights offset, not `darkroom.ringAround` (which takes `step_cc`). The centre tile is the main node by hash-consing — tested (`data-node` equals `session.displayNode().id`).
- **Time slider grid** is anchored at the default time (10 s), so 1/6-stop steps land on 10·2^(k/6).
- **Masks** are vector MaskSpecs built from `mask.ellipse`/`mask.gradient`/`mask.paint` (strokes as JSON) combined with `mask.or`, then `mask.feather`, `mask.not`; `parseMask()` reads them back.
- **Edit logs** are stored as one `EditLogData` per source hash (no per-entry rows or checkpoints yet).

### Results
- `pnpm typecheck` ok; `pnpm lint` ok (74 file checks); `pnpm test` 502 passed (34 new); `STUDIO_PORT=4391 pnpm test:browser` 13 passed (7 new, M1 ×2, wgsl-check ×4); `pnpm --filter @chromobench/studio build` ok (413 kB JS).
- Screenshots: `scratchpad/studio-light.png`, `studio-dark.png`, `studio-ring.png`.

### Open
- `ex7d`: the drag-latency spike (pointer move → presented draft) is not measured.
- `ey84`: no `refine` pass (draft and screen only).
- `kygr`: no printer-lights pad (three sliders only); typed value entry is missing.
- Stage 6 (`grer`, `rrhv`, `o944`): shortcut map and `aria-valuetext` exist; axe checks, live regions beyond the pending list, and the chat panel do not.
- Precache list for builds (`/precache.json`) is not generated; the service worker caches at runtime.

### Code review instructions
- Start at `apps/studio/src/core/studio.ts` (`requestRender`, `onPresent`, `approve`, `applyToFrames`), then `gesture.ts`, `scheduler.ts`, `ui/Controls.tsx` (`RangeControl` native listeners).
- Run: `STUDIO_PORT=4391 pnpm test:browser e2e/studio.spec.ts` and `pnpm vitest run apps/studio`.
