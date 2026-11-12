---
Title: "S06 Sorting and batch: picks, rejects, sync"
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
Summary: "Library work across many frames."
LastUpdated: 2026-11-12T13:45:00-05:00
WhatFor: "A cosplay scenario brief; follow with the session protocol."
WhenToUse: "Assigned to a tester."
---

# S06 Sorting and batch: picks, rejects, sync

**In his words:** "Thirty pictures from three days. I want to throw out the bad ones, mark the good ones and
give the daylight ones the same look."

**Setup:** a fresh port. Copy **all 33** NEFs (about 1 GB; check disk space first). Use "Open folder…" if
it works with the copied folder, otherwise multi-select.

**What he does**
1. Opens all of them. Watches what the app does while 33 RAWs load: can he already work on the first?
2. Library: grid view, flags picks (P) and rejects (X), filters by picks, searches by name.
3. Edits one daylight frame, then applies the same to all daylight picks.
4. Reloads the page (as if the next day): are the flags and edits still there?

**Mistakes to make:** reject the wrong one and undo it; select several and change a slider (does it apply to
all or one?).

**Measure:** total load time for 33 files; memory if visible (DevTools is out of character; note only if it
crashes); stalls while scrolling the grid during loading.

**Answer:** Does the library work for a real shoot? What did he lose on reload?
