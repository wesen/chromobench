---
Title: 'Design system: CraftKit tokens and app styling as the default theme, switchable at runtime'
Ticket: CHB-025
Status: active
Topics:
    - ui
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://e2e/theme.spec.ts
      Note: runtime switch, host frame and persistence in the app
    - Path: repo://packages/shell/src/app/builtins.ts
      Note: view.theme.* and view.gray.* commands
    - Path: repo://packages/shell/src/dom/theme.ts
      Note: themeHandle writes tokens on the theme root
    - Path: repo://packages/shell/src/themes/craftkit.ts
      Note: CraftKit theme (default) as data, grays 1-4, pending token
    - Path: repo://packages/shell/src/themes/tokens.ts
      Note: 'themeTokens/resolveTheme: tokens for scheme and gray'
    - Path: repo://packages/studio-kit/src/dom/studio-kit.css
      Note: CraftKit app styling ported onto studio-kit components
    - Path: repo://tools/scripts/check-colours.ts
      Note: 'lint: no literal colours outside theme files'
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-12T10:04:29.915261342-05:00
WhatFor: ""
WhenToUse: ""
---

# Design system: CraftKit tokens and app styling as the default theme, switchable at runtime

## Overview

<!-- Provide a brief overview of the ticket, its goals, and current status -->

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- ui

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
