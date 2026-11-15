# Chapter 7 · Budgeted Residency

*Count your own device memory against a derived budget; keep per owner, evict by visibility, recover once.*

**★** A good form among several; the Variations section names the others.

## Intent

When the device will not say how much memory is free, derive a budget by a written rule and count every allocation
against it in one ledger. Keep data per owner (an open image, a session, a level), at the size its consumers read,
and give memory back in the order the user would notice least. When an allocation still does not fit, free everything
not needed, retry once, and otherwise fail plainly for the right task.

## Also known as

Residency management; memory budget; texture streaming pool; working-set control.

## Motivation

chromobench keeps images on the GPU as **textures** (two-dimensional arrays the GPU samples and writes) and temporary
data in **buffers** (plain arrays of device memory). Its working textures are `rgba32float`: four 32-bit numbers, 16
bytes a pixel. A 24-megapixel raw file is developed at a working size of 4000 × 2686 pixels, so one full-size texture
is 171,904,000 bytes, 164 MiB.

With two such files open on an Apple laptop's integrated GPU, the viewer failed nine times with
`E_GPU_OOM: film.camMatrix.0: 14192640 bytes do not fit the budget (525083680 of 536870912 live)`. The budget was a
constant 512 MiB; 11.2 MiB were left and the next texture needed 13.5 MiB. After the second file the ledger counted
507 MiB live, and accounting for it showed four failures, none of them "the budget is too small".

1. **Every owner kept its full size.** Each open file kept its 164 MiB source texture whether it was on screen or not:
   328 MiB for two files.
2. **Small consumers held large data.** A 160-pixel filmstrip thumbnail shows the whole image, so it uploaded and kept
   the full-size texture to read 17,120 of its 10.7 million pixels.
3. **Released memory was not reclaimable.** 160 MiB of upload buffers had been released into the buffer pool's free
   list. Only the texture pool was ever trimmed, so they stayed in the budget for good.
4. **Some memory was not counted at all.** The film grain made textures of ones directly from the device, outside the
   ledger, each as large as the image again.

