---
Title: 'User cosplay simulation: photographer persona usability testing'
Ticket: CHB-026
Status: complete
Topics:
    - ui
    - product
    - ingest
    - testing
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'User-cosplay usability testing: agents play the photographer (Manfred) on his real photos, keep a diary and an experience report, and file findings.'
LastUpdated: 2026-11-15T17:48:54.832611-05:00
WhatFor: ""
WhenToUse: ""
---


# User cosplay simulation: photographer persona usability testing

## Overview

Usability testing by **cosplay**: an agent plays the real target user, Manfred (a photographer, the owner's
father), on his real Nikon D750 photos and a real negative strip, makes his mistakes, measures responsiveness,
and writes a diary plus a first-person experience report with developer commentary.

- Start here: [session protocol](playbooks/01-cosplay-session-protocol.md), [persona](reference/01-persona-manfred.md),
  [test material](reference/02-test-material.md), [scenarios S01–S10](playbooks/scenarios/).
- Results: [findings F1–F16](various/02-findings.md), [session 01 experience report](various/01-experience-report-session-01.md),
  [diary](diary/01-diary.md).
- Probes: [scripts/01-install-probe.js](scripts/01-install-probe.js), [scripts/02-read-probe.js](scripts/02-read-probe.js).

Session 01 found three blockers (a digital RAW opens as a negative; re-open is a silent no-op; a file's first
open mode sticks to its hash forever) and a major performance problem (the CPU engine freezes the window
for about 2 s per preview).

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **complete** (2026-11-15, CHB-044 triage): every task done or obsolete; the findings became CHB-027 and CHB-031, and persona sessions now follow each user-visible change.

## Topics

- ui
- product
- ingest
- testing

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- design/ - Architecture and design documents
- reference/ - Prompt packs, API contracts, context summaries
- playbooks/ - Command sequences and test procedures
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
