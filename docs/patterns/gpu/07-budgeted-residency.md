# Chapter 7 · Budgeted Residency

*Count your own device memory against a derived budget; keep per owner, evict by visibility, recover once.*

**★** A good form among several; the Variations section names the others.

## Intent

When the device will not say how much memory is free, derive a budget by a written rule and count every allocation
against it in one ledger. Keep data per owner (an open image, a session, a level), at the size its consumers read,
and give memory back in the order the user would notice least. When memory still runs out, free what is not
essential, retry once, and fail plainly for the task that failed.

## Also known as

Residency management; memory budget; texture streaming pool; working-set control.

## Motivation

chromobench keeps images on the GPU as **textures** (two-dimensional arrays the GPU samples and writes) and temporary
data in **buffers** (plain arrays of device memory). Its working textures are `rgba32float`, 16 bytes a pixel. A
24-megapixel raw file is decoded to a working image 4000 pixels on its long side, 4000 × 2674 (10.7 megapixels), so
one full-size texture is 171,136,000 bytes, 163 MiB.

With two such files open on an Apple laptop's integrated GPU, the viewer failed nine times with
`E_GPU_OOM: film.camMatrix.0: 14192640 bytes do not fit the budget (525083680 of 536870912 live)`. The budget was a
constant 512 MiB; 11.2 MiB were left and the next texture needed 13.5 MiB. After the second file the ledger counted
507 MiB live, and accounting for it showed four failures, none of them "the budget is too small".

1. **Every owner kept its full size.** Each open file kept its working texture whether it was on screen or not:
   328 MiB of textures live, almost all of it the two working images.
2. **Small consumers held large data.** A 160 × 107 filmstrip thumbnail shows the whole image, so it uploaded and kept
   the full-size texture to read 17,120 of its 10.7 million pixels.
3. **Released memory could not be reclaimed.** An upload goes through a **staging buffer** (device memory the host
   writes into, from which a kernel builds the texture); a 4000-pixel RGB source in 32-bit floats needs 122 MiB of
   it. Released staging buffers, 160 MiB in all, sat in the buffer pool's free list, and only the texture pool was
   ever trimmed.
4. **Some memory was not counted.** The film grain made textures of ones directly from the device, outside the ledger.

The fix brought the peak to about 215 MiB and live textures to 47 MiB, the same under a forced 512 MiB budget: it
was the accounting, not a larger number.

A language-model server meets the same problem with a key–value cache per conversation on one GPU; a game, with
textures for the parts of a level the player might see; a database, with pages that a running query holds.

## Problem

**How does a program keep the right data on a device whose free memory it cannot measure, and stay correct when the
device runs out anyway?**

## Forces

- **A measured budget against a stated one.** A budget that tracked free memory would use the machine fully, but
  WebGPU reports none; a rule over what the platform does report is predictable and can be wrong for one machine.
- **Full fidelity against footprint.** Keeping each owner at full size serves every request; keeping only what
  consumers read saves memory by the ratio of their sizes, but must give the same numbers.
- **Recency against visibility.** Least recently used is the classic order; what is on screen matters more.
- **Counted bytes against usable memory.** A ledger counts bytes; the driver needs blocks it can place, and
  alignment and fragmentation make the two differ.
- **Recover against tell the truth.** A retry absorbs a passing shortage; an unbounded retry hides a real one; a stale
  result left in view hides it worst of all.

## Solution

**Therefore: let one ledger create all device memory and count it against a budget computed from what the platform
reports, by a rule stated wherever the budget appears. Keep data resident per owner, at the size its consumers read,
and never more per owner than a stated bound. When an allocation does not fit, give back released units first, then
owners not on screen, least recently used first, and never a unit a task is reading. If the ledger or the driver
still refuses, let go of everything not essential, retry once, and otherwise fail for that task with the bytes, the
budget and the rule. Record every task's high-water mark against the budget.**

## Applicability

Use it when the platform does not report free device memory, when several owners compete for one device, and when
consumers often need less than full size (thumbnails, previews, distant objects).

Do not use it when the platform reports a per-process budget (Vulkan's memory-budget extension, DXGI's video memory
query): read theirs rather than keep a second count that drifts. Nor when the working set is fixed at build time, or
only one owner ever exists and fits easily.

## Structure