The fix (residency per owner, proxies at the consumer's size, one ledger over both pools) brought the peak from 512
MiB to about 215 MiB and live textures from 328 MiB to 47 MiB. The same numbers came out under a forced 512 MiB
budget: the fix was the accounting, not a larger number.

A language-model server meets the same problem with a key–value cache per conversation on one GPU; a game, with
textures for the parts of a level the player might see; a database, with pages that a running query holds.

## Problem

**How does a program keep the right data on a device whose free memory it cannot measure, and stay correct when the
device runs out anyway?**

## Forces

- **A measured budget against a stated one.** A budget that tracked free memory would use the machine fully, but
  WebGPU reports none; a rule over what the platform does report is predictable and can be wrong for a given machine.
- **Full fidelity against footprint.** Keeping each owner's data at full size serves every request; keeping only what
  consumers read saves memory by the ratio of their sizes, but must give the same numbers.
- **Recency against visibility.** Least recently used is the classic order; what is on screen matters more than what
  was touched last, and what a task is reading matters most.
- **Simple eviction against cost-aware eviction.** Least recently used needs no cost model; weighing the cost of
  remaking an item per byte pays only when that ratio differs between items.
- **Recover against tell the truth.** A retry absorbs a passing shortage; an unbounded retry hides a real one; a stale
  result left in view hides it worst of all.

## Solution

**Therefore: own the device memory in one ledger, with a budget derived by a written rule from what the platform
reports, and record the rule wherever the budget appears. Keep data resident per owner and at the size its consumers
read, so a small consumer gets a small copy that is bit-identical to reading the full data on the same grid. When an
allocation does not fit, take memory back in order of least harm: released units first (oldest release first), then
owners not on screen (least recently used owner first), never a unit a task is reading. If the device or the ledger
still refuses, let go of everything not essential, retry once, and otherwise fail with the bytes, the budget and its
rule, for the task that failed. Journal every high-water mark, eviction and recovery, so a report from another
machine says how close it ran.**

## Applicability

Use it when the platform does not report free device memory (a browser's GPU, a shared accelerator), when several
owners compete for one device (documents, conversations, levels), when consumers often need less than full size
(thumbnails, previews, distant objects), and when running out happens in the field, not only in tests.

Do not use it when the platform reports a per-process budget (Vulkan's memory-budget extension, DXGI's video memory
query): read theirs rather than keep a second count that drifts. Nor when the working set is fixed at build time, or
only one owner ever exists and fits easily.

## Structure

| Participant | Responsibility |
| --- | --- |
| **Budget rule** | turns what the platform reports (host memory, largest allocation, adapter kind, an override) into a number and a sentence |
| **Ledger** | the only creator of device memory; bytes live, high-water marks, release clock shared by all pools |
| **Pools** | released units kept for reuse by descriptor; trimmed oldest first when room is needed |
| **Residency** | units kept between tasks, grouped by owner; proxies per owner; lease and pin marks; eviction order |
| **Proxy maker** | samples an owner's data on a consumer's grid so a small consumer reads a small, exact copy |
| **Recovery** | the one bounded procedure after an out-of-memory refusal |
| **Journal** | high-water marks per task, evictions, recoveries, and the budget rule |

In a language-model server: the rule derives the cache budget from device memory minus the weights, the owner is a
conversation, a lease is a batch in flight, a pin is a conversation receiving tokens now, and recovery is preemption.

## Collaborations

1. The ledger takes its budget and rule at start and journals both; the display pins the owners on screen.
2. A task asks for its source on its own grid: the kept full-size unit, else a proxy for that grid, made if needed.
   The task leases what it receives.
3. A new allocation asks the ledger for room: released units of every pool, oldest release first; then unpinned
   owners, least recently used first, skipping leased units; then the released units again.
4. If room cannot be made, the ledger refuses. The task's driver evicts everything, pinned and leased units included,
   and runs the task once more; a second refusal is a plain error for that task.
5. The task ends its leases, returns scratch units to the pools, and journals its own high-water mark.

## Sketch

```text
-- the budget: a rule over what the platform reports, never a measurement of free memory
budgetFor(p) → (bytes, rule):
  -- p.memory: host memory reported, GiB, or none; p.maxBuffer: the adapter's largest buffer
  -- p.software: the adapter runs on the CPU; p.override: a budget the user set, or none
  if p.override ≠ none: return (p.override, "given: " ++ p.override)
  mem   ← p.memory if p.memory ≠ none else 4 GiB                -- assumed; the rule says so
  high  ← 1 GiB if p.software else 2 GiB
  bytes ← roundDownToMiB(max(512 MiB, min(high, p.maxBuffer, mem / 8)))
  return (bytes, "min(" ++ mem ++ " / 8, " ++ p.maxBuffer ++ ") within [512 MiB, " ++ high ++ "] = " ++ bytes)

-- the ledger: every device allocation passes through it
owner Ledger(limit):
  live ← 0 ; windows ← {}                    -- bytes claimed now; open per-task high-water marks
  pools ← [] ; reclaimers ← []               -- pools of released units; functions (need, all) → bytes let go

  allocate(desc, label) → unit:
    for pool in pools: if pool.has(desc): return pool.take(desc)      -- reuse: no new bytes
    need ← bytes(desc)
    if not makeRoom(need):
      refuse("out-of-memory", label ++ ": " ++ need ++ " bytes (" ++ live ++ " of " ++ limit ++ ")")
    live ← live + need ; for w in windows: w.peak ← max(w.peak, live)
    return create(desc, label)               -- labelled, so device errors name it (Chapter 8)
  discard(unit): live ← live − bytes(unit) ; retire(unit)
    -- retire (Chapter 8): out of the count now, destroyed after the device's last use of it
  trimReleased(target):
    for (pool, unit) in released units of every pool, oldest release first:
      if live ≤ target: stop
      pool.remove(unit) ; discard(unit)
  makeRoom(need) → bool:
    trimReleased(limit − need)
    for f in reclaimers: if live + need > limit: f(live + need − limit, all: false)
    trimReleased(limit − need)
    return live + need ≤ limit
  window() → w: w ← { peak: live } ; add w to windows ; return w
  close(w) → bytes: remove w from windows ; return w.peak

-- residency: units kept between tasks, grouped by owner
owner Residency(ledger):
  PROXIES ← 4                                -- per owner: a rule (thumbnail, draft, screen, one spare)
  items: map key → { owner, unit, bytes, used, leases, proxy }
  ownerUsed: map owner → tick ; pinned ← {} ; tick ← 0
  get(key) → unit or none:
    it ← items[key] ; if it = none: return none
    tick ← tick + 1 ; it.used ← tick ; ownerUsed[it.owner] ← tick ; return it.unit
  put(owner, key, unit, bytes, proxy, cap):
    tick ← tick + 1 ; items[key] ← { owner, unit, bytes, used: tick, leases: 0, proxy } ; ownerUsed[owner] ← tick
    if proxy:                                -- keep the newest proxies that fit under cap; let the rest go
      others ← [i in items where i.owner = owner and i.proxy and i.leases = 0 and i.key ≠ key], newest first
      kept ← bytes
      for (n, i) in enumerate(others):
        if n ≥ PROXIES − 1 or kept + i.bytes > cap: drop(i) else kept ← kept + i.bytes
  lease(key): if items[key] ≠ none: items[key].leases += 1
  unlease(key): if items[key] ≠ none: items[key].leases −= 1     -- recovery may have evicted it meanwhile
  pin(owners): pinned ← set(owners)
  evict(need, all) → bytes:                  -- a reclaimer; all = true only in recovery
    freed ← 0
    for it in items sorted by (it.owner ∈ pinned, ownerUsed[it.owner], it.used):
      if freed ≥ need: stop
      if not all and (it.leases > 0 or it.owner ∈ pinned): continue
      drop(it) ; freed ← freed + it.bytes
    return freed
  drop(it): remove it.key from items ; ledger.discard(it.unit)

-- what a task reads: the kept full size, else a proxy on the task's own grid
sourceFor(img, region, out) → (unit, key or none):
  full ← "full|" ++ img.id
  u ← residency.get(full) ; if u ≠ none: return (u, full)
  if out.w · out.h < region.w · region.h:
    key ← "proxy|" ++ img.id ++ region ++ out
    u ← residency.get(key)
    if u = none:
      p ← sampleOnGrid(img, region, out)     -- p[q] = img[g(q)], g computed exactly as the kernels do (Chapter 3)
      u ← upload(p) ; residency.put(img.id, key, u, bytes(p), proxy: true, cap: bytes(img))
    return (u, key)
  if region = whole(img):
    u ← upload(img) ; residency.put(img.id, full, u, bytes(img), proxy: false, cap: 0) ; return (u, full)
  return (upload(crop(img, region)), none)  -- a tile of an export: this task's alone

-- a task with its own high-water mark, and one bounded recovery
render(task) → picture or refusal:
  attempt():
    w ← ledger.window() ; src ← none ; key ← none
    try:
      (src, key) ← sourceFor(task.img, task.region, task.out)
      if key ≠ none: residency.lease(key)
      return run(task, src)                  -- run allocates scratch through the ledger, releases it to the pools
    finally:
      if key ≠ none: residency.unlease(key)
      else if src ≠ none: ledger.discard(src)                    -- a crop made for this task only
      journal("render", peak: ledger.close(w), live: ledger.live, limit: ledger.limit)
  try: return attempt()
  catch out-of-memory:
    before ← ledger.live
    residency.evict(∞, all: true) ; ledger.trimReleased(0)
    freed ← before − ledger.live
    try: p ← attempt() ; journal("recovered", freed) ; return p
    catch out-of-memory as e:
      journal("failed", freed)
      return refuse("out-of-memory", e.message ++ " after letting go of " ++ freed ++ " bytes",
                    hint: "budget " ++ ledger.limit ++ ": " ++ rule)

-- the pattern in use
(limit, rule) ← budgetFor(platform) ; journal("budget", limit, rule)
ledger ← Ledger(limit) ; residency ← Residency(ledger) ; ledger.reclaimers ← [residency.evict]
residency.pin(ownersOnScreen())
match render(task):
  refusal r: if task.img ≠ view.shownOwner: view.takeDown()
             view.say(r.message)
  picture p: view.show(p, owner: task.img)
```

## Implementation notes

1. **The budget is a rule, and the rule is data.** chromobench takes an eighth of `navigator.deviceMemory` (host
   memory in GiB, rounded by the browser; 32 on the test machine), at most the adapter's `maxBufferSize`, within
   512 MiB and 2 GiB (1 GiB for a software adapter); with no figure reported it assumes 4 GiB, which gives the floor.
   `?gpuBudget=` overrides it. On an integrated GPU device memory is the host's RAM, shared with everything else: an
   eighth is a policy, not a fact. The floor wins over `maxBufferSize` (a 256 MiB adapter still gets 512 MiB). The
   rule's sentence is journalled with the budget.
2. **Read the adapter's limits, not the device's.** The first version came out at 1 GiB instead of 2 GiB on the test
   machine. It read the device's `maxBufferSize`, which the engine itself had capped at 1 GiB when it requested the
   device: circular.
3. **One ledger across pools, one release clock.** This is the bug chromobench shipped: 160 MiB of released upload
   buffers that nothing could trim. Both pools now share one ledger and are trimmed oldest release first. Upload
   buffers over 16 MiB are not pooled: a large buffer kept for a rare reuse is idle memory.
4. **Every allocation through the ledger.** The grain's textures of ones moved into the pool. Debts remain: the film
   module's small table buffers still bypass the ledger, and a texture of ones as large as the image (164 MiB at full
   size) supplies a constant that a uniform could supply for nothing.
5. **A proxy must be exact, not similar.** A proxy is the source sampled on the consumer's grid, so the consumer reads
   texel q of the proxy where it would have read texel g(q) of the full image. That is an identity only if g is
   computed exactly as the kernel computes it. The kernel computes `fp = origin + floor((p + 0.5) · zoom)` in f32; the
   host reproduces it with `Math.fround`, because the product of two f32 values is exact in f64, so one rounding gives
   the correctly rounded f32 product. On the software adapter and on Metal, zero samples differed at every scale and
   region tested. A filtered proxy (an area average) would be a better picture and would break the parity tests: that
   is [Chapter 3](03-one-grid-rule.md)'s trade.
6. **Bound what an owner may keep.** At most four proxies per owner, and their bytes together never more than the
   full-size texture would take, leased ones aside: an owner costs at most about twice its full size. The four is a
   rule (thumbnail, draft, screen, one spare), written as such in the code. On a high-density display the viewer's
   proxy approaches the full size, so proxies save most for thumbnails and drafts.
7. **Evict by visibility, then recency, at owner granularity.** Pinned owners go last, leased units never (except in
   recovery), and among the rest the least recently used owner goes first, whole. Ten 2400 × 1600 scans opened and
   switched in a 512 MiB budget on the software adapter peaked at 109 MiB and kept 69 MiB across all ten, 7 MiB of
   it for the image on screen. Cost-aware eviction (GreedyDual-Size) was deferred: everything kept costs an upload
   roughly proportional to its bytes. With cost ∝ size every priority is the clock plus one constant, so the policy
   only breaks ties, and with ties broken by age it is least recently used (Exercise 2). Cached intermediates will
   differ in cost per byte; the ordering function is the one place to change
   ([Chapter 9](09-content-keyed-cost-aware-cache.md)).
8. **Recover once, at the task level, and say what was tried.** On a refusal the renderer drops any export fields,
   evicts everything including pinned and leased units, trims every pool and retries. A second failure names the
   bytes freed, the budget and its rule; the viewer takes down the picture if it belongs to another image. The
   failing path is twice as slow, accepted on purpose.
9. **Two kinds of out-of-memory, and only one is recovered.** The ledger's refusal is synchronous and names its
   allocation. The driver's `GPUOutOfMemoryError` arrives later, through an **error scope** (a WebGPU bracket that
   collects the errors of the calls inside it, read by a promise). `Pool.acquireChecked` awaits a scope around each
   allocation, trims, halves the budget for good and retries; only a unit test calls it (P10-5). In the program,
   driver errors reach the journal and nothing recovers from them. The halving is a ratchet: one transient failure
   would leave the budget halved for the rest of the session.
