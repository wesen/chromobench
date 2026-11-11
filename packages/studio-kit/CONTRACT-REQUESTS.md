# Contract requests from studio-kit (CHB-019)

## R1. `EditLog.preview` takes several mutations

**What.** `preview(m: Mutation | Mutation[] | null)`.

**Why.** A gesture that previews two paths of one frame at once (a look's parameter, a pad that moves the
lights and the density together, a test-strip band that sets time and filtration) can only put one mutation in the
log's overlay. The route keeps the shell's overlay as the readers' truth and puts only the last field into
`log.preview`; `log.state` is then wrong for the other paths during the gesture (only the agent reads it).

**Workaround now.** `EditLogRoute.preview` previews the last field written; the commit applies every field as one
unit, so nothing logged is affected.

**Proposed diff** (`packages/contract/src/editlog.ts`):

```diff
-  private overlay: Mutation | null = null;
+  private overlay: Mutation[] | null = null;
…
   get state(): FrameRecipe {
     if (!this.overlay) return this.committed;
-    if (!this.stateCache) this.stateCache = applyMutation(this.committed, this.overlay).recipe;
+    if (!this.stateCache) this.stateCache = this.overlay.reduce((r, m) => applyMutation(r, m).recipe, this.committed);
     return this.stateCache;
   }
…
-  preview(m: Mutation | null): void {
-    if (m) applyMutation(this.committed, m); // validate; throws on an invalid preview
-    this.overlay = m;
+  preview(m: Mutation | readonly Mutation[] | null): void {
+    const ms = m === null ? null : Array.isArray(m) ? [...m] : [m as Mutation];
+    if (ms) ms.reduce((r, x) => applyMutation(r, x).recipe, this.committed); // validate; throws on an invalid preview
+    this.overlay = ms && ms.length ? ms : null;
     this.stateCache = null;
-    this.emit({ type: 'preview', mutation: m });
+    this.emit({ type: 'preview', mutation: this.overlay?.[0] ?? null, mutations: this.overlay ?? [] });
   }
```

and in `LogEvent`: `| { type: 'preview'; mutation: Mutation | null; mutations: Mutation[] }`.

## R2. Move the frame vocabulary out of the DSL host

**What.** `ACCESSORS`, `PRINT_OPTIONS` and `cut(recipe, op)` in a shared module (contract or a small
`@chromobench/vocab`), imported by `packages/dsl/src/host.ts` and `packages/studio-kit/src/handles.ts`.

**Why.** Viewer and agent must name the same node for the same words. Today studio-kit keeps a copy;
`test/kit.test.ts` compares `PRINT_OPTIONS` with the DSL's and `cb.frame(s).print()` with `Host.printOf` on the M1
fixture, so a drift fails a test, but the copy should go (guide §14 item 9; CHB-017/CHB-007 decide where).
