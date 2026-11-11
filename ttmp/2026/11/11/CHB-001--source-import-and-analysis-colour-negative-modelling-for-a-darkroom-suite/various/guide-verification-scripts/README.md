---
Title: "Guide verification scripts (writer agents, CHB-002..CHB-015)"
Ticket: CHB-001
Status: active
Topics:
    - color-science
    - film-emulation
    - image-pipeline
    - js-api
    - product
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Subagent-authored reference stored for CHB-001"
LastUpdated: 2026-11-11T11:32:25-05:00
WhatFor: ""
WhenToUse: ""
---

# Guide verification scripts (writer agents, CHB-002..CHB-015)

These are the small scripts the seven intern-guide writers ran to check or derive numbers while writing the guides. They are copied unchanged from the session scratchpad (`scratchpad/guides/`), which is not persistent.

Several writers shared that folder, so ownership is mixed. Each ticket's diary (Step 2 onward, written by its writer) names the scripts that writer ran and the numbers they produced. The writers' own summaries attribute these:

| Scripts | Writer pair | Purpose |
|---|---|---|
| `enlarger.py`, `printchain.py`, `extra.py`, `strip.py`, `fade.py` | CHB-010 / CHB-015 | Re-derive textbook §2.6 enlarger Jacobians, filter factors, multi-exposure and test-strip numbers, fading |
| `out_numbers.py` | CHB-005 / CHB-011 | Grey-card encodings per output space, paper white/black, knee values, tiling overheads, CRC vectors |
| `spike/*.mjs` | CHB-002 / CHB-007 | quickjs-emscripten 0.32.0 spike (sync vs asyncify, interrupts, memory limit, toString) |
| `gold200_check.py`, `base_rank.py`, `leakage.py` | CHB-006 / CHB-013 (likely) | Gold 200 rebate, σ and shadow floors; stock ranking from the rebate; LED leakage fit |
| `check_k.js`, `check_dir.js`, `check_red.js`, `check_white.py`, `fit_push.py`, `nan_effect.py`, `neutral_law.py`, `upstream_vs_cg.py`, `crosscheck.py`, `vc_toy.py`, others | CHB-003 / CHB-012 and CHB-004 / CHB-014 (see diaries) | K matrices, DIR, CAT16, push fits, NaN convention, neutral reproduction, prototype vs upstream data, VC paper toy |

**Inputs:**
- `data.json` and `fbdata/` hold Filmbench's embedded spektrafilm data, decoded by the writers. Equivalent output comes from `scripts/06-decode-filmbench-film-data.py`.
- The `r*.json` files are intermediate results.

**What was not copied:**
- the guide drafts, which are identical or near-identical to the filed guides;
- the downloaded npm tarballs and packages for QuickJS;
- third-party PDFs and their text extractions (a Kodak datasheet, papers);
- caches.

**Running them:** scripts expect their inputs in the working directory, as in the original folder. Run with `python3 -I` or `node`. They are evidence of how numbers were obtained, not maintained tools.
