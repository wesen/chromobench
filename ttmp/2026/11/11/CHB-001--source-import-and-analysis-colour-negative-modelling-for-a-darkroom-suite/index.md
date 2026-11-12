---
Title: 'Source import and analysis: colour-negative modelling for a darkroom suite'
Ticket: CHB-001
Status: complete
Topics:
    - color-science
    - film-emulation
    - image-pipeline
    - js-api
    - product
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cv/graph/registry.go
      Note: Op registry/ArgSpec schema that generates the JS API
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/gojamod/cv/module.go
      Note: goja-cv module registration, pattern for the chromobench JS API
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/Filmbench IDE.html
      Note: Forward-simulation IDE with agent, source of the bench/rig/ctl/ws/lab API
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/The Mathematics of the Colour Negative.md
      Note: Primary theory source (4 chapters, inversion and forward model)
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/chromogen-studio-1.2/index.html
      Note: Inversion app (scan to print), source of the solver/table design
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-12T14:44:40.460748369-05:00
WhatFor: ""
WhenToUse: ""
---

# Source import and analysis: colour-negative modelling for a darkroom suite

## Overview

<!-- Provide a brief overview of the ticket, its goals, and current status -->

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- color-science
- film-emulation
- image-pipeline
- js-api
- product

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
