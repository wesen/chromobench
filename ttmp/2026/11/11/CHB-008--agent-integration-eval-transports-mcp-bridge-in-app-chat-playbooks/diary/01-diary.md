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
