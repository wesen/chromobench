---
Title: Diary
Ticket: CHB-008
Status: active
Topics:
    - agent
    - dsl
    - js-api
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:24.193656571-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-008 and CHB-009 (agent integration and UI). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-agent-integration.md` (13507 words), added 19 staged tasks, and related the primary source files.

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

That gave me a working map. The architecture doc defines the eval contract (§5.5), the recipe, mutations, edit log and ask mode (§5.4), and the planned paths `packages/agent` and `bridge/`. The goja-cv and Filmbench analysis reports point to the existing code this ticket should learn from. All times in this diary are UTC, taken from the session transcript.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
**Orchestrator brief (not the user's words):** a task message that begins "Write two chromobench intern guides: **CHB-008 "Agent integration"** and **CHB-009 "Studio app UI"**". It gives CHB-008 four stages:
- the eval channel;
- the Go bridge (`go:embed`, `ServeMux` only, a WebSocket relay, and an MCP server modelled on goja-cv);
- an in-app chat that goes through a proxy holding the API key;
- playbooks and evaluation.

It also points to the common brief `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md`, which sets the content, the Markdown rules for pandoc, the read-only constraints and the return format.
**Assistant interpretation:** write a self-contained intern guide for CHB-008, alongside CHB-009, and return it as text in GUIDE, TASKS and RELATED blocks. Do not change existing material and do not write into the ticket.
**Inferred user intent:** a new engineer can start CHB-008 from the guide alone. The orchestrator files it in the ticket and uploads it to reMarkable.
**Commit (code):** none. This work made no commits; the guides were returned as text.

### What I did
- Read the common brief (15:43:51).
- Ran `ls -R $C1 | head -100; wc -l $C1/design-doc/*.md $C1/various/*.md; cat /home/manuel/.claude/skills/ticket-research-docmgr-remarkable/references/writing-style.md` (15:43:54).
- Read `$C1/design-doc/01-chromobench-architecture-and-work-plan.md` (591 lines).
- Read `$C1/various/analysis-filmbench-ide.md` and listed the extracted Filmbench and Chromogen scripts with `wc -l` (15:43:58).
- Listed the headings of `$C1/various/analysis-goja-cv.md` and read lines 1–160 and 360–869 (15:44:01 to 15:44:04).

### Why
- The brief requires the architecture doc's names to be used exactly. Anything new goes under "Proposed contract additions (for CHB-002)".
- The brief calls the analysis reports "maps to verify", so I reopened the source line ranges cited in the guide's tables at source (Steps 3, 4 and 12).

### What worked
- The architecture doc gave the contract this ticket consumes: `EvalRequest`, `EvalResult`, `Diagnostic`, `ContextBlock`, `Mutation`, `LoggedMutation`, the closed mutation set, ask mode, and the open hosting decision (§8.4).
- goja-cv analysis §3 gave the agent-ergonomics evidence used in guide §2.1 and §5.7. That includes GCV-004: 18 runs, 751 evals, 2950 lines deleted, median call count down from 51 to 39. §4 covered MCP packaging and tests.
- Filmbench analysis §6 says agent safety there is "cooperative only". This became guide §4.3.

### What didn't work
- No failures in this step.

### What I learned
- `EvalResult.looks` refers to a `Look` shape the contract does not define, and log entries carry no sequence number. Both became proposed contract additions (guide §9).

### What was tricky to build
- N/A (reading).

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Compare guide §3 ("Contracts consumed") and §9 with architecture doc §5.4–5.5.

### Technical details
- `C1` = `/home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite`.
- The writing guidance prescribes two passes: draft, reread as the intern would, then revise.

## Step 3: goja-cv's MCP layer and go-go-goja's replmcp

The orchestrator brief named goja-cv as the model for the bridge's MCP server. I read its agent-facing files at commit `5a93095`. goja-cv builds on go-go-goja's `replmcp`, so I read that too, to decide whether the bridge could reuse it.

The guide copies goja-cv's agent-facing surface: the eval input descriptions, compact instructions, the generated reference, resources and a prompt, the wording for unknown sessions, the look budgets, and the context block. It does not reuse `replmcp`, because `replmcp` expects a goja runtime and the bridge has none.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** study the MCP design the orchestrator brief named.
**Inferred user intent:** the bridge should reuse patterns already proven in the organisation's own code.
**Commit (code):** none.

### What I did
- `cd ~/code/wesen/go-go-golems/goja-cv && git log --oneline -1 && wc -l pkg/cvsession/*.go cmd/goja-cv/*.go && cat pkg/cvsession/mcp.go` (15:44:07).
- `cat pkg/cvsession/reference.go && cat cmd/goja-cv/mcp.go && grep -n 'go-sdk\|go-go-goja\|^go ' go.mod` (15:44:09).
- Read `pkg/cvsession/processor.go` lines 1–120 and indexed its functions. Then read `session.go` 290–420 and `processor.go` 300–340 and 460–545, which cover code wrapping, the watchdog and the context block (15:44:12 to 15:44:15).
- Found `replmcp` in the module cache at `~/go/pkg/mod/github.com/go-go-golems/go-go-goja@v0.10.8-0.20261109062017-5e1ba117462e/pkg/replmcp`. Indexed it and read `replmcp.go` 1–75 and 160–210 and `tools.go` 135–260 (15:44:18 to 15:44:25).

### Why
- The orchestrator brief asked me to model the server on `pkg/cvsession/{mcp.go,reference.go,processor.go}` and to compare the current MCP options for Go.

### What worked
- HEAD is `5a93095 Merge pull request #8 from go-go-golems/task/root-flag-once`.
- File sizes: `mcp.go` 218 lines, `reference.go` 132, `processor.go` 581, `mcp_test.go` 302.
- Confirmed in the source:
  - the comment on `Instructions` says to keep it under 4000 characters, with detail in guides and resources;
  - `EvalToolDescription` is one paragraph;
  - `Reference(reg)` generates the op list;
  - the code wrapper adds a one-line prefix, so agent line N is evaluated as line N+1;
  - evals within one session run one at a time;
  - a watchdog interrupts runaway code.
- `replmcp.go` has 269 lines and `tools.go` 386. Its `Evaluator` returns go-go-goja's `replsession` response type.

### What didn't work
- No failures in this step.

### What I learned
- goja-cv runs agent JavaScript in Go (goja). Chromobench runs it in the browser (QuickJS, CHB-007), so the bridge only relays text and images. Satisfying `replmcp.Evaluator` would mean faking goja session types. This led to the decision record "use the official go-sdk directly" (guide §5.5).

### What was tricky to build
- Carrying goja-cv's watchdog and "broken session" handling into a browser. A QuickJS interrupt may never land, so the guide specifies a 2 s grace period, then termination of the worker, then `E_SESSION_RESET` reported on the session's next eval (guide §5.2).

### What warrants a second pair of eyes
- The decision not to reuse `replmcp`. The organisation may prefer one MCP wrapper across all its projects, even at the cost of adapter types.

### What should be done in the future
- N/A.

### Code review instructions
- Open goja-cv at the ranges in guide §4.1, for example `sed -n 40,52p pkg/cvsession/mcp.go` and `sed -n 107,132p pkg/cvsession/reference.go`. These ranges were re-verified in Step 12.

### Technical details
- Defaults carried over from goja-cv (confirmed in Step 9): 9000-character results, 4 looks, 8 MiB of look bytes, looks 1568 px on the long side. goja-cv's eval timeout is 60 s; chromobench uses 30 s.

## Step 4: Filmbench's agent loop and why its safety is cooperative

Filmbench IDE is the closest existing in-app chat. I read its step loop, system prompt, result formatting, approval flow and the mode check in `wb.apply`, all in the extracted script. I took exact line numbers and checked the ranges the orchestrator brief gave.

Three of the brief's ranges were a few lines off. The guide uses the verified ranges: `getCaps` at 5084–5090, the loop starting at 4834 (history trimming at 4832), and the look gate at 4532–4545. The reading confirmed that Filmbench's mode check relies on a global that agent code can overwrite. That finding is guide §4.3 and the basis of the host-enforced design in §5.3.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** compare against Filmbench's loop, as the orchestrator brief asked, and explain why the host must enforce safety.
**Inferred user intent:** learn from the prototype without inheriting its weaknesses.
**Commit (code):** none.

### What I did
- With `F=$C1/various/extracted/filmbench-ide/01-inline.js`:
  - `sed -n 5080,5095p $F` and `sed -n 4825,4870p $F` (15:44:31);
  - a `grep -n` for the loop's constructs (15:44:35);
  - `sed -n 4640,4824p $F`: system prompt, context, `fmtResult`, `runCode`, `approval` (15:44:38);
  - `sed -n 4530,4548p $F` and `sed -n 2318,2345p $F` for the look gate and `wb.apply` (15:44:42).
- Later passes:
  - `cat vfs/agent/brief.md`, the house notes (15:54:25);
  - located the History view at 4399 (15:54:27 to 15:54:32);
  - a `grep -n` for history trimming, compression and attachment limits, plus `sed -n 4871,4900p $F` (15:54:43);
  - during line verification (16:05:56): `contextText` 4708, `fmtResult` 4721, `SUGG` 4741, `ERR` 4749.

### Why
- The orchestrator brief listed Filmbench ranges to compare against, and the common brief requires checking at source before citing.

### What worked
- The `grep` returned:
  - `4448:const MAX_STEPS = 10, EVAL_MS = 25000, TIER = { fast: 'quick', default: 'default', deep: 'complex' };`
  - `4449:const WRITE_RE = /\blab\s*\.\s*(write|remove|export|useAsScene)\b/;`
  - `systemText` 4648, `contextText` 4708, `fmtResult` 4721, `runCode` 4731, `approval` 4805
  - `4834:    for (let n = 0; n < MAX_STEPS + 1; n++) {`
  - line 4844 calls `await sample(turns, opts)`
- Attachment limits are `ATT_EDGE = 1280, ATT_KEEP = 12` (4467).

### What didn't work
- No command failed.
- The brief's ranges `5085–5090`, `4841–4865` and `4537–4545` do not match the source. I used 5084–5090, 4834–4865 (with 4832 for the history trim) and 4532–4545.

### What I learned
- Filmbench compresses and deletes conversation history (4832–4839 and 4893–4895). Step 6 found this incompatible with Claude Opus 5.5's preserved-thinking prefix check, so the guide specifies an append-only transcript.
- `WRITE_RE` is a regex over the source text. `lab['wr' + 'ite']` gets past it.

### What was tricky to build
- Separating what Filmbench actually enforces from what it only expects of the agent. The `by` tag is resolved as `by || V2.by || 'script'`, and agent code can assign the global `V2.by`.

### What warrants a second pair of eyes
- Guide §4.3 also says agent code could reach `wb._exec` and `rig.insert`, `rig.drop` and `rig.engine()`. That claim comes from the Filmbench analysis report (§2, "Versus the API v2 design doc"); I did not trace each internal in the source.

### What should be done in the future
- N/A.

### Code review instructions
- Compare `sed -n 2323,2328p $F`, `sed -n 4731,4737p $F` and `sed -n 4832,4839p $F` with guide §4.2–4.3.

### Technical details
- `vfs/agent/brief.md` is a house-notes file the user edits and Filmbench prepends to the agent's instructions. The guide keeps the idea as item 6 of its system-prompt outline (§5.7).

## Step 5: Textbook printing units and golden numbers

Both guides need darkroom units with real numbers. CHB-008 uses them for the agent's vocabulary and for scoring playbook runs; CHB-009 uses them for its controls. I indexed the textbook, grepped it for the darkroom terms and golden numbers, and read the printing sections.

Printer points, the filter coupling per CC, the neutral filter pack and the law that printer lights factor out all came from §2.6–2.8. The grep also turned up the grey-card density 0.755 on line 377 and the "Try it" numbers on line 586. Step 15 found that the guide gives the wrong section for 0.755 and for α = 0.75.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** use real textbook numbers as golden values, as the common brief requires.
**Inferred user intent:** examples and tests tied to the physics reference.
**Commit (code):** none.

### What I did
- `T="$C1/sources/The Mathematics of the Colour Negative.md"; wc -l "$T"; grep -n '^#' "$T" | head -80; grep -n -i 'printer point\|test strip\|ring-around\|ring around\|0\.755\|f-stop\|f/' "$T" | head -40` (15:45:53).
- `sed -n 530,555p "$T"` (§2.6) and `sed -n 588,632p "$T"` (§2.8 to the start of §2.9) (15:46:00).

### Why
- The brief asks for textbook laws and golden numbers in each guide's testing section.

### What worked
- The textbook has 1399 lines. §2.6 starts at line 530 and defines the printer lights ℓₖ as offsets in log exposure.
- The ∂x/∂v matrix per CC has diagonal −0.0092, −0.0087 and −0.0100; the mid-grey-normalised matrix follows (lines 540–546).
- The neutral pack for Portra 400 on Portra Endura is C 0, M 51.57, Y 52.53 (line 542).
- §2.8 (line 588) gives the composition laws: printer lights factor out of the spectral sum.
- The grep matched line 377 (grey card 0.755) and line 586 ("Try it": +10 points of red light gives a* = −20.7 and density 0.746 → 0.956).

### What didn't work
- No failures. The section citations are dealt with in Step 15.

### What I learned
- One printer point is 0.025 log H. If a filter band covered exactly one paper layer, v CC would shift that layer by −v/100 log H, i.e. 0.4 points per CC.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- See Step 15.

### What should be done in the future
- See Step 15.

### Code review instructions
- `sed -n 536,546p "$T"` and `sed -n 586p "$T"`.

### Technical details
- The "Try it" result assumes flare at 0.48 % and Saunderson correction off (line 586).

## Step 6: Claude API reference from the claude-api skill

The in-app chat calls the Claude API, so I loaded the `claude-api` skill. I read its TypeScript streaming and tool-use references, its section on refusal fallbacks, and its migration notes for Claude Opus 5.5. One `sed` command failed because the heading it looked for does not exist; a `grep` then found the section.

This reading supplied the facts in guide §2.4 and the request sketch in §5.6:
- model IDs and effort;
- forced tool choice being rejected;
- stop reasons and streaming;
- images inside tool results;
- refusal fallbacks;
- the rule that history must be append-only.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** use current Claude model naming and API behaviour for the chat. The orchestrator brief says "the latest models are the Claude 5 family".
**Inferred user intent:** a chat design that works against today's API.
**Commit (code):** none.

### What I did
- Ran `Skill claude-api` (15:46:15) and listed the skill's `typescript/claude-api` and `shared` references (15:46:21).
- Read `typescript/claude-api/README.md` 1–140 and `streaming.md`, and grepped for browser use, `dangerouslyAllowBrowser`, `baseURL` and abort handling (15:46:24 to 15:46:25).
- Read the "Streaming Manual Loop" section of `typescript/claude-api/tool-use.md` (15:46:31).
- Tried to print the refusal section (15:46:36), then grepped for it (15:46:39).
- Read `shared/model-migration.md` 1635–1700 and 1968–1990, which cover preserved thinking (15:46:45 to 15:46:48).

### Why
- The chat's request shape, its step loop and its history storage all depend on current API behaviour.

### What worked
- The README's stop-reason table and its refusal section (README lines 331–346).
- The migration notes: on Claude Opus 5.5, a thinking block is bound to the model and to the conversation prefix that produced it, so editing an earlier turn invalidates every later thinking block. The API field names are `prefix_mismatch_behavior` and `prefix_binding_mismatch`.

### What didn't work
- Command (15:46:36): `B=…/claude-api; sed -n "$(grep -n -i '^## Refusal' $B/typescript/claude-api/README.md | head -1 | cut -d: -f1),+70p" $B/typescript/claude-api/README.md; …`
- Error: ``sed: -e expression #1, char 1: unknown command: `,'``
- Cause: the README has no `## Refusal` heading (the section is `### Refusal Fallbacks …`), so the command substitution was empty and `sed` received `,+70p`.
- Recovery: `grep -n -i 'refusal\|fallback' $B/typescript/claude-api/README.md` found lines 331, 335, 338 and 344 (15:46:39).

### What I learned
- Filmbench's history compression cannot work with preserved thinking. These do not count as edits: server-side context editing, server-side compaction, and appended `role: "system"` messages. This is the basis of the append-only guarantee in guide §5.6.
- Claude Opus 5.5 rejects forced `tool_choice`, so the system prompt has to say when to call `eval`.

### What was tricky to build
- Every `tool_use` must be answered by a `tool_result` at the start of the next user message. Keeping the transcript valid after Stop or at the step limit therefore needs a "carry" of pending results; the design is in Step 13.

### What warrants a second pair of eyes
- The refusal-fallback section I read is headed "Refusal Fallbacks (Claude Fable 5.2)". The guide enables `fallbacks: "default"` with the beta `server-side-fallback-2026-07-01` for `claude-opus-5-5`. Confirm that the parameter applies to that model.
- The request sketch in guide §5.6 uses `eager_input_streaming`, `context_management` with `clear_tool_uses_20250919`, and the beta `context-management-2025-06-27`. The sketch itself says to check field names against the pinned SDK version; do that before implementing.

### What should be done in the future
- Pin the SDK version at the start of stage 3 and recheck those field names.

### Code review instructions
- Compare guide §2.4 and §5.6 with the skill's `shared/model-migration.md`, section "Migrating to Claude Opus 5.5" (from line 1894).

### Technical details
- The skill files are under `/tmp/claude-1000/bundled-skills/2.1.322/4b5017955d2503dc2a33e8140b8af46d/claude-api/`.

## Step 7: Web research on MCP, the Go SDK, Claude Code, Claude Desktop and the TypeScript SDK

The orchestrator brief asked me to research and cite the current MCP options for Go, and to cover Claude Code and Claude Desktop over stdio or HTTP. I fetched:
- the MCP versioning page;
- the go-sdk release notes;
- Claude Code's MCP documentation;
- the Claude Desktop local-server quickstart;
- the TypeScript SDK's README and client source.

The queries used only generic technical terms.

The results back guide §2.3, the decision record on the MCP library, the client setup commands, and the proxy's handling of request headers.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** cite current external facts for the bridge and the chat.
**Inferred user intent:** setup steps that work with the clients as they are today.
**Commit (code):** none.

### What I did
- WebSearch "modelcontextprotocol go-sdk release mcp Go SDK latest version" and "mark3labs mcp-go streamable HTTP server release 2026" (15:47:08 to 15:47:09).
- WebFetch `https://code.claude.com/docs/en/mcp` (15:47:11).
- A WebSearch on configuring a local MCP server in Claude Desktop (15:47:12).
- WebFetch `https://github.com/modelcontextprotocol/go-sdk/releases` (15:47:23) and `…/releases/tag/v1.8.0` (15:47:45).
- WebFetch `https://modelcontextprotocol.io/specification/versioning` (15:47:24).
- WebFetch `https://github.com/anthropics/anthropic-sdk-typescript`, `https://platform.claude.com/docs/en/api/sdks/typescript` and `https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/src/client.ts` (15:50:28 to 15:50:41).
- WebFetch `https://modelcontextprotocol.io/quickstart/user` (16:06:03, during review).

### Why
- The setup commands, the protocol revision and the SDK's defaults all change over time, so the guide must cite current sources.

### What worked
- **MCP:** 2026-07-28 is the current revision. Each request declares its version in `_meta`, and over Streamable HTTP also in the `MCP-Protocol-Version` header.
- **go-sdk:**
  - v1.8.0 (14 Sep) is the latest release: hardening only, no new protocol revision.
  - v1.7.0 (28 Jul) added full support for 2026-07-28. Streamable HTTP accepts 2026-07-28 only with `StreamableHTTPOptions.Stateless: true`, and otherwise negotiates down to 2025-11-25.
  - v1.6.0 turned cross-origin protection off by default.
  - v1.8.0 removed the MCPGODEBUG options `enableoriginverification` and `disablelocalhostprotection`.
- **Claude Code:**
  - HTTP server: `claude mcp add --transport http <name> <url>`, with `--header "Authorization: Bearer …"`;
  - stdio server: `claude mcp add [options] <name> -- <command> [args...]`;
  - scopes: local, project, user;
  - timeouts: `MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT`, or a per-server `"timeout"`;
  - `MAX_MCP_OUTPUT_TOKENS` defaults to 25,000.
- **TypeScript SDK:** with `dangerouslyAllowBrowser: true` the client sends the header `anthropic-dangerous-direct-browser-access: true`. Without that option, the constructor throws in a browser. The proxy strips that header (guide §5.6).

### What didn't work
- The v1.8.0 release notes do not describe the default Host and Origin behaviour of `StreamableHTTPHandler`; the fetch summary reported "Not stated". The guide therefore implements the Host and Origin checks in our own middleware.

### What I learned
- The SDK's cross-origin defaults have changed between releases, so the bridge must not rely on them.

### What was tricky to build
- Session identity. MCP 2026-07-28 has no transport sessions, so the guide passes `sessionId` as an explicit tool argument, as goja-cv does.

### What warrants a second pair of eyes
- Guide §5.5 says Claude Desktop's local configuration does not connect to a plain `http://localhost` MCP endpoint. The quickstart documents only stdio servers and the search did not contradict this, but I found no Claude Desktop page that states it. Verify before telling users.
- Whether Claude Code works against a `Stateless: true` handler speaking 2026-07-28 is untested; guide §10 lists this as an open question.

### What should be done in the future
- Test `Stateless: true` with the current Claude Code in stage 2.

### Code review instructions
- Guide §2.3, §5.5 (the decision-record table and the client configuration) and §11 (URLs).

### Technical details
- All URLs are listed in guide §11 under "External".

## Step 8: Looking up the go-web-frontend-embed skill

The bridge serves the built studio with `go:embed`, and the repository has a standard pattern for that: the `go-web-frontend-embed` skill. To find its files I chained a quick `ls` with a `find` across the whole filesystem. The `find` ran past the 120 s limit and was moved to the background, so I stopped it.

The skill's `SKILL.md` gave the `internal/web` layout in guide §5.1: `go generate` builds the app and copies `dist/`, and an `embed` build tag selects the embedded file system.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** follow the house pattern for Go plus an embedded single-page app, with `ServeMux` only (orchestrator brief).
**Inferred user intent:** the bridge should look like the organisation's other Go web binaries.
**Commit (code):** none.

### What I did
- `ls /home/manuel/.claude/skills/go-web-frontend-embed/ 2>/dev/null; find / -path /proc -prune -o -type d -name 'go-web-frontend-embed' -print 2>/dev/null | head -3` (15:47:58).
- `S=/home/manuel/.claude/skills/go-web-frontend-embed; cat $S/SKILL.md | head -150; ls -R $S/references $S/assets` (15:50:00).
- `TaskStop bv875ub1s` (15:50:04).

### Why
- The skill sets the house conventions: the standard `ServeMux` only, `go generate` plus `go:embed`, and no third-party routers.

### What worked
- The `ls` printed `assets references SKILL.md`, which was all I needed.

### What didn't work
- The `find` over `/` printed: `Command did not complete within its 120s timeout and was moved to the background (ID: bv875ub1s).`
- Recovery: I read the skill from its known path and stopped the background task. TaskStop returned `Successfully stopped task: bv875ub1s`.

### What I learned
- The skill's path was already known, so the filesystem-wide search was unnecessary.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Compare the `internal/web` layout in guide §5.1 with the skill's `SKILL.md`.

### Technical details
- The guide's routes table and `serve.go` sketch use only `net/http`. `github.com/coder/websocket` handles the WebSocket upgrade; it is a library, not a router.

## Step 9: Ticket state and the remaining source checks

Before drafting, I checked what the ticket directories for CHB-002, CHB-007, CHB-008 and CHB-009 already held, so that the guide would not contradict names defined elsewhere. I also confirmed goja-cv's defaults and its MCP test helper. One `grep` failed because zsh expanded `--include=*.go` as a glob.

The other tickets' guides were still empty stubs. CHB-007 has not named its DSL calls yet, so the guide marks the DSL calls it uses as placeholders. The defaults and the test style the guide relies on were confirmed.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** avoid conflicts with neighbouring tickets and confirm the numbers taken from goja-cv.
**Inferred user intent:** guides that agree with each other.
**Commit (code):** none.

### What I did
- `ls /home/manuel/code/wesen/chromobench/ttmp/2026/11/11/` and `ls -R` of the CHB-002, CHB-007, CHB-008 and CHB-009 directories (15:54:16).
- `wc -l CHB-0*/design-doc/*.md; head -40 CHB-008*/design-doc/*.md; cat CHB-008*/tasks.md CHB-009*/tasks.md | head -60` (15:54:20).
- In goja-cv (15:55:12):
  - `grep -n 'DefaultEvalTimeout\|60 \* time.Second\|DefaultMaxLookBytes\|1568' pkg/cvsession/session.go pkg/cv/look/look.go`;
  - `grep -n 'E_TIMEOUT\|E_BUSY\|E_CANCEL' -r pkg --include=*.go | head -5`;
  - `ls pkg/cvsession/testdata/`;
  - `grep -n 'func Test' pkg/cvsession/mcp_test.go`.
- `sed -n 70,121p` and `sed -n 173,200p pkg/cvsession/mcp_test.go`, then `grep -n 'func connect' -A 25 pkg/cvsession/mcp_test.go` (15:55:14 to 15:55:18).

### Why
- The guide had to know which names exist and which it must propose.

### What worked
- The other tickets' guide files were 53-line stubs with no content.
- goja-cv: `DefaultEvalTimeout = 60 * time.Second` (`session.go:41`), `DefaultMaxLookBytes = 8 << 20` (`session.go:47`), and a look size of 1568 px on the long side (`look/look.go:48`).
- `testdata/` holds `probe.js`, `representative.result` and `scripts`.
- MCP tests start at `mcp_test.go` lines 70, 122, 140, 173, 237, 279 and 290. The `connect` helper (lines 17–42) uses `mcp.NewInMemoryTransports()`.

### What didn't work
- Command: `grep -n 'E_TIMEOUT\|E_BUSY\|E_CANCEL' -r pkg --include=*.go | head -5`
- Error: `(eval):1: no matches found: --include=*.go`. zsh expanded the unquoted glob, found no match and aborted the command, so the search never ran.
- I did not rerun it. The guide does not claim that goja-cv has these codes; it proposes them as new diagnostic codes for CHB-002 (guide §9).

### What I learned
- The DSL names belong to CHB-007. The guide labels calls such as `frame.print()`, `measure.densitometer` and `recipe.set` as placeholders.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Check whether goja-cv already names its timeout, busy and cancellation errors, with the glob quoted: `grep -rn 'E_TIMEOUT' --include='*.go' pkg`. If it does, align the proposed codes.

### What should be done in the future
- The same check, before CHB-002 fixes its error codes.

### Code review instructions
- Compare guide §8 ("Bridge tests") with `pkg/cvsession/mcp_test.go` lines 17–42.

### Technical details
- N/A.

## Step 10: Checking the unit arithmetic (inline Python)

Before writing any unit conversion into a guide, I computed the conversions both guides quote with an inline `python3 -I` script that read no files. The numbers in the CHB-008 units table, the test-strip example and the testing section come from its output.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** no hand-computed numbers.
**Inferred user intent:** examples a reader can trust and reproduce.
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
- The common brief asks for real numbers and requires them to be checked.

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
- A 1/3-stop step is 4.01 points, which the guides round to 4.0. A 4-point ring-around step and a 1/3-stop test-strip step are therefore almost the same change in exposure.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- Turn these into unit tests on the playbook arithmetic (guide §8).

### Code review instructions
- Rerun the script and compare its output with guide §2.2, §6 and §8.

### Technical details
- One point is 0.025 log H; one stop is log₁₀ 2 = 0.30103 log H.

## Step 11: Drafting the CHB-008 guide

I wrote the complete first draft in one pass (16:05:47), following the writing guidance's two-pass procedure. The draft had 13,056 words.

The draft follows the brief's teaching order: purpose; background (agents that write code, darkroom units, MCP, the Messages API); how it fits the system; existing code; design for each stage; one flow traced end to end; implementation plan; testing; proposed contract additions; risks; references. It has four decision records, all listed below under "What worked".

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** produce the full guide before reviewing it.
**Inferred user intent:** a complete guide, not an outline.
**Commit (code):** none.

### What I did
- Wrote `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb-008.md` with the `Write` tool.

### Why
- The brief requires a complete draft before the review pass.

### What worked
- The draft covered all four stages and every section the brief requires.
- Decision records:
  - the host stamps and commits mutations, the agent only stages them;
  - which MCP library to use;
  - one native `eval` tool;
  - the step loop runs in the page.

### What didn't work
- The draft had errors that Steps 12 and 13 fixed, among them wrong goja-cv line ranges and a reversed colour direction in the opening example.

### What I learned
- N/A beyond Steps 3–10.

### What was tricky to build
- Inside an eval, later reads must see the eval's own writes; to the outside, the eval must commit all its mutations or none. The design has CHB-007's runner stage the mutations while the host validates them and commits them as one transaction. This needs CHB-007 to agree on the `RunOutcome` type.
- Concurrent edits by the photographer. If the photographer changes a path after an eval starts, an agent write to that path becomes pending even in auto mode. Detecting this needs `LoggedMutation.seq`.

### What warrants a second pair of eyes
- The `commit()` sketch in guide §5.2: host-side stamping, statuses, the downgrade to pending on conflict, and the logging of rejected mutations.
- The table of attacks on host safety in guide §8.

### What should be done in the future
- Agree `RunOutcome` with CHB-007 before stage 1 ends (guide §10).

### Code review instructions
- Read guide §5.2–5.3 together with §8.

### Technical details
- The delivered guide has sections 1–11, as returned in the GUIDE block.

## Step 12: Checking the cited line ranges and correcting them

After the draft, I grepped again for the exact line numbers of the goja-cv functions and Filmbench symbols the guide cites, and compared them with its tables. Several goja-cv ranges and one Filmbench range were a few lines off. I corrected them all in one scripted edit.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** the brief says to check every cited line range at source.
**Inferred user intent:** references an intern can open and trust.
**Commit (code):** none.

### What I did
- At 16:05:56, a `grep -n` for:
  - in `pkg/cvsession/mcp.go`: `type EvalInput`, `type OpenInput`, `func NewMCPServer`, `register`, `unknownSession`, `run`, and closing braces;
  - in `reference.go`: `Instructions`, `EvalToolDescription`, `Reference`, `funcLine`, `opLine`;
  - in `processor.go` and `session.go`: `contextBlock`, `armWatchdog`, `disarm`;
  - in Filmbench: `contextText`, `fmtResult`, `SUGG`, `ERR`.
- At 16:06:12, ran `python3 -I - chb-008.md` with a heredoc of exact old and new strings. The script printed `MISSING` for any old string it could not find.

### Why
- My first-draft ranges had not been checked against exact line numbers.

### What worked
- The `grep` gave:
  - `EvalInput` 40–43, `OpenInput` 47–52, `NewMCPServer` 56–79, `register` 88–153, `unknownSession` 182–201, `run` 203–218;
  - `Instructions` at line 15, `EvalToolDescription` 48, `Reference` 52, `funcLine` 88, `opLine` 107;
  - `contextBlock` at `processor.go:475`, `armWatchdog` at `session.go:380`;
  - Filmbench `ERR` at 4749.
- Corrections, old → new:
  - `mcp.go`: 39–51 → 40–52; 55–83 → 54–79; 92–158 → 88–153; 182–218 → 180–218;
  - `reference.go`: 52–132 → 50–132; `opLine` 108–132 → 107–132;
  - `processor.go`: 463–540 → 469–540;
  - Filmbench `ERR` table: 4747–4752 → 4749–4752, in three places.
- No `MISSING` lines. A follow-up `grep` showed the new ranges at guide lines 167, 207, 717 and 994.

### What didn't work
- The first draft had the wrong ranges above.

### What I learned
- A cited range should start at a declaration or doc comment that a reviewer can find with `grep`.

### What was tricky to build
- Some ranges include the doc comment above a function on purpose. For example, 54–79 for `NewMCPServer`, whose `func` line is 56, and 180–218 for `unknownSession`.

### What warrants a second pair of eyes
- Spot-check the other ranges in guide §4.1. The `session.go` and `mcp_test.go` ranges were read in Steps 3 and 9 but not grepped again here.

### What should be done in the future
- N/A.

### Code review instructions
- `cd ~/code/wesen/go-go-golems/goja-cv && grep -n 'type EvalInput\|^func NewMCPServer\|^func opLine' pkg/cvsession/*.go`.

### Technical details
- goja-cv at commit `5a93095`.

## Step 13: Reviewing and revising CHB-008

I reread the whole draft as an intern would, in four reads (16:06:16 to 16:06:47), and listed its gaps and errors. I applied the fixes as exact-string replacements in two scripts (16:07:37 and 16:07:43) and then checked the code fences.

The main problems:
- the opening example had the colour direction reversed;
- the draft never said that an MCP eval does not wait for approval;
- the loop pseudocode could leave a `tool_use` without its `tool_result` after Stop or at the step limit;
- one package name and the rule for routing evals to pages were inconsistent.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** the brief's second pass: reread, note the gaps, revise.
**Inferred user intent:** a guide without errors an intern would trip over.
**Commit (code):** none.

### What I did
- Reread `chb-008.md` with `Read` at offsets 1, 160, 420 and 750.
- Script 1 (16:07:37) replaced:
  - the opening example: "+4 points of magenta light" → "+4 points of green printer light … (more green light makes more magenta dye, which cancels green)";
  - the page-routing paragraph: sessions belong to pages, and an eval without a session goes to the default session of the most recently focused page;
  - `render.ts`: records, per session, the pending sequence numbers it reported, and reports "approvals since your last eval";
  - a new subsection, "Approvals do not block an MCP eval";
  - the module layout: `internal/localauth/` → `internal/guard/`, the name the rest of the guide uses;
  - the `MAX_MCP_OUTPUT_TOKENS` note: 25,000 tokens against a 9000-character result, roughly 2000–3000 tokens;
  - Claude Desktop config paths for macOS, Windows and Linux, plus the rule that a stdio server logs only to stderr;
  - the refusal-fallback note: the fallback model cannot read the thinking blocks, so the API drops them for that request and the client resends them unchanged;
  - use of the SDK's beta namespace, `client.beta.messages`;
  - the whole `runTurn` pseudocode, rewritten with `takeCarry`/`setCarry`, a `max_tokens` branch, the step-limit note, and a `role: 'system'` message appended when the mode changes;
  - the guarantee text for Stop, now using the carry;
  - the step-limit bullet and the "two kinds of context" bullet;
  - the privacy setting: one per destination, "pictures allowed" or "numbers only";
  - steps 7–8 of the traced flow: the DSL write call is marked as CHB-007's to name, and approval semantics are deferred to CHB-002.
- Script 2 (16:07:43) added a "defence in depth" comment to the read-only branch of the `commit()` sketch.
- Fence check: `wc -w chb-008.md; grep -c '```' chb-008.md; grep -n '^```$' chb-008.md | head -3; awk '/^```/{c++; if(c%2==1 && $0=="```") print NR": untagged open"}' chb-008.md`.

### Why
- These were the errors and gaps found on reread.

### What worked
- Neither script printed `MISSING`. The follow-up `grep` found `internal/guard/` at line 259, the new subsection at line 373 and `takeCarry` at line 673.
- The fence check printed `13484` words and `50` lines containing three backticks; lines 44, 56 and 142 are bare closing fences. The `awk` printed no untagged opening fence.

### What didn't work
- No command failed. The defects listed above were in the draft.

### What I learned
- A printer light is named for its colour of light, and it changes the complementary dye: more green light gives more magenta dye. Writing "magenta light" was a units slip a darkroom reader would notice at once.

### What was tricky to build
- Keeping the Messages API transcript valid on every exit path. `tool_result` blocks must open the user message that answers them. Results for stopped or unrun calls are therefore carried into the next user message rather than appended on their own.

### What warrants a second pair of eyes
- The `runTurn` pseudocode in guide §5.6: carry handling, the `max_tokens` branch, and the tail added at the step limit.
- Whether the pinned API and SDK accept a `role: "system"` message appended on a mode change. The migration notes list appended system messages as allowed.

### What should be done in the future
- Implement the stage 3 test that each request's prefix is byte-identical to the previous request (guide §7).

### Code review instructions
- Guide §1 (the example), §5.2 ("Approvals do not block an MCP eval"), §5.4, §5.5 (client configuration) and §5.6 (the loop and its guarantees).

### Technical details
- 13,484 words by `wc -w` after this step; 13,507 after Step 14.

## Step 14: Making shared boundaries consistent and checking the RELATED paths

Two boundaries are described in both guides: chat threads stored in the studio's IndexedDB, and the named probes that playbooks use. Both guides had to describe them the same way, so I aligned the wording in both files. Then I checked that every path planned for the RELATED blocks exists.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** the two guides must not contradict each other, and the RELATED blocks may list only existing files.
**Inferred user intent:** two interns working in parallel agree on who owns what.
**Commit (code):** none.

### What I did
- At 16:16:15, `python3 -I -` with exact-string replacements:
  - `chb-008.md`, thread storage: now "the studio's IndexedDB database (CHB-009 defines the database and its `threads` store; this ticket defines the record)";
  - `chb-008.md`, the test-strip playbook row: now "measured at a named probe such as "grey" (CHB-009 proposes storing probes in the recipe)";
  - `chb-009.md`, the IndexedDB schema: comment `// record format defined by CHB-008`.
- At 16:16:24, `for f in … ; do test -e "$f" && echo OK || echo "MISSING $f"; done` over the 13 distinct files in both RELATED blocks.

### Why
- If the wording differs, each intern may assume the other owns the record.

### What worked
- `grep` showed the new text at `chb-009.md:366` and `chb-008.md:727`.
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
- The CHB-008 RELATED block lists 8 existing files:
  - the architecture doc;
  - goja-cv's `pkg/cvsession/mcp.go`, `reference.go` and `processor.go`, and `cmd/goja-cv/mcp.go`;
  - Filmbench's `01-inline.js`;
  - `analysis-goja-cv.md` and `analysis-filmbench-ide.md`.

## Step 15: Hand-back, wrap-up and preparing this diary

I printed the final guide and inspected the regions Step 13 changed (16:16:31 to 16:16:45). At 16:24:27 I returned both guides through `SubagentHandback`: a short summary, then the GUIDE, TASKS and RELATED blocks for CHB-008 and CHB-009. The orchestrator's wrap-up message ("Wrap up now…") arrived at the same moment.

The orchestrator then asked for these diaries. I rebuilt the timeline from the session transcript with two small scripts. While checking a textbook citation for the diary, I found two section numbers in this guide that do not match the textbook. I recorded them below and left the delivered guide unedited, as the wrap-up asked for no further revision.

### Prompt Context
**User prompt (verbatim), for this diary:** "ask them to write all detailed diaries for their work and add those to the ticket too, see diary skill for the format."
**Orchestrator messages (not the user's words):** "Wrap up now. The user wants to move on, and good enough is fine. …", followed by the request for one diary per ticket, in the investigation format, starting at Step 2.
**Assistant interpretation:** deliver the guides as they are, then a diary per ticket built from the transcript.
**Inferred user intent:** the ticket records how each guide was produced and what still needs checking.
**Commit (code):** none.

### What I did
- At 16:16:31, `cat` of the final `chb-008.md`. The output was 93.3 KB, so the harness saved it to `/home/manuel/.claude/projects/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/tool-results/b77ruli4b.txt`.
- At 16:24:27, `SubagentHandback`. Result: `Report delivered to your caller.`
- For this diary:
  - read `/home/manuel/.claude/skills/diary/SKILL.md`, `references/investigation-entry.md` and `references/evidence-levels.md`;
  - wrote `scratchpad/guides/trace.py` and `trace2.py`, which list the tool calls and results in the transcript `/home/manuel/.claude/projects/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/subagents/agent-a6e6dee9bda6ae5a3.jsonl`, and ran them with `python3 -I`;
  - saved the delivered report verbatim to `scratchpad/guides/chb-008-009-handback.md` and compared its guide blocks with the scratch files;
  - recounted words and fences;
  - grepped the textbook for the golden numbers.

### Why
- The diary skill asks for exact commands and diagnostics. Context had been compacted, so the transcript was the reliable source.

### What worked
- The GUIDE block in the delivered report is identical to `chb-008.md` (93,606 characters). TASKS has 19 lines and RELATED 8.
- Final `chb-008.md`:
  - 13,507 words, 1021 lines;
  - 46 fence lines at column 0, with no untagged opening fence;
  - sha256 prefix `cf4603f4ba4850e4`.

  The four fences not at column 0 (lines 878, 892, 965 and 972) are tagged fences indented inside numbered list items.
- The copy of the delivered report is 186,377 bytes, sha256 prefix `5b3d76a936b1edb1`.

### What didn't work
- My first diary command, `cat /home/manuel/.claude/skills/diary/SKILL.md; echo ======; cat …`, exited 1 with `(eval):1: ===== not found`. zsh's `=word` expansion read `======` as `=` followed by a command name. Recovery: `cd …/references && ls; for f in investigation-entry.md evidence-levels.md; do echo "----- $f"; cat "$f"; done`.
- Citation errors the textbook check found:
  - guide line 83 cites "α = 0.75 (§2.6)", but `integrate = (alpha = 0.75)` is on textbook line 937, in §3.6 "Grey balance belongs in log exposure";
  - guide line 933 cites "textbook §2.6" for the grey card at 0.755, but that number is on textbook line 377, in the introduction to chapter 2, "The forward model: film, paper and eye as composed functions";
  - the "Try it" numbers are correctly cited as §2.7 (line 586).

### What I learned
- In zsh, a run of `=` signs must be quoted.

### What was tricky to build
- Reconstructing the order of events and their outcomes after context compaction. The transcript has every tool input and result, so every fact in this diary comes from it rather than from memory.

### What warrants a second pair of eyes
- The two citation fixes above. Line numbers refer to `chb-008.md` as delivered.

### What should be done in the future
- When filing the guide:
  - on line 83, change "(§2.6)" after "α = 0.75" to "(§3.6)";
  - on line 933, cite the introduction to chapter 2 ("The forward model") for 0.755 instead of §2.6.
- The grey-balance evaluation fixture should use the "Try it" settings: flare 0.48 %, Saunderson off.

### Code review instructions
- `grep -n 'α = 0.75\|0.755' chb-008.md` in the scratch folder, plus `sed -n 377p` and `sed -n 937p` of the textbook.

### Technical details
- Scratch folder: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/`.
- This work wrote nothing under `ttmp/` or goja-cv. All its writes went to the scratch folder.

## Step 16: Implementation — the DSL session in a Web Worker, the in-app chat, the MCP bridge, three playbooks

This step implements CHB-008 on branch `task/chb-008-agent` in four commits, in the brief's priority order. The
DSL session (CHB-007's `DslSession`) now runs in a Web Worker behind a small protocol; it reaches the engine only
through `adopt`/`measure`/`evaluate`, reads recipes from mirror copies of the frames' EditLogs, and its proposals
are replayed on the page's real logs through `EditLog.propose`. On top of that: `ChatSession` (the step loop) with
pluggable model transports (a scripted model for tests and an offline demo, and the Claude API on
`@anthropic-ai/sdk` with a key typed at runtime), the `cb.chat` panel as `kits/chat` in studio-kit with an
Assistant module in the classic and lab variants, the Go bridge (`bridge/`, MCP over stdio and stateless HTTP,
a WebSocket hub to the page), the page's bridge client, and three playbooks.

The guide's stage-1 design (an `EvalHost` with its own `commit.ts` and `render.ts` around a CHB-007 `EvalRunner`)
was written before CHB-007 existed. CHB-007's `DslSession` already stages edits, renders the YAML result and calls
`EditLog.propose` at the end of a successful eval, and `EditLog.propose` (contract 0.2/0.3) already stamps
`by: 'agent'`, honours the mode and records `expect`. So the host here is the worker client: the page's
`EditLog.propose` is the safety boundary, and the guide's `channel.ts`/`commit.ts`/`render.ts` were not written.

### Prompt Context
**User prompt (verbatim):** the orchestrator's task (not the user's own words): "You implement ticket CHB-008
(agent integration: eval transports, MCP bridge, in-app chat, playbooks) in the chromobench monorepo, in your own
git worktree (based on main). […] Priorities, in order: (1) the DSL session in a Web Worker with RPC (session
reaches the engine only via adopt/measure/evaluate); (2) the in-app chat panel as a studio-kit component/kit […] on
a ChatSession that streams text, shows step cards, looks, approval cards, Stop, agent mode (read-only/ask/auto —
only the photographer changes it) — the LLM transport must be pluggable; for tests use a scripted fake model; for
real use, a provider adapter whose API key the user enters at runtime (never hard-code or commit keys […]); (3) the
MCP bridge / external transport as the guide describes (an optional Go bridge may be stubbed or left as a
documented TODO if large). Keep agent edits going through EditLog.propose → approval cards. […] Be pragmatic."
**Assistant interpretation:** worker + RPC first, then the chat (session, transports, kit, studio wiring, e2e),
then the bridge; everything through `EditLog.propose`; checks green at each commit.
**Inferred user intent:** the photographer can talk to an assistant inside the studio now (with their own key, or
the offline demo), and Claude Code/Desktop can reach the same darkroom through MCP, without either bypassing the
approval cards.
**Commit (code):** 5bfe010 — "CHB-008: DSL session in a Web Worker — worker protocol, mirror logs, proposals
replayed on the page's EditLog"; a2ef70c — "CHB-008: in-app chat — ChatSession, pluggable model transports,
cb.kits.chat panel, wired into the studio"; 079fbb1 — "CHB-008: the MCP bridge — Go hub, MCP server
(eval/status/create_session, stdio + stateless HTTP), page client"; 3127217 — "CHB-008: playbooks (grey balance,
test strip, ring-around), in the chat prompt and as MCP resources; contract requests"

### What I did
- Read the brief, the CHB-008 guide and tasks, `packages/dsl/src/{session,host,index}.ts`, the contract's
  `editlog.ts`, `eval.ts`, `vocab.ts`, `engine.ts`, studio-kit's `studio.ts`, `bridge/frames.ts`, `cb.ts` (the
  `cb.chat` slot, `agent.mode`), `dom/panels.ts`, the roll kit's layout, `apps/studio/src/main.ts`, the claude-api
  skill (model ids, adaptive thinking, effort, fallbacks, eager input streaming).
- `pnpm install --offline --frozen-lockfile`; `git checkout -b task/chb-008-agent`.
- **Worker (commit 1).** `packages/agent/src/worker/{protocol,server,client,spawn,dsl.worker}.ts`:
  - `serveDsl(endpoint)`: a `DslSession` on a `ProxyEngine` (adopt → fire-and-forget message; measure/evaluate →
    request/reply with cancel; open/prepare not reachable) and `MirrorLog`s (an `EditLog` subclass built from
    `toJSON()` snapshots whose `propose` also records the call in an outbox).
  - `DslWorkerClient` (page side): serves engine calls (evaluate copies the samples before transferring them),
    sends frame snapshots for logs that changed (a per-log version bumped by `log.on`), replays the outbox with
    `log.propose` under a per-session tx prefix and substitutes the real entries in `EvalResult.mutations`
    (refusals become `CONFLICT` warnings plus a `host:` section in the YAML), one eval at a time with `E_BUSY`
    after `busyMs` (10 s), and a backstop: deadline + 2 s, or a cancel the VM does not honour within 2 s, terminates
    and respawns the worker; the next eval carries `E_SESSION_RESET`.
  - `createDslWorker()` (`new Worker(new URL('./dsl.worker.ts', import.meta.url), { type: 'module' })`) and
    `inThreadWorker()` (the same server on a `MessageChannel`, for Node tests).
  - `packages/dsl`: `DslSession.interrupt()` (sets the deadline to 0, aborts pending engine calls, wakes the pump;
    the eval ends `E_CANCELLED` and keeps the `fatal` flag so the probe/restart logic still runs); `index.ts`
    exports `genInstructions`, `genReference`.
  - `tools/scripts/check-boundaries.ts`: `packages/agent/src` may not import core/gpu/ingest/studio-kit/shell.
- **Chat (commit 2).** `packages/agent/src/chat/`:
  - `model.ts`: `ChatModel` (send(request, sink, signal) → reply, Messages-API shapes from the SDK's beta
    types), `ScriptedModel`, `ModelError` kinds.
  - `anthropic.ts`: `AnthropicModel` on `@anthropic-ai/sdk` 0.123.0 (`client.beta.messages.stream`, `streamEvent`
    deltas, `finalMessage()`): model `claude-opus-5-5` by default, `thinking: {type: 'adaptive', display:
    'summarized'}`, explicit `output_config.effort`, top-level `cache_control`, `context_management`
    `clear_tool_uses_20250919`, `fallbacks: 'default'` with betas `context-management-2025-06-27` and
    `server-side-fallback-2026-07-01`, `dangerouslyAllowBrowser: true`; typed SDK errors → one sentence.
  - `prompt.ts`: the outline (how to act, modes, units, safety) + generated DSL instructions + reference +
    playbooks; `EVAL_TOOL` with `eager_input_streaming: true`, `additionalProperties: false`.
  - `session.ts`: `ChatSession` — append-only messages (frozen system/tools at the first send; per-turn context as a
    text block; a mode change since the model last heard is an appended `role: 'system'` message), the step loop
    (refusal, pause_turn, max_tokens with a cut call, 10-step limit with the "answer now" note, carry of
    `tool_result`s into the next user message), input validation (`E_TOOL_INPUT`), approvals inside the step
    (`decide(step, seqs, 'approve'|'reject'|'later', {force})`, also resumed when the photographer decides in the
    approvals panel, via `log.on`), `revertStep` (inverse mutations by `user`), `stop()`, looks as base64 image
    blocks in the `tool_result`, a state snapshot and `ChatEvent`s.
  - `demo.ts`: `demoModel` — a scripted assistant that measures the centre, solves lights in log exposure and
    proposes them, then summarises from the tool results.
  - studio-kit `kits/chat/src/{kit,dom,index}.ts`, `chat.css`: `ChatService`/`ChatSessionLike` contract (the
    session arrives as service `chat`), `createChatKit` (`panel()`, `module()`), `CHAT_RENDERERS['cb.chat']`;
    `cb.kits['chat']` in `cb.ts`; exports `./kits/chat`, `./kits/chat/dom`, `./kits/chat/chat.css`; an
    `assistant` module in `variants/classic.js` and `lab.js`; explain snapshots updated (`-u`).
  - `apps/studio/src/host/chat.ts`: `createStudioChat(studio)` — DSL worker sessions per prefix (`chat`, `dev`,
    later `mcp…`), providers "Claude (your API key)" and "Scripted demo (offline)", key kept in memory or, when
    "remember" is ticked, `localStorage['chromobench.chat.anthropic-key']`; mode via `rt.runCommand('agent.mode')`.
    `main.ts`: the service and renderers passed to `mountStudio`, `window.chromobench.{chat, chatService, eval}`.
  - `apps/studio/vite.config.ts`: `optimizeDeps.exclude` gains `@jitl/quickjs-wasmfile-release-sync`.
  - Tests: `packages/agent/test/{worker,chat,anthropic,demo}.test.ts`; `e2e/chat.spec.ts`.
- **Bridge (commit 3).** `bridge/` (module `github.com/wesen/chromobench/bridge`, Go 1.25, `go-sdk` v1.7.0 and
  `coder/websocket` v1.8.15 from the module cache with `GOFLAGS=-mod=mod GOPROXY=off`):
  - `internal/hub`: page registry, routing (session owner, else the focused/most recent page), ids `e-0001…`,
    watchdog deadline + grace (5 s), `eval.cancel` with reason `client`/`timeout`, `E_NO_PAGE` on disconnect,
    `create_session`, status; `ServePage` (Origin patterns, 64 MiB read limit).
  - `internal/mcpserver`: tools `eval` (input descriptions say when to omit the optional fields), `status`,
    `create_session`; resources `chromobench://instructions`, `chromobench://reference`; prompt
    `chromobench-agent`; `Remote` backend for attach mode.
  - `internal/guard`: loopback-only listen, Host check, bearer token, `bridge.json` (0600).
  - `internal/server`: the ServeMux (`GET /{path...}` SPA from `--dir`, `GET /ws/page`, `POST|GET|DELETE /mcp`
    stateless Streamable HTTP, `/api/agent/{eval,session,status}`, `GET /api/health` with `X-Chromobench-Bridge`).
  - `cmd/chromobench`: `serve`, `mcp` (attach to a healthy bridge from `bridge.json`, else start one; MCP on
    stdio; logs on stderr), `token`; `--config` overrides the bridge.json path.
  - `tools/gen-docs/agent.ts`: writes `bridge/internal/mcpserver/generated/{instructions.md,reference.md,
    eval-tool.txt}` (go:embed cannot reach outside the module).
  - `packages/agent/src/bridge/page-client.ts`: `BridgePageClient` (hello, focus/mode updates, evals in DSL
    sessions per bridge session, cancel, sessions, reconnect 0.5→8 s). The studio connects when `/api/health`
    has the bridge header, or with `?bridge[=ws-url]`; status bar pill `#bridge`.
  - Go tests `internal/server/server_test.go`; TS test `bridge-page.test.ts`; `bridge/README.md`.
- **Playbooks (commit 4).** `packages/agent/playbooks/{grey-balance,test-strip,ring-around}.js`; gen-docs bundles
  them into `packages/agent/src/playbooks.generated.ts` (system prompt section) and
  `bridge/internal/mcpserver/generated/playbooks/` (resources `chromobench://playbooks/<name>`);
  `playbooks.test.ts`; `packages/agent/CONTRACT-REQUESTS.md` (R1, R2).
- `docmgr task check --ticket CHB-008` for gleu, 3h2u, dfuk, jlwa, 1fpn, hbf7, 1put, jf58, m3zx, 3hp8.

### Why
- Mirror logs instead of an async EditLog proxy: CHB-007's `Host` reads `log.committed`, `log.mode`,
  `log.formatWhy`, `log.pending()` synchronously during an eval and calls `log.propose` synchronously at its end.
  A full snapshot before each eval keeps `DslSession` unchanged; replaying the recorded `propose` calls on the page
  keeps `EditLog.propose` the only door for agent writes, and the page's log (its mode, its current state) decides.
- One worker per session (chat, dev, each MCP session): `mem` stays separate, and a forced restart loses only that
  session's `mem`.
- The model transport behind `ChatModel` so that tests, the offline demo and the Claude API go through the same loop;
  the API key is typed by the photographer because there is no bridge proxy yet (guide §5.6's proxy is open).
- The kit gets the session as a service and declares the shape it needs (`ChatSessionLike`): studio-kit's boundary
  rule allows only the contract and the shell. `demo.test.ts` assigns a `ChatSession` to `ChatSessionLike` so a
  drift breaks `pnpm typecheck`.
- An Assistant module rather than a panel squeezed into the Print module's right column: the chat needs height.
- Go `flag` instead of cobra and `--dir` instead of `go:embed`: fewer dependencies and no build-order coupling
  for v0.

### What worked
- Commit 1: `npx vitest run packages/agent` 12 passed; `pnpm test` 69 files, 2425 passed (baseline 2413);
  typecheck clean; `pnpm lint` "import boundaries ok (278 file checks)"; `pnpm gen:check` "gen:check ok (19 files)".
- Worker test: the same E1 program via the worker and via an in-page `DslSession` gives identical `yaml` and
  `context`, one look of equal byte length; `vi.spyOn` counts 0 calls to `open`, `prepare`, `dispose` and > 0 to
  `adopt`, `measure`, `evaluate`.
- Commit 2: `pnpm test` 2442 passed; browser `CI=1 pnpm test:browser` (ports 4551–4554) 73 passed (1.8 m),
  including `e2e/chat.spec.ts` 4/4: the worker test returned `{ a: '3', b: 'E_CANCELLED', c: '42' }` with the
  synchronous `for (;;) {}` stopped in under 3 s; the demo flow applied the lights after Approve and Revert
  restored them; the routed fake API saw `x-api-key: sk-ant-test-not-a-real-key`, model `claude-opus-5-5` and
  `anthropic-dangerous-direct-browser-access: true`, and the key appears in neither the store nor the log.
- Screenshots (scratch spec, `?canvas2d`): `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/chat-approval.png`
  shows the Assistant module with the print, step cards with code and a look, and the approval card
  "print.lights.logH [0, 0, 0] → [-0.1125, -0.0125, 0.125]".
- Commit 3: `go vet ./...` clean; `go test ./...` ok (in-memory MCP client: tools `create_session,eval,status`,
  instructions 1000–3999 characters, resources, prompt; eval round trip with an `ImageContent`; `E_NO_PAGE`;
  timeout sends `eval.cancel` reason `timeout`; client cancellation sends reason `client`; a page disconnect fails
  the call with `E_NO_PAGE`; Host `evil.example:80` → 403, missing/wrong token → 401, foreign Origin on
  `/ws/page` → 403; attach mode through `Remote`; stateless Streamable HTTP with the bearer token).
- End to end with the real binary (scratch spec, not committed): `chromobench serve --addr 127.0.0.1:7355
  --allow-origin localhost:4551 --config <scratchpad>/bridge.json`, the studio opened with
  `?bridge=ws://127.0.0.1:7355/ws/page` showed "agents: connected"; `POST /api/agent/eval` returned the densities
  `[0.94691, 0.80158, 0.58241]`, an `edits:` line "e1 pending: set print.enlarger.time_s = 12.6 (was 10)" and a
  24752-character base64 look; `chromobench mcp --config …` logged "attaching to the running bridge" and answered
  `tools/call eval` over stdio with "10 … proposals: eval-1 pending"; the page log's pending entry had
  `{ tx: 'mcp-eval-1', by: 'agent' }`.
- Commit 4: `playbooks.test.ts` 4 passed (grey balance points `-4.5, -0.5, 5` and value `[-0.1125, -0.0125,
  0.125]` as in CHB-007 §7; `mem.stripTimes(12, 5, 1/3)` → `[7.56, 9.52, 12, 15.12, 19.05]`; 1/3 stop → 4.01 pt);
  `pnpm gen:check` "gen:check ok (26 files)".

### What didn't work
- `pnpm typecheck`: `client.ts(84,23): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is
  enabled.` (and three in `server.ts`): constructor parameter properties; rewritten as fields.
- Worker tests, first run (3 of 12 failed): the cancel test timed out after 5000 ms — in-thread, `for (;;) {}`
  blocks the timers that would send the interrupt, so only the 30 s deadline could stop it; the test now cancels an
  eval that awaits measurements, and the browser spec covers the synchronous loop in a real Worker. The replay
  refusal test switched the mode before the eval had synced, so the DSL itself threw `E_READONLY`; the switch now
  happens inside a spied `engine.measure`. `library.frames()` does not exist (`ReferenceError`); it is `cb.frames()`.
- Chat test: "partial approval" read `step.approval.seqs` of undefined — the wait condition matched the first step
  while it was still `waiting`; it now waits for the second step's own status.
- `pnpm typecheck`: `Type 'BetaContentBlockParam' is not assignable to type 'BetaTextBlockParam | …'` for text
  blocks inside `tool_result`; the helper now returns the narrow `{ type: 'text'; text: string }`.
- `e2e/chat.spec.ts`, first run (2 of 4 failed): `Aborted(CompileError: WebAssembly.instantiate(): expected magic
  word 00 61 73 6d, found 3c 21 64 6f @+0)` — Vite pre-bundled the QuickJS variant, so `new
  URL("emscripten-module.wasm", import.meta.url)` resolved to the SPA fallback HTML. Fixed with
  `optimizeDeps.exclude`.
- The first screenshot showed an empty viewer: headless SwiftShader WebGPU canvases do not appear in screenshots
  (as CHB-019 noted); with `?canvas2d` the print is there. It also showed the chat log pushing the composer off
  screen; `.cb-chat` now has a viewport-based height and the log scrolls.
- `go test`: `panic: pattern "/mcp" … conflicts with pattern "GET /{path...}"`; `/mcp` is registered per method.
- The worktree guard refused several shell commands ("too complex to verify that it stays inside the worktree"):
  `cat > file <<EOF` chains, `mkdir … && cd … && pnpm add`, an env-prefixed bridge start
  (`XDG_CONFIG_HOME=…`, "injecting git configuration"). Files were written with the editor, commands split, and
  the bridge got a `--config` flag.
- `pnpm test` under a load average of 21–26 (other agents' worktrees) failed by timeouts in other packages
  (`ch3.golden.test.ts` "Test timed out in 30000ms", `output` bug 4484, `ingest` dust, …); the failing files
  passed when rerun alone (63/63), and the last full run had 2 timeouts (core ch3 33³ tables, output bug 4484), 2446
  passed of 2448.

### What I learned
- `EditLog.propose` already carries the guide's commit rule except the "photographer's hand wins in auto mode"
  downgrade; that one needs a contract option (R1).
- go-sdk v1.7.0's `ImageContent.Data` is raw bytes (JSON-encoded as base64); the bridge decodes the page's base64.
- The SDK 0.123.0 in the pnpm store already has `fallbacks`, `output_config.effort`, `eager_input_streaming`,
  `role: 'system'` messages and `BetaFallbackBlock`.

### What was tricky to build
- Keeping three views of a log consistent: the worker's mirror (snapshot before each eval), the replay on the
  page, and the session's own proposal list (used for the context block's "eval-1 pending/approved"). Seqs agree as
  long as no one writes to the frame between the snapshot and the replay; the replay result is authoritative
  (`EvalResult.mutations` carries the page's entries).
- Stop at every point of a turn: while the model streams (nothing appended; a first request is taken back so Send
  can retry), during an eval (interrupt; `E_CANCELLED` result in the carry), during an approval wait (the waiter
  resolves "stopped", the changes stay pending), and between tool calls (later calls answered "not run").
- A forced worker restart: late messages of the terminated worker are ignored by identity, engine calls in flight
  are aborted, and the reset note is captured per eval so it lands on the next eval, not on the forced one.

### What warrants a second pair of eyes
- Security: the API key in `localStorage` when "remember" is ticked (any script on the origin can read it); the
  mirror-log replay as the only path for agent writes (`server.ts` `MirrorLog`, `client.ts` `replay`); the
  bridge's Origin check is `coder/websocket`'s pattern match (no page cookie yet, no `CrossOriginProtection`).
- `DslSession.interrupt()` in CHB-007's package: the cancelled outcome keeps `fatal` so a VM interrupted inside
  a synchronous loop is probed and restarted like a timeout.
- The context block's proposal status can be wrong when the photographer edits the same frame during an eval
  (mirror seqs ≠ page seqs).

### What should be done in the future
- Contract R1 (`propose({ pending })`) and then the auto-mode conflict downgrade; R2 (`origin`).
- Thread storage in IndexedDB and attachments (downscale to 1568 px) — tasks 99av, 1m3u stay open.
- The Claude proxy in the bridge (`/api/claude/…`, task ch9a), so the key can live outside the page.
- `go:embed` of the built studio, the page cookie and `CrossOriginProtection` (jgyd, a4uc); go-sdk ≥ 1.8.0 when it
  is in the module cache.
- Dust-pass and roll-consistency playbooks (siva), transcripts/replay/metrics (hnav; `DslSession.traces` exists),
  budget-gated evaluations and image-privacy settings (u7mw).
- Run the Go tests in CI (`cd bridge && go test ./...`); they are not part of `pnpm test`.

### Code review instructions
- Start with `packages/agent/src/worker/client.ts` (`runOne`, `replay`, `kill`) and `worker/server.ts`
  (`MirrorLog`, `ProxyEngine`), then `chat/session.ts` (`send`, `turn`, `runStep`, `waitDecision`, `decide`),
  `chat/anthropic.ts` (`body`), `packages/studio-kit/kits/chat/src/dom.ts`, `apps/studio/src/host/chat.ts`,
  `bridge/internal/hub/hub.go` (`Eval`), `bridge/internal/server/server.go`.
- `pnpm typecheck && pnpm lint && pnpm gen:check && pnpm test`;
  `STUDIO_PORT=4551 STUDIO_KIT_PORT=4552 SHELL_DEMO_PORT=4553 GPU_PARITY_PORT=4554 CI=1 pnpm test:browser`;
  `cd bridge && GOFLAGS=-mod=mod GOPROXY=off go test ./...`.
- In the app: `pnpm --filter @chromobench/studio dev`, open a scan, choose the Assistant module, pick "Scripted demo
  (offline)" or "Claude (your API key)", Connect, ask.

### Technical details
- Worker protocol (`protocol.ts`): to the worker `init {engine: {id, caps}, limits}`, `frames {set: {id: {data, mode,
  source, name}}}`, `eval {id, req}`, `interrupt {id}`, `engine.reply {call, ok|err}`; from the worker `ready`,
  `adopt {defs}`, `engine {call, method: measure|evaluate, node, spec|target}`, `engine.cancel {call}`,
  `result {id, result, proposals}`, `failed {id, error}`.
- Tx prefixes: `chat-eval-N` (in-app chat), `dev-eval-N` (`window.chromobench.eval`), `mcp-eval-N` (default MCP
  session), `mcp-s-K-eval-N` (created sessions).
- Bridge ↔ page messages: as in the guide §5.4 (`hello`, `focus`, `eval`, `eval.cancel`, `eval.result`,
  `session.create`, `session.created`); `PageMsg`/`BridgeMsg` in `bridge/internal/hub/hub.go`.
- Test counts at the end: vitest 74 files, 2448 tests (2413 baseline + 35 new; the last loaded run had 2 unrelated
  timeouts); browser 73 passed; Go `internal/server` 9 tests.
