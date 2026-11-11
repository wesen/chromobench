---
Title: Diary
Ticket: CHB-007
Status: active
Topics:
    - dsl
    - js-api
    - agent
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:23.571919131-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on CHB-002 and CHB-007 (contract and DSL runtime). The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into `design-doc/01-intern-guide-dsl-runtime.md` (10735 words), added 16 staged tasks, and related the primary source files.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Requested milestone: a complete intern guide plus a task breakdown for this ticket.
**Inferred user intent:** The ticket can be picked up by a new engineer or agent without prior context.

### Evidence and commits
- Brief: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md` (session scratchpad); shared map: CHB-001 `design-doc/01-chromobench-architecture-and-work-plan.md`.
- Filed with `python3 -I CHB-001/scripts/07-ingest-intern-guides.py <agent output> .` and checked with `scripts/08-check-guide-markdown.py` (fences tagged, no raw HTML).
- Writer agent: one background general-purpose agent for CHB-002 + CHB-007; ran a quickjs-emscripten 0.32.0 spike on Node 24.18 in the session scratchpad (guides/spike/); CHB-007 recommends the sync QuickJS variant with host promises over asyncify (DR-2).
- The writer's own summary, kept as returned:

> Both intern guides are below in the brief's block format: CHB-002 "Contract and walking skeleton" and CHB-007 "DSL runtime". I also ran a small spike in the scratchpad: quickjs-emscripten 0.32.0 on Node 24.18, scripts in `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/spike/`. Nothing under `ttmp/` or goja-cv was modified.
> 
> Points you should know before storing them:
> 
> - **CHB-007 recommends against the planned asyncify variant.** It proposes the sync variant with host promises instead (DR-2), and the guide marks this as a change to the ticket plan. The reasons:
>   - Agent code runs as an async function body, so everything after the first `await` executes inside `executePendingJobs`, and that call has no async version in 0.32.0.
>   - In the spike, an asyncified call made after an `await` returned "0 jobs" while it was still suspended. A second eval then ran during the suspension.
>   - The asyncify build is twice the size (1.03 MB against 503 KB) and runs at about 40 % of the speed of the sync build.
> - **Other spike observations, which stage 1 of CHB-007 is to turn into tests:**
>   - host promises work across `await` chains and `Promise.all`;
>   - interrupts stop loops both before and after an `await`, and the same VM keeps working afterwards;
>   - the memory limit raises "out of memory";
>   - `Symbol.toPrimitive` traps fire;
>   - `Function.prototype.toString` keeps the source, comments included;
>   - `Date` can be disabled, but `Eval: false` breaks `evalCode` entirely;
>   - a leaked handle makes `rt.dispose()` abort.
> - **CHB-002 corrects one inconsistency in the architecture doc.** The vocabulary example `{path:'print.lights', value:[0,4,-2]}` should be `print.lights.logH`, with values in log H. This is listed under proposed contract additions.
> - **Both guides use the same mock-engine numbers.** A grey patch goes from (0.370, 0.434, 0.548) to (0.313, 0.434, 0.548) at +4 pt red. The agent's balance proposes lights of −4.5 / −0.5 / +5 pt.
> 

### Noteworthy decisions or failures
- The guide's "Proposed contract additions (for CHB-002)" section, where present, is a proposal. It must be reconciled with CHB-002 before implementation.
- Numbers the writer computed for the guide (not from the textbook) are labelled as such in the guide. They are not independently re-verified here.

### Remaining requirements and next action
- Implementation has not started. Tasks in `tasks.md` are open.
- Next: review the guide, settle the open decisions it lists, and start stage 1.

## Step 2: Orientation: the brief, the writing procedure, the architecture doc and the ticket layout

Before touching the DSL sources, I read the orchestrator's common brief, the design-guide writing procedure and the CHB-001 architecture document. For CHB-007, the architecture doc fixes the eval contract (`EvalRequest`, `EvalResult`, `Diagnostic`), the vocabulary and the ticket plan. The plan included the choice of the asyncify variant, which this guide later changes (Step 13).

This gave the guide its frame: the DSL is the agent's view of CHB-002's registry, recipe and edit log, not a second application. I wrote nothing into the ticket.

### Prompt Context

**User prompt (verbatim), for the guides:** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."

**User prompt (verbatim), for this diary:** "ask them to write all detailed diaries for their work and add those to the ticket too, see diary skill for the format."

**Orchestrator brief (from the orchestrator, not the user's words):** The task message asked this agent to write the CHB-002 and CHB-007 guides from the common brief, `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md`. The brief requires the following:
- use the architecture doc's vocabulary;
- follow the two-pass writing procedure;
- tag every code fence and use no raw HTML;
- treat `ttmp/` and goja-cv as read-only;
- web research is allowed, with citations and no identifying information;
- do not write the guide into the ticket;
- return the GUIDE, TASKS and RELATED blocks through SubagentHandback.

**Assistant interpretation:** Write the CHB-007 intern guide: the QuickJS sandbox, the prelude and handle proxies, result shaping and the generated docs. Back the sandbox claims with evidence, not assumption.

**Inferred user intent:** An intern should be able to build the agent's eval runtime safely and in step with CHB-002's contract.

**Commit (code):** none. This agent made no commits.

### What I did
- Read the common brief (#1, 15:43:51Z).
- Listed C1 (#2).
- Read `/home/manuel/.claude/skills/ticket-research-docmgr-remarkable/references/writing-style.md` (#3).
- Read `C1/design-doc/01-chromobench-architecture-and-work-plan.md` (#4).
- Read `C1/various/analysis-goja-cv.md` and `C1/various/analysis-filmbench-ide.md` (#5, #6).
- Listed the ticket directories (#67).

### Why
- The DSL's names are generated from CHB-002's registry, so both guides had to share the architecture doc's vocabulary.

### What worked
- The ticket directory `CHB-007--dsl-runtime-quickjs-sandbox-generated-bindings-agent-ergonomics` exists.

### What didn't work
- No failures in this step.

### What I learned
- The goja-cv report's evidence-driven lessons are the strongest inputs for the DSL's ergonomics:
  - live parameters were used 0 times in 751 evals;
  - agents paste helpers instead of reading docs;
  - errors must carry fixes.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Read architecture doc §1, §3, §5.2–5.5 and §8 before reviewing the guide.

### Technical details
- In this diary, C1 means `/home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`, and SP means `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/`.
- Tool-call numbers (#n) follow the order of tool-use entries in `/home/manuel/.claude/projects/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/subagents/agent-afd006dbea6d43a29.jsonl`, as listed by `SP/diary-002-007/extract.py`. Entries repeated without timestamps are counted. Times are UTC.

## Step 3: goja-cv study: the prelude, native bindings and session processing

goja-cv already solved the agent-DSL problem in Go: lazy handles, awaitable nodes, errors with fixes, YAML results, looks, context blocks and docs executed as tests. I read its JS prelude, its native binding and its session and processor code, to port the design and cite exact lines.

Nearly all of the agent-facing design transferred, and guide §4.1 marks most rows "All of it". Two things did not: a session marked broken after a timeout, and live parameters.

### Prompt Context
See Step 2.

### What I did
- Ran `git log --oneline -1` and `wc -l` on the DSL files in `~/code/wesen/go-go-golems/goja-cv` (#9).
- Read `pkg/gojamod/cv/prelude.js` (#22) and `describe.go` (#23).
- Read `binding.go` lines 1–300 (#26) and 300–460 (#41).
- Read `pkg/cvsession/init.js` (#27), `session.go` (#28), `processor.go` (#32), `tables.go` (#33), `reference.go` (#36), `docs_test.go` (#37) and `mcp.go` (#40).

### Why
- CHB-007 should reuse proven agent ergonomics rather than rediscover them.

### What worked
- The revision was `5a93095`. Line counts:
  - `prelude.js` 301, `binding.go` 458, `describe.go` 246;
  - `session.go` 543, `processor.go` 581, `tables.go` 216, `reference.go` 132;
  - `mcp.go` 218, `init.js` 109, `docs_test.go` 194.
- Citations used in guide §4.1:
  - `prelude.js`: 1–14, 18–35, 39, 42, 66–111, 140–189 and 217–224;
  - `binding.go`: 72–97, 247–288, 343–382 and 420–431;
  - `describe.go`: 11–20 and 213–235;
  - `session.go`: 39–50, 185–191, 298–306 and 370–412;
  - `init.js`: 1–108;
  - `processor.go`: 64–89, 116–179, 221–237, 314–331, 332–407, 459–467 and 475–537;
  - `tables.go`: 16–126;
  - `reference.go`: 11–86;
  - `mcp.go`: 45–52;
  - `docs_test.go`: 98–100 and 125–173.

### What didn't work
- No failures in this step.

### What I learned
- goja-cv's wrapper `__cv_run(async function () {\n…\n})` shifts agent line N to source line N+1. The guide keeps the same one-line prefix.
- goja-cv marks the session broken when an interrupt hits an async continuation (`processor.go` 314–331). Whether QuickJS needs the same became a spike question (Step 7).
- `docs_test.go` uses info-string tags `warns=`, `error=`, `looks=` and `fragment`, plus a floor on the block count. Guide §5.12 ports them.

### What was tricky to build
- Domain filtering has no goja-cv equivalent. goja-cv offers every op on every handle, while chromobench handles must offer only the ops that accept their domain. The guide adds the per-domain method table in §5.7.

### What warrants a second pair of eyes
- The line ranges were read at `5a93095` and should be spot-checked.

### What should be done in the future
- N/A.

### Code review instructions
- Compare guide §4.1 with `/home/manuel/code/wesen/go-go-golems/goja-cv/pkg/gojamod/cv/prelude.js` and `/home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cvsession/processor.go`.

### Technical details
- goja-cv defaults: 60 s, 9000 characters, 4 looks, 8 MiB. The guide keeps 9000 characters and 4 looks, and uses 30 s.

## Step 4: Filmbench IDE study: the agent lab, the eval runner and approvals

Filmbench is the prototype that actually runs an agent against the darkroom. I read its agent object, its system prompt, its eval runner and its step loop. The goal was to take its darkroom vocabulary and show concretely why it needs a sandbox.

The vocabulary (what-ifs, sweeps, receipts) and the approval reporting transferred. The runner did not: page-scope `AsyncFunction`, a `Promise.race` timeout and a global `V2.by`. Those became the motivating examples in guide §2.2.

### Prompt Context
See Step 2.

### What I did
- Read `makeLab` at 4505–4631 in `C1/various/extracted/filmbench-ide/01-inline.js` (#51).
- Read line 4602 (`lab.set`) and 4648–4740 (system prompt, context, `fmtResult`, `runCode`) (#52).
- Read 4826–4876 (the step loop, approvals and Revert) (#53).
- Read `vfs/agent/brief.md`, `examples/16-mutations.js` and `examples/19-diagnostics.js` (#54), then `controls.js`, `main.js` and `examples/13-mosaic.js` (#55).
- Later ran `grep -n "WRITE_RE\s*=\|const MAX_STEPS\|EVAL_MS\s*=\|AsyncFunction\s*=" 01-inline.js` (#112, 15:57:06Z).

### Why
- The guide must show an intern exactly what goes wrong without a sandbox, using the project's own code.

### What worked
- #112 returned:
  - `4448:const MAX_STEPS = 10, EVAL_MS = 25000, …`;
  - `4449:const WRITE_RE = /\blab\s*\.\s*(write|remove|export|useAsScene)\b/;`;
  - `AsyncFunction` defined at 3108 and used at 4445.

### What didn't work
- No failures.

### What I learned
- `lab.set` goes through `wb.apply`, so ask mode queues it, but it writes the base layer. The recipe model removes that confusion.
- Older steps are compressed to one line each, and the approval outcome is appended to the result. Both ideas feed the context block.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Guide §2.2 says "writes outside the log are detected by a regular expression (`WRITE_RE`, line 4449)". The regex matches `lab.write|remove|export|useAsScene`, which are file and scene operations. A reviewer should check whether "writes outside the log" describes its purpose accurately.

### What should be done in the future
- N/A.

### Code review instructions
- Compare guide §2.2 and §4.2 with `C1/various/extracted/filmbench-ide/01-inline.js` 4445–4876.

### Technical details
- `runCode` is at 4731–4737, the 25 s race at 4734 and `V2.by = 'agent'` at 4735.

## Step 5: quickjs-emscripten documentation research on the web

The guide needs the real quickjs-emscripten API, not a remembered one. I fetched the README, the npm page and the generated class docs. Several fetches failed or came back truncated. That pushed me to download the package and read its type definitions directly (Step 6).

The web pages confirmed the variant system and the minimal setup, `quickjs-emscripten-core` plus `@jitl/quickjs-wasmfile-release-sync`. They did not provide complete method signatures.

### Prompt Context
See Step 2.

### What I did
- Loaded WebFetch and WebSearch (#68).
- #69: WebFetch of the GitHub README.
- #70: WebFetch of `https://www.npmjs.com/package/quickjs-emscripten`.
- #71: WebFetch of the raw README.
- #72: WebSearch `"newQuickJSAsyncWASMModuleFromVariant" "@jitl/quickjs-wasmfile-release-asyncify"`.
- #73: the quickjs-ng asyncify README on jsdelivr.
- #74: the debug-asyncify 0.31.0 README on unpkg.
- #75–#78: the `QuickJSRuntime` and `QuickJSAsyncContext` class docs on GitHub.

