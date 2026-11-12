# CHB-008 contract requests

Requests for `@chromobench/contract`, for the orchestrator to apply at merge time. The agent works without them
today; each says what it does locally in the meantime. Most of the guide's §9 list is already in contract 0.3
(`LoggedMutation.seq` and `.frame`, `Look`, the diagnostic codes, `signal` on `evaluate`/`measure`, `EvalResult.trace`).

## R1. `EditLog.propose(…, { pending: true })`: the photographer's hand wins in auto mode

**What.** An option on `propose` that records the entries as `pending` whatever the mode (read-only still throws).

**Why.** Guide §5.2, "the commit rule": if the photographer changed a path while an eval ran, the agent's change to
the same path must wait for approval even in auto mode, because the agent worked from a stale view. The page
replays a worker session's proposals with `propose` after the eval; without this option it cannot downgrade a
conflicting proposal in auto mode. Today such a proposal applies (it stays visible and undoable in the history).

**Proposed diff** (`packages/contract/src/editlog.ts`):

```diff
-  propose(ms: readonly Mutation[], meta: { tx: string; why?: string; label?: string; batch?: string }): LoggedMutation[] {
+  propose(ms: readonly Mutation[], meta: { tx: string; why?: string; label?: string; batch?: string; pending?: boolean }): LoggedMutation[] {
     if (this.modeValue === 'read-only') fail('E_READONLY', 'the agent is read-only for this frame', { hint: 'the photographer can switch the agent to ask mode' });
@@
-    if (this.modeValue === 'ask') {
+    if (this.modeValue === 'ask' || meta.pending) {
       const entries = withExpect.map((m) => this.append(m, 'agent', 'pending', meta.tx, meta.why, meta.batch));
```

## R2. `LoggedMutation.origin?: 'chat' | 'mcp' | 'dev'`

**What.** An optional field naming the transport an agent entry came from.

**Why.** The history and approval cards should say "Assistant" (in-app chat) or "Claude Code" (MCP). Locally the
transport is encoded in the transaction id prefix (`chat-eval-3`, `mcp-eval-1`, `mcp-s-1-eval-2`, `dev-eval-1`),
which keeps transactions unique across sessions but is only a convention.

**Proposed diff** (`packages/contract/src/mutations.ts`, `LoggedMutation`; `EditLog.propose` meta passes it through):

```diff
   tx?: string;
+  /** Agent entries: which transport proposed them (CHB-008). */
+  origin?: 'chat' | 'mcp' | 'dev';
```