| Participant | Responsibility |
| --- | --- |
| **Budget rule** | turns what the platform reports into a number and the sentence that derived it |
| **Ledger** | the only creator of device memory; bytes live, high-water marks, one release clock for all pools |
| **Pools** | released units kept for reuse by descriptor (format, size, usage); trimmed oldest release first |
| **Residency** | units kept between tasks, grouped by owner, with the eviction order |
| **Proxy** | an owner's data sampled on one consumer's grid, at the consumer's size |
| **Lease, pin** | a lease marks a unit a task is reading now; a pin marks an owner on screen |
| **Recovery** | the one bounded procedure after an out-of-memory refusal |
| **Journal** | the program's diagnostic log: budget and rule, high-water marks, evictions, recoveries |

In a language-model server: the budget is device memory minus the weights, the owner is a conversation, a lease is a
batch in flight, a pin is a conversation receiving tokens now, and recovery is preemption.

## Collaborations

1. The ledger takes its budget and rule at start and journals both; the display pins the owners on screen.
2. A task asks for its source on its own grid: the kept full-size unit, else a proxy for that grid, made if needed.
   The task leases what it receives.
3. A new allocation asks the ledger for room: released units of every pool, oldest release first; then unpinned
   owners, least recently used first, skipping leased units; then the released units again.
4. If room cannot be made, the ledger refuses; the task's driver evicts everything, pinned and leased units included
   ([Chapter 8](08-retire-after-the-fence.md) keeps work in flight valid), and runs the task once; a second refusal
   is a plain error.
5. The task ends its leases, returns scratch units to the pools, and journals its own high-water mark.

## Sketch