### Why
- The sandbox design depends on the interrupt, memory-limit, promise and asyncify APIs behaving as documented.

### What worked
- #71 quoted: "The most minimal setup would be to install `quickjs-emscripten-core` and `@jitl/quickjs-wasmfile-release-sync`".
- #73 confirmed the import pattern `newQuickJSAsyncWASMModuleFromVariant(variant)` and that the quickjs-ng variant uses quickjs-ng v0.12.1.
- #75 gave `setMemoryLimit` ("To remove the limit, set to `-1`") and the purpose of `setInterruptHandler`.

### What didn't work
- #70: "The server returned HTTP 403 Forbidden."
- #69: the README showed version 0.25.0 in its CDN examples, which is out of date relative to npm (Step 6).
- #76–#78: the class doc pages were truncated. #77 and #78 reported that "None of the requested functions (`newAsyncifiedFunction`, `newFunction`, `newPromise`, `resolvePromise`, …) appear in this excerpt."
- Recovery: download the published package and read `dist/index.d.ts` (Step 6).

### What I learned
- The rendered GitHub docs are too long for a single fetch. The typings are the reliable source.
- #76 reported the warning that calling `dispose()` "without disposing of all created handles will result in an error". This anticipated the spike failure in Step 7.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- N/A.

### Technical details
- The first draft said "since version 0.26" about the core/variant split. This came from no verified source and was removed in review (Step 14).