10. **Test recovery by injection, and inject at the right layer.** `Budget.inject(n)` makes the next n acquisitions
    fail. The first version failed only allocations needing new bytes; the test's render reused released textures and
    never failed; now every acquisition can. The journal keeps each render's high-water mark, a row each time the
    session's highest grows by 32 MiB, and one per eviction and recovery: the original out-of-memory was diagnosed
    from those, not from the error.

## Variations

- **Ask the platform.** Vulkan's memory-budget extension and DXGI's video memory query report a budget and usage per
  heap. Use them where they exist; keep your own count only for attribution.
- **Page-granular residency (virtual texturing).** Keep fixed-size pages of a mipmapped image, chosen by which pages
  the last render touched. Memory tracks visibility finely; the price is a page table, an indirection in every read,
  and a feedback pass.
- **Store narrower.** Half floats halve every texture. chromobench measured it for its camera path: the display
  differed by up to 0.0134 (3.4 eight-bit levels), and the scene-referred values missed their parity tolerance five
  times over, so working textures stay f32 ([Chapter 2](02-precision-ladder.md)).
- **Wait or spill instead of evicting.** A fixed pool makes tasks wait; a tiered store copies evicted data to host
  memory. chromobench keeps decoded pixels on the host, so an evicted source is uploaded again; a host tier for
  intermediates must beat recomputation on measured readback cost.

