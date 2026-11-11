---
Title: Diary
Ticket: CHB-015
Status: active
Topics:
    - film-emulation
    - color-science
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:26.575162293-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-010 and CHB-015 (darkroom printing and extensions). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-extensions.md` (8657 words), added 13 staged tasks, and related the primary source files.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Requested milestone: a complete intern guide plus a task breakdown for this ticket.
**Inferred user intent:** The ticket can be picked up by a new engineer or agent without prior context.

### Evidence and commits
- Brief: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md` (session scratchpad); shared map: CHB-001 `design-doc/01-chromobench-architecture-and-work-plan.md`.
- Filed with `python3 -I CHB-001/scripts/07-ingest-intern-guides.py <agent output> .` and checked with `scripts/08-check-guide-markdown.py` (fences tagged, no raw HTML).
- Writer agent: one background general-purpose agent for CHB-010 + CHB-015.
- The writer's own summary, kept as returned:

> Both guides are written and revised. The drafts are kept at /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb010.md (about 11,600 words) and /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/chb015.md (about 8,600 words). The verification scripts are in the same folder: enlarger.py, printchain.py, extra.py, strip.py and fade.py. They run on the spektrafilm data embedded in Filmbench, decoded to data.json in that folder.
> 
> Main findings:
> - **Textbook numbers check out.** I re-derived the §2.6 ∂x/∂v matrices, with and without normalisation, from the decoded data. They agree to four decimals; the only exception is G/Y, which comes out −0.0015 against the textbook's −0.0016. The grey card's paper dyes (0.665, 0.548, 0.499) and paper slopes (2.36, 1.98, 1.95) also match.
> - **Real-mode filter factors match Kodak's guidance.** To restore the grey card's visual density, 10 M needs ×1.119 more time, 10 Y ×1.039 and 10 C ×1.080. Kodak's E-4020 datasheet gives about 1 % per unit of magenta and says yellow changes are negligible.
> - **Normalised mode does not hold visual density.** Adding 10 Y darkens the normalised print by 0.053.
> - **Global split filtration on colour paper is almost one filtration.** It deviates from a single equivalent exposure by at most 0.48 points.
> - **A flash must go through the film base.** An open-gate flash with the neutral pack fogs the print orange-red: (−8.6, +1.5, +7.0) points of colour.
> - **The Jacobian preview for filter changes is accurate.** Its error is at most 0.37 points for 10 M and 0.62 points for 20 M + 20 Y. The two plausible buggy variants of the preview err by 1.2–6.2 points, so the parity test can tell them apart.
> - **Chromogen's log-domain burns are wrong at feathered edges.** At mask 0.5, a one-stop burn should add 0.176 log H (the linear sum); Chromogen adds 0.151.
> - **Printer lights cannot fix fading.** For a fade of k = (0.70, 0.90, 0.85), lights fitted at the grey card leave about 5.5 ΔE*ab at the white and black patches, as crossover.
> - **The DIR-aware inverse needed for reprinting is a well-posed 3×3 solve.** By the Gale–Nikaidô theorem it is injective given the slope bounds checked on Portra 400.
> - **The contract catalog has a conflict.** It puts `finishing` ops on `display-rgb`, which is after the gamut knee. The CHB-015 guide proposes moving them before `output.display`.
> 
> Limits of the evidence:
> - I could not open Wilhelm's book. The fading facts are cited from Anderson & Ellison (JAIC 1992), CCI Note 16/5, Gschwind & Frey (1994) and Chatterjee et al. (Heritage 2023); Wilhelm is cited only as the general survey.
> - I did not verify Ctein's highlight-mask procedure against the book. The guide says to check it before choosing defaults.
> - Chromogen's claim that its learned estimator has "half the error" of integrate-to-grey cannot be checked: its design document is not in the project.
> - Newson-grain cost on WebGPU is an extrapolation from the paper's CPU timings and is marked unmeasured.
> 

### Noteworthy decisions or failures
- The guide's "Proposed contract additions (for CHB-002)" section, where present, is a proposal. It must be reconciled with CHB-002 before implementation.
- Numbers the writer computed for the guide (not from the textbook) are labelled as such in the guide. They are not independently re-verified here.

### Remaining requirements and next action
- Implementation has not started. Tasks in `tasks.md` are open.
- Next: review the guide, settle the open decisions it lists, and start stage 1.
