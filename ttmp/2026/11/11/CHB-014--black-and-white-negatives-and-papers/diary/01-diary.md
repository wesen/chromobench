---
Title: Diary
Ticket: CHB-014
Status: active
Topics:
    - black-and-white
    - film-emulation
    - darkroom
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:26.228892732-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-004 and CHB-014 (data pipeline and black-and-white). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-black-and-white-negatives-and-papers.md` (10463 words), added 17 staged tasks, and related the primary source files.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Requested milestone: a complete intern guide plus a task breakdown for this ticket.
**Inferred user intent:** The ticket can be picked up by a new engineer or agent without prior context.

### Evidence and commits
- Brief: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md` (session scratchpad); shared map: CHB-001 `design-doc/01-chromobench-architecture-and-work-plan.md`.
- Filed with `python3 -I CHB-001/scripts/07-ingest-intern-guides.py <agent output> .` and checked with `scripts/08-check-guide-markdown.py` (fences tagged, no raw HTML).
- Writer agent: one background general-purpose agent for CHB-004 + CHB-014; ran data checks (NaN convention, prototype-vs-upstream deltas, grey-card error) in the session scratchpad; CHB-014 marks the development model, Callier model and VC-paper fit as speculative.
- The writer's own summary, kept as returned:

> Both guides are finished. Each has its GUIDE, TASKS and RELATED blocks below. The same text is assembled in /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/final-output.md if copying from a file is easier.
> 
> - **CHB-004** (about 10.9k words) covers the spektrafilm exporter, the pack format and the loader. I checked its key claims by running scripts against the data: how upstream treats NaN, how much the prototypes differ from upstream, and the grey-card error. If missing (NaN) densities are read as zero instead of opaque, the red layer comes out 0.18 log H too high. Its median spread across 128 film–paper pairs is 0.032 when NaN is read as opaque and 0.52 when it is read as zero.
> - **CHB-014** (about 10.5k words) covers black-and-white negatives and papers. It is research-led and marks unproven parts as **speculative**: the development model, the Callier specularity model (how much a condenser enlarger raises contrast) and the variable-contrast paper fit.
> - In the last pass I added the type definitions for the development model, renamed formula symbols that clashed, fixed the direction of the speed-shift term, and corrected the time–temperature check (within ±0.25 min; the worst point is 0.17 min off at 22 °C). I also added the warning code `W_DEV_EXTRAPOLATED`.
> 

### Noteworthy decisions or failures
- The guide's "Proposed contract additions (for CHB-002)" section, where present, is a proposal. It must be reconciled with CHB-002 before implementation.
- Numbers the writer computed for the guide (not from the textbook) are labelled as such in the guide. They are not independently re-verified here.

### Remaining requirements and next action
- Implementation has not started. Tasks in `tasks.md` are open.
- Next: review the guide, settle the open decisions it lists, and start stage 1.
