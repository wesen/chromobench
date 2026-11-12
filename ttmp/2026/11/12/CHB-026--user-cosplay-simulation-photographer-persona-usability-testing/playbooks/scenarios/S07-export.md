---
Title: "S07 Export for sharing and for printing"
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
Summary: "JPEG for e-mail, TIFF for the lab; where do files go."
LastUpdated: 2026-11-12T13:45:00-05:00
WhatFor: "A cosplay scenario brief; follow with the session protocol."
WhenToUse: "Assigned to a tester."
---

# S07 Export for sharing and for printing

**In his words:** "Send the truck picture to my son by e-mail, and a big file to the print shop."

**Setup:** a fresh port. Files: 8559, 8655. Open as photos; make one small edit on each.

**What he does**
1. Looks for "Export" (top bar, File menu, Output module). Which does he find first?
2. Exports a small JPEG for e-mail. If there is no JPEG option, what does he do?
3. Exports a 16-bit TIFF for the lab in a colour space the lab would want (he doesn't know what "ProPhoto"
   means; does the app help?).
4. Exports both photos at once.
5. Finds the files afterwards (Downloads folder or file picker), checks the names and sizes.

**Mistakes to make:** click Export twice quickly; switch photo during an export; cancel the save dialog.

**Measure:** export time per file and stalls during export (full-resolution path).

**Answer:** Could he share a photo? Is the exported image the same as the screen? Are the names sensible?
