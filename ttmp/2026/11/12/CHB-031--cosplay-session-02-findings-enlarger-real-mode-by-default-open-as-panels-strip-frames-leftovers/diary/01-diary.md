---
Title: Diary
Ticket: CHB-031
Status: active
Topics:
    - ui
    - product
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-12T17:06:19.617452823-05:00
WhatFor: ""
WhenToUse: ""
---

## Step 1: Ticket from cosplay session 02

Session 02 (a Sonnet tester re-running session 01 against main 3703d0a) confirmed 11 of the 16 session-01
findings fixed and found seven new ones (F17–F23, CHB-026 `various/02-findings.md`, session 02 section). The most
important: Time and Aperture are inert in the default enlarger mode `normalised`. The owner accepted the
recommendation: real mode by default for the darkroom-style layouts, normalised (with Time and Aperture hidden) as an
option and the default of the simple layouts, after verifying the test strip and the first print.

### Prompt Context
**User prompt (verbatim):** "1. what's the advantage of normalized and hiding?" (answered with a comparison), then "ok. \n\nwhat's next?"
**Assistant interpretation:** "ok" accepts the recommendation; next is the follow-up ticket and closing CHB-027.
**Inferred user intent:** The darkroom controls should do what they say.
**Commit (code):** N/A (planning).

### What I did
- `docmgr ticket create --ticket CHB-031`; 11 tasks (F17 split into verify / real default / normalised option;
  F18–F23; the partly fixed F8, F9, F12 and F10 on the CPU; a session-03 re-run).

### Why
- CHB-027's scope was the session-01 findings; the new ones get their own ticket and acceptance re-run.

### What worked
- N/A.

### What didn't work
- N/A.

### What I learned
- `packages/core/src/print/enlarger.ts`: "Real mode: the setting's optics … Normalised mode ignores them."
  `packages/contract/src/catalog/capture-film-print.ts`: `mode` default `normalised`.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Changing the default enlarger mode changes how saved recipes print (they store `mode` explicitly, so existing
  logs keep theirs; new recipes get the new default). Check `defaultRecipe` and the first print.

### What should be done in the future
- Coordinate with CHB-029 (both touch `cb.ts` and the controls panels).

### Code review instructions
- N/A.

### Technical details
- Owner decision recorded here: real mode default for classic/darkroom/lab; normalised default for simple/tiny.
