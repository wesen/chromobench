---
Title: Diary
Ticket: CHB-005
Status: active
Topics:
    - webgpu
    - image-pipeline
    - testing
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:22.970760049-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-005 and CHB-011 (WebGPU engine and output). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-webgpu-engine.md` (13349 words), added 18 staged tasks, and related the primary source files.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Requested milestone: a complete intern guide plus a task breakdown for this ticket.
**Inferred user intent:** The ticket can be picked up by a new engineer or agent without prior context.

### Evidence and commits
- Brief: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md` (session scratchpad); shared map: CHB-001 `design-doc/01-chromobench-architecture-and-work-plan.md`.
- Filed with `python3 -I CHB-001/scripts/07-ingest-intern-guides.py <agent output> .` and checked with `scripts/08-check-guide-markdown.py` (fences tagged, no raw HTML).
- Writer agent: one background general-purpose agent for CHB-005 + CHB-011; number checks in scratchpad out_numbers.py; web research on WebGPU limits, PNG cICP/iCCP, TIFF 34675, lcms-wasm, Compact ICC Profiles.
- The writer's own summary, kept as returned:

> Summary: I wrote both intern guides, following the common brief. For each I drafted, reread and revised, then checked every Chromogen line range I cite against `05-inline.js` and every textbook number against the source. Web research is cited in each guide's reference section:
> - WebGPU spec limits and features, plus web3dsurvey adapter values;
> - the PNG Third Edition rules for cICP, iCCP and sRGB, and TIFF tag 34675;
> - `lcms-wasm` 1.0.5 and `@kittl/little-cms`, with their exported APIs;
> - the Compact ICC Profiles (CC0);
> - Chrome's timestamp quantisation and headless WebGPU flags.
> 
> I ran small number checks only, with scripts in `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/out_numbers.py`. They covered grey-card encodings in the five output spaces, paper white and black, the knee values, tiling overheads and the CRC vectors. No WebGPU code was executed. The scratchpad drafts are `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb005.md` and `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb011.md`; they are identical to the text below.
> 
> Points the orchestrator should know:
> - Both guides contain "Proposed contract additions (for CHB-002)" sections, which overlap: `EvalTarget.signal` and `Engine.plan` appear in both.
> - CHB-011 proposes moving `finishing.*` ops before `output.display`, so that gamut compression stays the last colour step. That conflicts with the current catalog, which puts them on `display-rgb`.
> - CHB-011 stage 4 (soft proofing) depends on the open decision in design doc §8.4.
> - `scan-of-print` in CHB-011 requires a compile rule that sets `view.flare` to 0. CHB-002 or CHB-003 would need to accept it.
> 

### Noteworthy decisions or failures
- The guide's "Proposed contract additions (for CHB-002)" section, where present, is a proposal. It must be reconciled with CHB-002 before implementation.
- Numbers the writer computed for the guide (not from the textbook) are labelled as such in the guide. They are not independently re-verified here.

### Remaining requirements and next action
- Implementation has not started. Tasks in `tasks.md` are open.
- Next: review the guide, settle the open decisions it lists, and start stage 1.
