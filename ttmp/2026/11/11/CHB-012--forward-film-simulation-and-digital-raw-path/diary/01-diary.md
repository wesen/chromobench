---
Title: Diary
Ticket: CHB-012
Status: active
Topics:
    - film-emulation
    - color-science
    - image-pipeline
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:25.510562737-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-003 and CHB-012 (physics). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-forward-film-simulation-and-digital-raw-path.md` (11754 words), added 14 staged tasks, and related the primary source files.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Requested milestone: a complete intern guide plus a task breakdown for this ticket.
**Inferred user intent:** The ticket can be picked up by a new engineer or agent without prior context.

### Evidence and commits
- Brief: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md` (session scratchpad); shared map: CHB-001 `design-doc/01-chromobench-architecture-and-work-plan.md`.
- Filed with `python3 -I CHB-001/scripts/07-ingest-intern-guides.py <agent output> .` and checked with `scripts/08-check-guide-markdown.py` (fences tagged, no raw HTML).
- Writer agent: one background general-purpose agent for CHB-003 + CHB-012; it re-implemented key steps in scratch scripts to reproduce textbook K matrices, the §3.3 LM trace, DIR numbers, M_D55 and #70757b; spektrafilm cited at upstream commit 3bb2c2d.
- The writer's own summary, kept as returned:

> Both intern guides are finished and revised: CHB-003 (about 13.2k words) and CHB-012 (about 11.7k words). Each is below in the brief's block format with its TASKS and RELATED blocks.
> 
> - **Checks against the data:** I re-implemented the key steps independently on the existing data. The scratch scripts are in /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/. They reproduce the textbook's K matrices, its four-row K-construction error table, the §3.3 Levenberg–Marquardt trace and the shadow-pixel result, its DIR numbers, the CAT16 matrix M_D55 and #70757b.
> - **Values that are not in the textbook:** the push-profile fits, the moderate-red DIR trace and the base-weighted K and start are marked "derived" in the guides.
> - **Upstream code:** spektrafilm is cited at commit 3bb2c2d.
> - **Open decisions:** these are recorded in each guide's risks section:
>   - which conventions reproduce 0.755;
>   - the default viewing illuminant;
>   - the default RAW white balance;
>   - what "digital RAWs" means;
>   - the source for the time/temperature push mapping;
>   - the licence of the 192² spectra table.
> 
> Both guides end with a "Proposed contract additions (for CHB-002)" section. Source files, kept in case anything was lost in transcription: /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb003.md and /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb012.md.
> 

### Noteworthy decisions or failures
- The guide's "Proposed contract additions (for CHB-002)" section, where present, is a proposal. It must be reconciled with CHB-002 before implementation.
- Numbers the writer computed for the guide (not from the textbook) are labelled as such in the guide. They are not independently re-verified here.

### Remaining requirements and next action
- Implementation has not started. Tasks in `tasks.md` are open.
- Next: review the guide, settle the open decisions it lists, and start stage 1.
