---
Title: "S05 A real colour negative strip"
Ticket: CHB-026
Status: active
Topics:
    - ui
    - product
    - testing
DocType: playbook
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Invert and print a real 3-frame colour negative DNG."
LastUpdated: 2026-11-12T13:45:00-05:00
WhatFor: "A cosplay scenario brief; follow with the session protocol."
WhenToUse: "Assigned to a tester."
---

# S05 A real colour negative strip

**In his words:** "This is an old negative strip I digitised: three pictures on one strip. Make me prints, like
in the darkroom."

**Setup:** a fresh port, **never** opened `raw010.dng` before (see finding F3). File: `raw010.dng`.

**What he does**
1. Opens it **as a negative** (find out how; the default may differ).
2. Does the app find the three frames, or show the whole strip? Can he print one frame?
3. Gets a good print: time and grade for density and contrast, filtration for colour, test strip.
4. Looks at the "Negative", "Dyes" and "Base & gamut" tabs: do they mean anything to him?
5. Exports one frame as a TIFF for printing.

**Mistakes to make:** first open it with "photo" ticked (if that box is still there), then try to correct the
mistake *without* `?fresh`; record exactly what happens.

**Measure:** open time (the DNG is decoded on the main thread; S01 measured a 6.7 s freeze); render time per
change.

**Answer:** Could he get a print from his negative at all? Was the inversion right (no orange cast, sensible
density)? What did the jargon in the status line do to his confidence?
