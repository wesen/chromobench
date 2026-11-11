# Tasks

## TODO
- [ ] [stage 1] Define EvalEnvelope, EvalRunner/RunOutcome and the page↔bridge message types in packages/agent/src/channel.ts, agreeing RunOutcome (staged mutations, read-your-writes) with CHB-007 <!-- t:iefi -->
- [ ] [stage 1] Implement EvalHost: sessions, per-session FIFO with E_BUSY, 30 s default deadline (1–120 s), AbortSignal cancellation, interrupt with 2 s grace, worker termination and E_SESSION_RESET <!-- t:dfuk -->
- [ ] [stage 1] Implement commit.ts: closed op set, registry path and ArgSpec value checks, host-stamped by:'agent', read-only/ask/auto statuses, user-conflict downgrade to pending, tx = eval id, discard on failure <!-- t:em2d -->
- [ ] [stage 1] Implement render.ts around CHB-007's renderer (mutations section, approvals-since context) and pin a golden representative result text <!-- t:luix -->
- [ ] [stage 1] Implement WsPageClient (hello, focus, eval, cancel, reconnect with backoff) and the dev-only window.chromobench.eval entry point <!-- t:jlwa -->
- [ ] [stage 2] Create the bridge Go module with cmd/chromobench (serve, mcp, token) and internal/web go:embed SPA on a Go 1.22 ServeMux <!-- t:jgyd -->
- [ ] [stage 2] Implement the hub: page registry, routing by session owner or focus, correlation ids, deadline+5 s watchdog, eval.cancel on client cancellation, E_NO_PAGE on disconnect <!-- t:1fpn -->
- [ ] [stage 2] Implement the MCP server on modelcontextprotocol/go-sdk (v1.8.0+): eval, status, create_session tools; reference/docs/guide/playbook resources; chromobench-agent prompt; stdio and stateless Streamable HTTP <!-- t:m3zx -->
- [ ] [stage 2] Implement local guards (Host check, Origin and CrossOriginProtection, SameSite page cookie, bearer token in a 0600 bridge.json) and the stdio attach-to-running-bridge mode; document Claude Code and Claude Desktop setup <!-- t:a4uc -->
- [ ] [stage 2] Write Go tests with in-memory MCP transports and a fake page: tool list, instruction length, image round trip, timeout, cancellation, guard rejections <!-- t:hbf7 -->
- [ ] [stage 3] Implement the Claude proxy (/api/claude/v1/messages and count_tokens): key injection, header stripping, model/beta allowlists, max_tokens cap, SSE flushing, upstream cancellation, no body logging <!-- t:ch9a -->
- [ ] [stage 3] Implement the chat client and append-only thread store: TS SDK with baseURL and dangerouslyAllowBrowser, claude-opus-5-5 default, explicit effort, frozen system and tools, context editing, refusal fallbacks <!-- t:99av -->
- [ ] [stage 3] Implement the step loop: streaming events, eval tool with eager input streaming and schema validation, 10-step limit, stop_reason handling, carry of tool_results after Stop or limits <!-- t:1put -->
- [ ] [stage 3] Implement looks and attachments (≤1568 px at ingestion, images inside tool_result, ≤4 looks), ask-mode approvals inside the step, per-step revert, and the ChatSession/ChatEvent interface for CHB-009 <!-- t:1m3u -->
- [ ] [stage 3] Build the fake Claude SSE server and loop tests (two steps, refusal, cut tool call, fallback, Stop mid-stream and mid-eval) asserting byte-identical request prefixes <!-- t:jf58 -->
- [ ] [stage 4] Add agent outputs to tools/gen-docs (instructions <4000 chars, eval tool description, reference.md, playbook docs) embedded in the bridge and bundled into the studio; run docs as tests <!-- t:3hp8 -->
- [ ] [stage 4] Write the five playbooks (test strip, ring-around, grey balance, dust pass, roll consistency) with doc lines and mock-engine tests <!-- t:siva -->
- [ ] [stage 4] Implement opt-in transcript recording, the replay harness against engine-mock, and the metrics report feeding the pruning and redirect procedure <!-- t:hnav -->
- [ ] [stage 4] Implement the budget-gated task evaluations on the reference engine (grey balance from +10 pt red, test strip aim 0.755) and the image-privacy settings <!-- t:u7mw -->
