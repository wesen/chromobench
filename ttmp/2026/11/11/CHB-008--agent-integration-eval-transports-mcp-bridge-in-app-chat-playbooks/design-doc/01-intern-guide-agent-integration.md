---
Title: 'Intern guide: Agent integration'
Ticket: CHB-008
Status: active
Topics:
    - agent
    - dsl
    - js-api
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/cmd/goja-cv/mcp.go
      Note: stdio vs HTTP serving, loopback check, http.Server settings
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cvsession/mcp.go
      Note: 'model for the MCP server: eval input descriptions, resources, prompt, unknown-session wording'
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cvsession/processor.go
      Note: result text, look delivery limits, context block with function doc lines
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cvsession/reference.go
      Note: instructions under 4000 characters, eval tool description, reference generated from the registry
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/design-doc/01-chromobench-architecture-and-work-plan.md
      Note: shared contracts; §5.4 mutations, edit log and ask mode; §5.5 eval contract; §8.4 hosting decision
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-filmbench-ide.md
      Note: §1 agent summary and §6 the cooperative-safety finding
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-goja-cv.md
      Note: §3 agent ergonomics and evidence-driven pruning, §4 go-go-goja/MCP packaging and tests
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/01-inline.js
      Note: Filmbench agent loop (4448–4895), system prompt (4648–4707), cooperative-safety wb.apply (2323–2375)
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:24.067256619-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Agent integration

This guide is for the engineer who builds CHB-008. It assumes you have read the shared map, `design-doc/01-chromobench-architecture-and-work-plan.md` in the CHB-001 ticket (called "the architecture doc" below), at least §1, §3, §4 and §5. Paths that start with `C1/` are relative to the CHB-001 ticket directory, `ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`. Paths that start with `goja-cv/` are relative to `~/code/wesen/go-go-golems/goja-cv` at commit `5a93095`. Everything under `packages/`, `apps/` and `bridge/` is planned and does not exist yet.

## 1. What this ticket builds

Chromobench lets a language model help the photographer print. The model does not move sliders and does not see raw pixels on demand. It writes short JavaScript programs against the darkroom DSL that CHB-007 builds. A program builds and measures prints, shows a few pictures ("looks"), and may ask to change the recipe. The host runs the program and answers with numbers, pictures and a list of the changes it accepted or queued. This is the `eval(code) → EvalResult` contract of architecture doc §5.5.

Two kinds of agent use that one contract:

| Agent | Where the model runs | How code reaches the page | Who talks to the photographer |
|---|---|---|---|
| **In-app chat** | Claude API, called from the page through a proxy in the bridge | direct function call inside the page | the chat panel in `apps/studio` |
| **External agent** | Claude Code or Claude Desktop on the photographer's machine | MCP tool call → Go bridge → WebSocket → page | the external client's own window |

A short example of what the photographer experiences. They have frame 12 of a 1975 roll open and type "the skin on the left looks green, fix it". The agent runs an eval that reads the densitometer at the face and returns `a* −6.1, b* +9.8` with a cropped look. It runs a second eval that tries +4 points of green printer light as a what-if (more green light makes more magenta dye, which cancels green), which changes nothing in the recipe, and returns `a* −0.4`. A third eval asks to set the printer lights. The photographer is in **ask mode**, so the change waits as a pending card ("Agent: printer lights G +4 pt"). They click Approve, the print updates, and the agent's next eval is told the change was approved.

This ticket builds four things, in this order:

1. **The eval channel** (`packages/agent/src/channel.ts` and friends). The page-side host that accepts eval requests, runs them in CHB-007's QuickJS sandbox, enforces timeouts and cancellation, commits the requested mutations under host rules, and renders the result text.
2. **The Go bridge** (`bridge/cmd/chromobench`). One binary that serves the built app with `go:embed`, relays eval traffic between external agents and the page over a WebSocket, offers an MCP server with an `eval` tool, resources and a prompt, and proxies the in-app chat to the Claude API so that the API key never reaches the browser.
3. **The in-app chat engine** (`packages/agent/src/chat/`). The step loop that streams Claude's replies, runs each `eval` tool call through the channel, waits for ask-mode approvals, and supports cancellation.
4. **Playbooks and evaluation** (`packages/agent/playbooks/`, `packages/agent/src/harness/`). The tool manual and system prompt generated from the op registry, a library of darkroom task scripts, and a replay harness that measures how agents use the API so that unused parts can be pruned.

Out of scope:

- The DSL, its sandbox and its result formatting rules belong to CHB-007. This ticket consumes CHB-007's runner and the `EvalResult` it produces.
- Rendering the chat panel, the approval cards and the history panel belongs to CHB-009. This ticket supplies the session object, the events and the approve/reject functions that CHB-009 calls.
- Physics and darkroom ops (`darkroom.testStrip` and so on) belong to CHB-003 and CHB-010. Until they exist, everything here runs against `engine-mock` (CHB-002).

## 2. Background you need

### 2.1 Agents that write code instead of calling one tool per operation

The obvious way to connect a model to an image editor is one tool per operation: `set_exposure`, `measure_patch`, `show_image`. goja-cv chose the opposite and its evidence supports it (C1 `various/analysis-goja-cv.md` §1.1, §3). The agent gets **one** tool, `eval`, whose input is the body of an async JavaScript function. A few lines can build several lazy nodes, measure them, filter the measurements with ordinary JavaScript, attach one picture, and return a small table. One call replaces a dozen tool round trips, and the API documentation is a single generated reference rather than a long tool list.

Here is the shape of one exchange, using goja-cv's real output format (C1 `various/analysis-goja-cv.md` §3.2) with chromobench names. The DSL names in this guide are placeholders until CHB-007 fixes them.

```js
// the agent's code: the body of an async function
const d = await frame.print().measure.densitometer({ at: 'face', radius: 12 })
frame.print().crop([1500, 900, 600, 600]).look('face')
return { L: d.lab[0], a: d.lab[1], b: d.lab[2], D: d.visualDensity }
```

```yaml
L: 61.8
a: -6.1
b: 9.8
D: 0.42
looks: '[look 1: face — print of frame_0042, crop 600×600 (600×600)]'

context:
  frame: frame_0042 (roll-1975-07/scan_12.tif) · mode ask · state 3f9a…
  mem: (empty)
```

(The numbers are illustrative.) Things to notice:

- **The returned value is YAML text** of at most 9000 characters. Arrays of flat records become compact tables (goja-cv `pkg/cvsession/tables.go:16-29`).
- **Looks travel separately** as images, at most four per eval (architecture doc §5.5). Each look is paired with the numbers it shows, because a model must never read a number off a picture (C1 `various/analysis-goja-cv.md` §3.1).
- **The context block** at the end tells the agent which frame it is on, the mode, the state hash and what it keeps in `mem`, the object that survives between evals. Top-level `const` does not survive.
- **Errors are structured** `Diagnostic`s with a literal `fix` the agent can paste (architecture doc §5.5; goja-cv `pkg/cv/graph/errors.go:15-50`).

### 2.2 The darkroom quantities the agent talks about

The agent and the photographer must use darkroom units, not "brightness +0.2". The physics behind them is in the textbook (`C1/sources/The Mathematics of the Colour Negative.md` §2.6); this table is what you need to read transcripts and write playbooks.

| Quantity | Unit | Meaning | Worked example |
|---|---|---|---|
| Exposure of the paper | log H (log₁₀ of exposure) | what printer lights shift | — |
| Printer light | **point** = 0.025 log H | per-layer shift of paper log exposure (architecture doc §4) | +10 pt red = +0.25 log H |
| Stop | 0.30103 log H | a doubling of light | 1 stop ≈ 12.04 points |
| Exposure time | seconds | light × time; equal ratios are equal steps | 12 s × 2^(1/3) = 15.12 s is +1/3 stop = +0.1003 log H ≈ +4.0 pt |
| Aperture | f-number N | illuminance ∝ 1/N² | f/8 → f/11 is 2·log₁₀(8/11) = −0.277 log H ≈ −0.92 stop |
| Filtration | **CC** = 0.01 D in the filter's band | dichroic filters in the enlarger head | textbook §2.6: if a band covered exactly one paper layer, v CC would shift that layer by −v/100 log H, i.e. 0.4 pt per CC; the measured diagonal is −0.0092, −0.0087, −0.0100 log H per CC |

Two rules matter for agent behaviour:

- **Balance in log exposure, never by adding density.** A printer-light change is a shift of paper log H; a density offset is refused by the API (architecture doc §2, rule table; textbook §2.8, third law). A playbook that "adds 0.05 D of cyan" is wrong by construction.
- **Filtration is subtractive.** More yellow filtration removes blue light, the blue-sensitive layer forms less yellow dye, and the print turns bluer. More magenta makes the print greener; more cyan makes it redder. Filmbench's system prompt states the same rule (`C1/various/extracted/filmbench-ide/01-inline.js` 4648–4707, "PHYSICS HINTS").

The textbook also gives golden numbers that the evaluation harness uses (section 8): with Portra 400 printed on Portra Endura the grey card prints at visual density 0.755, and moving the red light by +10 points turns the grey card cyan (a* = −20.7) and darkens it from 0.746 to 0.956 (textbook §2.7, "Try it"). Auto-balance ("integrate to grey") removes three-quarters of a colour cast, α = 0.75 (§2.6).

### 2.3 MCP in brief

The **Model Context Protocol** (MCP) is how Claude Code and Claude Desktop talk to local tools. An MCP **server** offers:

- **tools**, functions with a JSON-schema input that the model can call (our `eval`);
- **resources**, read-only documents addressed by URI (our generated reference and guides);
- **prompts**, reusable message templates a user can insert (our "chromobench-agent" prompt).

Two transports matter:

- **stdio:** the client starts the server as a child process and exchanges JSON-RPC messages over stdin and stdout. Claude Desktop's local configuration only supports this.
- **Streamable HTTP:** the client POSTs JSON-RPC to one URL; the server answers with JSON or with a Server-Sent Events stream.

The current protocol revision is **2026-07-28** (modelcontextprotocol.io, "Versioning"). It is stateless: there is no `initialize` handshake, each request carries its protocol version, and a client may call `server/discover`. The older handshake-based revision, 2025-11-25, is still widely spoken. The official Go SDK, `github.com/modelcontextprotocol/go-sdk`, negotiates both; its Streamable HTTP handler accepts 2026-07-28 requests only when `StreamableHTTPOptions.Stateless` is true and otherwise negotiates down to 2025-11-25 (go-sdk v1.7.0 and v1.8.0 release notes). Because the protocol no longer has transport sessions, our session identity travels as an explicit `sessionId` argument of the `eval` tool, which is also what goja-cv does (`goja-cv/pkg/cvsession/mcp.go` `EvalInput`).

### 2.4 The Claude Messages API, as far as the chat loop needs it

The in-app chat calls `POST /v1/messages`. A request has a `model`, `max_tokens`, a `system` prompt, a list of `tools` and a list of `messages`. The response is a list of content blocks (`text`, `thinking`, `tool_use`) and a `stop_reason`:

| `stop_reason` | Meaning | What the loop does |
|---|---|---|
| `end_turn` | the model finished its answer | stop |
| `tool_use` | the model wants one or more `eval` calls | run them, append `tool_result` blocks, call again |
| `pause_turn` | a server-side tool paused | append the assistant turn and call again |
| `max_tokens` | output cut off | if a `tool_use` was cut, do not run it; report |
| `refusal` | a safety classifier declined | show the refusal, stop |

Facts about the current models that shape the design:

- **Model names.** The current family is Claude 5. The default for chromobench is `claude-opus-5-5`; `claude-sonnet-5-5` and `claude-haiku-5-5` are the other current tiers. Model IDs are used exactly as written, with no date suffix.
- **Thinking and effort.** On Claude Opus 5.5 thinking is always adaptive and cannot be disabled; depth is controlled with `output_config.effort` (`low`, `medium`, `high`, `xhigh`, `max`), whose default on this model is `medium`. Set it explicitly. `thinking: {type: 'adaptive', display: 'summarized'}` returns readable reasoning summaries for the chat panel.
- **Forced tool choice is rejected** on Claude Opus 5.5 and Sonnet 5.5 (`tool_choice: any/tool` returns 400). Use the default `auto` and say in the system prompt when to call `eval`.
- **History must be append-only.** Claude Opus 5.5 binds each thinking block to the exact conversation prefix that produced it: the `system` prompt, the `tools` array and every earlier message. On accounts created on or after 2026-08-31 a request that replays a block after an earlier turn was edited fails with 400. Editing the system prompt mid-thread, deleting old tool results client-side or summarising old steps in place all count as edits. Server-side **context editing** (clearing old tool results) and server-side **compaction** do not, and appended `role: "system"` messages are allowed. This rule decides how the chat stores and trims history (section 5.6).
- **Tool results may carry images.** A `tool_result` block's content can hold text and image blocks. Returning looks inside the `eval` result (rather than in a plain user turn) lets server-side context editing clear old looks later.
- **Streaming** delivers `message_start`, `content_block_start/delta/stop`, `message_delta` and `message_stop` events. The TypeScript SDK's `client.messages.stream(...)` accumulates them; `finalMessage()` returns the complete message.
- **Refusal fallbacks.** With the beta `server-side-fallback-2026-07-01` and `fallbacks: "default"`, a declined request is re-run on a fallback model inside the same call. We enable it and show the photographer when a fallback model answered. The fallback model cannot read Claude Opus 5.5's thinking blocks; the API drops them for that request, and the client keeps sending them unchanged.

## 3. Where this sits in the system

```text
 ┌──────────────────────────── browser: apps/studio (CHB-009) ───────────────────────────────┐
 │  chat panel ◄── ChatEvents ── packages/agent/chat ──► fetch /api/claude/v1/messages ──┐    │
 │  approvals UI ── decide() ──┐            │ submit()                                    │    │
 │                             ▼            ▼                                             │    │
 │                 ┌──────── EvalHost (packages/agent/channel) ────────┐                  │    │
 │  WsPageClient ─►│ sessions · queue · deadline · cancel · commit     │                  │    │
 │      ▲          └──────┬──────────────────────────┬─────────────────┘                  │    │
 │      │                 │ run(req, ctx)            │ append(LoggedMutation)              │    │
 │      │          EvalRunner (CHB-007 QuickJS)   edit log (CHB-002) ─► recipe ─► compile  │    │
 │      │                 │ Engine calls              ─► engine-mock / reference / gpu     │    │
 └──────┼─────────────────┼──────────────────────────────────────────────────────────────┼────┘
        │ ws /ws/page     │                                                              │ HTTPS via proxy
 ┌──────┴─────────────── bridge/cmd/chromobench (Go, this ticket) ───────────────────────┴────┐
 │  SPA (go:embed) · Hub (pages, routing, watchdogs) · MCP server · /api/agent/eval · proxy  │
 └──────┬──────────────────────────────┬───────────────────────────────────────────────┬─────┘
        │ stdio (child process)        │ Streamable HTTP /mcp                          │
   Claude Desktop                  Claude Code                                  api.anthropic.com
```

**Contracts consumed** (all defined in `@chromobench/contract`, CHB-002): `EvalRequest`, `EvalResult`, `Diagnostic`, `ContextBlock`, `Mutation`, `LoggedMutation`, the op registry (`OpDef`, `ArgSpec`) for generating the tool manual, and the edit log API (append, fold, `why(path)`, ask mode). This ticket defines no new shared types; the gaps it needs filled are listed in section 9.

**Dependencies and dependants:**

| Ticket | Relation | What crosses the boundary |
|---|---|---|
| CHB-002 | depends on | contract types, edit log with ask mode, `engine-mock`, error codes |
| CHB-007 | depends on | `EvalRunner`: runs code in a QuickJS session, returns staged mutations, looks, warnings and the context block; generated docs |
| CHB-009 | consumed by | renders `ChatEvent`s, approval cards, step cards; calls `decide()` and `revertStep()` |
| CHB-010 | consumed by | playbooks call `darkroom.testStrip`, `darkroom.ringAround`; milestone M4 "the agent runs a test strip" |
| CHB-006 | consumed by | the dust-pass playbook calls its dust detection |
| CHB-013 | consumed by | beta sessions record transcripts with the harness |

**What lets this ticket proceed in parallel.** The mock engine makes every op return deterministic trivial values, so transcripts replay exactly. Until CHB-007 delivers the QuickJS runner, a `FakeRunner` that recognises a handful of fixed programs (for example `return 1`, a program that stages one `set`, a program that loops forever) is enough to build and test the host, the bridge and the chat. A fake page (a Go test client that speaks the page protocol) tests the bridge without a browser, and a fake Claude server that replays recorded SSE streams tests the chat loop without spending money.

## 4. What exists today and what to take from it

### 4.1 goja-cv's MCP layer

goja-cv is a Go image engine driven by agents through JavaScript (`C1/various/analysis-goja-cv.md`). Its agent façade is the closest existing design to ours. The important difference is where JavaScript runs: goja-cv runs it in Go (goja), chromobench runs it in the browser (QuickJS). So we copy goja-cv's **agent-facing surface** and its MCP wiring, but not its runtime plumbing.

| File (goja-cv) | What it does | What to take |
|---|---|---|
| `pkg/cvsession/mcp.go` 40–52 | `EvalInput` and `OpenInput` with descriptions that say when to omit optional fields | the same trick for `sessionId`, `frame`, `timeoutMs`: "agents invent values for unexplained options" |
| `pkg/cvsession/mcp.go` 54–79 | `NewMCPServer`: one default session, `replmcp.NewServer` with name, version, instructions, limits, extra tools | the server construction, minus replmcp |
| `pkg/cvsession/mcp.go` 88–153 | removes the generic eval, adds `eval` and `open`, resources `cv://reference`, `cv://docs/<id>`, `cv://guide/<slug>`, prompt `cv-agent` | the resource and prompt layout, renamed `chromobench://…` |
| `pkg/cvsession/mcp.go` 180–218 | `unknownSession`: an invented session id becomes an error that lists real ids and says to omit `sessionId` | copy the wording |
| `pkg/cvsession/reference.go` 11–45 | `Instructions`, kept under 4000 characters: eval contract, laziness, "never read a coordinate off a picture", "apply the fix", ~20 most-used calls | generate ours from the registry with the same sections |
| `pkg/cvsession/reference.go` 47–48 | `EvalToolDescription`, one paragraph | same, generated |
| `pkg/cvsession/reference.go` 50–132 | `Reference(reg)`: every op by receiver kind with args and one doc sentence | port to `tools/gen-docs` (TypeScript), output embedded in the bridge |
| `pkg/cvsession/processor.go` 64–106 | YAML result, "nothing returned" message, failures rendered with the looks made before the error | CHB-007 owns the renderer; we reuse it for both transports |
| `pkg/cvsession/processor.go` 109–180 | every look made in the eval is delivered, at most `MaxLooks`, with a warning naming dropped ones | keep: never silently drop a look |
| `pkg/cvsession/processor.go` 469–540 | context block: images, `mem` keys, function signatures and doc lines of new or changed functions | the chat's per-turn context and the MCP result end with it |
| `pkg/cvsession/session.go` 40–47 | defaults: 60 s timeout, 9000 chars, 4 looks, 8 MiB of look bytes | we use 30 s default (see 5.2), 9000, 4, 8 MiB |
| `pkg/cvsession/session.go` 309–323 | evals of one session are serialised in call order, so line numbers in errors belong to the right eval | the per-session FIFO in our host |
| `pkg/cvsession/session.go` 372–412 | a watchdog interrupts runaway code after an `await`; a VM broken by an interrupt marks the session broken | our "terminate the worker, mark the session reset" rule |
| `cmd/goja-cv/mcp.go` 30–80 | `mcp` command: stdio by default, `--http ADDR` loopback-only unless `--allow-remote` | the command shape; we never allow remote in v0 |
| `cmd/goja-cv/mcp.go` 104–145 | loopback address check and an `http.Server` with header timeouts around `replmcp.NewStreamableHTTPHandler` | copy |
| `pkg/cvsession/mcp_test.go` 17–42, 70–121, 173–200 | tests through `mcp.NewInMemoryTransports()`; checks tools, resources, prompt, instruction size, error text | the test style for our MCP server |

goja-cv uses go-go-goja's `replmcp` package, which wraps the official SDK (`github.com/modelcontextprotocol/go-sdk` v1.7.0 in goja-cv's `go.mod`). `replmcp.NewServer` takes an `Evaluator` whose `Evaluate` returns a goja `replsession.EvaluateResponse` (`go-go-goja/pkg/replmcp/replmcp.go` 25–32). Our bridge has no goja runtime, so it cannot satisfy that interface without faking it; section 5.5 records the decision to use the official SDK directly.

### 4.2 Filmbench IDE's agent loop

Filmbench (`C1/various/extracted/filmbench-ide/01-inline.js`, report `C1/various/analysis-filmbench-ide.md` §1 and §6) is the closest existing in-app chat. It was built as a claude.ai artifact, so it calls the model through the artifact capability `window.claude.use('sample')` (`getCaps`, 5084–5090) and has no native tool calling.

| Feature | Lines | Keep, fix or leave |
|---|---|---|
| constants: 10 steps, 25 s eval timeout, model tiers | 4448 | keep a step limit (10) and a timeout; leave the tiers, use effort |
| `WRITE_RE`, a regex over the code to detect writes outside the log | 4449, 4853 | **leave**: a regex is not a security boundary (`lab['wr' + 'ite']` passes) |
| look gate: at most `min(imgMax, 6)` looks per step minus the user's attachments; each look gets a header band with its `#id` | 4532–4545 | keep the id band and the "fewer looks" error; use the contract's 4 |
| system prompt as a complete tool manual: how to act, modes, API, helpers, physics hints, house notes | 4648–4707 | keep the structure; generate the API part from the registry |
| per-message context: scene, changed parameters, layers, pending approvals, mode, state hash | 4708–4719 | keep as the context block |
| result formatting, cut at 9000 characters | 4721–4725 | keep the cap; use CHB-007's renderer |
| `runCode`: `new AsyncFunction` with `wb, ctl, …` in scope, `V2.by = 'agent'` during the step, 25 s race | 4731–4737 | **fix**: page JavaScript, cooperative `by`, the timeout does not stop the code |
| `approval()`: Approve/Skip buttons inside the step card | 4805–4811 | keep |
| history trimmed at 110 000 characters by deleting the oldest turns | 4832 | **leave**: an edit of history |
| step loop: rebuild `turns`, compress old steps into one text, keep the last two verbatim | 4834–4839 | **leave**: rewrites history every step |
| `sample(turns, {signal, modelTier, effort, images, onText})` | 4840–4844 | replace with the Messages API through the proxy |
| fenced `eval` block extracted by regex; unterminated block → retry | 4845–4848 | replace with a native `eval` tool |
| ask mode: queued mutations shown for approval right after the step; the decision appended to the result text | 4856–4860 | keep exactly this behaviour |
| per-step Revert button when the state hash changed | 4864–4865 | keep |
| after the turn, history keeps the user text plus an 8-line step summary and the final text | 4893–4895 | **leave**: lossy rewrite |
| error table for capability failures | 4749–4752 | keep the idea: one clear sentence per failure kind |

