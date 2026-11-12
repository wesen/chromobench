---
Title: Plan
Ticket: CHB-030
Status: active
Topics:
    - ui
    - agent
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: /home/manuel/code/wesen/chromobench/packages/studio-kit/variants/classic.js
      Note: What a layout is today (plain JS composing ck and cb, with selector and handler functions)
    - Path: /home/manuel/code/wesen/chromobench/packages/dsl/src/session.ts
      Note: The QuickJS sandbox the agent DSL runs in (CHB-007, DR-1 and DR-2)
    - Path: /home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-007--dsl-runtime-quickjs-sandbox-generated-bindings-agent-ergonomics/design-doc/01-intern-guide-dsl-runtime.md
      Note: Sandbox decisions (QuickJS, sync build with deferred promises), handle disposal, interrupt and memory limits
ExternalSources: []
Summary: "Let the AI assistant write and load layouts in the same UI DSL the studio uses, evaluated in the QuickJS sandbox, so it can build the photographer a personal interface."
LastUpdated: 2026-11-12T17:30:00-05:00
WhatFor: "Design and implementation of agent-written layouts."
WhenToUse: "After CHB-029 (layouts as a library of modules, typed host capabilities, layout naming)."
---

# CHB-030 plan: agent-written layouts in the QuickJS sandbox

## Goal

The photographer asks the assistant for a different interface ("just exposure, filtration and grade, with a big
viewer"), and the assistant writes a layout in the same `ck`/`cb` DSL the built-in layouts use, loads it, and
iterates on it with him. The layout is saved and selectable under View ▸ Layout like the built-in ones.

## Why it is hard

A layout today is plain JavaScript, and it is full of functions: state selectors (`s => cb.frame(s)?.print()`,
`txOpts(s => …)`) that the shell evaluates on every relevant store change, and command or button handlers. The
agent DSL runs in QuickJS (CHB-007 DR-1: a WebAssembly interpreter in a worker, only what the host installs, with
interrupt and memory limits). Evaluating a layout there means:

- **Functions crossing the sandbox boundary.** Every selector call is a call into the worker, with arguments and
  results marshalled through QuickJS handles that must be disposed (CHB-007: a leaked handle aborts
  `runtime.dispose()`).
- **Frequency.** Selectors run on store changes; at interactive rates that is many calls per second into an
  interpreter without JIT, across a worker boundary.
- **Synchrony.** The shell expects selectors to return synchronously; the sandbox is in another thread (DR-2:
  synchronous host calls are answered from worker-local data, asynchronous ones through promises).
- **Security.** A layout must not reach storage, the network or the DOM except through the DSL's own components,
  and a bad layout must not break the studio (interrupts, memory cap, a fallback to the default layout).

## Work

1. **Design study.** Decide where layout code runs and how selectors are evaluated: (a) the whole layout in the
   sandbox, with the shell calling selectors over the boundary (batched per store change, results cached by input
   version); (b) the sandbox *builds* the layout once and selectors are restricted to a declarative path language
   that the shell evaluates natively (e.g. `cb.frame.print` instead of `s => cb.frame(s)?.print()`), with handlers
   being command ids. Measure (a) with a prototype; write the decision record.
2. **The layout API surface for agents:** what of `ck`/`cb` is exposed, as generated bindings with documentation
   the agent reads (as CHB-007 does for the recipe DSL), with the typed host capabilities of CHB-029 (item 1).
3. **Loading and lifecycle:** a "Load Layout" path (the CHB-028 "Load Variant" task folds in here), validation and
   an explain report before mounting, hot replacement, a fallback to the default layout on failure, saving
   agent-written layouts in the library (KV) and listing them under View ▸ Layout.
4. **Agent tools:** `layout.write(code)`, `layout.preview()`, `layout.explain()`, `layout.save(name)`, playbook
   "make a simpler layout" with tests on the mock engine.
5. **Safety tests:** escape attempts, runaway selectors, memory blow-ups, a layout that throws during build or at
   runtime; the studio stays usable in every case.
6. **Acceptance:** in a cosplay session the photographer persona asks for a simpler interface and gets one that
   works, through the chat.

## Depends on

CHB-029 items 1 (typed host capabilities), 4 (modules as a library: an agent composes library parts rather than
importing other layouts), 7 (typed state) and 9 (layout naming).