## Step 6: quickjs-emscripten-core 0.32.0 package inspection: typings and build internals

Because the web docs were incomplete, I downloaded the published packages and read their typings and minified build. The goal was exact signatures, the documented asyncify limits, and an answer to whether `executePendingJobs` has an asynchronous path.

The typings provided every API name used in the guide and the two asyncify limit quotes. The build showed that only evaluation has a "maybe async" entry point. Several grep attempts on the minified file failed, and Python solved it.

### Prompt Context
See Step 2.

### What I did
- #79: `npm view quickjs-emscripten-core version dist-tags --json` in `SP/guides/qjs`.
- #80: `npm pack quickjs-emscripten-core@0.32.0` and `tar -xzf` into `SP/guides/qjs/core`.
- #81–#86: grep and `sed -n` over `core/package/dist/index.d.ts`, 2033 lines, for:
  - `InterruptHandler`, `setInterruptHandler`, `executePendingJobs`, `setMemoryLimit`;
  - `Intrinsics` and `DefaultIntrinsics`;
  - `RuntimeOptionsBase`, `QuickJSAsyncWASMModule` and `QuickJSDeferredPromise`.
- #87–#93: grep over the minified chunks for `QTS_*` entry points and `handleAsyncify`.
- #94: printed the `handleAsyncify` body with `python3 -I -c` reading `chunk-V2S4ZYJR.mjs`.
- #95–#97: `npm view` of four variant packages, `npm pack` of the sync and asyncify variants, and `ls -la` of their `.wasm` files and READMEs.