```text
-- the budget: a rule over what the platform reports, never a measurement of free memory
budgetFor(p) → (bytes, rule):
  -- p.memory: host memory reported, GiB, or none; p.maxBuffer: the adapter's largest buffer, or none
  -- p.software: the adapter is a CPU implementation of the API; p.override: a budget the user set, or none
  if p.override ≠ none and p.override > 0: return (p.override, "given: " ++ p.override)
  mem   ← p.memory if p.memory ≠ none and p.memory > 0 else 4 GiB      -- assumed; the rule says so
  high  ← 1 GiB if p.software else 2 GiB
  maxB  ← p.maxBuffer if p.maxBuffer ≠ none else high
  bytes ← roundDownToMiB(max(512 MiB, min(high, maxB, mem / 8)))
  return (bytes, "min(" ++ mem ++ " / 8, " ++ maxB ++ ") within [512 MiB, " ++ high ++ "] = " ++ bytes)

-- the ledger: every device allocation passes through it
owner Ledger(limit, rule):
  live ← 0 ; windows ← {} ; tick ← 0         -- bytes counted now; open per-task high-water marks; release clock
  free: map descriptor → list of (unit, releasedAt)
  reclaimers ← []                            -- functions (need, all) → bytes let go; residency is one

  allocate(desc, label) → unit:
    if free[desc] is not empty: return removeNewest(free[desc])         -- reuse: no new bytes
    need ← bytes(desc)
    if need > limit: refuse("too-large", label ++ ": " ++ need ++ " bytes exceed the whole budget " ++ limit)
    if not makeRoom(need):
      refuse("out-of-memory", label ++ ": " ++ need ++ " bytes (" ++ live ++ " of " ++ limit ++ ")")
    u ← create(desc, label)                  -- labelled, so device errors name it
    live ← live + need ; for w in windows: w.peak ← max(w.peak, live)
    return u
  release(u):                                -- kept for reuse, still counted
    if retired(u): return                    -- discarded meanwhile by a recovery: never reused (Chapter 8)
    tick ← tick + 1 ; append (u, tick) to free[descriptor(u)]
  discard(u): live ← live − bytes(u) ; retire(u)
    -- retire (Chapter 8): out of the count now, destroyed after the device's last use of u
  trimReleased(target):
    for (u, _) in every free list, oldest releasedAt first:
      if live ≤ target: stop
      remove u from its free list ; discard(u)
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
  put(owner, key, unit, bytes, proxy, cap):  -- cap: the most the owner's proxies may hold together
    tick ← tick + 1 ; items[key] ← { owner, unit, bytes, used: tick, leases: 0, proxy } ; ownerUsed[owner] ← tick
    if proxy:
      others ← [i in items where i.owner = owner and i.proxy and i.leases = 0 and i.key ≠ key], newest first
      kept ← bytes
      for (n, i) in enumerate(others):
        if n ≥ PROXIES − 1 or kept + i.bytes > cap: drop(i) else kept ← kept + i.bytes
  lease(key): if items[key] ≠ none: items[key].leases += 1
  unlease(key): if items[key] ≠ none and items[key].leases > 0: items[key].leases −= 1
  pin(owners): pinned ← set(owners)
  evict(need, all) → bytes:                  -- a reclaimer; all = true only in recovery
    freed ← 0
    for it in items sorted by (it.owner ∈ pinned, ownerUsed[it.owner], it.used):
      if freed ≥ need: stop
      if not all and (it.leases > 0 or it.owner ∈ pinned): continue
      drop(it) ; freed ← freed + it.bytes
    return freed
  drop(it): remove it.key from items ; ledger.discard(it.unit)

-- what a task reads: the kept full size, else a proxy on the task's own grid, else a crop for this task alone
sourceFor(img, region, out) → (unit, key or none):
  if out.w < 1 or out.h < 1 or region is empty: refuse("empty", "nothing to render")
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
  return (upload(crop(img, region)), none)

upload(x) → unit:
  u ← ledger.allocate(textureDesc(x), "source " ++ x.id)
  copyToDevice(x, u)                         -- through a staging buffer, discarded after the copy (Chapter 6)
  return u

-- one task: a source, one scratch output, a readback; everything it allocates goes back
run(task, src) → picture:
  out ← ledger.allocate(textureDesc(task.out), task.label)
  try: dispatch(task.kernel, grid(task.out), { src, dst: out }) ; return readback(out)
  finally: ledger.release(out)

render(task) → picture or refusal:
  attempt():
    w ← ledger.window() ; src ← none ; key ← none
    try:
      (src, key) ← sourceFor(task.img, task.region, task.out)
      if key ≠ none: residency.lease(key)
      return run(task, src)
    finally:
      if key ≠ none: residency.unlease(key)
      else if src ≠ none: ledger.discard(src)                     -- a crop made for this task only
      journal("render", peak: ledger.close(w), live: ledger.live, limit: ledger.limit)
  try: return attempt()
  catch out-of-memory:                       -- "too-large" is not caught: no eviction can help
    before ← ledger.live
    residency.evict(∞, all: true) ; ledger.trimReleased(0)
    freed ← before − ledger.live
    try: p ← attempt() ; journal("recovered", freed) ; return p
    catch out-of-memory as e:
      journal("failed", freed)
      return refuse("out-of-memory", e.message ++ " after letting go of " ++ freed ++ " bytes",
                    hint: "budget " ++ ledger.limit ++ ": " ++ ledger.rule)

-- the pattern in use
(limit, rule) ← budgetFor(platform) ; journal("budget", limit, rule)
ledger ← Ledger(limit, rule) ; residency ← Residency(ledger) ; ledger.reclaimers ← [residency.evict]
residency.pin(ownersOnScreen())
match render(task):
  refusal r: if task.img ≠ view.shownOwner: view.takeDown()
             view.say(r.message)
  picture p: view.show(p, owner: task.img)
```

## Implementation notes

1. **Derive the budget, and journal the derivation.** chromobench takes an eighth of `navigator.deviceMemory` (host
   memory in GiB, rounded by the browser; 32 on the test machine). On an integrated GPU that memory is shared with
   the system, the browser and other tabs, so the eighth is a share, not a measurement. It is capped by the
   adapter's `maxBufferSize`, which the browser sets per class of device (4 GiB on the test machine's GPU, 1 GiB on
   its **software adapter**, a CPU implementation of WebGPU), and kept within 512 MiB and 2 GiB (1 GiB for a software
   adapter). The floor is the budget the whole test suite already ran in on the software adapter, and it wins over
   `maxBufferSize`. Unreported memory is assumed to be 4 GiB, which gives the floor; `?gpuBudget=` overrides
   everything: a 32 GiB machine gets 2 GiB, an 8 GiB machine 1 GiB. Read the adapter's limit, not the device's: the
   first version read the device's, which the program itself had capped at 1 GiB.
