---
Title: "S10 The next day: coming back to yesterday's work"
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
Summary: "Persistence and recall across sessions."
LastUpdated: 2026-11-12T13:45:00-05:00
WhatFor: "A cosplay scenario brief; follow with the session protocol."
WhenToUse: "Assigned to a tester."
---

# S10 The next day: coming back to yesterday's work

**In his words:** "I worked on the truck picture yesterday. Where is it?"

**Setup:** a fresh port and a **persistent** browser profile (option B in the protocol, or keep the MCP
browser open). Day 1: open 8559 and 8562 as photos, edit both, flag one as a pick, make a snapshot. Close
the tab/browser. Day 2: open the app again.

**What he does**
1. Day 2: looks for yesterday's photos without opening files. "Reopen <folder>"? Library? History?
2. Opens 8559 again from disk: are yesterday's edits back? Is the history there? The snapshot? The flag?
3. Opens a photo he did not edit yesterday: does it get yesterday's settings by mistake?
4. "Save recipe": what is it, where does it go, can he load it back?

**Answer:** What survives a restart, and what doesn't? Does he understand why?