### Why
- DR-2 (sync versus asyncify) had to rest on what the 0.32.0 code actually does.

### What worked
- #79: `"version": "0.32.0"`, `"latest": "0.32.0"`. #80: 0.32.0 was published `2026-02-16T04:48:40.889Z`.
- #87: `QTS_ExecutePendingJob` appears once, in `chunk-V2S4ZYJR.mjs`, the sync path. `QTS_Eval_MaybeAsync` appears twice, in `chunk-TAV5CUKK.mjs`.
- #89: in the async context, `newAsyncifiedFunction(name,fn){return this.newFunction(name,fn)}`.
- #94: `handleAsyncify(asyncify,fn){if(asyncify)return asyncify.handleSleep(…` throws `QuickJSAsyncifyError` "Already suspended at:" on a second suspension.
- #97: the sync wasm is 503,134 bytes. The asyncify README names bellard/quickjs `2025-09-13+f1139494`, vendored 2026-02-15.
- The asyncify README says: "This imposes substantial size (2x the size of sync) and speed penalties (40% the speed of sync)."
- The sync README says: "Note that both variants support regular async functions."
- The typings contain "Asyncified functions must never call other asyncified functions or" (line 425) and "module are limited to a single async call at a time" (line 1782).

### What didn't work
- #88 exited with code 1:

```text
Exit code 1
e,filename="eval.js",options){let detectModule=…QTS_Eval_MaybeAsync(…)…
(eval):1: === not found
```

  The first grep printed. The `echo ====` separator then failed, because zsh treats a word starting with `=` as a command lookup.
- #90, #91 and #93: grep patterns such as `handleAsyncify(asyncify,fn){.\{600\}` returned "(Bash completed with no output)". The cause was not determined.
- Recovery: #94 used Python `str.find` on the file, which worked.

### What I learned
- In 0.32.0, only `evalCodeAsync` can suspend. Code after the first `await` in an agent's async body runs inside the synchronous `executePendingJobs`. That is the structural reason behind DR-2.

### What was tricky to build
- Reading minified bundles. Python slicing around a known substring was more reliable than grep with fixed-width regexes.

### What warrants a second pair of eyes
- The "40 % of the speed" figure is the README's claim, not a measurement made here.

### What should be done in the future
- N/A.

### Code review instructions
- `grep -n "must never call other asyncified\|single async call at a time" /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/qjs/core/package/dist/index.d.ts`

### Technical details
- Package directories:
  - `SP/guides/qjs/core`;
  - `SP/guides/qjs/sync`;
  - `SP/guides/qjs/as` (the asyncify wasm, 1,027,523 bytes).

## Step 7: Spike 1: host promises, interrupts, the memory limit, proxies, `toString`, stacks and asyncify

I installed the three packages into an isolated scratch directory and ran a Node script. It exercised every QuickJS behaviour the sandbox design relies on. This is runtime evidence from Node 24.18, not from a browser or a Web Worker.

Most behaviours worked as the design needs:
- host promises;
- interrupts both before and after `await`, with the VM still usable;
- the out-of-memory error;
- `Symbol.toPrimitive` traps;
- exact `toString` source;
- stack line numbers.

`rt.dispose()` aborted because of a handle leak in the spike script. On the second run, the asyncify section showed that a call after an `await` completes only after waiting and pumping again.

### Prompt Context
See Step 2.

### What I did
- #98: `node --version` gave `v24.18.0`. Then `npm install --ignore-scripts --no-audit --no-fund quickjs-emscripten-core@0.32.0 @jitl/quickjs-wasmfile-release-sync@0.32.0 @jitl/quickjs-wasmfile-release-asyncify@0.32.0` in `SP/guides/qjs-deps` printed "added 4 packages in 393ms".
- #99 (15:50:23Z): wrote `SP/guides/spike/spike.mjs` and ran `node spike.mjs SP/guides/qjs-deps`. The script loads packages by path from the deps directory and runs these cases:
  1. awaits on host deferred promises, pumped by a timer loop;
  2. interrupts: (a) sync, (b) inside a promise job, (c) promises run after the interrupt;
  3. the memory limit at 64 MiB;
  4. asyncify;
  5. and 6. a proxy `toPrimitive` trap, `Function.prototype.toString` and a stack trace.
- #100: added `d.dispose()` for each deferred, wrapped `vm.dispose(); rt.dispose()` in try/catch, and reran.

### Why
- DR-1 and DR-2 make claims about interrupts, memory and asyncify. Those claims had to be observed.

### What worked
- Output of #99 and #100, identical up to the dispose line:

```text
1 sync deferred await: fulfilled {"a":10,"b":20,"c":30,"d":40}
2a interrupt sync: {"name":"InternalError","message":"interrupted","stack":"    at <eval> (eval.js:1:1)\n"}
2b interrupt in job: executePendingJobs ok 1 | promise rejected {"name":"InternalError","message":"interrupted","stack":"    at <anonymous> (eval.js:1:20)\n"}
2c promises after interrupt: fulfilled 7
3 memory limit: {"name":"InternalError","message":"out of memory","stack":"    at <eval> (eval.js:1:42)\n"}
5/6 proxy, toString, stack: {"mul":"E_NOT_AWAITED","cmp":"E_NOT_AWAITED","tmpl":"E_NOT_AWAITED","src":"async (x, y) => { // the best point within 2 px\n      return x }","mathRandomType":"function","hasDate":"function","stack":"    at <anonymous> (agent.js:12:40)\n    at <eval> (agent.js:12:76)\n"}
```