2. **A byte count is not free memory.** Model the peak as the largest sum, at any moment, of what is resident (R),
   what tasks in flight hold (W) and what is released but not trimmed (F); the ledger keeps R + W + F within the
   budget. Measured at rest after the second file, before the fix, R was 328 MiB and F 179 MiB (160 MiB of buffers,
   19 MiB of textures): 5 MiB were free, and the texture pool's trim could reach only its own 19 MiB, so any render
   needing more than 24 MiB failed. After the fix, the measured peak was 215 MiB with 47 MiB resident and 48 MiB of
   released buffers, so the renders' own working set was about 120 MiB (my subtraction, not a measurement). The
   device holds more than the count: units retired but not yet destroyed, alignment, the driver's own copies. And a
   count that fits is not a block that fits: after allocations and frees of mixed sizes, free memory can be
   fragmented so that a large texture fails although the count admits it. That is why the driver can refuse an
   allocation the ledger allowed, and why the budget is a fraction of memory, not all of it.
3. **One ledger across pools; let large staging go.** This is the bug chromobench shipped. Both pools now share one
   ledger and one release clock. A staging buffer over 16 MiB is discarded after its copy instead of pooled: a
   122 MiB buffer kept for a rare reuse is idle memory. Released buffers held fell from 160 MiB to 48 MiB. Two debts
   remain: the film module's small table buffers bypass the ledger, and a texture of ones as large as the image
   (163 MiB at full size) supplies a constant a uniform could.
4. **A proxy must be exact, not similar.** The kernel reads source texel g(q) for output pixel q, with g computed in
   f32; the proxy stores exactly those texels, so reading it at q gives the same number. The host reproduces g with
   `Math.fround` (the product of two f32 values is exact in f64, so one rounding gives the f32 product). Zero samples
   differed on the software adapter and on Metal at every scale and region tested. The argument is
   [Chapter 3](03-one-grid-rule.md)'s.
5. **Bound each owner, and know the bound from the measurement.** At most four proxies per owner, holding together
   no more than the full-size texture, leased ones aside: by construction an owner costs at most about twice its full
   size. That is a bound. The measurements sit far below it: ten 2400 × 1600 scans, opened and switched in a 512 MiB
   budget on the software adapter, peaked at 109 MiB and kept 69 MiB across all ten. The four is a rule (thumbnail,
   draft, screen, one spare), named as such in the code.
6. **Evict by visibility, then recency, a whole owner at a time.** Pinned owners go last, leased units never (except
   in recovery), and among the rest the least recently used owner goes first. Everything kept costs an upload
   roughly proportional to its bytes, so a cost-aware order would agree with this one
   ([Chapter 9](09-content-keyed-cost-aware-cache.md) carries the argument).
7. **Two kinds of out-of-memory, and only one is recovered.** The ledger's refusal is synchronous and names its
   allocation. The driver's `GPUOutOfMemoryError` arrives later, through an **error scope** (a WebGPU bracket that
   collects the errors of the calls inside it, read by a promise). chromobench's pool has a method that awaits a scope
   around each allocation, trims, halves the budget for good and retries; only a unit test calls it, so driver errors
   reach the journal and nothing recovers from them. Its halving is a ratchet: one transient failure would halve the
   budget for the session. Recovery from the ledger's refusal follows
   [Count What You Own](../modular/08-count-what-you-own.md).
8. **Inject failures at the right layer, and keep the marks.** The test hook first failed only allocations that
   needed new bytes; the test's render reused released textures and never failed. Now every acquisition can. The
   journal keeps each render's high-water mark, a row each time the session's highest grows by 32 MiB, and one per
   eviction and recovery: the original failure was diagnosed from those rows, not from the error.

## Variations

- **Ask the platform.** Vulkan's memory-budget extension and DXGI's video memory query report a budget and usage per
  heap. Use them where they exist; keep your own count only for attribution.
- **Page-granular residency (virtual texturing).** Keep fixed-size pages of a mipmapped image, chosen by which pages
  the last render touched. Memory follows visibility finely; the price is a page table, an indirection in every
  read, and a feedback pass.
- **Store narrower.** Half floats halve every texture. On chromobench's camera path they moved the display by up to
  3.4 eight-bit levels and missed the parity tolerance five times over, so working textures stay f32
  ([Chapter 2](02-precision-ladder.md)).
- **Spill instead of evicting.** Copy evicted data to host memory; it must beat recomputation on measured cost.
  chromobench keeps decoded pixels on the host, so an evicted source is uploaded again.

