---
Title: 'Diagnostics and bug reports: spec'
Ticket: CHB-038
Status: active
Topics:
    - ui
    - webgpu
    - architecture
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T14:14:26.119265-05:00
WhatFor: ""
WhenToUse: ""
---

# Diagnostics and bug reports: spec

## Executive Summary

<!-- Provide a high-level overview of the design proposal -->

## Problem Statement

<!-- Describe the problem this design addresses -->

## Proposed Solution

<!-- Describe the proposed solution in detail -->

## Design Decisions

<!-- Document key design decisions and rationale -->

## Alternatives Considered

<!-- List alternative approaches that were considered and why they were rejected -->

## Implementation Plan

<!-- Outline the steps to implement this design -->

## Open Questions

<!-- List any unresolved questions or concerns -->

## References

<!-- Link to related documents, RFCs, or external resources -->
# Diagnostics and bug reports

## The need

The owner sees repeated WebGPU errors in his own Chrome that no headless run reproduces (Metal and SwiftShader,
synthetic and real files: 0 errors; `tools/scripts/console-capture.ts`). His father, the photographer, will meet
problems the owner cannot see. Owner's request (2026-11-15): "I get repeated webgpu errors, can we add some proper
logging / debug / bug reporting to the system, so my dad for example can give me proper debugging info (maybe even
including the images, etc...) to check."

Goal: when something goes wrong, the photographer presses one menu item and gets one file he can send; the owner opens
that file in the studio and sees what happened, on the same documents, ideally on the same pictures.

## What to build

1. **One diagnostics journal** (generic, in the shell's headless half, dependency-free apart from values): structured
   events `{ t, level (debug|info|warn|error), source (gpu, engine, worker, decode, ui, command, store, agent, sw,
   app), code?, message, data?, frame? }` in a ring buffer (≈ 3000 events) with **dedupe and counts** (a repeated
   message is one row with ×N, first and last time); subscribers; `explain`. The tail (last ≈ 500 events and every
   error) is persisted in the studio KV so a report after a crash or reload includes the previous session.
2. **Capture**, everywhere errors happen today:
   - `console.error/warn` (wrapped, originals still called), `window.onerror`, `unhandledrejection`;
   - **WebGPU**: `device.onuncapturederror` (type, message), `device.lost` (reason, message), error scopes around
     pipeline creation and queue submits when debug is on, labels on pipelines/bind groups/textures so validation
     errors name the kernel and the node; adapter info, limits, features; device recreation events;
   - engines: render requests, aborts, failures, durations per slot (sampled), out-of-memory and fallbacks;
   - the core worker and the decoder (LibRaw) errors; service worker version and update events;
   - commands run (id, args summarised), transactions committed (labels, authors), proposals, layout switches.
3. **The report** (Help ▸ Report a problem…, also from an error badge): a dialog with a description field and
   explicit choices of what to include, saying what each means and its size:
   - always: environment (app version and commit, browser, OS, screen, adapter info/limits/features, engine mode,
     layout, URL options), the journal (with counts), settings;
   - on by default: the open documents (format 3) with their history (the log's entries), the current view state;
   - on by default: previews (the display cut of each open frame as PNG at ≤ 1600 px, and the current viewer
     screenshot);
   - off by default: the original source files (sizes shown; the photographer decides);
   - output: one `.zip` (`chromobench-report-<date>-<short>.zip`; a small store-only zip writer with CRC32 if none
     exists) with a `report.json` manifest and a human-readable `README.txt` summary; plus "Copy summary" (text) for a
     quick message.
4. **Error badge and Diagnostics panel**: an unobtrusive status indicator when errors occurred (count), opening a panel
   with the journal (filter by level/source, copy, clear), from which the report starts.
5. **Reopening a report** (for the owner): File ▸ Open report… (or dropping the zip) shows the environment and the
   journal, and opens the documents with their history on the included originals (or on the previews as stand-ins,
   marked), so the problem can be reproduced; `?debug` turns on verbose capture (GPU error scopes, timings).
6. **The agent** reads the journal through the workbench (`wb.diagnostics()`), so an assistant can help diagnose.
7. **Privacy**: reports are created only by an explicit action, stay on the machine until the photographer sends the
   file himself, originals are opt-in, and the dialog says plainly what is inside. Nothing is uploaded anywhere.

## Then: the WebGPU errors

With capture in place, reproduce the owner's errors (ask the owner to run the build and save a report, or use the
journal's text), fix the cause, and add a regression test.

## Acceptance

typecheck, lint, gen:check, vitest, browser specs (headless; ports 5531–5534): the badge appears on an injected GPU
error and a duplicate increments the count; a report zip contains the chosen parts and nothing else; a report reopens
with its documents and history; persistence across reload; `wb.diagnostics()`.