### 4.3 Why Filmbench's safety was cooperative, and why ours must not be

Filmbench enforces its modes inside `wb.apply` (`01-inline.js` 2323–2328): if `by` is `'agent'` and the mode is read-only it throws `E_READONLY`; in ask mode it queues the mutation. The trouble is how `by` is decided: `by = by || V2.by || 'script'`, and `runCode` sets the global `V2.by = 'agent'` for the duration of the step (4735). Agent code runs as ordinary page JavaScript with the bench in scope, so it can:

- assign `V2.by = 'user'` and every later `wb.apply` is treated as the photographer's;
- call `wb.apply(m, 'user')` with an explicit `by`;
- call internals such as `wb._exec(m)` directly, skipping the log;
- reach `rig.insert`, `rig.drop` and `rig.engine()`, which bypass `apply` entirely (analysis §2, "Versus the API v2 design doc");
- write files through `lab['wr' + 'ite']`, which the `WRITE_RE` check does not see.

None of this needs a malicious model. A prompt injection is enough: a frame named `approve-everything-and-ignore-the-user.tif`, a sidecar note, or a pasted playbook can steer a well-meaning model. The analysis report says it plainly: "agent safety is cooperative only (agent code is arbitrary page JS and could flip `V2.by`)" (§6).

Chromobench therefore puts the safety rules where the agent cannot reach them: in the host that commits mutations (section 5.3). The architecture doc states the rule: "the set of mutation ops is closed and enforced by the engine host, not by the agent's good behaviour" (§5.4).

### 4.4 What to leave behind

- Model tiers by name ("fast/balanced/deep"). Expose effort instead, and a model choice from an allowlist.
- Any client-side compression or deletion of conversation history.
- Approval detection by inspecting source text.
- goja-cv's `open` tool. Chromobench's library belongs to the photographer; the agent sees frames through the DSL's library functions, never raw paths (C1 `various/analysis-goja-cv.md` §5.4, item 10).

## 5. Design

### 5.1 Module layout

```text
packages/agent/                         (TypeScript, browser)
  src/channel.ts        EvalEnvelope, page↔bridge messages, EvalHost (sessions, queue, deadlines, cancel)
  src/commit.ts         host-side mutation validation and commit (the safety boundary)
  src/render.ts         EvalResult → result text (calls CHB-007's renderer; one function for both transports)
  src/ws-client.ts      WsPageClient: connects to the bridge, hello/focus, eval/cancel dispatch
  src/chat/
    client.ts           Anthropic SDK client pointed at the bridge proxy
    thread.ts           append-only conversation store (IndexedDB), session per thread
    loop.ts             the step loop, approvals, cancellation, ChatEvent emission
    looks.ts            look and attachment encoding, downscaling at ingestion
  src/harness/
    transcript.ts       transcript records (JSONL), opt-in recording
    replay.ts           replay against engine-mock; diff result texts
    metrics.ts          usage counts → report
  playbooks/            test-strip.js, ring-around.js, grey-balance.js, dust-pass.js, roll-consistency.js
  test/                 vitest: host, commit, loop (fake Claude), playbooks (mock engine)

bridge/                                 (Go module)
  go.mod                                Go 1.26 (as goja-cv); deps: modelcontextprotocol/go-sdk, coder/websocket, cobra
  cmd/chromobench/      main.go, serve.go, mcp.go, token.go
  internal/web/         embed.go (//go:build embed), embed_none.go, spa.go, generate.go, generate_build.go
  internal/hub/         hub.go (pages, routing, calls), page.go (one WebSocket), protocol.go (message types)
  internal/mcpserver/   server.go (tools, resources, prompt), generated/ (instructions, reference, docs; go:embed)
  internal/claudeproxy/ proxy.go (reverse proxy), policy.go (model/beta allowlist, max_tokens cap)
  internal/guard/       token.go (bridge.json), guard.go (Host, Origin, Sec-Fetch-Site, cookie, bearer)
```

`internal/web` follows the repository's standard Go + SPA pattern (the `go-web-frontend-embed` skill): `go generate ./internal/web` runs `pnpm -C ../apps/studio build` and copies `dist/` into `internal/web/embed/`; the `embed` build tag selects the embedded file system, and the default build serves the directory from disk for development.

### 5.2 Stage 1: the eval channel

#### What the host is responsible for

The **eval host** (`EvalHost`) lives in the page. Every eval, whatever its transport, passes through `EvalHost.submit(envelope, signal)`. The host:

1. finds or creates the **session** the eval belongs to;
2. waits its turn in that session's FIFO queue;
3. starts a deadline and wires cancellation;
4. hands the code to CHB-007's `EvalRunner`;
5. validates and commits the mutations the code **staged**;
6. renders the result text and returns it.

A **session** is one QuickJS context with its own `mem`. The default session of a page is where an external agent's evals go when it does not pass `sessionId`. Each chat thread has its own session, so the photographer's chat and Claude Code do not see each other's `mem`. A session is identified by a string the host issues (`create_session`), and lives until it is idle for 30 minutes, the page reloads, or it is reset after a hard kill.

```ts
// packages/agent/src/channel.ts (sketch)
import type { EvalRequest, EvalResult, LoggedMutation } from '@chromobench/contract';

export interface EvalEnvelope {
  id: string;                 // unique per eval: MCP: bridge-assigned "e-0193"; chat: the tool_use id
  session: string;            // 'default' or an id from createSession()
  origin: 'mcp' | 'chat' | 'dev';
  req: EvalRequest;           // { code, frame?, timeoutMs? }
}

export interface EvalRunner {                 // implemented by CHB-007
  run(req: EvalRequest, ctx: RunContext): Promise<RunOutcome>;
  interrupt(): Promise<boolean>;              // true if the VM stopped within the grace period
  dispose(): void;
}
export interface RunContext {
  signal: AbortSignal;
  frame: string;                              // resolved default frame id
  mode: AgentMode;                            // the runner throws E_READONLY on the first write in read-only mode
  view: RecipeView;                           // read access to recipes; overlays this eval's staged writes
}
export interface RunOutcome {
  result: Omit<EvalResult, 'mutations'>;      // yaml, looks, warnings, context, error?
  staged: StagedMutation[];                   // what the code asked to change, in order
}
export interface StagedMutation { frame: string; m: Mutation; line?: number }
export type AgentMode = 'read-only' | 'ask' | 'auto';

export interface EvalHost {
  submit(env: EvalEnvelope, signal: AbortSignal): Promise<EvalResult>;
  createSession(origin: EvalEnvelope['origin']): string;
  resetSession(id: string, reason: string): void;
  setMode(mode: AgentMode): void;             // only the UI calls this
}
```

The split between `EvalRunner` and `EvalHost` is deliberate. CHB-007's runner knows the DSL: it builds nodes, collects looks, and records writes as `staged` mutations while letting later reads in the same eval see them (read-your-writes through `RecipeView`). It never touches the edit log. The host knows policy: who may change what, when, and with what tag.

#### The lifecycle of one eval

```text
 submitted ──► queued ──(turn)──► running ──(runner resolves)──► committing ──► done(result)
     │            │                  │  │
     │            │                  │  └─(deadline)──► interrupting ──(ack ≤ 2 s)──► done(E_TIMEOUT)
     │            │                  │                         └─(no ack)──► worker terminated,
     │            │                  │                                       session reset ──► done(E_TIMEOUT)
     │            │                  └─(signal aborted)──► interrupting ──► done(E_CANCELLED)
     │            └─(waited > 10 s)──► done(E_BUSY)
     └─(unknown session)──► done(E_SESSION)
```

The rules behind each arrow:

- **Queueing.** Evals of one session run one at a time in arrival order, as in goja-cv (`session.go` 309–323). Without this, two evals of the same session would interleave line numbers and `mem` writes. Different sessions may run concurrently only if CHB-007's runner gives each session its own worker; v0 runs one eval at a time across the page, because evals compete for the same GPU and the photographer's attention. An eval that waits more than 10 s for its turn returns `E_BUSY` rather than silently eating its own deadline.
- **Deadline.** The default timeout is 30 s, between Filmbench's 25 s and goja-cv's 60 s; a request may ask for 1–120 s. The deadline starts when the eval starts running, not when it was queued.
- **Interrupting.** On deadline or cancellation the host aborts the `RunContext.signal` (which CHB-007 wires to QuickJS's interrupt handler and to every pending Engine call) and calls `runner.interrupt()`. If the VM does not stop within 2 s, the host terminates the session's worker. That loses the session's `mem`, so the session is marked reset and the next eval in it is told: `E_SESSION_RESET: the previous eval was stopped by force; values in mem are lost`. This is goja-cv's "broken session" lesson (`processor.go`, `brokenMessage`) in browser form: a hard kill is honest only if the agent is told.
- **Staged mutations of a failed eval are discarded.** If the eval ends with an error, a timeout or a cancellation, none of its staged mutations reach the edit log, and the result says how many were discarded. A successful eval commits all of them as one transaction. This avoids half-applied programs: either the eval's changes are all proposed or none are.
- **Cancellation is not completion.** When an MCP client cancels a call, the host stops the eval and discards its staged writes; any result produced after that point is dropped, because nobody is waiting for it. If the eval had already committed (the cancel arrived during rendering), the committed mutations stay committed and appear in the next eval's context block as "committed by eval e-0193, whose result you did not receive". The arbiter is the host: once `commit()` has run, the transaction is in the edit log regardless of what happens to the transport.

#### The commit rule

```ts
// packages/agent/src/commit.ts (sketch)
export function commit(staged: StagedMutation[], ctx: CommitContext): LoggedMutation[] {
  const out: LoggedMutation[] = [];
  for (const s of staged) {
    const problem = validate(s, ctx.registry, ctx.library);        // closed op set, known path, typed value, frame exists
    if (problem) { ctx.warnings.push(problem); out.push(ctx.log.append(s.frame, reject(s.m, problem))); continue; }
    const userTouched = ctx.log.entriesSince(s.frame, ctx.startSeq)
      .some((e) => e.by === 'user' && overlaps(pathOf(e.m), pathOf(s.m)));
    const status =
      ctx.mode === 'read-only' ? 'rejected' :                   // defence in depth: the runner already throws E_READONLY
      ctx.mode === 'ask' || userTouched ? 'pending' : 'applied';
    out.push(ctx.log.append(s.frame, { m: s.m, by: 'agent', tx: `eval:${ctx.evalId}`, ts: Date.now(), status }));
    if (userTouched) ctx.warnings.push(conflictWarning(s));       // "the photographer changed print.lights while you worked"
  }
  return out;
}
```

What to notice:

- `by: 'agent'` is written by the host. Nothing the runner returns can set it.
- A mutation that fails validation is logged as `rejected` with its diagnostic, so the history shows what the agent tried.
- **Concurrent edits.** If the photographer moves a slider while an eval runs, and the eval then asks to change the same path, the agent's change becomes `pending` even in auto mode, and the agent is told why. The photographer's hand always wins over an agent working from a stale view. `overlaps` treats a path and its prefixes as overlapping (`print.lights` overlaps `print.lights.logH`).
- `ctx.startSeq` is the edit log's head when the eval started running, which is why the proposed contract needs a sequence number on log entries (section 9).

#### Multiple frames and multiple pages

An eval works on one **default frame**: `EvalRequest.frame` if given, otherwise the frame the photographer has open in the viewer when the eval starts. Changing the open frame during an eval does not move the eval to the other frame. The DSL can reach other frames of the open project through its library functions (CHB-007), which is what the roll-consistency playbook needs. Every staged mutation names its frame, and the host checks that the frame exists in the open project. A mutation for a frame in another project is rejected.

Several browser tabs may run the studio at once. Each page sends `hello` with a page id and reports focus changes. Sessions belong to pages, so an MCP eval that names a session goes to the page that owns it; an eval without a session goes to the default session of the most recently focused page. If no page is connected, the tool fails with `E_NO_PAGE` and a message the agent can relay: "Chromobench is not open. Ask the photographer to open http://127.0.0.1:7341."

#### Approvals do not block an MCP eval

An eval from an external agent never waits for the photographer. The photographer may be away from the screen, and MCP clients have their own tool timeouts. In ask mode the eval returns at once with its changes listed as pending, and later context blocks report the decisions. The in-app chat behaves differently (section 5.6): there the photographer is present, so the loop waits for the decision before it answers the tool call.

#### One renderer for both transports

`render.ts` turns an `EvalResult` into the exact text the model reads: the YAML value, warnings with line numbers, a mutations section, and the context block. The host keeps, per session, the sequence numbers it has reported as pending; the next context block of that session lists what the photographer decided about them since ("approvals since your last eval"), and any reverts. The chat puts that text into a `tool_result`; the bridge puts it into an MCP `TextContent`. Because both use the same function, a transcript from Claude Code and one from the in-app chat are comparable, and one golden file pins the format (goja-cv's `pkg/cvsession/testdata/representative.result` is the model). The mutations section is added by the host because only the host knows the final statuses:

```yaml
mutations:
  - seq 41 · pending · set print.enlarger.time_s = 15.12 (now 12.0) · waits for the photographer
```

### 5.3 Host-enforced safety: the closed mutation set

The **closed mutation set** is the list of `Mutation` ops in architecture doc §5.4: `set`, `exposure.add`, `exposure.remove`, `mask.set`, `frame.add`. Agent code cannot change the recipe in any other way, because the sandbox has no other way out. The rule has three parts, each enforced by a component the agent's code cannot reach.

| Rule | Enforced by | How |
|---|---|---|
| The code can only reach the DSL | CHB-007 sandbox | QuickJS in a worker; no DOM, no `fetch`, no storage, no `window`; host functions are the generated prelude only |
| A write is one of the closed ops, on a known path, with a valid value | `commit.ts` | op name ∈ closed set; `set` paths must be a `recipePath` (or an argument path under it) declared in the registry; the value is checked against the `ArgSpec` type and hard range (`E_ARG_RANGE`); soft range (`usual`) adds a warning |
| Who made a write and whether it applies | `commit.ts` + edit log | `by` stamped by the host; mode read from host state that only the UI can set; approvals are UI actions (`decide()`), not DSL functions |
| Budgets | host and runner | timeout, 9000-character result, 4 looks, 8 MiB of look bytes, session count, eval size (code ≤ 20 000 characters) |
| Side effects outside the recipe | not exposed | the sandbox has no file export; exports are photographer actions in the UI |

Things the agent can still do, and why they are acceptable: build any number of what-if nodes (they change nothing), read any frame of the open project, propose changes. In ask mode every proposal is shown to the photographer before it applies; in auto mode it applies but stays visible and undoable in the history. The worst a prompt-injected agent can achieve is a set of visible, reversible proposals. That is the property to defend, and the tests in section 8 attack it directly.

**Decision record: the host stamps and commits; the agent stages.**

- *Context:* Filmbench let agent code call the same `apply` the UI uses and relied on a global to tag it (section 4.3).
- *Alternatives:* (a) Filmbench's model with a frozen global, still bypassable through internals; (b) validate inside CHB-007's prelude JavaScript, which runs in the same VM as the agent's code and can be patched by it; (c) stage in the runner, validate and commit in the host.
- *Decision:* (c).
- *Consequences:* writes within an eval are visible to later reads of the same eval but are not in the edit log until the eval ends; the UI never shows half an eval; a failed eval changes nothing; `commit.ts` and its tests are the security boundary and get a reviewer outside this ticket.
- *Status:* proposed; needs CHB-007 to implement staging and read-your-writes, and CHB-002 to accept `seq` and `frame` on log entries.

### 5.4 The page ↔ bridge protocol

The page connects as a WebSocket client to `ws://127.0.0.1:7341/ws/page` (the port is configurable). Messages are JSON text frames. Looks travel base64-encoded inside the JSON; at most 8 MiB per eval, so binary frames are not worth the complexity in v0.

```ts
// packages/agent/src/channel.ts (sketch, continued)
export type PageToBridge =
  | { t: 'hello'; page: string; app: string; catalogHash: string; focused: boolean; frames: FrameSummary[] }
  | { t: 'focus'; focused: boolean; frame?: string }
  | { t: 'eval.result'; id: string; text: string; isError: boolean; looks: LookPayload[] }
  | { t: 'session.created'; id: string; session: string };
export type BridgeToPage =
  | { t: 'eval'; id: string; session: string; req: EvalRequest }
  | { t: 'eval.cancel'; id: string; reason: 'client' | 'timeout' | 'shutdown' }
  | { t: 'session.create'; id: string };
export interface LookPayload { n: number; caption: string; mime: 'image/jpeg' | 'image/png'; base64: string }
export interface FrameSummary { id: string; name: string; roll?: string; open: boolean }
```

The page never sends unsolicited evals and the bridge never sees recipes; it sees code, result text and looks. Because `text` is already rendered in the page, the bridge needs no knowledge of `EvalResult`'s shape. A `catalogHash` mismatch between the page and the bridge's embedded reference (a page from another build) is reported by the `status` tool so the agent knows the reference may be stale.

```text
 Claude Code         chromobench (stdio)        bridge hub              page (EvalHost)
     │ tools/call eval        │                      │                         │
     ├───────────────────────►│ POST /api/agent/eval │                         │
     │                        ├─────────────────────►│ {t:eval,id:e-0193,…}    │
     │                        │                      ├────────────────────────►│ queue → run → commit
     │                        │                      │  (timer: deadline + 5 s)│
     │                        │                      │◄────────────────────────┤ {t:eval.result,id,…}
     │                        │◄─────────────────────┤ 200 {text, looks}       │
     │◄───────────────────────┤ CallToolResult       │                         │
     │ notifications/cancelled│                      │                         │
     ├───────────────────────►│ ctx cancelled        │ {t:eval.cancel,id}      │
     │                        ├─────── (HTTP closed) ├────────────────────────►│ abort, discard staged
```

**Reconnection.** If the WebSocket drops, the page reconnects with backoff (0.5 s doubling to 8 s) and sends `hello` again. The bridge fails every call in flight to that page with `E_NO_PAGE` ("the page disconnected during the eval; its staged changes were discarded"). The page discards staged mutations of an eval whose connection dropped before commit, by aborting its signal.

### 5.5 Stage 2: the bridge binary

#### Routes

The bridge uses only `net/http` and a single `*http.ServeMux` with Go 1.22 method-and-path patterns. More specific patterns take precedence, so the SPA catch-all cannot shadow the API.

| Pattern | Handler | Caller |
|---|---|---|
| `GET /{path...}` | SPA from `internal/web` (`index.html` fallback for unknown paths) | browser |
| `GET /ws/page` | WebSocket upgrade → `hub.ServePage` | the studio page |
| `/mcp` (POST, GET, DELETE) | MCP Streamable HTTP handler | Claude Code over HTTP |
| `POST /api/agent/eval` | JSON eval for a second process (the stdio MCP server attaching to a running bridge) | `chromobench mcp` |
| `GET /api/agent/status` | pages, frames, versions, catalog hashes | `chromobench mcp`, debugging |
| `POST /api/claude/v1/messages`, `POST /api/claude/v1/messages/count_tokens` | Claude proxy | the studio page |
| `GET /api/health` | liveness | scripts |

```go
// bridge/cmd/chromobench/serve.go (sketch)
mux := http.NewServeMux()
mux.Handle("GET /{path...}", web.SPA(web.FS()))
mux.Handle("GET /ws/page", guard.Page(hub.ServePage))                 // Host + Origin + page cookie
mux.Handle("/mcp", guard.Bearer(mcpserver.HTTPHandler(srv)))          // Host + bearer token
mux.Handle("POST /api/agent/eval", guard.Bearer(hub.HTTPEval))
mux.Handle("GET /api/agent/status", guard.Bearer(hub.HTTPStatus))
mux.Handle("/api/claude/", guard.Page(claudeproxy.New(cfg.Claude)))   // StripPrefix inside
mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
server := &http.Server{Addr: cfg.Addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second, MaxHeaderBytes: 1 << 20}
```

The WebSocket library is `github.com/coder/websocket` (the maintained continuation of `nhooyr.io/websocket`): it is context-aware, which makes cancellation plumbing straightforward, and its `Accept` checks the `Origin` against the request host by default. A WebSocket library is not a router, so it does not conflict with the ServeMux-only rule.

#### Local security

The bridge listens on loopback only (`127.0.0.1:7341` by default; a non-loopback `--addr` is refused, unlike goja-cv's `--allow-remote`). Loopback alone is not enough, because any web page the photographer visits can send requests to `127.0.0.1`. The guards:

- **Host check** on every request: the `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`. This defeats DNS rebinding, where an attacker's domain resolves to 127.0.0.1 and the browser sends the attacker's hostname. The MCP specification asks servers on Streamable HTTP to validate `Origin` for the same reason.
- **Page guard** (`/ws/page`, `/api/claude/`): the request's `Origin` must be the bridge's own origin, cross-site requests are rejected with Go's `http.CrossOriginProtection` (Go 1.25+, based on `Sec-Fetch-Site`), and the page must present a `SameSite=Strict`, `HttpOnly` cookie that the bridge sets when it serves `index.html`.
- **Bearer guard** (`/mcp`, `/api/agent/*`): `Authorization: Bearer <token>`, where the token is 32 random bytes generated at first start and stored with the port in `$XDG_CONFIG_HOME/chromobench/bridge.json` (mode 0600). Local processes that can read that file are inside the trust boundary anyway.

#### The MCP server

The decision record below explains why the server uses the official SDK directly. Its construction mirrors goja-cv's `NewMCPServer`:

```go
// bridge/internal/mcpserver/server.go (sketch)
type EvalInput struct {
	Code      string `json:"code" jsonschema:"JavaScript run in the photographer's darkroom: the body of an async function. Use await and end with return."`
	SessionID string `json:"sessionId,omitempty" jsonschema:"Optional; omit it to use the default session (where mem lives). Only pass ids returned by create_session."`
	Frame     string `json:"frame,omitempty" jsonschema:"Optional; omit it to work on the frame the photographer has open. Pass a frame id from status only to work on another frame."`
	TimeoutMs int    `json:"timeoutMs,omitempty" jsonschema:"Optional; omit it for the default of 30000 ms. Raise it (at most 120000) only for full-resolution measurements."`
}

func New(h *hub.Hub, gen Generated, version string) *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{Name: "chromobench", Version: version},
		&mcp.ServerOptions{Instructions: gen.Instructions}) // < 4000 characters, generated
	notDestructive := false
	mcp.AddTool(srv, &mcp.Tool{Name: "eval", Description: gen.EvalToolDescription,
		Annotations: &mcp.ToolAnnotations{Title: "Run darkroom JavaScript", DestructiveHint: &notDestructive}},
		func(ctx context.Context, _ *mcp.CallToolRequest, in EvalInput) (*mcp.CallToolResult, any, error) {
			r, err := h.Eval(ctx, hub.EvalCall{Session: in.SessionID, Frame: in.Frame, Code: in.Code, TimeoutMs: in.TimeoutMs})
			if err != nil {
				return nil, nil, err // E_NO_PAGE, E_SESSION (with goja-cv's wording), transport errors
			}
			res := &mcp.CallToolResult{IsError: r.IsError, Content: []mcp.Content{&mcp.TextContent{Text: r.Text}}}
			for _, l := range r.Looks {
				res.Content = append(res.Content, &mcp.ImageContent{Data: l.Bytes, MIMEType: l.MIME})
			}
			return res, nil, nil
		})
	mcp.AddTool(srv, &mcp.Tool{Name: "status", Description: "Pages, open frames, mode and versions. Changes nothing.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true}}, statusHandler(h))
	mcp.AddTool(srv, &mcp.Tool{Name: "create_session", Description: "Start a fresh session with an empty mem; returns its id."},
		createSessionHandler(h))
	addMarkdown(srv, "chromobench://reference", "Every op with arguments and units, generated from the registry.", gen.Reference)
	for _, d := range gen.Docs { addMarkdown(srv, "chromobench://docs/"+d.ID, d.Summary, d.Body) }
	for _, g := range gen.Guides { addMarkdown(srv, "chromobench://guide/"+g.Slug, g.Short, g.Body) }
	for _, p := range gen.Playbooks { addMarkdown(srv, "chromobench://playbooks/"+p.Name, p.Doc, p.Source) }
	srv.AddPrompt(&mcp.Prompt{Name: "chromobench-agent", Title: "Chromobench agent instructions"}, instructionsPlusReference(gen))
	return srv
}
```

Serving it:

```go
// stdio (Claude Desktop, or Claude Code's stdio mode)
err := srv.Run(ctx, &mcp.StdioTransport{})
// Streamable HTTP (Claude Code's HTTP mode), mounted at /mcp
h := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return srv },
	&mcp.StreamableHTTPOptions{Stateless: true}) // accept 2026-07-28; clients on 2025-11-25 still work
```

The `Generated` struct comes from files that `tools/gen-docs` writes into `internal/mcpserver/generated/` before `go build` (section 5.7), embedded with `go:embed`. The same files are bundled into the studio for the in-app chat.

**One process or two.** Claude Desktop and Claude Code (in stdio mode) start `chromobench mcp` as a child process. The photographer may already have a bridge running (`chromobench serve`) with the studio open. Two bridges would mean two ports and a page connected to only one of them. So `chromobench mcp`:

1. reads `bridge.json`; if a bridge answers `GET /api/health` on that port, it **attaches**: its `eval` handler forwards to `POST /api/agent/eval` with the bearer token, and its `status` handler to `/api/agent/status`;
2. otherwise it starts the full server in-process (SPA, WebSocket, proxy) on the configured port, writes `bridge.json`, and serves MCP on stdio; with `--open` it opens the studio in the default browser.

Either way the MCP client sees the same tools.

**Connecting the clients.**

```text
# Claude Code, stdio (Claude Code starts the process)
claude mcp add chromobench -- chromobench mcp

# Claude Code, HTTP (a bridge is already running; `chromobench token` prints the token)
claude mcp add --transport http chromobench http://127.0.0.1:7341/mcp --header "Authorization: Bearer <token>"
```

Claude Code's defaults matter: `MAX_MCP_OUTPUT_TOKENS` is 25 000 tokens, far above a 9000-character result (roughly 2000–3000 tokens); set `MCP_TOOL_TIMEOUT` (or a per-server `"timeout"` in `.mcp.json`) above our 120 s maximum eval.

```json
{
  "mcpServers": {
    "chromobench": { "command": "/usr/local/bin/chromobench", "args": ["mcp", "--open"] }
  }
}
```

That is Claude Desktop's `claude_desktop_config.json` (macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`, Linux `~/.config/Claude/`). Claude Desktop's local configuration launches stdio servers; it does not connect to a plain `http://localhost` MCP endpoint, so stdio with the attach behaviour is the supported route. A stdio server owns its stdout for the protocol: `chromobench mcp` must log only to stderr (Claude Desktop collects it in `mcp-server-chromobench.log`), or the client sees corrupt messages.

**Decision record: which MCP library.**

- *Context:* the bridge needs stdio and Streamable HTTP, tools with images, resources and prompts, and should speak the current revision.
- *Alternatives:*

  | Option | State (November 2026) | Fit |
  |---|---|---|
  | `github.com/modelcontextprotocol/go-sdk` | official; v1.8.0 (Sep 2026) negotiates 2026-07-28 and 2025-11-25; stdio, Streamable HTTP with a stateless mode, in-memory transports for tests | direct fit; goja-cv already depends on it |
  | go-go-goja `pkg/replmcp` | wraps the official SDK around a goja REPL session (`Evaluator` returns `replsession.EvaluateResponse`) | built for JavaScript running in Go; we would fake its session types |
  | `github.com/mark3labs/mcp-go` | community SDK, widely used; secondary sources list spec 2025-11-25 support | a second API to learn, no goja-cv code to copy |
  | `github.com/go-go-golems/go-go-mcp` | the organisation's own earlier framework | superseded for goja-cv by replmcp + official SDK |

- *Decision:* the official SDK, pinned to a released version (v1.8.0 or later), used directly; goja-cv's structure copied by hand.
- *Consequences:* no goja or tree-sitter dependencies in the bridge (goja-cv needs cgo only because of go-go-goja's session; `C1/various/analysis-goja-cv.md` §1.3), so the bridge cross-compiles easily. The SDK's `MCPGODEBUG` escape hatches are slated for removal in v1.9.0; do not rely on them. Origin and Host checks are our own middleware rather than SDK defaults, which have changed between releases.
- *Status:* proposed.

### 5.6 Stage 3: the in-app chat

#### The proxy

The page must never hold an API key. The bridge holds it (from `ANTHROPIC_API_KEY`, or a key written by `chromobench config set-key` into a 0600 file) and forwards the page's requests:

```go
// bridge/internal/claudeproxy/proxy.go (sketch)
func New(cfg Config) http.Handler {
	upstream, _ := url.Parse("https://api.anthropic.com")
	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(upstream)
			for _, k := range []string{"Authorization", "X-Api-Key", "Anthropic-Dangerous-Direct-Browser-Access",
				"Cookie", "Origin", "Referer"} {
				pr.Out.Header.Del(k)
			}
			pr.Out.Header.Set("X-Api-Key", cfg.APIKey())
		},
		FlushInterval: -1, // flush every write; Server-Sent Events must not be buffered
	}
	mux := http.NewServeMux()
	mux.Handle("POST /v1/messages", cfg.policy(rp))
	mux.Handle("POST /v1/messages/count_tokens", cfg.policy(rp))
	return http.StripPrefix("/api/claude", mux)
}
```

`policy` reads the body (at most 32 MiB), checks `model` against an allowlist (default `["claude-opus-5-5"]`, configurable), caps `max_tokens`, checks every `anthropic-beta` value against an allowlist (`context-management-2025-06-27`, `server-side-fallback-2026-07-01`, and others as they are adopted), and restores the body. When the browser aborts the request, `r.Context()` is cancelled and the reverse proxy cancels the upstream request, so a Stop click ends billing for that response. The proxy never logs bodies; it logs model, status, token usage from the final `message_delta`, and duration.

If the app is hosted as a static PWA without the bridge (an open decision, architecture doc §8.4), there is no proxy and the chat panel says so. The external-agent path also needs the bridge, so both agent features depend on that decision.

#### The client and the request

The page uses the official TypeScript SDK, pointed at the proxy. Requests go through the SDK's beta namespace (`client.beta.messages`) because they use beta features (context editing, refusal fallbacks).

```ts
// packages/agent/src/chat/client.ts (sketch)
import Anthropic from '@anthropic-ai/sdk';

export const client = new Anthropic({
  baseURL: `${location.origin}/api/claude`,
  apiKey: 'held-by-bridge',          // placeholder; the proxy strips it and adds the real key
  dangerouslyAllowBrowser: true,     // required in a browser; safe here because no real key is in the page
  maxRetries: 2,
});
```

The `eval` tool for the chat has the same name and description as the MCP tool, so one tool manual serves both:

```ts
// packages/agent/src/chat/loop.ts (sketch; check field names against the pinned SDK version)
const evalTool = {
  name: 'eval',
  description: generated.evalToolDescription,
  input_schema: {
    type: 'object', additionalProperties: false, required: ['code'],
    properties: {
      code: { type: 'string', description: 'The body of an async function. Use await and end with return.' },
      frame: { type: 'string', description: 'Optional; omit it to work on the open frame.' },
    },
  },
  eager_input_streaming: true,       // the code streams into the step card as it is written
};

const stream = client.beta.messages.stream({
  model: settings.model,                              // 'claude-opus-5-5' by default
  max_tokens: 64000,
  system: [{ type: 'text', text: thread.system }],    // frozen when the thread starts
  tools: [evalTool],                                  // frozen when the thread starts
  messages: thread.messages,                          // append-only
  thinking: { type: 'adaptive', display: 'summarized' },
  output_config: { effort: settings.effort },         // 'low' | 'medium' | 'high'; set explicitly
  cache_control: { type: 'ephemeral' },               // caches the long system prompt and history prefix
  context_management: { edits: [{ type: 'clear_tool_uses_20250919' }] },
  betas: ['context-management-2025-06-27', 'server-side-fallback-2026-07-01'],
  fallbacks: 'default',
}, { signal: turn.abort.signal });
```

Because `eager_input_streaming` turns off server-side validation of tool input, the loop validates every `eval` input with a schema before running it and checks `stop_reason` before running any tool.

#### The step loop

```ts
// packages/agent/src/chat/loop.ts (pseudocode)
async function runTurn(thread: Thread, user: UserInput, ui: ChatSink): Promise<void> {
  // tool_result blocks left over from a stopped turn must come first in the next user message
  thread.append({ role: 'user', content: [...thread.takeCarry(), ...user.attachments.map(imageBlock),
                                          text(user.text), text(contextBlock())] });
  if (thread.modeChangedSinceLastTurn) thread.append({ role: 'system', content: modeText(host.mode) });
  for (let step = 0; ; step++) {
    const msg = await streamOne(thread, ui);             // emits text, thinking and tool-input deltas
    thread.append({ role: 'assistant', content: msg.content });   // full content, thinking blocks included
    if (msg.stop_reason === 'refusal') return ui.refusal(msg.stop_details);
    if (msg.stop_reason === 'pause_turn') continue;
    const calls = msg.content.filter(isToolUse);
    if (calls.length === 0) return ui.done(msg);           // end_turn: the final answer
    if (msg.stop_reason === 'max_tokens' || step >= MAX_STEPS) {
      // do not run a cut-off call or a call past the limit; answer each call so the transcript stays valid
      thread.setCarry(calls.map((c) => notRun(c, step >= MAX_STEPS ? 'step limit reached' : 'cut off at max_tokens')));
      return ui.error('stopped', step >= MAX_STEPS ? 'The agent used all its steps.' : 'The reply was cut off mid-code.');
    }
    const results: ToolResultBlockParam[] = [];
    for (const call of calls) {                            // sequential: evals share the recipe
      results.push(await runEvalStep(call, thread, ui));   // on Stop: an is_error result, then the turn ends
      if (thread.stopped) { thread.setCarry([...results, ...calls.slice(results.length).map((c) => notRun(c, 'stopped'))]); return; }
    }
    const tail = step + 1 === MAX_STEPS ? [text('Step limit reached. Answer now from what you have; do not call eval again.')] : [];
    thread.append({ role: 'user', content: [...results, ...tail] });
  }
}

async function runEvalStep(call: ToolUseBlock, thread: Thread, ui: ChatSink): Promise<ToolResultBlockParam> {
  const input = EvalInput.safeParse(call.input);
  if (!input.success) return errorResult(call.id, `E_TOOL_INPUT: ${input.error.message}`);
  ui.stepStarted(call.id, input.data.code);
  const res = await host.submit({ id: call.id, session: thread.session, origin: 'chat',
                                  req: { code: input.data.code, frame: input.data.frame } }, thread.turnSignal);
  let note = '';
  const pending = res.mutations.filter((m) => m.status === 'pending');
  if (pending.length) {
    const d = await ui.askApproval(call.id, pending, thread.turnSignal);   // resolves when the photographer decides
    note = decisionText(d);   // "[the photographer approved 1 change: print.enlarger.time_s 12.0 → 15.12 s]"
  }
  ui.stepDone(call.id, res);
  return { type: 'tool_result', tool_use_id: call.id, is_error: Boolean(res.error),
           content: [text(render(res) + note), ...res.looks.map(lookImageBlock)] };
}
```

What the loop guarantees:

- **The transcript is append-only.** Nothing already sent is edited, reordered or deleted. The system prompt and the tool list are fixed when the thread starts; a mode change is an appended `role: "system"` message right after the next user message; the per-turn context block is a text block in that user message; the step-limit note is a text block after the tool results. Old looks and results are cleared server-side by context editing when the context grows, and a thread that grows very long can use server-side compaction; neither counts as an edit.
- **Approvals happen inside the step.** As in Filmbench (4856–4860), the loop waits for the photographer's decision before it answers the tool call, so the model's next step knows what actually applied. The approval card also offers "Decide later"; the note then says the changes are still pending.
- **Every `tool_use` gets a `tool_result`.** If the photographer presses Stop while an eval runs, the host cancels it and the loop produces `is_error: true` with "Stopped by the photographer before this eval finished; nothing it asked to change was applied." Such results (and those for calls that were cut off or past the step limit) are kept as the thread's *carry* and become the first blocks of the next user message, because `tool_result` blocks must open the user message that answers them. If Stop is pressed while the model is still streaming, the partial assistant message was never sent back and is simply not appended.
- **Revert.** Each step card shows Revert when the step committed applied mutations (Filmbench 4864–4865). Revert appends `by: 'user'` mutations that restore the previous values of the paths that transaction touched, as one new transaction. The agent learns about it from the next context block ("the photographer reverted eval toolu_01…").
- **Step limit.** Ten steps per turn, as in Filmbench. The tenth result carries a note asking for the final answer; a call after that is answered as "not run" and the turn ends.
- **Two kinds of context.** Each user message carries a context block because the photographer may have changed things between turns without any eval running; each eval result carries one because the eval itself may have changed things.

**Images.** A look is downscaled once, when it is produced, to at most 1568 px on the long side (goja-cv's look size, `pkg/cv/look/look.go` 48), and encoded as JPEG (q 85) for pictures or PNG for masks, charts and small crops. The photographer's attachments, for example a reference print they like, are downscaled at ingestion the same way and sent as image blocks in their message. The stored thread keeps the exact bytes it sent, because thinking blocks are bound to the bytes of earlier images; a re-encoded image would count as an edit.

**Thread storage.** Threads live in the studio's IndexedDB database (CHB-009 defines the database and its `threads` store; this ticket defines the record), one record per thread with the frozen system prompt, the model, and the message list exactly as sent, including thinking blocks and their signatures. If a request fails with the 400 that says a thinking block "is bound to a different conversation", the history was edited by a bug; the documented one-time recovery is to strip all thinking blocks from the stored history and retry once. Log it as a defect.

**Errors** shown to the photographer, one sentence each (Filmbench's `ERR` table, 4749–4752, is the model):

| Condition | Detected as | Message |
|---|---|---|
| bridge has no API key | 401 from the proxy | "The chat needs an API key in the bridge: run `chromobench config set-key`." |
| rate limit | `Anthropic.RateLimitError` | "Too many requests right now; your message is kept, press Send to retry." |
| network or bridge down | `Anthropic.APIConnectionError` | "Cannot reach the bridge." |
| refusal | `stop_reason: 'refusal'` | "Claude declined this request." plus the `stop_details` category |
| fallback answered | a `fallback` content block | small note "answered by a fallback model" on the message |

#### What the UI receives

```ts
// packages/agent/src/chat/events.ts (sketch)
export type ChatEvent =
  | { t: 'text'; delta: string }
  | { t: 'thinking'; delta: string }                         // summarised reasoning
  | { t: 'step.code'; step: string; partial: string }        // eval code while it streams
  | { t: 'step.started'; step: string; code: string }
  | { t: 'step.done'; step: string; text: string; looks: LookPayload[]; ms: number; isError: boolean }
  | { t: 'approval'; step: string; pending: LoggedMutation[] }
  | { t: 'notice'; kind: 'fallback' | 'cleared-context'; detail: string }
  | { t: 'error'; kind: string; message: string }
  | { t: 'done'; stopReason: string; usage: { input: number; output: number; cacheRead: number } };

export interface ChatSession {
  events(): AsyncIterable<ChatEvent>;
  send(text: string, attachments: File[]): Promise<void>;
  stop(): void;
  decide(step: string, seqs: number[], decision: 'approve' | 'reject' | 'later'): void;
  revertStep(step: string): void;
}
```

**Decision record: one native `eval` tool instead of a fenced code block.**

- *Context:* Filmbench extracted a fenced `eval` block with a regex because its sampling capability had no tool calling (4845).
- *Alternatives:* (a) keep the fenced block; (b) one tool per op; (c) one native `eval` tool.
- *Decision:* (c).
- *Consequences:* structured `tool_use` ids pair each eval with its result; no unterminated-block retries; tool input streams; looks ride inside `tool_result` where context editing can clear them; the chat and MCP share one tool description; forced tool choice is unavailable on the default model, so the system prompt must say when to use the tool.
- *Status:* proposed.

**Decision record: the loop runs in the page; the bridge only proxies.**

- *Context:* the loop could run in Go, with the page only executing evals.
- *Alternatives:* (a) Go loop using the Go SDK, page as executor; (b) browser loop with a thin proxy.
- *Decision:* (b). The eval host, the approval UI, the looks and the thread storage are all in the page; a Go loop would need a second protocol for streaming text, approvals and cancellation to the page.
- *Consequences:* the bridge stays stateless about conversations; the TypeScript SDK's streaming helpers are used directly; closing the tab ends a turn in progress.
- *Status:* proposed.

### 5.7 Stage 4: playbooks and evaluation

#### The tool manual and system prompt, generated from the registry

Every text the model reads about the API is generated, so it cannot drift from the code:

```text
packages/contract (registry: OpDef, ArgSpec, doc, examples, redirects)
        │  tools/gen-docs (CHB-002/007; this ticket adds the agent outputs)
        ├──► instructions.md      < 4000 characters: eval contract, modes, units, ~20 most-used calls
        ├──► eval-tool.txt        one paragraph, shared by MCP and chat
        ├──► reference.md         every op by area: signature, units, ranges, one doc sentence
        ├──► docs/<id>.md         agent topics (CHB-007), every js block executed in CI
        └──► playbooks/*.md       each playbook's header comment and function doc lines
             ├──► bridge/internal/mcpserver/generated/   (go:embed)
             └──► packages/agent/src/generated.ts        (bundled into the studio)
```

A reference line, in the style of goja-cv's `opLine` (`reference.go` 107–132):

```text
- `print.lights(logH)` → Image — Shift paper log exposure per layer (printer lights).
  - logH: vec3, logH, hard −1…1, usual −0.3…0.3; shown in points (0.025 logH); never a density
```

The chat's system prompt is `instructions.md + reference.md + the photographer's house notes`, frozen per thread. Filmbench shows that a photographer-editable "house notes" file (`vfs/agent/brief.md`) is useful: preferred vocabulary, spelling, how much to explain. Its outline, in order:

1. Who you are and what the photographer is doing (printing their own negatives).
2. How to act: call `eval` with the body of an async function; look, measure, change, then check; never claim to have seen what you did not look at; never read a number off a picture.
3. Modes (read-only, ask, auto) and what each does to your writes; the current mode is in the context block and in system messages.
4. Darkroom units and directions (section 2.2), and "balance in log exposure".
5. The generated reference and the playbook list.
6. House notes.

The MCP `instructions` field carries items 2–4 plus the most-used calls; the full reference is a resource and part of the `chromobench-agent` prompt.

#### Task libraries

A playbook is a script the agent loads into its session, as in goja-cv's `cv.load` and its model library `dust/helpers.js` (C1 `various/analysis-goja-cv.md` §2.10). goja-cv added loading because annotator agents pasted a 3 KB helper file into evals 29 times and never opened the docs. A playbook defines functions on `mem` whose first comment is their doc line, so the context block lists them with signatures.

```js
// packages/agent/playbooks/test-strip.js (sketch; DSL names are placeholders owned by CHB-007)
// Test strips around the current print: time in stops, or one filter in CC, measured at a probe.
mem.testStrip = async ({ axis = 'time', step = 1 / 3, count = 5, probe = 'grey' } = {}) => { // strip around now; returns rows and a look
  const r = await frame.recipe()
  const ks = Array.from({ length: count }, (_, i) => i - (count - 1) / 2)
  const values = axis === 'time'
    ? ks.map((k) => +(r.print.enlarger.time_s * 2 ** (k * step)).toFixed(2))      // equal ratios
    : ks.map((k) => r.print.enlarger.filtration[axis] + k * step)                  // axis 'c' | 'm' | 'y', step in CC
  const strip = frame.print().darkroom.testStrip({ axis, values })
  const rows = await strip.measure.patches({ at: probe })                          // one row per step: value, D, L*, a*, b*
  return { rows, look: strip.look(`test strip: ${axis}`) }
}
mem.bestStep = (rows, aimD) => rows.reduce((b, r) => (Math.abs(r.D - aimD) < Math.abs(b.D - aimD) ? r : b)) // step closest to the aim density
return 'test-strip ready'
```

| Playbook | What it does | Ops it relies on | How the harness scores it |
|---|---|---|---|
| test strip | strips in time (stops) or one filter (CC), measured at a named probe such as "grey" (CHB-009 proposes storing probes in the recipe); pick a step | `darkroom.testStrip`, `measure.patches` (CHB-010) | the chosen step is the one the harness computes as closest to the aim density, or its neighbour |
| ring-around | six colour directions plus density steps at 2, 4 or 8 points (Chromogen's ring, `05-inline.js` 4330–4347) | `darkroom.ringAround` | the chosen tile reduces the neutral probe's colour error |
| grey balance | densitometer at a neutral, solve lights in log exposure, verify | `measure.densitometer`, `print.lights` | starting from +10 pt red (textbook: a* = −20.7 at the grey card), reach ΔE00 ≤ 1.0 from the reference engine's own grey solve in ≤ 6 evals (M2 and later) |
| dust pass | find specks on the scan, show them on a contact sheet of crops, heal approved ones | CHB-006 dust detection; a recipe field for healed spots (section 9) | on a synthetic frame with planted specks: recall and precision against the planted truth (thresholds set with CHB-006) |
| roll consistency | measure every frame of a roll at comparable areas, propose lights per frame | library functions, `darkroom.contactSheet`, `measure.stats` | on a synthetic roll with known per-frame exposure offsets, the spread of grey densities after the agent shrinks to a threshold set with CHB-013 |

Thresholds marked "set with" another ticket are not invented here; they need that ticket's fixtures.

#### The replay harness and evidence-driven pruning

goja-cv's most transferable practice is to measure how agents use the API and delete what they do not use (C1 `various/analysis-goja-cv.md` §3.6–3.7). Its GCV-004 analysis of 18 runs (751 evals) found parameters and sliders used 0 times and only 14 of 246 synonym keys ever typed; deleting them cut 2950 lines, removed a class of errors entirely, lowered the median call count from 51 to 39 on one benchmark, and did not change recall. GCV-005's analysis of 39 annotator runs produced `cv.load`, the context-block signatures and compact tables.

The harness has three parts:

1. **Recording.** With the photographer's opt-in, each eval appends one JSON line to a local transcript: time, origin (chat or MCP), model and effort (chat only), code, frame id, recipe hash before and after, result text hash, error code, the ops the runner called with counts (CHB-007 provides the trace), looks as content hashes, duration, mutations and their final statuses. Look bytes are stored separately by hash so transcripts stay small and can be shared without pictures.
2. **Replay.** `replay.ts` takes a transcript and its starting recipe, runs every eval against the current build with `engine-mock`, and diffs the result text. Because the mock is deterministic, any difference is an API or formatting change. An eval that now fails must fail with a `Diagnostic` that has a `fix`; a renamed op without a `redirect` is a regression.
3. **Metrics.** `metrics.ts` aggregates many transcripts into a report: op call counts, ops never called, error codes by frequency, unknown member names (candidates for `ArgSpec.redirects`), options agents invent (candidates for "omit it unless…" wording), `CUT` warnings (results too long), dropped looks, steps and tokens per task.

The pruning procedure: an op unused across a stated number of tasks is removed from the instructions' most-used list and, if still unused, from the agent reference (it stays in the registry for the UI); a name typed by agents at least twice becomes a redirect; the most frequent error codes get their hints rewritten; each change is re-measured on the same tasks. Running live agents spends money, so task evaluations against the Claude API run only behind an explicit flag with a stated budget, never in ordinary CI.

#### Privacy of the photographer's images

The photographer's scans are their work. The rules:

- **What leaves the machine.** Only images the agent asks to look at (downscaled looks) and images the photographer attaches are sent to Anthropic, through the bridge. Full-resolution scans, file paths outside the frame name, and the library never are. Looks are rendered from pixels, so they carry no EXIF or GPS metadata.
- **Photographer control.** A setting per destination (in-app chat, external agents): "pictures allowed" or "numbers only". In "numbers only", the runner refuses looks with a diagnostic telling the agent to use measurements; Filmbench had the same degraded mode (4533–4536). The chat panel counts images shared in the thread.
- **External agents.** Looks returned over MCP go to whatever client is connected and from there to its model provider. The `status` tool and the studio's header show which external agents are connected.
- **Local storage.** Threads and transcripts stay in the browser's storage or the bridge's data directory; nothing is uploaded for analysis. Transcripts are opt-in, can be exported without pictures, and are deleted with the project.
- **Retention at Anthropic** follows the account's data-retention settings; the bridge does not add any.

## 6. One flow traced end to end

The photographer has the studio open, served by `chromobench serve`, on `frame_0042` (`roll-1975-07/scan_12.tif`). The print time is 12.0 s and the mode is **ask**. In Claude Code, connected over stdio, they type: "Make a 1/3-stop test strip around the current time and set the best one; aim for the grey card at 0.755."

1. **Claude Code calls `eval`.** Input: `{"code": "await load('playbooks/test-strip.js')\nconst s = await mem.testStrip({ axis: 'time', step: 1/3, probe: 'grey' })\nreturn { rows: s.rows, best: mem.bestStep(s.rows, 0.755), look: s.look }"}`. No `sessionId`, `frame` or `timeoutMs`, as the descriptions advise.
2. **The stdio process forwards.** `chromobench mcp` found a running bridge in `bridge.json`, so it POSTs `{code, sessionId: "", frame: "", timeoutMs: 0}` to `/api/agent/eval` with the bearer token.
3. **The hub routes.** One page is connected, `p-7f3c`, focused. The hub assigns id `e-0193`, sends `{t: 'eval', id: 'e-0193', session: 'default', req: {code, timeoutMs: 30000}}` over the page's WebSocket, and arms a 35 s timer (deadline plus 5 s grace).
4. **The host runs it.** Session `default` exists. The queue is empty. The host records `startSeq = 40` (the edit log's head for frame_0042) and resolves the default frame to `frame_0042`. The runner loads the playbook (its `return 'test-strip ready'` is discarded) and evaluates `mem.testStrip`. The five times are 12 × 2^(k/3) for k = −2…2: **7.56, 9.52, 12.00, 15.12, 19.05 s**, steps of 0.1003 log H (4.0 points). The DSL builds one `darkroom.testStrip` node; `engine-mock` evaluates it and the patch measurement. One look is produced (1568 × 627 JPEG). Nothing is staged.
5. **Commit and render.** No staged mutations, so `commit()` returns an empty list. `render()` produces about 1.2 KB of text:

   ```yaml
   rows: |-
     value   D      L*     a*    b*
     7.56    0.52   ...
     ...
   best: { value: 15.12, D: 0.74 }
   look: '[look 1: test strip: time — 7.56…19.05 s, 1/3 stop (1568×627)]'

   context:
     frame: frame_0042 (roll-1975-07/scan_12.tif) · mode ask · state 3f9a…
     functions: mem.testStrip({ axis, step, count, probe }), mem.bestStep(rows, aimD)
     new functions: |-
       mem.testStrip(...): strip around now; returns rows and a look
       mem.bestStep(rows, aimD): step closest to the aim density
   ```

   (Densities are illustrative; on the mock engine they come from the mock's trivial maths.)
6. **Back to Claude Code.** The page sends `eval.result`; the hub resolves the call; the HTTP response returns; the stdio process builds a `CallToolResult` with one `TextContent` and one `ImageContent`.
7. **Claude Code asks for the change.** Second eval: the DSL's write call (here `recipe.set('print.enlarger.time_s', 15.12)`; CHB-007 names it), then `return (await frame.recipe()).print.enlarger.time_s`. The runner stages `{frame: 'frame_0042', m: {op: 'set', path: 'print.enlarger.time_s', value: 15.12}}`; the read inside the eval sees 15.12. `commit()` validates: `set` is in the closed set, the path is the `recipePath` of the enlarger op, 15.12 s is inside the `ArgSpec` range. Mode is ask, so it appends `{seq: 41, by: 'agent', tx: 'eval:e-0194', status: 'pending'}`. The result's mutations section says the change waits for the photographer, and the context block says the applied time is still 12.0 s.
8. **The photographer decides.** CHB-009's history panel shows a pending card: "Agent · Exposure time 12.0 s → 15.12 s (+1/3 stop)". They click Approve. The edit log makes entry 41 applied (by flipping its status or appending an applied copy, whichever CHB-002 chooses; section 10); the recipe fold changes; the viewer re-renders. Because this is an MCP eval, nothing was waiting on the click.
9. **The agent finds out.** On Claude Code's next eval, the context block contains `approvals since your last eval: seq 41 approved (print.enlarger.time_s 12.0 → 15.12 s)`.

Two failure variants on the same flow:

- **The photographer moves the time slider while eval e-0194 runs** (it appends a user entry, seq 41, on `print.enlarger.time_s`). At commit, the host sees a user write to the same path after `startSeq = 40`, so the agent's mutation becomes seq 42 `pending` even if the mode were auto, and the result carries the warning "the photographer changed print.enlarger.time_s while you worked; your change waits for approval".
- **The page is closed during the strip.** The hub's call sees the page connection close and returns `E_NO_PAGE` to Claude Code; nothing was staged, so nothing is lost. Had the eval been the `set`, its staged mutation would never have been committed.

## 7. Implementation plan

**Stage 1: eval channel (against `FakeRunner`, then CHB-007's runner; mock engine).**

- Build: `channel.ts` (types, `EvalHost`), `commit.ts`, `render.ts` (host sections around CHB-007's renderer), `ws-client.ts`, a dev-only `window.chromobench.eval(code)` entry point.
- Done when: the host's tests pass for queueing, `E_BUSY`, deadline, cancellation, forced termination and `E_SESSION_RESET`, discard-on-failure, commit statuses in all three modes, the user-conflict downgrade, rejected mutations logged, multi-frame staging; and a golden result text is pinned.

**Stage 2: the Go bridge.**

- Build: `bridge/` module; `serve` and `mcp` commands; `internal/web` embed with SPA fallback; hub with routing, watchdog and reconnection behaviour; MCP server with `eval`, `status`, `create_session`, resources and prompt; local guards; attach mode; `chromobench token`.
- Done when: `go test ./...` covers an in-memory MCP round trip against a fake page, the timeout path, client cancellation reaching the page, `E_NO_PAGE`, rejected Host/Origin/token; `claude mcp add chromobench -- chromobench mcp` works by hand against the studio with the mock engine; instructions are under 4000 characters.

**Stage 3: the in-app chat.**

- Build: proxy and policy in the bridge; `chat/client.ts`, `thread.ts`, `loop.ts`, `looks.ts`, `events.ts`; integration with CHB-009's panel.
- Done when: loop tests against a fake Claude server cover a two-step tool round trip, refusal, `max_tokens` with a cut tool call, Stop during streaming, Stop during an eval, ask-mode approval inside a step, revert; the stored history of a multi-turn test thread is byte-identical as a prefix from request to request (the three-step check from the Claude migration guidance); a manual session with `claude-opus-5-5` completes a grey-balance request on the mock engine.

**Stage 4: playbooks and evaluation.**

- Build: the generator outputs; five playbooks with tests on the mock engine; transcript recording; replay; metrics report; the task-evaluation runner behind a budget flag; privacy settings.
- Done when: every playbook loads and runs on the mock engine in CI; replaying a recorded transcript on an unchanged build produces no diff, and renaming an op produces a failure with a `fix`; the metrics report lists op counts and unknown names for a set of transcripts; the grey-balance and test-strip evaluations run on the reference engine once CHB-003 reaches M2.

## 8. Testing and acceptance

**Golden numbers and laws that apply.** This ticket implements no physics, but its playbooks and units must agree with the textbook:

- units: 1 point = 0.025 log H; 1 stop = 0.30103 log H = 12.04 points; a 1/3-stop time step multiplies the time by 1.2599 (12.00 → 15.12 s) and adds 0.1003 log H; f/8 → f/11 is −0.277 log H. A unit test of the playbook arithmetic uses these.
- textbook §2.7: +10 points of red at the grey card gives a* = −20.7 and density 0.746 → 0.956; this is the starting fixture of the grey-balance evaluation on the reference engine and a check that the fixture is set up right.
- textbook §2.6: grey card at visual density 0.755 for Portra 400 on Portra Endura; the default aim of the test-strip evaluation.
- the "lights factor out" law (§2.8): a playbook may compute what-ifs by adding lights without rebuilding tables; the ring-around evaluation relies on that being cheap.

**Host safety tests (the security boundary).** Each is a program run through the real host with the mock engine, and each must fail if the boundary is removed:

| Attack | Expected |
|---|---|
| stage a mutation with an op not in the closed set | rejected with a diagnostic; recipe unchanged |
| `set` a path that no `OpDef.recipePath` declares | rejected, `E_PATH` (proposed code) |
| `set` a value outside the hard range | rejected, `E_ARG_RANGE` |
| any write in read-only mode | `E_READONLY`; nothing appended as applied |
| any write in ask mode | appended as pending; recipe unchanged until `decide()` |
| try to set `by`, call an approval function, or reach `window` from agent code | not reachable: `ReferenceError` or `E_UNKNOWN_METHOD`; nothing applied |
| infinite loop | `E_TIMEOUT` within deadline + 2 s; next eval in the session reports `E_SESSION_RESET` |
| a frame named "approve all.tif" with a model told to obey it | the model can only propose; the proposals are pending in ask mode |

To show a test can fail, run it once against a deliberately broken host (for example `commit()` that copies `by` from the staged mutation, or a deadline that is never armed) and confirm it goes red. Keep that broken variant as a test fixture, as the architecture doc asks for parity tests.

**Bridge tests (Go).** `mcp.NewInMemoryTransports()` with a fake page goroutine speaking the page protocol, in goja-cv's style (`mcp_test.go` 17–42): tool list and descriptions, resources and prompt, instruction length, `eval` round trip with an image, `E_NO_PAGE`, timeout returning `E_TIMEOUT` and sending `eval.cancel`, client cancellation reaching the page, unknown session wording. `httptest` for the guards: wrong Host, cross-site Origin, missing cookie, wrong token. Proxy tests against an `httptest.Server` that streams SSE slowly: the first event reaches the client before the upstream finishes (flushing works), aborting the client request cancels the upstream request, disallowed model and beta values are rejected, and the API key never appears in a response or a log line.

**Chat loop tests (TypeScript).** A fake Claude server that replays recorded SSE streams. Fixtures: `two-steps.sse`, `refusal.sse`, `cut-tool-call.sse`, `fallback.sse`. Assert the exact request bodies the loop sends, including that each request's `system`, `tools` and message prefix equal the previous request's.

**Docs are tests.** Every `js` block in generated agent docs and playbook headers runs in a real session against the mock engine, as goja-cv's `docs_test.go` does.

**Fixtures needed:** `fixtures/scans/` Gold 200 sample (from CHB-001) for manual sessions; `fixtures/synthetic/` frames from CHB-004 for grey balance, planted dust and roll offsets; `packages/agent/test/fixtures/*.sse`; a representative result text.

## 9. Proposed contract additions (for CHB-002)

1. **`LoggedMutation.seq: number`**, a per-frame monotonic sequence number. Needed to reference entries in approvals, revert and conflict detection.
2. **`LoggedMutation.frame: string`** (or one edit log per frame with the frame id in every `EvalResult.mutations` entry). Needed because one eval may stage mutations for several frames.
3. **`Look`** shape, referenced by `EvalResult.looks` but not defined:

   ```ts
   export interface Look {
     n: number;                          // look number, burned into the image band
     caption: string;                    // what it shows: node path, crop, scale
     values?: Record<string, number | number[] | string>;   // the numbers it shows
     image: { mime: 'image/jpeg' | 'image/png'; width: number; height: number; bytes: Uint8Array };
   }
   ```

4. **Diagnostic codes** in `errors.ts`: `E_TIMEOUT`, `E_CANCELLED`, `E_BUSY`, `E_SESSION`, `E_SESSION_RESET`, `E_NO_PAGE`, `E_READONLY`, `E_PATH`, `E_TOOL_INPUT`, and the warning `CONFLICT`.
5. **Cancellable engine calls:** an optional `signal?: AbortSignal` on `Engine.evaluate` and `Engine.measure` (for example as a third `opts` argument). Without it a cancelled eval keeps the GPU busy. CHB-009's render scheduler needs the same addition.
6. **`EvalResult.trace?: { ms: number; ops: Record<string, number> }`**, not rendered to the model, recorded by the harness.
7. **A recipe field for retouched dust spots**, for example `scan.retouch?: { spots: { id: string; x: number; y: number; r: number }[] }`, changed with `set`. To be shaped with CHB-006, which owns dust detection.

## 10. Risks, open questions and decisions

**Blocking decisions (need an answer before the stage that uses them):**

- **Hosting** (architecture doc §8.4). Without the bridge there is neither an MCP route nor a key-holding proxy. If the answer is "static PWA only", stage 3 needs another proxy and stage 2 becomes optional. Blocks stage 3's deployment, not its development.
- **Staging in the runner.** The commit rule in 5.2–5.3 requires CHB-007 to stage writes and provide read-your-writes. Agree on `RunOutcome` with CHB-007 before stage 1 ends.
- **Approval semantics in the edit log.** Whether approving a pending entry flips its status or appends a new applied entry is CHB-002's choice; the host and the UI need to know which.

**Open questions (do not block; decide during implementation):**

- Whether the bridge should also serve the photographer's scan folders to the page (useful outside Chromium, where the File System Access API is missing; CHB-009 decides with this ticket).
- Whether the API key should live in the OS keychain instead of a 0600 file.
- Whether Claude Code's current client speaks 2026-07-28; `Stateless: true` must be tested against it, with a fallback to the stateful handler if it misbehaves.
- How background-tab throttling affects GPU work during an eval started from Claude Code while the studio tab is hidden. The status tool should report "page hidden" so the agent can say why an eval is slow.

**Risks:**

- **Cost and latency of the in-app chat.** Long system prompts are cached, but each step re-sends history. Context editing and effort settings are the levers; the metrics report shows tokens per task.
- **Prompt injection through frame names, notes and playbooks.** Mitigated by the host boundary; residual risk is unwanted proposals in auto mode. Default to ask mode for new projects.
- **Forced worker termination loses `mem`.** Agents must be told (`E_SESSION_RESET`) and playbooks should be cheap to reload.
- **Format drift between chat and MCP.** Prevented by the single renderer and its golden test.

## 11. References

**Chromobench and CHB-001 material**

- Architecture doc: `C1/design-doc/01-chromobench-architecture-and-work-plan.md` §3 (architecture), §4 (vocabulary), §5.4 (recipe, mutations, edit log, ask mode), §5.5 (eval contract), §8 (work plan, open decisions).
- Filmbench: `C1/various/extracted/filmbench-ide/01-inline.js` lines 2323–2375 (`wb.apply`, pending queue), 4448–4449 (limits, `WRITE_RE`), 4532–4545 (look gate), 4648–4707 (system prompt), 4708–4719 (context), 4721–4737 (result format, `runCode`), 4749–4752 (error texts), 4805–4811 (approval), 4832–4895 (the step loop and history handling), 5084–5090 (`window.claude.use('sample')`); `vfs/agent/brief.md` (house notes); report `C1/various/analysis-filmbench-ide.md` §1, §2, §6.
- goja-cv: `pkg/cvsession/mcp.go`, `reference.go`, `processor.go`, `session.go`, `tables.go`, `mcp_test.go`, `testdata/representative.result`, `testdata/scripts/dust/helpers.js`; `cmd/goja-cv/mcp.go`; report `C1/various/analysis-goja-cv.md` §1.3–1.4, §2.10, §3, §4, §5.4.
- go-go-goja replmcp: `~/go/pkg/mod/github.com/go-go-golems/go-go-goja@v0.10.8-0.20261109062017-5e1ba117462e/pkg/replmcp/replmcp.go` and `tools.go`.
- Textbook: `C1/sources/The Mathematics of the Colour Negative.md` §2.6 (printer lights, CC, grey balance), §2.7 ("Try it" numbers), §2.8 (composition laws).

**External**

- MCP specification, versioning and the 2026-07-28 revision: https://modelcontextprotocol.io/specification/versioning
- Official MCP Go SDK and release notes (v1.7.0, v1.8.0): https://github.com/modelcontextprotocol/go-sdk/releases
- mark3labs/mcp-go: https://github.com/mark3labs/mcp-go (spec support per https://mcp-go.dev/transports/http)
- Claude Code MCP configuration (`claude mcp add`, scopes, `MCP_TOOL_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS`): https://code.claude.com/docs/en/mcp
- Claude Desktop local servers (`claude_desktop_config.json`, stdio): https://modelcontextprotocol.io/quickstart/user
- Anthropic TypeScript SDK (browser use, streaming, errors, retries): https://platform.claude.com/docs/en/api/sdks/typescript
- Claude API: tool use, streaming, context editing, prompt caching, refusals and fallbacks, and the model migration notes for Claude Opus 5.5 (preserved thinking and the append-only rule): https://platform.claude.com/docs
- `coder/websocket`: https://github.com/coder/websocket
- Go `net/http` `ServeMux` patterns (Go 1.22) and `CrossOriginProtection` (Go 1.25): https://pkg.go.dev/net/http