- Additional lines from #100 only:

```text
4a asyncify in sync part: 42
4b asyncify after await: job ok | promise fulfilled 10
```

### What didn't work
- #99 aborted at the first `rt.dispose()`, and section 4 never ran:

```text
Aborted(Assertion failed: list_empty(&rt->gc_obj_list), at: ../../vendor/quickjs/quickjs.c,2036,JS_FreeRuntime)
RuntimeError: Aborted(Assertion failed: list_empty(&rt->gc_obj_list), at: ../../vendor/quickjs/quickjs.c,2036,JS_FreeRuntime). Build with -sASSERTIONS for more info.
    at QuickJSRuntime.dispose (…/quickjs-emscripten-core/dist/chunk-V2S4ZYJR.mjs:5:3564)
    at file:///…/scratchpad/guides/spike/spike.mjs:86:20
```

- #100 still logged `dispose failed: RuntimeError: Aborted(Assertion failed: list_empty(&rt->gc_obj_list), …)` even with `d.dispose()` added. Wrapping the call in try/catch let section 4 run.

### What I learned
- An interrupt inside a promise job rejects that job's promise, and the same VM keeps running new promises (2c). This differs from goja-cv, which had to mark its session broken.
- A leaked handle aborts the whole WASM module at dispose time. The guide makes a leak test mandatory.
- In section 4b, the asyncified call after `await null` did complete, but only after a 50 ms wait and a second `executePendingJobs`. Step 8 examines this further.

### What was tricky to build
- Handle lifetimes in the spike itself. The leak was not pinpointed. A likely candidate, not verified, is the handle returned by `vm.getPromiseState(res)` in the `while` condition of section 1, which is never disposed when the state becomes fulfilled.

### What warrants a second pair of eyes
- DR-1's consequence line says "in the spike, a leaked handle made `runtime.dispose()` abort". That a leak causes the abort is supported by the assertion text and by Step 8, but the specific leaked handle was not identified.
- DR-1's table says the out-of-memory error occurred "at a 32 MiB limit". In spike 1 it was observed at 64 MiB. The 32 MiB run (Step 8) showed a clean dispose but did not print the error text.

### What should be done in the future
- Stage 1 of CHB-007 turns each numbered case into a Vitest test, including a leak detector that fails on a forgotten `dispose()`.

### Code review instructions
- Run `cd /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/spike && timeout 60 node spike.mjs /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/qjs-deps`.

### Technical details
- The interrupt handler in the spike was `() => Date.now() > deadline`, with deadlines of 200 ms for the loops and 2000–5000 ms otherwise.

## Step 8: Spike 2: isolating the dispose failure, and asyncify re-entry while suspended

Spike 1 left two questions. Does one of the failure paths (interrupt, out of memory) leave a runtime that cannot be disposed? And what exactly happens when an asyncified host function is called after an `await`? I wrote a second script that runs each case in a fresh runtime and probes asyncify step by step.

None of the four cases broke dispose, so the spike 1 abort came from the script's own handle bookkeeping. Under asyncify, the first `executePendingJobs` returned 0 while the call was still suspended, and a second `evalCodeAsync` ran during the suspension. This is the core evidence for DR-2.

### Prompt Context
See Step 2.

### What I did
- #101 (15:50:57Z): wrote `SP/guides/spike/spike2.mjs` and ran it with `timeout 60 node spike2.mjs SP/guides/qjs-deps`. It runs:
  - `plain`, `interruptSync`, `interruptJob` and `oom`, each in a new sync runtime with a 32 MiB limit and a 200 ms deadline, followed by dispose;
  - an asyncified `slow(x)` that waits 20 ms, called after `await null`. The script then calls `executePendingJobs` once and runs `evalCodeAsync('1+1')` while the call is suspended.

### Why
- To tell a library hazard from a spike bug, and to test asyncify's documented one-call-at-a-time limit.

### What worked
- Output:

```text
plain dispose ok
interruptSync dispose ok
interruptJob dispose ok
oom dispose ok
first executePendingJobs returned 0 | state pending
second entry while suspended: 2
```

### What didn't work
- There were no failures in the script itself. The asyncify behaviour is the finding, not an error.

### What I learned
- With asyncify, the host gets no signal from `executePendingJobs` that a job is suspended, and nothing stops re-entry during the suspension. The typings document this situation as unsupported: "All runtimes inside a module are limited to a single async call at a time."

### What was tricky to build
- Asyncify suspension is invisible to the caller of `executePendingJobs`. The script had to check the promise state explicitly to see it.

### What warrants a second pair of eyes
- Guide DR-2 states the "0 jobs" and re-entry observations. It does not mention that spike 1's section 4b eventually fulfilled (value 10) after waiting and pumping again. The argument for DR-2 is about ergonomics and re-entrancy hazards, not about asyncify failing outright, and a reviewer should read it that way.

### What should be done in the future
- The stage 1 test "asyncify re-entry" should reproduce both observations before the variant choice is confirmed (guide §10, decision 1).

### Code review instructions
- Run `cd /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/spike && timeout 60 node spike2.mjs /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/qjs-deps`.

### Technical details
- The asyncify module came from `newQuickJSAsyncWASMModuleFromVariant(@jitl/quickjs-wasmfile-release-asyncify)`, version 0.32.0.