## Consequences

- \+ Out-of-memory becomes predictable and attributable: the refusal names the allocation, the bytes, the count and
  the rule.
- \+ Footprint follows what is shown, not what is open: two owners fell from 328 MiB of textures to 47 MiB.
- \+ The budget is reproducible across machines: a report carries the rule and the high-water marks.
- − The ledger counts what the program asked for, not what the driver holds (alignment, internal copies, units
  retired but not yet destroyed: [Chapter 8](08-retire-after-the-fence.md)); one bypass silently breaks it.
- − The rule's constants are judgements; on a machine they suit badly, the budget is too tight or too loose.
- − Proxies cost a host-side gather and an upload per new grid, and exactness ties the proxy to the kernel's
  arithmetic.

## Known uses

- **Vulkan Memory Allocator** (AMD GPUOpen) reads heap budgets through `VK_EXT_memory_budget` and, on request, makes
  an allocation fail rather than exceed them; Direct3D 12 applications read `QueryVideoMemoryInfo`'s budget and
  manage residency with `MakeResident` and `Evict`.
- **Unreal Engine**'s texture streaming pool keeps mip levels within a configured pool size, prioritised by on-screen
  size; this is residency per owner at the size the consumer reads.
- **Virtual texturing**: Sean Barrett, "Sparse Virtual Textures", GDC 2008; id Software's id Tech 5 used virtual
  texturing ("MegaTexture") in *Rage* (2011).