## Consequences

- \+ Out-of-memory is attributable: the refusal names the allocation, the bytes, the count and the rule.
- \+ Footprint follows what is shown, not what is open.
- \+ The budget is reproducible across machines: a report carries the rule and the high-water marks.
- − The ledger counts what the program asked for, not what the driver can place; one bypass silently breaks it.
- − The rule's constants are judgements that some machines will suit badly.
- − Proxies cost a host-side gather and an upload per new grid, and exactness ties them to the kernel's arithmetic.

## Known uses

- **Vulkan Memory Allocator** (AMD GPUOpen) reads heap budgets through `VK_EXT_memory_budget` and, on request, makes
  an allocation fail rather than exceed them; Direct3D 12 programs read the budget from DXGI's
  `QueryVideoMemoryInfo` and manage residency with `MakeResident` and `Evict`.
- **Unreal Engine**'s texture streaming pool keeps mip levels within a configured pool size.
- **Virtual texturing**: Sean Barrett, "Sparse Virtual Textures", GDC 2008; id Software's id Tech 5 used it
  ("MegaTexture") in *Rage* (2011).
- **vLLM**: Woosuk Kwon et al., "Efficient Memory Management for Large Language Model Serving with PagedAttention",
  SOSP 2023: key–value caches in fixed-size blocks under a device budget; under pressure, requests are preempted and
  their blocks swapped out or recomputed.
- Peter J. Denning, "The Working Set Model for Program Behavior", *Communications of the ACM* 11(5), 1968.

## Related chapters

- [Chapter 8 · Retire After the Fence](08-retire-after-the-fence.md): eviction takes a unit out of the count; Chapter 8
  says when it may leave the device.
- [Chapter 9 · Content-Keyed, Cost-Aware Cache](09-content-keyed-cost-aware-cache.md): what to keep once intermediates
  are cached.
- [Chapter 3 · One Grid Rule](03-one-grid-rule.md) makes a proxy exact; [Chapter 6](06-cross-the-bus-rarely.md):
  every eviction is an upload later.
- Modular volume: [Count What You Own](../modular/08-count-what-you-own.md) introduces the ledger, leases, pins and
  recovery; this chapter adds the budget rule, proxies, the peak model and the eviction order.
- Image engine volume: [Reach-Declared Tiling](../08-reach-declared-tiling.md) for what does not fit at all.

## Exercises

1. **Work a memory budget, then measure it without a GPU.** The Editor lab textbook works a time budget for opening a
   ten-layer 24-megapixel document and leaves memory "measured". Work the memory side. A 6000 × 4000 layer in
   `rgba32float` is 366 MiB (the textbook's 384 MB, decimal); ten are 3.6 GiB; a view on a 2× display reads level 1,
   3000 × 2000, at 92 MiB a layer. Which fit in a 1 GiB budget beside two scratch textures the size of the view?
   Then implement the sketch with textures as byte counts, replay ten such images with a 160 × 107 thumbnail each and
   a 1500 × 1000 viewer, report the peak and bytes uploaded with and without proxies, and inject a failure on the
   fifth allocation to check recovery.
2. **Analyse fragmentation.** A device heap of 1,024 units allocates each request as one contiguous block, first fit.
   Give a sequence of allocations and frees of sizes 1 to 64, never more than 1,024 units live, after which a request
   of 64 fails while at least 512 units are free. Argue that no margin that is a fixed fraction of the heap prevents
   this for every sequence when sizes may differ by a factor n, and compare with J. M. Robson's bounds on the memory
   any allocator needs (*Journal of the ACM*, 1971).
3. **Analyse the eviction granularity.** Evicting a whole owner at a time and evicting single units least recently
   used first can choose differently. With owners of one full-size unit (163 MiB) and up to four proxies (0.3 to
   23 MiB), give a trace on which evicting whole owners uploads more bytes, and one on which it uploads fewer.
   Which matches a user switching between two images while thumbnails redraw?
4. **Another domain: a model server.** An 80 GiB GPU holds 26 GiB of weights; each conversation's key–value cache
   grows by 0.5 MiB a token. Derive a budget rule (state what you leave for activations), define owner, lease and pin,
   choose the eviction order, and say what the user sees when recovery fails. Compare vLLM's preemption.
