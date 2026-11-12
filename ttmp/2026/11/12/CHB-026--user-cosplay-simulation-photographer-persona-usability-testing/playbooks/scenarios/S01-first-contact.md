---
Title: "S01 First contact: a day's shoot from the D750"
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
Summary: "Open a handful of NEFs for the first time and get normal-looking photos."
LastUpdated: 2026-11-12T13:45:00-05:00
WhatFor: "A cosplay scenario brief; follow with the session protocol."
WhenToUse: "Assigned to a tester."
---

# S01 First contact: a day's shoot from the D750

**In his words:** "My son says this does everything Lightroom does. Let's see. I'll put in yesterday's pictures."

**Setup:** a fresh port; start at `/` (persistent storage, never used). Copy 8558, 8559, 8562, 8536, 8541 to
`.playwright-mcp/photos/`.

**What he does**
1. Looks at the empty app for a few seconds and decides where to click. Record what he reads first and what
   he thinks it means (the empty state, the buttons, the checkboxes).
2. Opens **one** photo, the easiest (8559, daylight truck). Does it look like his photo?
3. If it looks wrong, he tries to fix it *without* help: menus, checkboxes, opening it again, reloading.
4. Opens the rest, **all at once** (multi-select in the file dialog, or "Open folder…").
5. Flips through them (filmstrip, arrow keys) and says which look right and which don't.

**Mistakes to make:** open before reading anything; open the same photo twice; reload when it looks stuck.

**Measure:** time from choosing the file to the first picture, per file; stalls during multi-file open; whether
the window stays usable while files load.

**Answer:** Could he get from "nothing" to "my five photos, looking normal" alone? How long did it take? Which
words on screen did he not understand?