## Step 9: Spike 3: default globals, intrinsics and a seeded, frozen `Math.random`

The sandbox claims that agent code can reach nothing except the DSL, and that results are deterministic. I probed the globals of a default context, a context with `Date` and `Eval` disabled, and a prelude-style replacement of `Math.random`.

A default context has no `console`, timers, `require`, `fetch` or `WebAssembly`, and 61 own globals. Disabling `Eval` breaks `evalCode` itself, so the guide keeps `Eval` on. The seeded `Math.random` resists reassignment.

### Prompt Context
See Step 2.

### What I did
- #102 (15:51:20Z): wrote `SP/guides/spike/spike3.mjs` and ran it with `timeout 60 node spike3.mjs SP/guides/qjs-deps`. It probes typeofs and the global count in a `default` context and a `noDateNoEval` context (`{...DefaultIntrinsics, Date: false, Eval: false}`). It then installs mulberry32(42) as `Math.random` with `Object.defineProperty(…, {writable: false, configurable: false})`, freezes `Math` and attempts a reassignment.

### Why
- DR-1's "reachable APIs" and the §5.5 determinism rules needed observed facts.

### What worked
- Output:

```text
default {"console":"undefined","setTimeout":"undefined","require":"undefined","fetch":"undefined","importFn":"object","Date":"function","eval":"function","Function":"function","WebAssembly":"undefined","globalKeys":61}
noDateNoEval error {"name":"TypeError","message":"eval is not supported","stack":""}
seeded Math.random: [0.6011037519201636,0.44829055899754167,"assign ignored"]
```

### What didn't work
- The `noDateNoEval` context refused the probe itself with `TypeError: eval is not supported`. Disabling `Eval` therefore cannot be used. Step 11 tested `Date: false` on its own.

### What I learned
- `typeof import('x')` is `"object"`: dynamic import returns a promise rather than throwing synchronously.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The guide's sandbox test table expects "`import('x')` rejects". The spike only showed that it returns an object (a promise). Whether that promise rejects was not observed.

### What should be done in the future
- Add an explicit test that awaits `import('x')` and checks for rejection.

### Code review instructions
- Run `cd /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/spike && timeout 60 node spike3.mjs /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/qjs-deps`.

### Technical details
- The mulberry32 constants were 0x6D2B79F5 and the multipliers 61 and 1|a, as in Chromogen's law harness.

## Step 10: Research: the alternative of a Web Worker plus CSP

DR-1 compares QuickJS-in-WASM with a plain Web Worker locked down by a Content Security Policy. I searched for how dedicated workers get their CSP, and for known leaks. Only search-result titles and summaries were read; no spec or bug page was fetched.

The search gave two citable anchors: a Chromium commit titled "[CSP] Fix dedicated worker inheritance", and Mozilla bug 1800890 (CVE-2023-23602), titled "connect-src CSP header does not apply to WebWorker initiated WebSocket connections".

### Prompt Context
See Step 2.

### What I did
- #103 (15:51:32Z): WebSearch `Content Security Policy dedicated worker policy inherited blob URL worker response header CSP3 spec "workers"`.

### Why
- To give the rejected alternative a fair, sourced description rather than a strawman.

### What worked
- Result titles included:
  - "Closed Bug 1800890 (CVE-2023-23602)" and "connect-src CSP header does not apply to WebWorker initiated WebSocket connections" (`bugzil.la/1800890`);
  - "[CSP] Fix dedicated worker inheritance" (`chromium.googlesource.com/chromium/src/+/f7c475b89dc0281b63133497efefa6b6cc007c64`).
- The summary said that the Chromium commit makes dedicated workers parse their own response headers, while workers from local schemes (data, blob, filesystem) still inherit the creator's CSP.

### What didn't work
- The search summary stated: "I did not retrieve either of those documents, so I can't confirm their current wording." This applies to the CSP3 spec and the HTML spec. No page was fetched afterwards.

### What I learned
- A same-origin worker shares the library's IndexedDB. A Worker+CSP design would therefore also need an opaque-origin sandboxed iframe. The guide's DR-1 table says so.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The CSP claims in DR-1 rest on search-result titles and summaries. The rejected alternative does not drive any implementation, but a reviewer who disputes DR-1 should read the primary sources.

### What should be done in the future
- N/A.

### Code review instructions
- Guide §5.2, the "Network blocking" row.

### Technical details
- N/A.

## Step 11: Spike 4: `Date` disabled on its own, and line mapping after an `await`

After spike 3 showed that `Eval: false` is unusable, I tested `Date: false` on its own. I also checked the error line numbers for an agent body wrapped in the one-line async prefix, where the failing line runs after an `await`.

`Date` can be removed while `evalCode` keeps working. A throw on agent line 3, after the await, is reported as `agent.js:4:14`, so the guide's "line N = source line N + 1" rule holds.

### Prompt Context
See Step 2.

### What I did
- #110 (15:56:39Z): wrote `SP/guides/spike/spike4.mjs` and ran it with `timeout 60 node spike4.mjs SP/guides/qjs-deps`.
  - Case 1: a context with `{...DefaultIntrinsics, Date: false}` evaluating `JSON.stringify({ Date: typeof Date, ok: 1 + 1 })`.
  - Case 2: the body `const a = 1\nawait null\nconst b = a.x.y\nreturn b`, wrapped as `(async function () {\n…\n})()` and evaluated as `agent.js`, then `executePendingJobs`.

### Why
- §5.5 (no clocks) and §5.9 (where an error points) depend on both.

