# Tasks

## TODO
- [x] [stage 1] Turn the QuickJS spike into tests: host-promise awaits, interrupts before and after await, memory limit, default globals, asyncify re-entry <!-- t:kfdz -->
- [ ] [stage 1] Record DR-1 (QuickJS vs Worker+CSP) and DR-2 (sync variant vs asyncify) and get the change to the ticket plan confirmed — awaiting the user's confirmation (implemented as proposed; cg16 spike tests are the evidence) <!-- t:zr25 -->
- [x] [stage 1] Implement createVm (limits, Date off, seeded frozen Math.random, console capture) and the 1000-eval handle-leak test <!-- t:gjoh -->
- [x] [stage 1] Implement the eval pump with deadline, stall detection, cancellation of host work, and probe-and-restart after memory errors <!-- t:2ki7 -->
- [x] [stage 1] Implement the DSL worker and DslSession RPC, including node-closure shipping and Graph.adopt on the main thread — moved to CHB-008 <!-- t:44uo -->
- [x] [stage 2] Implement the native __cb bindings with JSON marshalling and the structured-error throwers <!-- t:fynm -->
- [x] [stage 2] Write prelude.js: handle proxies with domain-filtered generated namespaces, the callable print namespace, PROBES and labels <!-- t:ul4y -->
- [x] [stage 2] Implement the globals cb, frame, units and mem and the vocabulary layer with recipe-filled arguments <!-- t:278b -->
- [x] [stage 2] Implement frame.edit with draft validation, receipts with preview, end-of-eval submission in read-only/ask/auto, and EDITS_DROPPED <!-- t:2rii -->
- [x] [stage 2] Write one test per mistake in §5.9 asserting code and fix, plus the frame.print/compile cache-identity test <!-- t:l7o8 -->
- [x] [stage 3] Implement YAML rendering, number formatting, compact tables and the 9000-character cap that reserves room for context <!-- t:udc7 -->
- [x] [stage 3] Implement looks: queueing, delivery rules, per-domain display transforms, attached numbers and burned-in look numbers <!-- t:6umn -->
- [x] [stage 3] Implement the context block and diagnostics with line mapping across evals; pin test/representative.result <!-- t:07ft -->
- [x] [stage 4] Extend tools/gen-docs for the DSL reference, the instructions (under 4000 characters) and chromobench-dsl.d.ts <!-- t:2og2 -->
- [x] [stage 4] Write the topic pages and port docs_test.go so every js block and OpDef example runs in CI <!-- t:bg07 -->
- [x] [stage 4] Implement EvalTrace and tools/dsl-usage to report unused vocabulary and frequent errors <!-- t:h52b -->
- [x] [errata] Review guide claims flagged by its writer's diary: asyncify-after-await call does complete (after 50 ms + second pump); import('x') rejection untested; OOM observed at 64 MiB not 32; Filmbench WRITE_RE matches lab.write/remove/export/useAsScene <!-- t:cg16 -->
