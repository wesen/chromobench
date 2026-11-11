---
Title: Diary
Ticket: CHB-006
Status: active
Topics:
    - ingest
    - image-pipeline
    - color-science
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:23.232498737-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-006 and CHB-013 (ingest and calibration). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-ingest-and-scan-conditioning.md` (13764 words), added 20 staged tasks, and related the primary source files.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Requested milestone: a complete intern guide plus a task breakdown for this ticket.
**Inferred user intent:** The ticket can be picked up by a new engineer or agent without prior context.

### Evidence and commits
- Brief: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md` (session scratchpad); shared map: CHB-001 `design-doc/01-chromobench-architecture-and-work-plan.md`.
- Filed with `python3 -I CHB-001/scripts/07-ingest-intern-guides.py <agent output> .` and checked with `scripts/08-check-guide-markdown.py` (fences tagged, no raw HTML).
- Writer agent: one background general-purpose agent for CHB-006 + CHB-013; it ran small read-only scripts in the session scratchpad to recompute Gold 200 numbers.
- The writer's own summary, kept as returned:

> Summary: below are both guides in the brief's block format.
> 
> - **CHB-006** is about 9,500 words. It covers:
>   - TIFF/PNG16/LinearRaw DNG decoders, with Chromogen's three named bugs fixed and five more found while reading.
>   - LibRaw WASM in a worker, in scan mode and photo mode.
>   - The conditioning stages: flat field, open gate, flare, rebate, σ, base classes, the σ₃ map and stock ranking.
>   - Dust detection and healing in density, as a JS reference plus WGSL kernels.
> 
>   Several numbers come from small scripts I ran in the scratchpad that re-implement Chromogen's `loadSample`, `region`, `rebate` and `sigmaD`. The textbook's Gold 200 values reproduce: T_reb = (0.121, 0.679, 0.214), σ = (0.0090, 0.0069, 0.0122) at full size and (0.0043, 0.0033, 0.0057) at 640 px, and the shadow floors. The scripts also give new figures:
>   - the automatic percentile rebate sits 0.047, 0.056 and 0.062 D lighter than the picked box;
>   - a pixel traced end to end flips from "below base" to "blank";
>   - stock bases read through the illustrative X-T5 channels sit 0.02 to 0.10 D apart.
> 
>   The guide states that these were computed for the guide.
> - **CHB-013** is about 7,500 words. It branches on four setups (LED triplet, white light with a camera, dedicated scanner, flatbed) and covers the capture kit, the photometric and spectral fits, verification by the textbook's laws, advice derived from conditioning, and the beta plan.
> - **LibRaw research:** `libraw-wasm` (ybouane), its maintained fork `@colorhythm/libraw-wasm` with a getter API and LGPL 2.1/CDDL 1.0 licensing, LibRaw 0.22.3, and the LibRaw data structures. Both guides cite these.
> - **Contract additions for CHB-002** are proposed explicitly in both guides. The main ones are `SourceRef`, `SourceInfo`, `DecodeOptions`, `ScannerForward` and `ScannerModel`, sensor coordinates for stored boxes and spots, the ops listed in each guide, and a split of `classify` between ingest and CHB-003.
> 

### Noteworthy decisions or failures
- The guide's "Proposed contract additions (for CHB-002)" section, where present, is a proposal. It must be reconciled with CHB-002 before implementation.
- Numbers the writer computed for the guide (not from the textbook) are labelled as such in the guide. They are not independently re-verified here.

### Remaining requirements and next action
- Implementation has not started. Tasks in `tasks.md` are open.
- Next: review the guide, settle the open decisions it lists, and start stage 1.
