---
Title: 'Real-GPU check on the M1 Max: browser suite on Metal, smoke and timings, post-CHB-027 checks on the GPU engine'
Ticket: CHB-034
Status: active
Topics:
    - gpu
    - testing
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-14T14:38:18.93192-05:00
WhatFor: ""
WhenToUse: ""
---

# Real-GPU check on the M1 Max: browser suite on Metal, smoke and timings, post-CHB-027 checks on the GPU engine

## Overview

First run on the real GPU (M1 Max, Metal), on the Mac itself. The browser suite had only ever run WebGPU on SwiftShader; with `REAL_GPU=1` it runs on Metal (100 of 106 pass; 6 GPU-parity tolerances tuned on SwiftShader fail, the preview tables through hardware filtering differ from core by up to 0.86 of an 8-bit level). The GPU engine works: Time drags settle in 0.2 s at 4000 px (CPU 1.2 s at 640 px), first print and strip frames match the CPU engine on the private photos, the interface checks pass on it. Specs now use ControlOrMeta so the suite passes on macOS. Open: one decision (preview lookup), a typed-entry race, a 200 ms stall per GPU open. Read `diary/01-diary.md`.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- gpu
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
