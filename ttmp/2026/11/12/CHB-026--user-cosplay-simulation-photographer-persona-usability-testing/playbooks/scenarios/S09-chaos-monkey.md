---
Title: "S09 Chaos monkey: the user does everything wrong"
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
Summary: "Deliberate misuse, to find crashes, stuck states and lost work."
LastUpdated: 2026-11-12T13:45:00-05:00
WhatFor: "A cosplay scenario brief; follow with the session protocol."
WhenToUse: "Assigned to a tester."
---

# S09 Chaos monkey: the user does everything wrong

**In his words:** none. He is tired, in a hurry, and clicks too much.

**Setup:** a fresh port. Files: 8559, 8541, raw010.dng.

**What he does** (in any order, keep notes of the order):
- Open the same file twice, at once and one after the other; open a negative as a photo and a photo as a
  negative; try to undo the wrong open.
- Drag sliders fast back and forth for 10 s; press Ctrl+Z 20 times quickly, then Ctrl+Shift+Z 20 times.
- Type into every number field: `0`, `-0`, `-5`, `1e9`, `abc`, `½`, `7,5`, empty, a very long string.
- Switch photos while rendering; switch the layout (top-right "Layout") during a drag; reload during an open.
- Double-click everything that looks clickable; right-click thumbnails, the image, the panels (then Escape:
  Chrome's own menu stays open).
- Press Escape, Enter, Delete and Backspace with a frame selected; press F1 to F12.

**Measure:** stuck states (a status that never clears, a spinner that never stops), uncaught errors (the console
and the probe's toasts), the UI log, stalls over 1 s.

**Answer:** List every way he got stuck and how he got out (or didn't). Did he lose any work?