### What worked
- Output:

```text
Date off: {"Date":"undefined","ok":2}
error after await: {"name":"TypeError","message":"cannot read property 'y' of undefined","stack":"    at <anonymous> (agent.js:4:14)\n"}
```

### What didn't work
- No failures.

### What I learned
- Stack frames inside promise jobs still carry the eval's file name and line. A per-eval file name (`eval-N.js`) can therefore map errors in `mem` functions back to the eval that defined them.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Run `cd /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/spike && timeout 60 node spike4.mjs /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/qjs-deps`.

### Technical details
- The guide's wrapper is `'__cb_run(async function () {\n'` + code + `'\n})'`. It has the same one-line prefix as the spike.

## Step 12: Check: mock-engine numbers for the grey-card balance trace

The §7 trace follows one agent eval that measures a grey card, computes printer lights and proposes them. Its numbers must be reproducible. I computed them in Python with the same mock formulas as CHB-002, on the same pixel.

The trace numbers below appear in the guide exactly.

### Prompt Context
See Step 2.

### What I did
- #111 (15:56:50Z): ran `SP/guides/mock_numbers.py`. This is shared with CHB-002; see the CHB-002 diary, Step 7, for its full output.
- #113 (16:01:53Z): visual densities.
- #118 (16:10:41Z): an inline `python3 -I -c` that mirrors the eval's own steps: now, probe at +0.05, slope, mean, dx, half-point rounding, lights, after, and visual densities.

### Why
- The trace's result block and the golden numbers in §9 must match what the mock engine will compute.

### What worked
- Output of #118:

```text
now [0.94691, 0.80154, 0.58235]
probe [1.0219, 0.87654, 0.65735]
slope [1.5, 1.5, 1.5] [1.5000000000000036, 1.5000000000000013, 1.5000000000000013]
mean 0.77694 dx [-0.11332, -0.016406, 0.12972] pts raw [-4.532640822591331, -0.6562403022690889, 5.188881124860424] pts [-4.5, -0.5, 5.0] lights [-0.1125, -0.0125, 0.125]
after [0.77816, 0.78279, 0.76985]
after visual 0.78086
now visual 0.80726
```

- From #111, the display grey goes from (0.3703, 0.434, 0.5484) to (0.4451, 0.4428, 0.4491) at those lights.

### What didn't work
- No failures.

### What I learned
- With zero flare, the mock densitometer on `print-xyz` returns exactly the paper dye amounts, because `R = M⁻¹·M·10^−a`. The slope therefore equals the mock γ, 1.5.

### What was tricky to build
- Rounding to half points before converting back to log H, as a printer would. This makes the "after" spread 0.013 D rather than 0.

### What warrants a second pair of eyes
- The trace assumes flare 0 and zero filtration in the recipe. With the catalog default flare of 0.48 %, the numbers would differ.

### What should be done in the future
- Make the §7 eval a docs-test case against `engine-mock` once CHB-002 stage 7 exists.

### Code review instructions
- Rerun the #118 snippet; it is stored in the transcript.

### Technical details
- Pixel T = (0.20, 0.10, 0.05) against a rebate of (0.80, 0.50, 0.35); 10 s at f/8; grade 2.

## Step 13: Drafting the CHB-007 guide

I wrote the full guide to the scratchpad in one pass, following the brief's structure, and built the sandbox sections on the spike results. The main design decision recorded there is DR-2: the sync variant with deferred promises, explicitly changing the ticket plan's asyncify choice.

The draft covers:
- the sandbox, with its two decision records;
- the eval pump;
- determinism;
- the native bindings;
- the object model with domain-filtered handles;
- edits as one unit per eval (DR-3);
- the mistake → error → fix table;
- result shaping;
- the generated docs;
- telemetry;
- examples E1–E6;
- the traced balance eval;
- plan, tests, risks and contract additions.

### Prompt Context
See Step 2.

### What I did
- #119 (16:15:04Z): wrote `SP/guides/draft-chb-007.md`, 72,906 characters.

### Why
- The orchestrator files the guide, and the brief forbade writing into the ticket.

### What worked
- The draft was complete, with 18 code blocks (Step 14 counts them).

### What didn't work
- No tool failures. Review findings are listed in Step 14.

### What I learned
- goja-cv's lesson ("measure and delete") conflicts with chromobench's need for human controls. Putting all parameters in the recipe, keeping the DSL literal, and having `frame.edit` write mutations resolves the conflict. The guide explains this in §2.5.

### What was tricky to build
- `neg.print` had to be both a callable vocabulary macro and a namespace of generated `print.*` ops. The guide specifies a function-object proxy with a `get` trap and domain filtering.

### What warrants a second pair of eyes
- DR-2 changes the ticket plan and needs explicit confirmation (guide §10, decision 1).
- DR-3 delays the effect of `frame.edit`, so `frame.recipe` shows the eval-start state for the whole eval. Agents must use `receipt.preview`, which may surprise them.

### What should be done in the future
- N/A.

### Code review instructions
- Start with guide §5.2–5.4 (sandbox), §5.7–5.9 (object model, edits, errors) and §7 (trace).

### Technical details
- Draft path: `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/draft-chb-007.md`.

## Step 14: Review pass and revision

I reread the draft against the spike results and the brief, then applied the fixes with an asserted-replacement script, as for CHB-002. I then ran the mechanical checks for fences, raw HTML and table pipes. This was my own second pass; no reviewer agent was used.

