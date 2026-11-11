---
Title: Diary
Ticket: CHB-007
Status: active
Topics:
    - dsl
    - js-api
    - agent
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:23.571919131-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-002 and CHB-007 (contract and DSL runtime). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-dsl-runtime.md` (10735 words), added 16 staged tasks, and related the primary source files.

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
