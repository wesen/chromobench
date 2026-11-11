---
Title: 'Intern guide: DSL runtime'
Ticket: CHB-007
Status: active
Topics:
    - dsl
    - js-api
    - agent
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cvsession/docs_test.go
      Note: docs executed as tests with info-string tags
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cvsession/processor.go
      Note: result YAML, look delivery, the error block and the context block
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cvsession/tables.go
      Note: compact tables for arrays of flat records
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/gojamod/cv/binding.go
      Note: native binding, deferred evaluation and structured error objects with fixes
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/gojamod/cv/describe.go
      Note: function signatures and doc lines for the context block
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/gojamod/cv/prelude.js
      Note: handle proxies, awaitable nodes and the E_NOT_AWAITED/E_IMMUTABLE rules to port
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-goja-cv.md
      Note: §2–3 agent ergonomics and evidence, §5 what does not transfer
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/01-inline.js
      Note: agent lab, system prompt, runCode, approvals and Revert (lines 4445–4876)
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:23.458024443-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: DSL runtime

## 1. What this ticket is for

Chromobench lets an LLM agent work on the photographer's frames. The agent inspects prints, runs test strips, measures densities, proposes colour corrections and removes dust. It does all of this by sending short JavaScript programs through a single tool, `eval(code)`, and reading back a text result with a few images. CHB-007 builds what runs those programs:

- a **sandbox** that runs untrusted agent code with hard limits on time and memory and nothing else reachable;
- a **prelude** that turns the op registry of CHB-002 into the agent's API: lazy handles on graph nodes, darkroom vocabulary such as `frame.negative()` and `neg.print({…})`, and proxies that turn common LLM mistakes into structured errors;
- **result shaping**: a YAML text capped at 9000 characters, compact tables, at most four images ("looks") each paired with the numbers it shows, a context block, and diagnostics with a literal `fix`;
- **generated documentation**: the reference, the agent instructions and topic pages, with every example executed in CI.

The photographer never sees this language. What the photographer sees:

- the agent's messages and looks in the chat panel, served by CHB-008;
- the agent's proposals as approval cards, shown by CHB-009;
- approved changes in the frame's history, tagged `by: agent`.

The DSL is the agent's view of the same recipe and graph that the UI edits. It is not a second application.

**What this ticket does not do.**

- **Transports** (in-app chat, the Go MCP bridge), system prompts and playbooks belong to CHB-008. CHB-007 provides `DslSession.eval(EvalRequest) → EvalResult` and the text the agent needs: instructions, reference and topics.
- **The approval UI** belongs to CHB-009.
- **Physics** belongs to CHB-003, CHB-005 and CHB-012. The DSL is developed against `engine-mock` from CHB-002 and does not change when the real engines arrive.

**Status.** Everything below is planned. `packages/dsl/` does not exist yet. The design follows goja-cv (`~/code/wesen/go-go-golems/goja-cv` at `5a93095`), which solved the same problem in Go. Where this guide reports behaviour of the QuickJS library, it says whether that behaviour was read from the library's source or type definitions, or observed in a throwaway spike run while writing this guide. The spike used Node 24.18, `quickjs-emscripten-core` 0.32.0 and the 0.32.0 variant packages. "C1" means the CHB-001 ticket directory, `ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`.

## 2. Background you need

### 2.1 What an eval looks like

An agent turn has three parts. The agent writes code, the system runs it, and the agent reads the result. The code is the *body of an async function*, so `await` and `return` work at the top level. Here is a first eval on a scanned negative:

```js
const print = frame.print()                                    // a handle: nothing computed yet
const grey = await print.measure.densitometer({ at: [1210, 860], aperture_px: 15 })
print.look('current print')                                    // queue an image for the agent
return { grey: grey.D, time_s: frame.recipe.print.enlarger.time_s }
```

The agent receives text like the following, plus one image:

```yaml
grey: [0.94691, 0.80154, 0.58235]
time_s: 10
look: '[look 1: current print — frame_0042 print (750×500, 1 px = 4 source px)]'

context:
  frame: frame_0042 · negative-scan · kodak_portra_400 → kodak_portra_endura · mode ask
  changed: none
```

Three habits of LLM agents shape everything that follows. They make the same small mistakes again and again: forgetting `await`, misspelling options, passing points where log exposure is expected. They read numbers off pictures badly. And they rarely open documentation unless an error points them to it. goja-cv measured this behaviour: in one study, 39 annotator agents pasted a helper file into their evals 29 times and none opened the docs (`C1/various/analysis-goja-cv.md` §2.10). The DSL therefore answers mistakes with errors that contain the corrected code, pairs every image with its numbers, and reports what the agent has defined, without being asked.

### 2.2 Why a sandbox

Agent code is untrusted. That is not an accusation against the agent. The model can make mistakes, and text it reads can steer it: a file name, a note in a recipe, or a pasted message can contain instructions. Whatever the agent's code does must therefore stay inside limits that the host enforces, not limits that the agent respects.

Filmbench IDE, the prototype with an agent, shows what happens without a sandbox (`C1/various/extracted/filmbench-ide/01-inline.js`):

- **Agent code runs as page JavaScript.** `runCode` (lines 4731–4737) wraps the agent's text in `new AsyncFunction(...)` with the workbench objects in scope. That code can reach `localStorage`, `fetch` and the whole DOM.
- **The timeout does not stop anything.** It is a `Promise.race` against a 25 s timer (line 4734). A `while (true) {}` freezes the page forever.
- **The author tag can be forged.** Agent changes are tagged by setting the global `V2.by = 'agent'` before the call (line 4735), so the agent's code could set it back to `'user'`.
- **Writes outside the log are detected by a regular expression** over the code text (`WRITE_RE`, line 4449). Any indirection defeats it.

The Filmbench report itself calls agent safety there "cooperative only" (`C1/various/analysis-filmbench-ide.md` §6).

### 2.3 QuickJS in WebAssembly

QuickJS is a small JavaScript engine written in C by Fabrice Bellard. Compiled to WebAssembly (WASM) with Emscripten, it runs inside the browser as an ordinary WASM module. The guest program gets its own heap inside the module's memory and sees only the globals the host installs. The library `quickjs-emscripten` wraps the module in a TypeScript API. It is split into a core package, `quickjs-emscripten-core`, and separately installed **variants**, for example `@jitl/quickjs-wasmfile-release-sync`. The current version is 0.32.0, published in February 2026.

These are the concepts you need, all from the 0.32.0 type definitions (`dist/index.d.ts`):

- **A runtime** (`QuickJSRuntime`) is one heap. Limits are set on it:
  - `setMemoryLimit(limitBytes)`: −1 removes the limit;
  - `setMaxStackSize(stackSize)` in bytes: 0 removes the limit;
  - `setInterruptHandler(cb)`: "a callback which is regularly called by the QuickJS engine when it is executing code"; returning `true` stops execution.

  The helper `shouldInterruptAfterDeadline(deadline)` builds a time-based handler. `newRuntime({ memoryLimitBytes, maxStackSizeBytes, interruptHandler })` sets all three at once.
- **A context** (`QuickJSContext`) holds one set of globals inside a runtime. `newContext({ intrinsics })` chooses which built-in language features exist; `DefaultIntrinsics` enables `Date`, `Eval`, `Proxy`, `Promise` and others.
- **Handles.** Every guest value the host touches is a `QuickJSHandle`, which must be disposed. `Scope.withScope(scope => …)` disposes many at once. `vm.evalCode(code, filename)` returns a result whose `.value` or `.error` is a handle. `vm.newFunction(name, fn)` exposes a host function. `vm.dump(handle)` converts a handle to a host value.
- **Promises do not run by themselves.** `vm.newPromise()` returns a deferred whose `.handle` the host can hand to the guest and later `.resolve(...)`. The host must then call `runtime.executePendingJobs()` to run the guest's continuations. `vm.getPromiseState(handle)` reports `pending`, `fulfilled` or `rejected` synchronously.
- **Asyncify variants** (`@jitl/quickjs-wasmfile-release-asyncify`) add `newAsyncifiedFunction`. It lets a synchronous-looking guest call wait on an async host function. Section 5.3 explains why this design does not use it.

### 2.4 Lazy handles and `await` (from goja-cv)

The DSL uses goja-cv's central idea (`C1/various/analysis-goja-cv.md` §1.4, §2.4): **images never cross into JavaScript**.