All replacements applied and all checks passed. The guide ended at 10,735 words, near the top of the brief's typical range.

### Prompt Context
See Step 2.

### What I did
- #120 (16:15:49Z), a Python script with asserted replacements in `draft-chb-007.md`:
  - removed the unsourced "Since version 0.26" claim;
  - reworded the DR-2 context ("Only one kind of host call takes time here");
  - replaced the invalid `interface Frame { edit(…); edit: {…} }` sketch, which declared `edit` twice, with a callable `interface FrameEdit` plus `interface Frame { readonly edit: FrameEdit }`;
  - changed the look size from 768 px to 750 px;
  - added the note that host reads between evals use a fresh short deadline;
  - added the cache-identity test (`frame.print()` id = `view.adapt` id in `compile(recipe)`);
  - noted in addition 4 that the CHB-002 guide lists the same `OpDef.dsl` flag.

  The same script edited the CHB-002 guide's addition 4 to match.
- #121: a raw-HTML scan outside code, which found nothing. A `sed -i` then added `import { shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';` under the `pump.ts` sketch header. Its output was line 309.
- #122: fence count. #124: pipes inside table code spans. #125: listed headings. #126: grepped that the removed strings were gone and that the related files exist.

### Why
- The pump sketch used `shouldInterruptAfterDeadline` without importing it. The `Frame` interface was not valid TypeScript. The version claim had no source.

### What worked
- #120 printed `ok`, and `wc -w` gave 10729.
- #122: `draft-chb-007.md: fences=36` (ts 4, text 2, yaml 5, js 7), with none untagged.
- #124 printed nothing.
- #126: the grep for `Since version\|768\|Two kinds of host call\|interface Frame {` matched only line 428, `interface Frame { readonly edit: FrameEdit /* … */ }`, which is the intended new text.

### What didn't work
- No failures in this step.

### What I learned
- N/A beyond the fixes themselves.

### What was tricky to build
- Keeping the two guides consistent on shared items: `OpDef.dsl`, `print.lights.logH`, the mock numbers and the DR references across guides. The script edited both files in one run.

### What warrants a second pair of eyes
- The items flagged in Steps 4, 7, 8 and 9 were not fixed in this pass:
  - the `WRITE_RE` wording;
  - the 32 MiB versus 64 MiB out-of-memory note;
  - the eventual fulfilment under asyncify;
  - `import('x')` rejecting.

### What should be done in the future
- Correct those four items in the guide when it is next revised.

### Code review instructions
- `grep -n "shouldInterruptAfterDeadline } from\|interface FrameEdit\|750 px" /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guides/draft-chb-007.md`

### Technical details
- Final file: 74,411 bytes, 853 lines, 10,735 words (`wc -w`).

## Step 15: Hand-back, a re-send, and these diaries

I returned both guides with their TASKS and RELATED blocks through SubagentHandback. After a wrap-up message, a harness notice said the report had not been delivered, and I sent it again. Then the coordinator asked for these diaries. I wrote them from an extraction of the transcript and return them in a follow-up handback.

The handed-back CHB-007 guide equals the scratchpad file except for whitespace on line 78.

### Prompt Context
**User prompt (verbatim):** see Step 2.

**Coordinator messages (from the orchestrator, not the user's words):**
- the wrap-up request to return the guides immediately in block format;
- the request for these diaries;
- "they're a log, not a document. Don't cross-check, edit or revise them."

### What I did
- #128 (16:25:04Z): SubagentHandback with the summary, GUIDE, TASKS (16 lines) and RELATED (8 lines) blocks for both tickets.
- After the context ran out and the session continued from a summary, I replied in plain text that the report was already delivered.
- #130 (16:33:52Z): re-sent the full report.
- For the diaries:
  - read the diary skill and its investigation and evidence references;
  - wrote `SP/diary-002-007/extract.py`;
  - pulled the commands and outputs cited here from the transcript.

### Why
- The orchestrator files the guides from the handback. The diary needs exact commands and errors, which only the transcript keeps.

### What worked
- Both handbacks returned `{"success":true,"message":"Report delivered to your caller."}`.

### What didn't work
- The plain-text reply was not delivered:

```text
[handback-send-enforce] Your report has not been delivered. Call SubagentHandback({message: <your full report>}) now; the call ends your run.
```

  The re-send (#130) fixed this.
- `echo ======` in zsh failed with `(eval):1: ===== not found` while gathering diary evidence (#131). This is the same zsh behaviour as in Step 6.

### What I learned
- Only SubagentHandback reaches the coordinator. A plain-text note after a handback does not.

### What was tricky to build
- Reconstructing exact errors after a context compaction. The transcript extraction was the source of every quoted output.

### What warrants a second pair of eyes
- The scratchpad, with its spike scripts, packages and drafts, is session-scoped. The orchestrator should file from the handback.

### What should be done in the future
- To keep the spike evidence, copy `SP/guides/spike/*.mjs` into the CHB-007 ticket's `scripts/`, with a note that they need `SP/guides/qjs-deps` (or a fresh `npm install` of the three 0.32.0 packages). This agent did not do so, because `ttmp/` was read-only for it.

### Code review instructions
- Run `python3 -I /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/diary-002-007/extract.py /home/manuel/.claude/projects/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/subagents/agent-afd006dbea6d43a29.jsonl` to regenerate the tool-call list.

### Technical details
- The CHB-007 guide in the handback hashes to `e0263a03…f4`, and the file to `e0772376…8e`. The only difference is two spaces on line 78 of the file.
