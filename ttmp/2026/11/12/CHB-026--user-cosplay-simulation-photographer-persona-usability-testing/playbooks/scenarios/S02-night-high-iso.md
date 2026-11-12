---
Title: "S02 Night street at very high ISO"
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
Summary: "Make dark, noisy night photos look good."
LastUpdated: 2026-11-12T13:45:00-05:00
WhatFor: "A cosplay scenario brief; follow with the session protocol."
WhenToUse: "Assigned to a tester."
---

# S02 Night street at very high ISO

**In his words:** "The fire truck at night. ISO 5000, it'll be noisy. I want the red to glow and the shadows not
to be mud."

**Setup:** a fresh port. Files: 8655 (fire truck, ISO 5000), 8687 (ISO 8000, portrait orientation), 8536 (ISO 2000,
1/30). Open them **as photos** (find out how).

**What he does**
1. Opens the three files. Checks orientation of 8687 (shot in portrait).
2. On 8655: brightens it (exposure/time, "Lighter"), then tries to lift only the shadows; looks for a noise
   control; tries to make the red richer without the street lights clipping.
3. Zooms in to 100 % to judge the noise and sharpness. Can he?
4. Compares before/after (`\` or the Before/after tool).
5. Uses what he did on 8655 for 8687 (sync / apply to selection / copy-paste settings).

**Mistakes to make:** push brightness far too high, then undo several times; type "+2" into a field expecting
"2"; switch photo while it is still rendering.

**Measure:** slider drag stalls; time for a release to show; render time when switching photo.

**Answer:** Is there anything for noise? Do the darkroom controls (time, grade, filtration) let him do what
Lightroom's Exposure, Shadows and Vibrance would? What did he miss most?