- A call such as `frame.negative().print({ time_s: 12.6 })` builds graph nodes (CHB-002's hash-consed `Node`) and returns a **handle**, a proxy over a node id. Nothing is computed.
- `await` on a handle produces data:
  - a **Value** node (a measurement) is evaluated at full resolution and returns plain numbers;
  - an **Image** node returns a short summary (domain, size, node id). No pixels are computed, and none are ever handed over.
- Options are literal values. To use a measurement as an option, `await` it first and pass the number.
- Looks are images for the model's eyes. goja-cv's rule is "never make a model read a number off a picture; every look comes with the data it shows" (report §2.8). The rule is kept here.

### 2.5 The parameter question, and how it is resolved

goja-cv once had live parameters. GCV-001 added `P.slider` values with their own cache signatures, which is the GUI-friendly design. Then GCV-004 measured real agent runs: in 751 evals, params and sliders were used **0** times (report §3.6). They were deleted, and literal options plus hash-consing gave the same caching. The report draws the general lesson: **measure what agents use and delete the rest**. It also warns that chromobench needs the opposite trade-off, because human controls are first-class (report §5.1 item 3).

Both observations hold, and this design satisfies both by putting parameters in exactly one place.

1. **The recipe owns every persistent parameter.** CHB-002's `FrameRecipe` holds the exposure time, the lights, the filtration and the rest. The GUI's controls are generated from `ArgSpec.ui` and bound to recipe paths. A drag becomes a mutation.
2. **The DSL has no parameters.** It has literal-option calls, goja-cv style. `neg.print({ time_s: 12.6 })` builds a what-if node and changes nothing.
3. **The DSL writes the recipe the way the GUI does.** `frame.edit({ 'print.enlarger.time_s': 12.6 })` produces the same `set` mutation a slider produces, tagged `by: 'agent'`. It goes through the same validator and the same edit log, subject to ask mode.
4. **`compile(recipe)` turns parameters back into literal-option nodes.** Caching therefore works through hash-consing for both writers.

So there is one parameter store, two writers distinguished by `by`, and a DSL that stays literal. The goja-cv lesson then applies to the *DSL vocabulary and its docs*: instrument evals, and remove what agents do not use (§5.13). It never applies to recipe parameters, because the GUI justifies those.

## 3. How this ticket fits the system

```text
 agent (LLM) ── eval(code) ──► CHB-008 transport (chat panel · MCP bridge)
                                      │ EvalRequest {code, frame, timeoutMs}
                                      ▼
 ┌──────────────── main thread ─────────────────┐        ┌───────────── DSL worker (CHB-007) ─────────────┐
 │ DslSession (facade)                          │ RPC    │ QuickJS WASM module (one runtime, one context) │
 │ host services:                               │◄──────►│ prelude.js + registry tables                    │
 │  · Engine (mock → reference → gpu)           │        │ Graph interner + binder (from contract)         │
 │  · EditLog per frame (arbiter of mutations)  │        │ recipe snapshot of this eval                    │
 │  · library: frames, recipes, provenance      │        │ result shaping (YAML, tables, looks, context)   │
 └──────────────────────────────────────────────┘        └─────────────────────────────────────────────────┘
          ▲ approve / reject (CHB-009 approval cards)
```

**Where the parts run.** The QuickJS module runs in a dedicated Web Worker. This is not mainly about security; QuickJS provides that. It is about responsiveness: QuickJS is an interpreter, and a long eval must not freeze the viewer. The worker holds everything that must answer synchronously:

- the registry tables;
- the graph interner and the argument binder, which are pure functions from `@chromobench/contract`;
- a snapshot of the library's recipes taken when the eval starts.

Only two kinds of request cross to the main thread. Evaluating a node (`await`) is asynchronous. Submitting the eval's edits happens once, at the end. The main thread's `EditLog` is the only arbiter of what the recipe becomes.

**Nodes cross as data.** Node ids are content hashes (CHB-002 §5.7). The worker sends a node's definitions (`Graph.closure(id)`, minus the ones it already sent) with each evaluate request, and the main thread re-interns them with `Graph.adopt`. Both sides compute the same ids, so they never share a mutable graph.

**Dependencies.**

| Ticket | Relationship |
|---|---|
| CHB-002 | Provides the registry, binder, `Graph`, `compile`, `EditLog.propose`, the units, `EvalRequest`/`EvalResult`/`Diagnostic` and `engine-mock`. CHB-007 cannot start without its stages 3–5 |
| CHB-008 | Calls `DslSession.eval`. Owns system prompts and playbooks, and serves CHB-007's instructions and reference as MCP resources |
| CHB-009 | Shows the approval cards built from `EvalResult.mutations` and calls `approve`/`reject` |
| CHB-010 | Adds darkroom vocabulary (test strips, ring-arounds, dodge and burn) through the registry; the DSL picks it up automatically |
| CHB-003, CHB-005 | Replace the mock engine behind the `Engine` interface; no DSL change |

## 4. What exists today and what to take from it

### 4.1 goja-cv

| File and lines | What it shows | Take |
|---|---|---|
| `pkg/gojamod/cv/prelude.js` 1–14 | The rules of the handle proxy: `then` makes nodes awaitable; `Symbol.toPrimitive`/`valueOf` throw `E_NOT_AWAITED`; assignments throw `E_IMMUTABLE`; a data field on a Value node throws `E_NOT_AWAITED`; an unknown member throws `E_UNKNOWN_METHOD`; a node passed as an option is `E_ARG_TYPE` | All of it |
| `prelude.js` 18–35 | Method tables come from `native.__registry()`; dotted names become namespaces (`img.mask.luminance`) | The same, with tables filtered by domain (§5.7) |
| `prelude.js` 39, 42, 217–224 | `PROBES` (`constructor`, `inspect`, `$$typeof`, …) pass through so console/JSON code does not crash; a `proxies` map makes hash-consed nodes `===` | Both |
| `prelude.js` 66–77, 84–87 | `marshal`: nodes become `{__cvnode: id}`; `callOp` returns handles | The same, with JSON strings across the boundary |
| `prelude.js` 89–111 | Builder lambdas (`within(mask, i => …)`) run once at build time on a placeholder | Not needed in v0: dodge and burn are recipe exposures (§6 E6) |
| `prelude.js` 140–189 | `lookup`: `then` evaluates Value nodes and gives a summary for Images; `toString`/`toJSON` give labels; `look()` queues a look | All of it |
| `pkg/gojamod/cv/binding.go` 72–97 | A Go error becomes a JS `Error` whose `name` is the code, with `code/path/hint/fix/valid` properties | The same shape |
| `binding.go` 247–288 | `__evaluate`: an Image resolves at once to a summary; a Value is evaluated on another goroutine and the promise is settled back on the owner | The deferred-promise pattern (§5.4) |
| `binding.go` 343–382, 420–431 | `__notAwaited` builds a fix such as `(await img.stats()).p99`; `__immutable` | The same |
| `pkg/gojamod/cv/describe.go` 11–20, 213–235 | The doc line is the comment that opens the function's body, read from `Function.prototype.toString`, cut at 120 runes | Port; the spike confirmed QuickJS returns exact source |
| `pkg/cvsession/session.go` 39–50, 298–306 | Defaults (60 s, 9000 chars, 4 looks, 8 MiB); the wrapper `__cv_run(async function () {\n…\n})`, so agent line N is line N+1 | Same wrapper; 30 s default here |
| `session.go` 185–191, 370–412 | `require` loads no files (agents had escaped through it "within two runs", report §2.9); a watchdog interrupts loops after an `await` | Nothing to load in QuickJS; the interrupt handler covers both cases (§5.4) |
| `pkg/cvsession/init.js` 1–62, 64–108 | Globals `cv` (guarded proxy with did-you-mean), `mem`, `img`; `__cv_run` waits for unawaited saves and reports `UNHANDLED` rejections | Same pattern for `cb`, `mem`, `frame` |
| `pkg/cvsession/processor.go` 64–89, 221–237 | The result is value YAML, then warnings, then the context block, capped; "# nothing returned: end the code with `return …`" | Same, with the cap reserving room for context (§5.10) |
| `processor.go` 116–179 | Every look created in the eval is delivered, returned or not, at most 4; duplicates once; a `LOOKS` warning names the rest by line | All of it |
| `processor.go` 332–407, 459–467 | The error YAML `code, message, where, path, hint, fix, valid`; hints for `is not defined` ("keep values in mem") | All of it |
| `processor.go` 475–537 | The context block: images, `mem` keys with kinds, function signatures, and the doc line of new or changed functions | All of it, plus frame and proposal lines |
| `pkg/cvsession/tables.go` 16–126 | Compact tables: ≥ 2 flat records render as a header plus rows; 2/3 of the cap shared; at least 5 rows; a paging note | All of it |
| `pkg/cvsession/reference.go` 11–48, 52–86 | Instructions under 4000 chars; a one-paragraph eval tool description; the reference generated from the registry | All of it, generated by `tools/gen-docs` |
| `pkg/cvsession/mcp.go` 45–52 | Tool input descriptions say when to *omit* optional fields, because "agents invent values for unexplained options" | Hand to CHB-008 |
| `pkg/cvsession/docs_test.go` 98–100, 125–173 | Every `js` block of every topic runs in a real session; info-string tags `warns=CODE`, `error=CODE`, `looks=N`, `fragment`; a floor on the block count | All of it (§5.12) |

What does not transfer is listed in report §5. Two items matter here:

- **A broken session after a timeout.** goja-cv must mark a session broken when an interrupt hits an async continuation (`processor.go` 314–331). The spike shows that QuickJS keeps running promises after such an interrupt (§5.3).
- **Live parameters,** which §2.5 resolves.

### 4.2 Filmbench IDE

| Lines | What it shows | Take or leave |
|---|---|---|
| 4505–4631 `makeLab` | The agent vocabulary: `state`, `img`/`crop`/`zoom`/`measure`/`pixel`/`look`, what-ifs `compare` (4565–4569) and `sweep` (≤ 14 values, 4570–4575), `patches`, `tone`, `curves`, changes `set`/`film`/`print`/`reset`/`preset`, a did-you-mean proxy (4630) | Take the vocabulary: what-ifs that say "nothing was changed", sweeps returning tables. Leave pixel-level `Img` methods: pixels stay out of the DSL |
| 4602 `lab.set` | Goes through `wb.apply`, so ask mode queues it; returns `{queued, note: 'waiting for the user to approve'}` | The receipt idea; but this writes the base layer, not an agent layer (report §2), a confusion the recipe model removes |
| 4537–4545 `lab.look` | Looks get a burned-in header band with `#id`, label, region and size; at most 6 per step | Burn in the look number; 4 per eval |
| 4648–4707 `systemText` | A complete tool manual in the system prompt: one `eval` block per reply, "look first, measure second, change third", the current mode, physics hints ("+yellow makes the print bluer"), the parameter list | Hand to CHB-008; the DSL generates the parameter and op lists |
| 4708–4717 `contextText` | A context line per message: scene, changed-from-defaults, layers, pending approvals, mode, state hash | Feeds the context block |
| 4721–4730 | `fmtResult` cuts YAML at 9000 chars; `errText` maps the stack line back by −2 | Same cap; exact line mapping |
| 4731–4737 `runCode` | `AsyncFunction` in page scope, `Promise.race` timeout, `V2.by = 'agent'` | Leave all three (§2.2) |
| 4834–4868 | The step loop: older steps compressed into one line each (4836–4838); queued changes approved or skipped after each step, and the outcome appended to the result (4856–4859); a per-step Revert by popping the undo stack (4864–4865) | Approval outcome reported in the next context block; Revert becomes ordinary undo of the eval's unit (CHB-002 DR-5) |
| `vfs/agent/brief.md` | House notes the photographer edits: use darkroom words, colour from numbers, crop when you look, leave the bench as you found it | Hand to CHB-008; it confirms the vocabulary |
| `vfs/examples/16-mutations.js`, `19-diagnostics.js` | Mutations and diagnostics shown as runnable examples | The style of the docs topics |

## 5. Design

### 5.1 Module layout

```text
packages/dsl/
  src/
    session.ts            DslSession: main-thread facade; host services; RPC to the worker
    worker.ts             worker entry: loads QuickJS, prelude, tables; runs evals
    sandbox/
      quickjs.ts          module/runtime/context creation, limits, determinism
      pump.ts             the eval loop: evalCode, executePendingJobs, host settlements, deadline
      native.ts           the __cb host functions (§5.6)
    prelude/
      prelude.js          hand-written proxy machinery and vocabulary (runs inside QuickJS)
      vocabulary.ts       host side of the vocabulary: compile-based handles, edits, receipts
    handles.ts            node id ↔ handle bookkeeping, closure shipping to the main thread
    results/
      yaml.ts tables.ts looks.ts context.ts diagnostics.ts lines.ts
    docs/
      topics/*.md         agent topics (executed in CI)
      instructions.md     the < 4000-character instructions (template, filled by gen-docs)
    telemetry.ts          EvalTrace (§5.13)
  generated/              reference.md, chromobench-dsl.d.ts (tools/gen-docs)
  test/                   sandbox, proxies, results, mutations, docs tests
```

### 5.2 Decision record DR-1: QuickJS in WASM or a Web Worker with CSP

**Context.** The sandbox must do five things:

1. stop runaway code without losing the session's `mem`;
2. cap memory;
3. expose nothing but the DSL;
4. make sure the agent cannot reach the photographer's library storage, the network or the DOM;
5. answer synchronous calls such as `frame.negative()` immediately.

**Alternatives.**

| Criterion | QuickJS in WASM (in a worker) | Plain Web Worker + CSP (in an opaque-origin sandboxed iframe) |
|---|---|---|
| Reachable APIs | Only what the host installs. The spike found no `console`, `setTimeout`, `require`, `fetch` or `WebAssembly` in a default context; 61 own globals | The worker realm has `fetch`, `WebSocket`, `IndexedDB`, caches, timers, `crypto`, `performance`. A same-origin worker shares the library's IndexedDB, so it must sit inside `<iframe sandbox="allow-scripts">` to get an opaque origin |
| Network blocking | Nothing to block | Relies on CSP. A dedicated worker's policy comes from its script's response headers, or is inherited when it is created from a `blob:` URL (Chromium change "Fix dedicated worker inheritance"). Mozilla bug 1800890 (CVE-2023-23602) shows how such rules have leaked: `connect-src` was not applied to a worker's WebSocket |
| Stopping a loop | The interrupt handler. The spike: `while(true){}` stopped with `InternalError: interrupted`, both before and after an `await`, and the same VM kept working | `worker.terminate()` only: the realm and `mem` are lost |
| Memory cap | `setMemoryLimit`. The spike: `InternalError: out of memory` at a 32 MiB limit, after which the runtime disposed cleanly | None; a runaway allocation grows until the tab's process fails |
| Determinism | `Date` can be removed (spike: `intrinsics: {…, Date: false}`), `Math.random` replaced and frozen (spike) | Many clocks and random sources to patch |
| Synchronous host calls | `newFunction` host functions are synchronous | The host is in another realm. Synchronous calls need `SharedArrayBuffer` + `Atomics.wait`, which require cross-origin isolation (COOP/COEP), or a copy of the host logic in the worker |
| Speed | Interpreter, no JIT. Agent code is glue: a few hundred node builds and a few dozen awaits per eval | V8 with JIT |
| Debugging | Stack traces with file and line (spike: `at <anonymous> (agent.js:4:14)`) | DevTools |
| Size | 503 KB WASM (sync release variant) | 0 |

**Decision.** QuickJS in WASM, run inside a dedicated Web Worker for responsiveness.

**Consequences.**

- Every host value is a handle that must be disposed. A leak test is mandatory: in the spike, a leaked handle made `runtime.dispose()` abort with `Assertion failed: list_empty(&rt->gc_obj_list)`.
- The interpreter is slower than V8. That is acceptable because pixels never enter the VM.
- Sandbox escape attempts become a test suite (§9).

**Status:** proposed; confirm with the stage 1 tests.

### 5.3 Decision record DR-2: the sync variant with deferred promises, not asyncify

**Context.** The ticket plan says to use "the asyncify variant for async host calls". Only one kind of host call takes time here: `await` on a measurement, because the engine runs on the main thread. Every other call is answered from data already in the worker.

**What the library offers.** Two mechanisms can connect a guest call to async host work:

1. **Deferred promises.** These work in every variant. A host function returns `vm.newPromise().handle`, the host resolves it later, and then calls `runtime.executePendingJobs()`. The variant READMEs say "both variants support regular async functions".
2. **Asyncify.** `newAsyncifiedFunction(name, asyncFn)` makes the guest call look synchronous. The 0.32.0 type definitions document its limits:
   - "Asyncified functions must never call other asyncified functions or `import`, even indirectly, because the stack cannot be unwound twice."
   - On `QuickJSAsyncWASMModule.newRuntime`: "All runtimes inside a module are limited to a single async call at a time."
   - The asyncify variant README states roughly "2x the size of sync" and "40% the speed of sync". The measured files are 1.03 MB against 503 KB.

**Evidence from the 0.32.0 build and the spike.**

- **Source.** In `quickjs-emscripten-core` 0.32.0 only evaluation has an asynchronous entry point (`QTS_Eval_MaybeAsync` behind `evalCodeAsync`). `executePendingJobs` calls `QTS_ExecutePendingJob` synchronously. Agent code is an async function body, and everything after its first `await` runs as a promise job inside `executePendingJobs`.
- **Spike, deferred promises with the sync variant.** A chain of two awaits and a `Promise.all` over two more host promises fulfilled correctly (`{a:10, b:20, c:30, d:40}`).
- **Spike, an asyncified function in the synchronous part of `evalCodeAsync`.** It worked.
- **Spike, the same function called after an `await`.** `executePendingJobs` returned "0 jobs" at once while the call was still suspended, so the host could not tell when the job finished. While it was suspended, a second `evalCodeAsync('1+1')` ran and returned 2. That is re-entry during suspension, which the library documents as unsupported.

**Decision.** Use `@jitl/quickjs-wasmfile-release-sync` with deferred promises for every host operation that takes time. Every other host function is synchronous and answered from worker-local data. **This changes the ticket plan's stated choice of the asyncify variant.** For this DSL, asyncify only works before the first `await`, it brings re-entrancy hazards, and it doubles the size.

**Consequences.**

- `await` works anywhere and any number of times. `Promise.all` over measurements runs them concurrently on the engine.
- The variant is one import, so switching later is a one-line change, should a need for synchronous async calls appear. One example would be loading playbooks with `import` through an async module loader.
- Library choice: bellard/quickjs (version 2025-09-13 in the 0.32.0 variants) or quickjs-ng (`@jitl/quickjs-ng-wasmfile-release-sync`). Start with bellard, the variant the spike tested. Revisit only if a missing language feature shows up in agent traces.

**Status:** proposed; the stage 1 tests reproduce the spike before anything else is built.

### 5.4 Session lifecycle and the eval pump

One `DslSession` exists per chat thread. It owns one worker, which owns one QuickJS module, one runtime and one context. `mem` lives in that context and persists across evals until the session ends.

```ts
// packages/dsl/src/sandbox/quickjs.ts (sketch, real API names from quickjs-emscripten-core 0.32.0)
import { newQuickJSWASMModuleFromVariant, DefaultIntrinsics } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';

export async function createVm(native: NativeHost, prelude: string, tablesJSON: string) {
  const QJS = await newQuickJSWASMModuleFromVariant(variant);
  const rt = QJS.newRuntime({ memoryLimitBytes: 64 * 1024 * 1024, maxStackSizeBytes: 1024 * 1024 });
  const vm = rt.newContext({ intrinsics: { ...DefaultIntrinsics, Date: false } });
  installNative(vm, native);                         // the __cb object of §5.6
  const r = vm.evalCode(prelude, 'prelude.js');      // defines cb, mem, units, console, __cb_run
  vm.unwrapResult(r).dispose();
  return { QJS, rt, vm };
}
```

64 MiB is generous for glue code. The limit exists to turn a runaway allocation into a clean error. `Eval` must stay enabled: in the spike, a context created with `Eval: false` refused every `evalCode` call with "eval is not supported".

The eval pump is the heart of the sandbox. It runs the agent's code, lets host promises settle, and enforces two limits. The interrupt handler bounds interpreter time. The race against the deadline bounds wall time, including time spent waiting on the engine.

```ts
// packages/dsl/src/sandbox/pump.ts (sketch)
import { shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';
const WRAP_PREFIX = '__cb_run(async function () {\n';   // agent line N = source line N + 1
const WRAP_SUFFIX = '\n})';

async function runEval(s: Session, req: EvalRequest): Promise<EvalOutcome> {
  const deadline = Date.now() + Math.min(req.timeoutMs ?? 30_000, 120_000);
  s.rt.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
  s.begin(req);                       // recipe snapshot, seeded Math.random, empty look/edit queues
  const file = `eval-${s.evalSeq}.js`;  // unique per eval, so errors in older mem functions map back
  const r = s.vm.evalCode(WRAP_PREFIX + req.code + WRAP_SUFFIX, file);
  if (r.error) return s.fail(r.error);            // syntax error, or a throw before the first await
  const p = r.value;
  for (;;) {
    const jobs = s.rt.executePendingJobs();
    if (jobs.error) { jobs.error.dispose(); }     // job errors surface through p's rejection
    const st = s.vm.getPromiseState(p);
    if (st.type === 'fulfilled') return s.succeed(st.value);
    if (st.type === 'rejected') return s.fail(st.error);
    if (s.host.outstanding() === 0) return s.fail(stalled());    // E_STALLED: awaiting something that never settles
    const settled = await s.host.nextSettlement(deadline);       // false when the deadline passes first
    if (!settled) { s.host.cancelAll(); return s.fail(timeout()); }   // E_TIMEOUT; engine work aborted via AbortSignal
  }
}
```

**What happens on failures.**

- **A loop in synchronous code** is stopped by the interrupt handler: `InternalError: interrupted`, reported as `E_TIMEOUT`.
- **A loop after an `await`** is stopped the same way. The spike showed the job's promise rejected with `InternalError: interrupted` and the VM still running promises afterwards. `mem` survives.
- **Out of memory** gives `InternalError: out of memory`, reported as `E_MEMORY`. The session probes itself afterwards, as goja-cv's `probePromises` does (`processor.go` 316–329), by evaluating a tiny async function. If the probe fails, the session is recreated and the result says "the DSL session was restarted; `mem` was lost".
- **A host operation still in flight when the eval ends.** This happens when the agent did not await a measurement. The operation is cancelled and reported as an `UNHANDLED` warning with its line.

Host-side reads between evals (building the context block calls `Function.prototype.toString` inside the VM) run under a fresh short deadline of their own, because the eval's handler would otherwise interrupt them once its deadline has passed.

`__cb_run` mirrors goja-cv's `__cv_run` (`init.js` 64–108). It starts the body from a promise job and records the eval's outcome. QuickJS has no unawaited saves to wait for, because the DSL has no file writes.

### 5.5 Determinism and the global surface

The same code on the same recipe must produce the same result text. That property is what lets the docs tests and golden result files work.

- **`Math.random`** is replaced in the prelude by `mulberry32(seed)` and frozen with `Object.defineProperty(…, {writable: false, configurable: false})`. The spike confirmed that a later assignment is ignored. The seed is the first 32 bits of `sha256(stateHash + code)`, so a re-run of the same eval is identical and a different eval gets a different stream.
- **`Date` is absent** (`Date: false`). Nothing in the DSL needs wall-clock time.
- **No timers.** `setTimeout` does not exist, so `await` can only wait on host operations.
- **`console.log`** is installed by the prelude. Its lines are captured into the result under `console:` and count against the cap.
- **Engine results** are deterministic by CHB-002's Engine contract.

### 5.6 Host bindings and marshalling

The prelude talks to the host through one object of underscore-named native functions, as goja-cv's `binding.go` does (lines 40–63). Values cross as **JSON strings**: the host returns `vm.newString(json)` and the prelude calls `JSON.parse`. Each call then creates one handle instead of one per field, which keeps disposal simple.

| Native function | Timing | Does |
|---|---|---|
| `__tables()` | sync, once | Registry tables as JSON: ops by kind and domain, namespaces, argument names, vocabulary list, docs index |
| `__call(op, recvId, argsJSON, line)` | sync | `bindArgs` + `Graph.intern` (contract). Returns `{id, kind, domain}` or throws a structured error. `line` is the caller's agent line, used to tag `RANGE` warnings |
| `__evaluate(id)` | **async** (deferred promise) | Image: resolves at once to a summary. Value: ships the node closure to the main thread, `engine.measure`, resolves with the JSON value |
| `__explain(id)` | sync | The chain of ops and arguments, with cached marks when known |
| `__look(id, optsJSON, line)` | sync | Queues a look; returns a placeholder `{look: n}` |
| `__frame(id)` / `__frames()` | sync | The recipe snapshot, provenance and pending list for a frame; a library listing |
| `__edit(frameId, mutationsJSON, why, line)` | sync | Validates against the eval's draft recipe; records proposals; returns a receipt with a preview node (§5.8) |
| `__help(name)`, `__docsList/Search/Read` | sync | Reference and topics |
| `__unknown`, `__notAwaited`, `__immutable` | sync, throws | Structured errors with did-you-mean and fixes, as in goja-cv `binding.go` 327–431 |
| `__log(text)` | sync | Console capture |

Host functions created with `vm.newFunction` run in the worker. Only `__evaluate` and the end-of-eval edit submission talk to the main thread.

### 5.7 The object model

The DSL's objects are the darkroom's concepts. There are four globals, then handles.

| Global | What it is | Members |
|---|---|---|
| `frame` | The frame this eval is bound to (`EvalRequest.frame`). A plain object, not a node. Without a bound frame, reading `frame` throws `E_NO_FRAME` with fix `cb.frame("…")` | `id`, `name`, `kind`, `recipe` (deep-frozen snapshot), `source()`, `scan()`, `negative()`, `print(opts?)`, `display()`, `edit(…)`, `why(path)`, `pending()` |
| `cb` | The module, wrapped in a did-you-mean proxy as goja-cv's `cv` is (`init.js` 47–59) | `frames()`, `frame(id)`, `stocks({role})`, `help(name?)`, `docs.list/search/read`, `explain(h)`, `compare([a, b], label)`, `testStrip(frame, opts)`, `ringAround(frame, opts)`, `contactSheet(ids, opts)`, `load(name, args)` (playbooks, CHB-008), `mode`, `version`, plus generated receiver-less ops such as `cb.darkroom.contactSheet` |
| `units` | Conversions from `@chromobench/contract/units` | `pt(x)` points→log H, `toPt(x)`, `stops(x)`, `toStops(x)`, `stopsFromTime(t1_s, t2_s)`, `stopsFromFstop(n1, n2)`; each accepts a number or an array |
| `mem` | A plain object that persists across evals of the session | Anything; functions on `mem` appear in the context block |

**Handles** are proxies over nodes, built and governed exactly as in goja-cv's `prelude.js`. Their methods are generated from the registry. A dotted op name becomes a namespace, so `measure.densitometer` is called as `h.measure.densitometer({…})`. Unlike goja-cv, the method table also depends on the handle's **domain**: a handle offers only the ops whose `domainIn` accepts its domain.

| Handle domain | Usually obtained from | Methods offered (generated) |
|---|---|---|
| `camera-linear` | `frame.source()` | `scan.*`, `mask.*`, `measure.*` |
| `scanner-density` | `frame.scan()` | `invert.dyes`, `scan.noise`, `mask.*`, `measure.*` |
| `film-dyes` | `frame.negative()` | `print.expose`, `darkroom.*`, `invert.classify`, `film.grain`, `mask.*`, `measure.*` |
| `paper-logH` | `neg.print.expose({…})` | `print.lights`, `print.preflash`, `print.develop`, `measure.*` |
| `paper-dyes` | `….print.develop({…})` | `view.reflect`, `measure.*` |
| `print-xyz` | `frame.print()`, `neg.print({…})`, `darkroom.*` | `view.flare`, `view.adapt`, `output.display`, `measure.*` |
| `display-rgb` | `frame.display()` | `output.frame`, `finishing.*`, `measure.stats`, `measure.histogram` |
| `mask` | `h.mask.*(…)` | `mask.feather`, `mask.and/or/not`, `measure.stats` |

Every Image handle also has `look(label | {label, box, at})`, `then` (await → summary) and the labels `toString`/`toJSON`. Value handles have only `then`. Reading a field of a Value handle throws `E_NOT_AWAITED`.

**The vocabulary layer.** A small set of hand-written methods expands to registry ops using the frame's recipe. It is documented and tested like the rest, and kept under fifteen entries, so that most of the API stays generated:

| Vocabulary | Expands to | Notes |
|---|---|---|
| `frame.source()`, `frame.scan()`, `frame.negative()` | `compile(recipe)` cut at `source.open`, `scan.density`, `invert.dyes` | Returns the recipe's own nodes, so they are cache hits |
| `frame.print(opts?)` | `frame.negative().print(opts)` | The physical print under the viewing light (`print-xyz`), not display codes |
| `frame.display()` | `compile(recipe)` | What the viewer shows |
| `neg.print(opts)` | `print.expose → print.lights → [print.preflash] → print.develop → view.reflect → view.flare → view.adapt`, with recipe values overridden by `opts` | A what-if. Option keys: `paper, time_s, fstop, filtration, lights, grade, preflash, illuminant, flare`. Each is validated by the `ArgSpec` that owns it, so `lights` uses `print.lights.logH`'s spec |
| `cb.testStrip(f, opts)`, `cb.ringAround(f, opts)` | `f.negative().darkroom.testStrip(opts)` / `.ringAround(opts)` with the recipe's print settings | Looks of these pictures carry per-cell readings automatically |
| `cb.compare([a, b], label)` | No node. A side-by-side look composed by the result processor | Each half carries its own numbers |
| `frame.edit(…)` | mutations (§5.8) | — |

`neg.print` is a **callable namespace**. Calling it runs the vocabulary macro, while its members are the generated `print.*` ops. The proxy returns a function object whose `get` trap serves `expose`, `lights` and the others, and applies the domain filter. On a `film-dyes` handle, `neg.print.expose(…)` is valid. `neg.print.lights(…)` throws `E_DOMAIN`, and its fix shows both correct forms: `neg.print({ lights: […] })` and `neg.print.expose({…}).print.lights({…})`.

**Arguments with a recipe path are filled from the recipe** when the receiver came from a frame. `frame.negative().print.expose({ time_s: 12.6 })` takes paper, lamp, filtration and f-stop from the frame's recipe. The handle remembers its frame for exactly this purpose. CHB-002's `ArgSpec.default` applies only to handles without a frame.

### 5.8 What-ifs, edits, and how an eval becomes mutations

**Building nodes never changes anything** (architecture doc §5.3). Every vocabulary call and every generated method is a what-if. Changing the recipe requires `frame.edit`:

```ts
// the guest-side API (sketch, generated .d.ts style)
interface FrameEdit {
  (changes: Record<RecipePath, unknown>, opts?: { why?: string }): EditReceipt;    // 'set' mutations
  exposure: { add(e: ExposureInput, opts?: { why?: string }): EditReceipt;
              remove(id: string, opts?: { why?: string }): EditReceipt };
  mask: { set(id: string, mask: MaskHandle, opts?: { why?: string }): EditReceipt };
}
interface Frame { readonly edit: FrameEdit /* … */ }
interface EditReceipt {
  id: string;                        // 'e1', unique within the session
  status: 'queued';                  // final status arrives in EvalResult.mutations and the next context block
  mutations: Mutation[];             // exactly what will be submitted
  preview: Handle;                   // print-xyz of the recipe with all of this eval's edits applied
  note: string;                      // 'submitted when this eval ends; ask mode: waits for the photographer'
}
```

**DR-3: an eval's edits are submitted together, at the end, as one unit.**

- **Context.** Filmbench applies `lab.set` immediately through `wb.apply`. If the step then fails, half of its changes remain, and the UI offers a "Revert" button that pops undo snapshots (lines 4864–4865).
- **Decision.** `frame.edit` validates at once, using CHB-002's validator against a **draft**: the eval-start snapshot plus this eval's earlier edits. Invalid edits throw immediately: `E_PATH`, `E_ARG_RANGE`, or `E_READONLY` in read-only mode. Valid edits are queued. When the eval *succeeds*, the session calls `editLog.propose(mutations, {tx: evalId, why})` once per touched frame, on the main thread. When the eval *fails*, nothing is submitted, and the result carries the warning `EDITS_DROPPED` listing the dropped edits.
- **Consequences.**
  - One eval is one approval card and one undo unit (CHB-002 DR-5). "Revert this step" is an ordinary undo.
  - `frame.recipe` and `frame.print()` keep showing the eval-start state for the whole eval, so code reads what the agent saw. To look at the effect of an edit within the same eval, use `receipt.preview`.
  - Each `set` carries `expect` = the eval-start value, so a stale approval is refused (CHB-002 DR-7).

**Modes** are host state, set by the photographer and shown as `cb.mode`:

- `read-only`: `frame.edit` throws `E_READONLY` with the hint "describe the change; the photographer can switch the mode";
- `ask`: the proposals become `pending`;
- `auto`: they are applied at once as one unit.

The `by: 'agent'` tag is added by the main-thread `EditLog.propose`. Nothing in the worker or the VM can choose `by`.

**Approval happens later, in the UI.** The next eval's context block reports the outcome, as Filmbench appends it to the result (line 4858):

```yaml
  proposals: e1 (eval-12) approved · e2 (eval-13) stale, not applied (the photographer changed print.lights.logH)
```

**Masks in edits.** `frame.edit.exposure.add({ id: 'sky', kind: 'dodge', mask: skyHandle, stops: -0.5 })` emits two mutations. The first, `mask.set('sky', closure(skyHandle))`, stores the mask as node definitions, the `MaskSpec` of CHB-002 §5.8. The second is `exposure.add({…, mask: 'sky'})`.

### 5.9 Proxies and structured errors

Every mistake below has a test, and every test asserts the exact `code` and `fix`. The codes marked (new) are proposed to CHB-002 in §11.

| What the agent wrote | Code | Fix in the error |
|---|---|---|
| `neg.pirnt({ time_s: 12 })` | `E_UNKNOWN_METHOD`, `hint: Did you mean "print"?` | `neg.print(…)` |
| `frame.scan().print.expose({…})` | `E_DOMAIN`: print.expose takes `film-dyes`; this handle is `scanner-density` | `frame.negative().print.expose(…)` |
| `neg.print.lights({ logH: [0.1, 0, 0] })` | `E_DOMAIN` | `neg.print({ lights: [0.1, 0, 0] })` |
| `const g = p.measure.densitometer({at}); return g.D` | `E_NOT_AWAITED` (new) | `(await p.measure.densitometer({ at: [1210, 860] })).D` |
| `if (p.measure.densitometer({at}) > 0.8)` or `x * 2` | `E_NOT_AWAITED` through `Symbol.toPrimitive` (spike: `*`, `>` and template literals all reach the trap) | `(await …).visual > 0.8` |
| `` `${handle}` `` | no error: the string hint returns a label `[print-xyz #b2e4 print.lights]`, so logging never crashes (goja-cv `prelude.js` 141–146) | — |
| `neg.time_s = 12` | `E_IMMUTABLE` (new) | `frame.edit({ 'print.enlarger.time_s': 12 })` |
| `neg.print({ time: 12 })` | `E_UNKNOWN_OPTION`, did-you-mean `time_s`, `valid` lists the keys | `neg.print({ time_s: 12 })` |
| `neg.print({ lights: [4, 0, 0] })` | `E_ARG_RANGE` with the points redirect hint | `neg.print({ lights: units.pt([4, 0, 0]) })` = `[0.1, 0, 0]` |
| `neg.print({ time_s: p.measure.stats() })` | `E_ARG_TYPE`: options are literal values | `(await p.measure.stats()).…` |
| `frame.edit({ 'print.light.logH': … })` | `E_PATH`, did-you-mean `print.lights.logH` | the corrected path |
| `frame.edit(…)` in read-only mode | `E_READONLY` | none; hint "describe the change instead" |
| `x` defined by top-level `const` in an earlier eval | `ReferenceError` + hint "top-level const/let do not survive between evals; keep values on mem" | `mem.x = …` |
| `await new Promise(r => setTimeout(r, 500))` | `ReferenceError` + hint "there are no timers; `await` waits only on measurements" | — |
| `fetch(…)`, `require(…)`, `import('…')` | `E_SANDBOX` (new): "the DSL has no network, files or modules; playbooks load with `cb.load(name)`" | `cb.load("…")` |
| `(await frame.print()).data` | `undefined`; the summary lists its keys, and the hint says pixels never enter the DSL | `p.measure.stats()`, `p.measure.patches()` |
| no `return` | not an error: `# nothing returned: end the code with return …` | — |

The proxy must let generic probes through (`then` on non-handles, `constructor`, `toJSON`, `inspect`, `$$typeof`, `Symbol.toStringTag`), as goja-cv's `PROBES` set does. Otherwise `JSON.stringify(handle)` or a `console.log` would throw.

**Where an error points.** QuickJS stack frames carry `file:line:col` (spike: `at <anonymous> (agent.js:4:14)` for agent line 3).

- `lines.ts` maps `eval-N.js:L` to "line L − 1" for the current eval.
- For a function defined in an older eval and stored on `mem`, it maps to "eval N, line L − 1". The session keeps the sources of its last 50 evals.
- `where` includes the trimmed source line, as goja-cv does (`processor.go` 278–288).
- Warnings raised during `__call` (for example `RANGE`) carry the caller's line. The prelude obtains it from `new Error().stack` at the call site.

### 5.10 Result shaping

`EvalResult` (architecture doc §5.5) carries structured fields for the UI, plus `yaml`, the text the agent reads. The text has up to five parts, in this order:

1. the returned value as YAML, or the `error:` block;
2. `edits:`, one line per queued edit with its status;
3. `console:`, if anything was logged;
4. `warnings:`, each with its line;
5. `context:`.

**Cap.** The whole text is capped at 9000 characters. goja-cv cuts the assembled text at the end (`processor.go` 236). This design reserves room instead: the error, edits, warnings and context are never cut, and the value gets what remains (at least 2000 characters). When the value is cut, it ends with `# CUT: n of m characters shown; return less, or page the array`.

**Values.** Numbers print with at most five significant digits, trailing zeros dropped, so `0.946913…` prints as `0.94691`. Handles print as their labels. A returned look prints as its caption placeholder.

**Compact tables.** These follow goja-cv's `tables.go`. An array of at least two flat records (primitives only) renders as a literal block: a header line with the union of keys, then one line per record. All tables in one result share two thirds of the cap. Each table shows at least 5 rows, and a cut table ends with `… rows 1–N of M shown. Next: rows.slice(N, 2N)`. goja-cv measured why tables matter: its item cap fired in 40 evals, and agents were joining rows into strings themselves (report §3.2).

**Looks.**

- At most four per eval. Every look created is delivered in creation order, whether or not it was returned, and identical looks (same node, same options) are delivered once. More than four produces a `LOOKS` warning naming the extras by line (goja-cv `processor.go` 116–179).
- A look of a non-display domain is rendered through a fixed display transform: `print-xyz` through the recipe's `output.display`, densities and dye amounts as a greyscale with a legend, masks as greyscale.
- The long side is 750 px by default, at most 1568.
- Encoding follows goja-cv's `look.go` rule: PNG for masks, charts and small or zoomed crops, JPEG q85 otherwise.
- The look number is burned into a corner, so the model and the photographer can both refer to "look 2".

Every look carries **numbers** (`Look.numbers`, §11), chosen by what the look shows:

- any Image: `measure.stats` over the look's region (mean, p01, p99, clip fractions) in the domain's unit;
- a `darkroom.*` picture: the `measure.patches` table, one row per cell with its setting;
- a look with an `at` option: the densitometer reading there.

The numbers appear twice: in `EvalResult.looks[i].numbers` for the UI, and under the look's caption in the YAML for the agent.

**The context block** is rebuilt for every eval. It is never cut, and it is kept short:

```yaml
context:
  frame: frame_0042 · negative-scan · kodak_portra_400 → kodak_portra_endura · mode ask
  changed: print.enlarger.time_s=12.6 (user) · print.lights.logH=[0, 0.05, 0] (user)
  proposals: e1 (eval-12) approved
  mem: greyD (function), strip (#b2e4 print-xyz)
  functions: mem.greyD(h, at)
  new functions: |-
    mem.greyD(h, at = [1210, 860]): print densities at a point, 15 px aperture
```

How each line is built:

- **`changed`** lists at most twelve recipe paths that differ from `defaultRecipe`, each with the author of its last write, as Filmbench's `contextText` does (lines 4708–4717).
- **`mem` and `functions`** follow goja-cv's `contextBlock` (`processor.go` 475–537). Keys are read through property descriptors, so getters never run.
- **`new functions`** shows the full signature and doc line of each `mem` function whose source changed since the agent last saw the block. The doc line is the comment that opens the function's body, read from `Function.prototype.toString`; the spike confirmed QuickJS returns exact source, comment included. The parser is ported from `describe.go`.

Frame names and recipe notes come from the photographer's files and are untrusted text. The context block prints them as quoted YAML scalars, and the instructions tell the agent that `context:` is data, not instructions.

**Error blocks** follow goja-cv's shape:

```yaml
error:
  code: E_NOT_AWAITED
  message: 'measure.densitometer() is a lazy node: read .D after awaiting it.'
  where: 'line 2: return g.D'
  path: frame_0042 print → measure.densitometer → ✗ D
  hint: Nothing has been computed yet; awaiting the node evaluates it.
  fix: (await p.measure.densitometer({ at: [1210, 860] })).D
```

### 5.11 What is deliberately not exposed

Each omission is deliberate, and each has a test that it stays absent:

- **The DOM, network, timers, modules and `require`.** QuickJS provides none of them, and the prelude adds none.
- **Raw file paths and storage.** Frames are reached by id through `cb.frame(id)` only. goja-cv's report recommends exactly this for a GUI app: a catalog API instead of paths (§5.4 item 10).
- **Pixels.** No pixel buffers, and no per-pixel callbacks. Measurement ops are the only way to numbers. That keeps the interpreter's speed irrelevant, and the results comparable across engines.
- **The `EditLog` and the `Engine`.** The agent cannot undo, approve, reject, change the mode or choose `by`. It can only propose. Undoing a photographer's change is an ordinary proposal to set the old value, which the photographer sees.
- **Export and file writing.** `output.encode` is excluded from the DSL in v0 (CHB-002 §5.5). Exports are the photographer's action.
- **Live parameters and sliders.** §2.5 explains why.
- **Clocks and unseeded randomness** (§5.5).

### 5.12 Generated documentation and reference

`tools/gen-docs`, shared with CHB-002, produces three agent-facing texts from the registry and the vocabulary table:

1. **The reference** (`packages/dsl/generated/reference.md`). It is grouped by handle domain, then by area. Each op gets one line, for example `h.print.expose({ paper, mode, lamp, filtration, time_s, fstop }) → paper-logH — <first sentence of doc>`. One sub-line per argument gives its type, unit, range, default and recipe path. The vocabulary and the globals each get a section. This follows goja-cv's `Reference` (`reference.go` 52–86). CHB-008 serves it as an MCP resource and in the system prompt.
2. **The instructions** (`docs/instructions.md`, under 4000 characters, as goja-cv's are):
   - the eval contract (async body, `return`, `mem`);
   - "calls build lazy nodes; `await` gives data";
   - literal options;
   - looks come with numbers, so read numbers rather than pictures;
   - edits are proposals, submitted at the end of a successful eval;
   - errors carry a literal fix: apply it;
   - about twenty most-used calls, chosen from the telemetry once it exists.
3. **`chromobench-dsl.d.ts`**: one interface per handle domain, for humans writing playbooks (CHB-008) and for editor completion.

**Topics** are hand-written Markdown pages in `packages/dsl/src/docs/topics/`: `getting-started`, `darkroom-vocabulary`, `measuring`, `test-strips`, `balancing-colour`, `editing-and-approval` and `errors`. Agents read them from inside an eval with `cb.docs.search(text)` and `cb.docs.read(id, {section})`, exactly as goja-cv's `cv.docs` works.

**Every example runs in CI.** `packages/dsl/test/docs.test.ts` ports goja-cv's `docs_test.go`. For each topic page it starts a fresh session against `engine-mock` with the M1 fixture frame bound to `frame`. It then evaluates every fenced block whose info string starts with `js`, in order. The block's info string sets the expectation:

| Info string | Expectation |
|---|---|
| `js` | succeeds with no warnings |
| `js warns=RANGE` | succeeds with that warning code |
| `js error=E_DOMAIN` | fails with that error code |
| `js looks=2` | delivers exactly that many looks |
| `js fragment` | skipped (partial code shown for explanation) |

The test also runs every `OpDef.examples` entry from the registry, and fails if fewer than a floor of blocks ran, so that a broken extractor cannot pass silently. Vitest runs these in Node; the spike shows that the WASM module loads in Node unchanged.

### 5.13 Instrumentation: measure, then delete

Every eval emits an `EvalTrace` to CHB-008's evaluation harness. The trace stays local; nothing is sent anywhere.

```ts
interface EvalTrace { evalId: string; ms: number; resultChars: number; cut: boolean;
                      ops: Record<string, number>; vocabulary: Record<string, number>;
                      errors: string[]; warnings: string[]; looks: number; edits: number }
```

`tools/dsl-usage` aggregates the traces. It reports:

- vocabulary entries and topics never used, which are candidates for deletion;
- the most frequent error codes with their offending source lines, which are candidates for new `redirects` in the registry;
- how often results were cut.

This is goja-cv's GCV-004/005 process (report §3.6), applied to the DSL surface only.

## 6. Example scripts an agent would write

All of these run against `engine-mock` and become docs-test cases. Coordinates are source pixels (CHB-002 DR-3). The grey card position `[1210, 860]` comes from the photographer's message: the chat panel attaches the coordinates of a click.

**E1: orientation.**

```js
// what is this frame, and how does it print now?
const r = frame.recipe
const print = frame.print()
const grey = await print.measure.densitometer({ at: [1210, 860], aperture_px: 15 })
const s = await print.measure.stats()
print.look('current print')
return { stock: r.scan.stock, paper: r.print.paper, time_s: r.print.enlarger.time_s,
         lights_pt: units.toPt(r.print.lights.logH), grey: grey.D, clipHigh: s.clipHigh }
```

**E2: a time test strip.**

```js
// seven exposures a third of a stop apart around the current time
const strip = cb.testStrip(frame, { vary: 'time', steps: 7, step: 1 / 3 })
strip.look('time test strip')
return await strip.measure.patches()      // a compact table: cell, time_s, D, visual
```

**E3: a ring-around.**

```js
const ring = cb.ringAround(frame, { step_cc: 10 })
ring.look('ring-around, 10 CC')
return await ring.measure.patches()
```

**E4: a reusable helper on `mem`.**

```js
mem.greyD = async (h, at = [1210, 860]) => { // print densities at a point, 15 px aperture
  return (await h.measure.densitometer({ at, aperture_px: 15 })).D
}
return { now: await mem.greyD(frame.print()),
         cooler: await mem.greyD(frame.print({ filtration: { c: 0, m: 0, y: 10 } })) }
```

The next context block lists `mem.greyD(h, at = [1210, 860]): print densities at a point, 15 px aperture`. Adding yellow filtration removes blue light, so the print gets less yellow dye and turns cooler, in the mock as on a real enlarger.

**E5: a balance, measured and proposed.** This is traced in §7.

**E6: a dodge** (vocabulary from CHB-010; the registry already has the ops).

```js
// hold the sky back by half a stop with a feathered gradient
const sky = frame.source().mask.gradient({ from: [1500, 0], to: [1500, 700] })
                          .mask.feather({ radius_px: 80 })
const e = frame.edit.exposure.add({ id: 'sky', kind: 'dodge', mask: sky, stops: -0.5 },
                                  { why: 'the sky prints 0.4 D denser than the foreground' })
e.preview.look('proposed dodge')
return e
```

## 7. One flow traced end to end: a neutral grey card in ask mode

**Setting.**

- Frame `frame_0042` is a 3000 × 2000 scan on Portra 400, printed to Portra Endura on `engine-mock` (CHB-002 §5.10).
- The recipe has 10 s at f/8, zero filtration, `print.lights.logH = [0, 0, 0]`, grade 2 and flare 0.
- The grey card sits at `[1210, 860]`. Its pixel transmittance is (0.20, 0.10, 0.05) against a rebate of (0.80, 0.50, 0.35), the same pixel as CHB-002's trace.
- The agent is in ask mode, and the photographer has asked: "make the grey card neutral".

**The agent's eval** (its 12th, so `evalId = eval-12`):

```js
const at = [1210, 860]
const now = await frame.print().measure.densitometer({ at, aperture_px: 15 })
const probe = await frame.print({ lights: [0.05, 0.05, 0.05] }).measure.densitometer({ at, aperture_px: 15 })
const slope = now.D.map((d, k) => (probe.D[k] - d) / 0.05)        // print density per log H, per layer
const mean = (now.D[0] + now.D[1] + now.D[2]) / 3
const dx = now.D.map((d, k) => (mean - d) / slope[k])             // log H that brings each layer to the mean
const pts = units.toPt(dx).map(p => Math.round(p * 2) / 2)        // half points, as a printer would set them
const lights = units.pt(pts).map((v, k) => v + frame.recipe.print.lights.logH[k])
const e = frame.edit({ 'print.lights.logH': lights }, { why: `neutral grey card: ${pts.join(' / ')} pt` })
e.preview.look('proposed balance')
const after = await e.preview.measure.densitometer({ at, aperture_px: 15 })
return { before: now.D, slope, points: pts, after: after.D }
```

**Step by step.**

1. **The session receives** `EvalRequest {code, frame: 'frame_0042', timeoutMs: 30000}`. It snapshots the library: the frame's recipe, its in-effect provenance, the pending list, and the state hash `S0`. It seeds `Math.random` and sets the deadline.
2. **Line 2** `frame.print()` interns the recipe's print chain through `__call`. The nodes are the same ids as the viewer's, so they are already cached. `.measure.densitometer({at, aperture_px: 15})` binds its arguments (`at` is a `point`, `aperture_px` lies in [1, 200]) and interns a Value node. `await` calls `__evaluate`: the worker sends the closure of new definitions to the main thread, the main thread adopts them and calls `engine.measure`, and the deferred promise resolves. The pump runs `executePendingJobs`, and the agent's code continues with `now.D = [0.94691, 0.80154, 0.58235]`.
3. **Line 3** builds a what-if with all three lights at +0.05 log H. Only the nodes from `print.lights` down are new. Densitometer: `[1.0219, 0.87654, 0.65735]`.
4. **Lines 4–8.** The slope is 1.5 per layer, the mock paper's γ. The mean is 0.77694, and `dx = [−0.11332, −0.016406, 0.12972]` log H. That is −4.53, −0.66 and +5.19 points, rounded to half points `[−4.5, −0.5, 5]`, so `lights = [−0.1125, −0.0125, 0.125]`.
5. **Line 9** `frame.edit` checks three things. The path `print.lights.logH` is settable. The value lies in [−1.5, 1.5]. The mode is ask, which is not read-only. The edit is queued as `{op: 'set', path: 'print.lights.logH', value: [−0.1125, −0.0125, 0.125], expect: [0, 0, 0]}`. The receipt's `preview` is the print chain compiled from the draft recipe.
6. **Line 10** queues look 1. **Line 11** measures the preview: `after.D = [0.77816, 0.78279, 0.76985]`, a spread of 0.013 D instead of 0.36.
7. **The promise fulfils.** The session renders the look through `output.display` and attaches its numbers (the stats over the frame). It then submits the queued edit: `editLog('frame_0042').propose([…], {tx: 'eval-12', why: 'neutral grey card: -4.5 / -0.5 / 5 pt'})`. In ask mode this returns one `LoggedMutation` with `status: 'pending'`, `by: 'agent'` and `seq: 9`. The state hash is still `S0`.
8. **The agent reads:**

```yaml
before: [0.94691, 0.80154, 0.58235]
slope: [1.5, 1.5, 1.5]
points: [-4.5, -0.5, 5]
after: [0.77816, 0.78279, 0.76985]

edits:
  - 'e1 pending: set print.lights.logH = [-0.1125, -0.0125, 0.125] (was [0, 0, 0]); why: neutral grey card: -4.5 / -0.5 / 5 pt'

context:
  frame: frame_0042 · negative-scan · kodak_portra_400 → kodak_portra_endura · mode ask
  changed: none
  proposals: e1 (eval-12) pending
```

   `EvalResult.looks[0]` carries the preview image, its caption and its numbers. `EvalResult.mutations` carries the pending entry for CHB-009's approval card.
9. **The photographer approves.** CHB-009 calls `approve([9])`. `expect` matches the current value, so the log applies the unit `eval-12` and the state hash becomes `S1`. The viewer recompiles: on screen the grey patch goes from (0.370, 0.434, 0.548) to (0.445, 0.443, 0.449). `why('print.lights.logH')` now lists the entry with `by: agent, approved`.
10. **The next eval's context** reads `proposals: e1 (eval-12) approved`.

**The failing variant.** Suppose the photographer nudged the green light before approving. Then `approve` finds `expect ≠ current`, returns `E_STALE` and applies nothing. The card shows "stale". The agent's next context block reads `e1 (eval-12) stale, not applied (the photographer changed print.lights.logH)`.

## 8. Implementation plan

| Stage | Build | Files | Done when |
|---|---|---|---|
| 1. Sandbox | Variant loading, runtime/context with limits, `Date: false`, seeded `Math.random`, the pump with deadline and stall detection, the worker and RPC skeleton, the leak test; turn every spike observation of §5.2–5.3 into a test | `sandbox/*`, `worker.ts`, `session.ts`, `test/sandbox.test.ts` | Tests pass in Node (Vitest) and in headless Chromium (Playwright): loop → `E_TIMEOUT` within deadline + 100 ms and `mem` survives; 100 MB allocation → `E_MEMORY`; `await` chains and `Promise.all` over host promises; 1000 evals without handle leaks (`rt.dispose()` succeeds) |
| 2. Prelude and handles | Registry tables, handle proxies with domain filtering, namespaces, `cb`/`frame`/`units`/`mem`/`console`, vocabulary macros, recipe-filled arguments, closure shipping, `frame.edit` with draft validation and receipts, end-of-eval submission in all three modes | `prelude/*`, `handles.ts`, `sandbox/native.ts` | Every row of §5.9 has a passing test; E1–E6 run against `engine-mock`; mutation tests for read-only, ask (pending, approve, stale) and auto |
| 3. Results | YAML rendering, number formatting, compact tables, cap with reserved context, looks with numbers and burned-in numbers, the context block with function doc lines, diagnostics with line mapping across evals | `results/*` | A golden file `test/representative.result` pins the exact text of the §7 eval and of three error cases; changing the format is a reviewed diff |
| 4. Docs and reference | gen-docs targets (reference, instructions, `.d.ts`), topic pages, `cb.help`/`cb.docs`, the docs test, `EvalTrace` and `tools/dsl-usage` | `docs/*`, `generated/*`, `test/docs.test.ts`, `telemetry.ts` | Every `js` block and every `OpDef.examples` entry runs in CI; the instructions are under 4000 characters; a broken example fails CI |

M1 needs a thin slice of stages 1–3: the sandbox, `frame.print`, `frame.edit`, YAML results, and ask mode. CHB-002's M1 test uses it at step 5.

## 9. Testing and acceptance

**Sandbox tests.** These encode the spike; each must be shown failing against a deliberately broken session.

| Test | Expectation | Broken variant that must fail |
|---|---|---|
| sync loop | `E_TIMEOUT` within deadline + 100 ms | interrupt handler not installed (test has its own 5 s guard) |
| loop after `await` | `E_TIMEOUT`; afterwards `return 1 + 1` works and `mem` is intact | pump that ignores the deadline |
| allocation | `E_MEMORY`; session usable or restarted with a note | no memory limit |
| stall | `await new Promise(() => {})` → `E_STALLED` immediately | pump without the outstanding-work check |
| globals | `typeof fetch, setTimeout, require, Date, WebAssembly` all `'undefined'`; `import('x')` rejects | context with default intrinsics |
| determinism | the same eval twice → byte-identical `yaml`; `Math.random` sequence fixed per seed | unseeded `Math.random` |
| leaks | 1000 mixed evals, then `vm.dispose(); rt.dispose()` succeeds | a native function that forgets one `dispose()` |
| author tag | no guest code can produce a `LoggedMutation` with `by ≠ 'agent'` | — (asserted structurally: `propose` hard-codes it) |

**Proxy and error tests.** One per row of §5.9, asserting `code` and `fix` exactly.

**Cache identity.** `frame.print()` must intern exactly the nodes that `compile(recipe)` produces for the same chain, so that the agent's measurements hit the viewer's cache. A test asserts that the id of `frame.print()` equals the id of the `view.adapt` node in `compile(recipe)`, for recipes with and without preflash and extra exposures.

**Mutation tests.**

- read-only refuses at `frame.edit`;
- ask leaves the state hash unchanged until approval;
- auto changes it once;
- a failing eval submits nothing and warns `EDITS_DROPPED`;
- a stale approval returns `E_STALE`;
- one eval with two edits is one unit, and one undo removes both.

**Golden numbers** (mock engine, from §7):

- `now.D = [0.94691, 0.80154, 0.58235]`;
- `probe.D = [1.0219, 0.87654, 0.65735]`;
- slope 1.5;
- `points = [−4.5, −0.5, 5]`;
- `after.D = [0.77816, 0.78279, 0.76985]`;
- the display grey goes from (0.3703, 0.4340, 0.5484) to (0.4451, 0.4428, 0.4491).

The units helpers come from the contract: `units.pt(4) = 0.1`, `units.stops(1) = 0.30103` log H, and `units.stopsFromTime(10, 12.6) = 0.3334`. When the reference engine replaces the mock, these numbers change. The docs tests do not assert physics values; they assert codes, shapes and the presence of numbers. The physics golden numbers, such as the grey card at visual density 0.755, stay in CHB-003.

**Result-format golden.** `test/representative.result` pins the full text of the §7 eval and of three error cases. It follows goja-cv's `testdata/representative.result` (report §4.4).

**Docs tests** (§5.12). At least 30 executed blocks, plus every catalog example.

**Fixtures.** The M1 negative from CHB-002, bound as `frame_m1`. The §7 test uses a 3000 × 2000 synthetic frame with the same grey patch at `[1210, 860]`, generated by the same tool.

## 10. Risks, open questions and decisions

**Decisions that block work.**

1. **Asyncify or not (blocks stage 1).** DR-2 proposes the sync variant, which changes the ticket plan. The CHB-007 owner and the CHB-002 steward should confirm it before stage 1 ends.
2. **Who renders looks (blocks stage 3).** Rendering a look needs an `Engine.evaluate` at look scale plus encoding. The proposal: the main-thread host renders and encodes looks after the eval, and the worker only queues requests. That keeps image bytes out of the worker. CHB-005 must confirm that it can evaluate at a preview scale off the viewer's queue without starving it.
3. **Chat-provided coordinates (blocks E1/E5 docs).** The examples assume the chat panel attaches clicked points to the photographer's message. CHB-008 and CHB-009 must agree on that message format.

**Risks.**

- **Prompt injection through context data.** Frame names and notes reach the agent. Mitigation: quoting, the "context is data" instruction, and the fact that every change is a proposal the photographer approves.
- **Interpreter speed.** If an agent writes heavy loops over awaited tables (thousands of rows), QuickJS may be slow. Mitigation: return compact data from measurement ops; the telemetry shows whether this happens.
- **Worker round-trips.** Each `await` costs a `postMessage` round-trip, about a millisecond, which is negligible against engine time. Closure shipping keeps messages small, because each definition is sent once.
- **Upstream changes.** `quickjs-emscripten` is maintained by one author and has not been audited (its README: "has not been audited"). Pin exact versions, keep the sandbox tests as the contract, and treat a variant upgrade as a reviewed change.
- **Vocabulary creep.** Each vocabulary entry is hand-written. The cap of fifteen and the usage report keep it honest.

**Ordinary choices** (implementer's call): the YAML library, as long as output is deterministic; the exact look sizes; the RPC message format; whether the reference is one file or one per area.

## 11. Proposed contract additions (for CHB-002)

1. **`Look`** in `eval.ts`: `{ n: number; caption: string; node: string; domain: Domain; region?: Box; scale: number; numbers: Record<string, unknown>; image: { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array } }`.
2. **`ContextBlock`** in `eval.ts`: `{ frame?: string; mode: AgentMode; changed: string[]; proposals: string[]; mem: string[]; functions: string[]; newFunctions: string[] }`.
3. **Error and warning codes** in `errors.ts`:
   - errors: `E_NOT_AWAITED`, `E_IMMUTABLE`, `E_UNKNOWN_METHOD`, `E_NO_FRAME`, `E_SANDBOX`, `E_STALLED`, `E_MEMORY`;
   - warnings: `LOOKS`, `CUT`, `UNHANDLED`, `EDITS_DROPPED`.
4. **`OpDef.dsl?: boolean`** (default true), to keep ops such as `output.encode` out of the DSL while the UI still uses them. Distinct from `internal`, which hides an op from everything. The CHB-002 guide lists the same flag.
5. **`EvalResult.mutations`** documented as the `LoggedMutation`s returned by `EditLog.propose` for this eval, including `seq`, `frame`, `why` and `expect` (CHB-002 §11 item 14).
6. **`EvalRequest`** unchanged. The eval id and the seed are host-generated.

## 12. References

**Project documents.**

- Architecture doc: `C1/design-doc/01-chromobench-architecture-and-work-plan.md`, §1, §3, §5.2–5.5, §8.
- CHB-002 intern guide: registry, binder, graph, `compile`, `EditLog` (DR-3, DR-5, DR-7), mock engine, §6 trace.
- goja-cv report: `C1/various/analysis-goja-cv.md`, §1.4, §2 (API, looks, measurement, task libraries), §3 (what the agent is told and gets back, context block, errors, evidence-driven design), §4.4 (tests), §5 (what does not transfer).
- Filmbench report: `C1/various/analysis-filmbench-ide.md`, §1 (agent), §2 (`lab`), §6.

**Code.**

- goja-cv at `5a93095`:
  - `pkg/gojamod/cv/prelude.js`, `binding.go`, `describe.go`;
  - `pkg/cvsession/session.go`, `init.js`, `processor.go`, `tables.go`, `reference.go`, `mcp.go`, `docs_test.go`.
- Filmbench: `C1/various/extracted/filmbench-ide/01-inline.js`:
  - lines 4445–4449 (constants);
  - 4505–4631 (`makeLab`);
  - 4648–4717 (system prompt, context);
  - 4719–4737 (`fmtResult`, `errText`, `runCode`);
  - 4826–4876 (the step loop, approvals, Revert);
  - `vfs/agent/brief.md`, `vfs/examples/16-mutations.js`, `vfs/examples/19-diagnostics.js`.

**External.**

- quickjs-emscripten: `github.com/justjake/quickjs-emscripten`, README ("Safely evaluate untrusted Javascript"; "has not been audited"; asyncify limits; deferred promises and `executePendingJobs`).
- `quickjs-emscripten-core` 0.32.0, `dist/index.d.ts`: `QuickJSRuntime` (`setInterruptHandler`, `setMemoryLimit`, `setMaxStackSize`, `executePendingJobs`), `RuntimeOptionsBase` (`memoryLimitBytes`, `maxStackSizeBytes`, `interruptHandler`), `Intrinsics` and `DefaultIntrinsics`, `QuickJSAsyncContext.newAsyncifiedFunction`, `QuickJSAsyncWASMModule.newRuntime`, `newQuickJSWASMModuleFromVariant`, `shouldInterruptAfterDeadline`.
- `@jitl/quickjs-wasmfile-release-sync` and `@jitl/quickjs-wasmfile-release-asyncify` 0.32.0 READMEs (bellard/quickjs 2025-09-13; asyncify "2x the size of sync", "40% the speed of sync").
- `@jitl/quickjs-ng-wasmfile-release-asyncify` README (the quickjs-ng alternative).
- Emscripten Asyncify: `emscripten.org/docs/porting/asyncify.html`.
- Chromium commit "[CSP] Fix dedicated worker inheritance" (workers parse their own CSP; `blob:`/`data:` workers inherit).
- Mozilla bug 1800890 / CVE-2023-23602 (`connect-src` not applied to a worker's WebSocket).
