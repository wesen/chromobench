---
Title: "S04 Portrait orientation, crop and straighten"
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
Summary: "Rotation from EXIF, cropping to a print format, straightening."
LastUpdated: 2026-11-12T13:45:00-05:00
WhatFor: "A cosplay scenario brief; follow with the session protocol."
WhenToUse: "Assigned to a tester."
---

# S04 Portrait orientation, crop and straighten

**In his words:** "Some of these are upright pictures. And I want an 8×10 print of the morning one, a bit
tighter."

**Setup:** a fresh port. Files: 8521 (270°), 8553 (90°), 8552 (270°), 8554 (landscape). Open as photos.

**What he does**
1. Checks every frame is the right way up in the filmstrip, the main view and the navigator.
2. Crops 8553 to 8×10 (4:5), then changes his mind to 5×7, then back; straightens it by a degree.
3. Exports it and checks the exported file's orientation and size.

**Mistakes to make:** rotate the wrong way first; crop, then undo, then redo; type a crop ratio like `8x10`.

**Measure:** time for a crop change to show.

**Answer:** Is orientation right everywhere? Can he crop at all (where)? Does the export match what he saw?