- **PostgreSQL**'s shared buffers (pinned buffers are never evicted); **Android**'s `onTrimMemory` and **iOS**'s
  memory warnings (the platform's signal in place of a budget).
- **vLLM**: Woosuk Kwon et al., "Efficient Memory Management for Large Language Model Serving with PagedAttention",
  SOSP 2023. Key–value caches live in fixed-size blocks under a device budget; under pressure, requests are preempted
  and their blocks swapped out or recomputed.
- Peter J. Denning, "The Working Set Model for Program Behavior", *Communications of the ACM* 11(5), 1968.
- **GreedyDual-Size**: Pei Cao and Sandy Irani, "Cost-Aware WWW Proxy Caching Algorithms", USENIX USITS 1997.

## Related chapters

- [Chapter 8 · Retire After the Fence](08-retire-after-the-fence.md): eviction only takes a unit out of the count;
  Chapter 8 says when it may leave the device.
- [Chapter 9 · Content-Keyed, Cost-Aware Cache](09-content-keyed-cost-aware-cache.md): what to keep once intermediates
  are cached; residency of sources is its degenerate case.
- [Chapter 3 · One Grid Rule](03-one-grid-rule.md) makes a proxy bit-identical to the full source;
  [Chapter 6](06-cross-the-bus-rarely.md): every eviction is an upload later;
  [Chapter 10](10-measure-completion-gate-percentiles.md): high-water marks belong beside latencies.
- Modular volume: [Count What You Own](../modular/08-count-what-you-own.md) introduces the ledger, leases and pins;
  this chapter adds the budget rule, proxies and the eviction analysis.
- Image engine volume: [Reach-Declared Tiling](../08-reach-declared-tiling.md) computes what does not fit in bounded
  tiles; [Latest-Wins Render Slots](../04-latest-wins-render-slots.md) decides which renders run at all.

## Exercises

1. **Work a budget, then measure it without a GPU.** The Editor lab textbook works a time budget for opening a
   ten-layer 24-megapixel document and leaves memory as "the device class's budget, measured". Work the memory side:
   a 6000 × 4000 layer in `rgba32float` is 366 MiB (the textbook's 384 MB, decimal), ten are 3.6 GiB, and a view on a
   2× display reads level 1 at 92 MiB a layer. What fits in 1 GiB beside two intermediates? Then implement the sketch
   with byte counts for textures, replay ten such images with thumbnails and a 1500 × 1000 viewer, report peak and
   bytes uploaded with and without proxies, and inject a failure to check recovery.
2. **Analyse the eviction order.** GreedyDual-Size sets an item's priority H = L + c/s on insertion and on each hit
   (c: cost to remake, s: size, L: the H of the last victim) and evicts the least H. (a) Prove that when c/s is one
   constant for every item, it evicts in least-recently-used order exactly when ties go to the least recently used.
   (b) Give a trace of sources and intermediates, with costs you choose, on which LRU remakes twice the work.
3. **Analyse the proxy's exactness.** The kernel computes g(p) = ⌊fl32((p + ½) · fl32(W/n))⌋. A host that computes
   ⌊(p + ½) · W/n⌋ in f64 instead will disagree for some (W, n, p). Find the smallest such n for W = 6000 by search,
   and explain why the disagreement is always at most one pixel.
4. **Another domain: a model server.** An 80 GiB GPU holds 26 GiB of weights; each conversation's key–value cache
   grows by 0.5 MiB a token. Derive a budget rule (state what you leave for activations), define owner, lease and pin,
   choose the eviction order, and say what the user sees when recovery fails. Compare vLLM's preemption.
