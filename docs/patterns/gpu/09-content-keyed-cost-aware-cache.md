# Chapter 9 · Content-Keyed, Cost-Aware Cache

*Name every result by what made it; stop early when an output repeats; when memory runs short, drop what is
cheapest to remake per byte.*

**★** A good form among several; the Variations section names the others.

## Intent

Name each expensive result by a hash of everything that produced it, wide enough for the whole life and population
of the store, so a stale result is never asked for again. At chosen checkpoints, also name the result by a hash of
its output, so a recomputation that reproduces its output stops the rebuild there. Keep what you can afford, and
evict by the cost of remaking per byte.

## Also known as

Content-addressed memoisation; constructive and verifying traces; GreedyDual-Size; cost-aware eviction; tiered
result store.

## Motivation

Editor lab's engine stacks adjustment layers and cuts the picture into **tiles** of 128 × 128 pixels. Each tile
of each layer is named by a hash of the layer's settings, the pixels it reads and the names of the tiles below it,
so undo lands on old names and finds old results. Its textbook measured three ways this design still loses.

1. **Names made from names cannot stop a rebuild.** Changing the exposure of a layer whose mask is zero over most
   of the picture leaves 16 to 26 of its 40 output tiles bit-identical, yet every name above changes. A third to a
   half of the work in the layers above recomputes pixels that are, bit for bit, what they were.
2. **A wide key is only as wide as its narrowest part.** The tile key is 52 bits, chosen because 32 bits give about
   1.2 expected colliding pairs among 10⁵ keys. But a layer's settings enter that key through a 32-bit hash. Two
   settings states with the same 32-bit hash give every tile of the layer the same name, so the risk the 52 bits
   were bought to avoid is still there for settings.
3. **Recency keeps the wrong tiles.** Ten edits, ten undos and ten redos with a 32 MB cache: least-recently-used
   (LRU) eviction kept the newest tiles, let the shared tiles under the edited layer age out, and recomputed 10,560
   tiles. Weighing each tile by its cost per byte recomputed 2,662. In a brush stroke the order reversed: LRU
   recomputed 925 tiles, the cost-aware policy 1,236.

The same problem appears in deep-learning training, which must decide which layers' activations to keep for the
backward pass and which to recompute, and in incremental compilers, where an edit inside a function body that
leaves its signature unchanged should not re-check every caller.

## Problem

**How do you name, keep and evict expensive intermediate results so that a stale one is never served, unchanged
outputs stop recomputation, and memory goes to what is dearest to remake?**

## Forces

- **Names before work against early cutoff.** Names made from input names exist before anything runs, so a scheduler
  can ask about a whole graph at once; names made from outputs stop rebuilds but exist only after the work.
- **Short keys against safe keys.** A 52-bit key fits a JavaScript number and a fast map; collisions return a wrong
  answer silently, and their rate grows with every session, every user and every entry a store keeps.
- **Recency against cost per byte.** Recent entries are usually wanted next; an old entry that is expensive and
  shared by many states is worth more.
- **Fusion against checkpoints.** A fused pass never writes its interior values to memory; keeping one means
  splitting the pass and paying a write and a read of the whole image.
- **Measuring cost against disturbing it.** The cost-aware policy needs each entry's cost, and timing device work to
  completion can stall the work it times.

## Solution

**Therefore: name every result by a hash of everything that made it (the operation, its canonical parameters, its
inputs' names, and the precision and grid it was computed on), wide enough that the expected number of wrong
answers over the store's whole life and population is negligible. At checkpoints, record which output each name
produced and name what is above by that output's hash, so a recomputation that reproduces its output stops there.
Keep outputs only at checkpoints chosen by a cost model, preferring values the plan must write to memory anyway,
ranked by the recomputation they save per byte. Evict by GreedyDual-Size, priority H = clock + cost / size, with
cost the measured time to remake the entry from what stays cached, and use plain LRU where cost per byte is the
same for every entry. Let each slower tier verify every read and treat every failure, read or write, as a miss.**

## Applicability

Use it when results are deterministic functions of hashable inputs; when states recur (undo, toggling, comparing
two versions); when entries differ in cost per byte by an order of magnitude or more; and when local edits often
leave outputs unchanged (masked or clipped operations, functions whose results do not depend on the edit).

Do not use it when a result depends on something no key can hold (a clock, unseeded randomness, an outside
service); when hashing an output costs about as much as recomputing it; when remaking every entry costs the same per
byte (keep the keys and use LRU); or for a single pass that never returns to a state.

## Structure

| Participant | Responsibility |
| --- | --- |
| **Key function** | hashes operation, canonical parameters, input names, precision and grid into a fixed-width name |
| **Trace store** | maps a key to the hash of the output it produced; small, kept long |
| **Blob store** | maps an output hash to the output; large, budgeted, evicted by cost per byte |
| **Checkpoint plan** | which nodes keep outputs; chosen from materialised nodes by saved cost per byte |
| **Producer** | runs a fused segment from the checkpoints below; reports its cost, timed to completion |
| **Policy** | GreedyDual-Size over a heap, or LRU; a setting |
| **Lower tiers** | host memory, disk; verify every read; a failed write is counted, not raised |

In a deep-learning trainer the key is a layer and a batch, the checkpoint plan chooses which activations to keep,
the producer is the forward pass of a segment, and the tiers are device memory, host memory and local disk.

## Collaborations

1. The evaluator computes each node's key bottom-up from its inputs' names before any device work.
2. At a checkpoint it looks the key up in the trace store. A trace gives the output's hash, which becomes the
   node's name for everything above; without a trace the producer runs the segment, hashes the output on the device
   and records the trace.
3. A value is needed only where a name above misses. The blob store answers from the fastest tier that holds it,
   promoting on a hit; a lower tier verifies before answering.
4. On a miss the producer runs the fused segment from the nearest cached checkpoints and stores the result with its
   size and measured cost. Over budget, the policy evicts the lowest-priority entry no one holds.

## Sketch

```text
-- helpers: hash (SHA-256 over length-prefixed fields), canonical, bytesOf, now; push, popMin (a binary heap);
-- hashOnDevice(v): the same hash, computed by a reduction kernel; 32 bytes are read back; retire(v): free v once
-- the device's last use of it has finished (Chapter 8); produce(n, inputs) → (value, ms): runs the fused segment
-- that ends at n, timed from submit to its fence (Chapter 10)

key(n, inNames, target) → Key:
  return hash(DOMAIN, n.op, canonical(n.params), inNames, target.precision, target.grid)

traces ← {}                                    -- key → hash of the output that key produced
blobs ← Cache(budget)                          -- output hash → output

evaluate(root, target) → value:
  names ← {} ; vals ← {} ; held ← []           -- this evaluation's names, values and holds
  name(n) → Key:
    if n in names: return names[n]
    k ← key(n, [name(i) for i in n.inputs], target)
    names[n] ← k
    if n.checkpoint:
      if traces[k] = none: run(n, k)           -- no trace yet: run once to learn what it makes
      names[n] ← traces[k]                     -- above this node, the output is the name
    return names[n]
  value(n) → value:                            -- only checkpoints are stored; make the root one
    if n in vals: return vals[n]
    if n.checkpoint:
      h ← name(n) ; if n in vals: return vals[n]           -- naming it may have run it
      v ← blobs.get(h)
      if v = none:                             -- the next tier; remaking from it costs the read
        t0 ← now() ; v ← fromDisk(h) ; if v ≠ none: blobs.put(h, v, bytesOf(v), now() − t0)
      if v ≠ none: held ← held ++ [h] ; vals[n] ← v ; return v
    run(n, key(n, [name(i) for i in n.inputs], target)) ; return vals[n]
  run(n, k):
    (v, ms) ← produce(n, [value(i) for i in n.inputs]) ; vals[n] ← v
    if n.checkpoint:
      h ← hashOnDevice(v)
      assert traces[k] = none or traces[k] = h   -- else the producer is not deterministic: stop
      traces[k] ← h ; blobs.put(h, v, bytesOf(v), ms) ; held ← held ++ [h] ; toDisk(h, v)
  out ← value(root)
  for h in held: blobs.release(h)
  return out

value Entry: { value, bytes, cost, H, holds }

cache Cache(budget):                           -- GreedyDual-Size with holds
  entries ← {} ; heap ← [] ; used ← 0 ; clock ← 0
  get(h) → value | none:                       -- a value handed out is held until release(h)
    e ← entries[h] ; if e = none: return none
    e.H ← clock + e.cost / e.bytes ; push(heap, (e.H, h)) ; e.holds += 1
    return e.value
  put(h, v, bytes, cost):                      -- the stored entry is held by the caller
    if entries[h] ≠ none: get(h) ; return      -- equal outputs share one entry
    entries[h] ← Entry{ value: v, bytes, cost, H: clock + cost / bytes, holds: 1 }
    push(heap, (entries[h].H, h)) ; used += bytes ; evict()
  release(h): entries[h].holds −= 1 ; evict()
  evict():
    busy ← []
    while used > budget and heap ≠ []:
      (H, h) ← popMin(heap) ; e ← entries[h]
      if e = none or e.H ≠ H: continue         -- an outdated heap record
      if e.holds > 0: busy ← busy ++ [(H, h)] ; continue
      clock ← max(clock, H)                    -- holds can leave an H below the clock
      remove h from entries ; used −= e.bytes ; retire(e.value)
    for r in busy: push(heap, r)

-- a lower tier: a bad or unreadable file is a miss; a failed write is counted, never raised
fromDisk(h) → value | none:
  b ← disk.read(h)
  if b = none or b.magic ≠ MAGIC or b.version ≠ VERSION or hash(b.payload) ≠ h:
    disk.remove(h) ; return none               -- blobs are named by their content: the name is the checksum
  return b.payload
toDisk(h, v):
  if disk.writeTemp(h, v) fails or hash(disk.readTemp(h)) ≠ h or disk.renameTemp(h) fails: writeFailures += 1

-- in use: undo lands on old names; a masked edit whose checkpoint output is unchanged stops at the checkpoint
for s in edits ++ reverse(edits): show(evaluate(compile(s), screenTarget))
```

## Implementation notes

1. **A key is as wide as its narrowest link, over its whole population.** Editor lab's 52-bit tile key mixes in the
   settings through a 32-bit hash and each pixel block's revision through a 32-bit mix; for those inputs the key
   has 32 bits. The birthday bound N² / 2^(b+1) counts pairs among all keys ever made, right for a store that never
   forgets. A bounded cache serves a wrong answer only when a lookup meets a resident entry with the same name:
   about L · C / 2^b over L lookups with C entries resident. Either way, multiply by sessions and users before
   calling a risk negligible. chromobench names graph nodes, colour tables and compiled programs by SHA-256.

2. **Precision and grid belong in the key.** chromobench's table key names the builder (`f64` or `gpu-f32`), the
   domain, the table size and the sampling conventions. Its cache of finished images is keyed by node, scale,
   region and precision class (`preview` or `export`), but a preview may use tables from either builder, so two
   previews under one key can differ in the last bits. Equal keys then mean "equal within the preview tolerance";
   say so, or name the builder.

3. **A name that stands for content is invalidation in disguise.** In chromobench's reference engine (the slow,
   exact one) a source's id is the SHA-256 of the file's bytes, not of how they were decoded. Reopening a file
   decoded another way would hit the old results, so `forgetSource` clears every cache and rebuilds the graph. The
   compiled-program cache trusts a caller-chosen label for the binding layout in the same way. Put the decode mode,
   and the layout's content, in the key.

4. **On a device, an output hash is a reduction.** Hash the output with a kernel and read back 32 bytes, not the
   image ([Chapter 6](06-cross-the-bus-rarely.md)). The names above must then wait for that kernel's fence, so the
   scheduler loses look-ahead past every checkpoint. The textbook measured the trade on the CPU: hashing a 256 KiB
   tile took 0.093 ms, 15 to 22 % of the cheapest layers' cost, against 33 to 52 % of the work above masked edits
   saved. Cut off only on bit-identical outputs; a tolerance makes the picture depend on the order of edits. A
   trace that disagrees with a recomputation is a determinism bug, so the sketch stops.

5. **GreedyDual-Size, carefully.** Young showed GreedyDual k-competitive for weighted caching (k entries); Cao and
   Irani carried it to entries of different sizes. Scaling every cost by a constant scales every H and the clock
   alike, so cost units do not matter. Without holds every H is at least the clock, so the clock only rises; holds
   break that, hence the `max`. Editor lab scans every entry for the minimum; a heap with lazy deletion is
   O(log n), rebuilt when outdated records outnumber entries. Cost is the time to remake the entry from what stays
   cached: for a checkpoint, its whole fused segment.

6. **Measure the policy on the workloads that matter.** On the textbook's tablet profile: undo, 10,560 tiles
   recomputed under LRU against 2,662 cost-aware; toggling each layer, 4,620 against 3,474; scrubbing the lowest
   layer, 1,388 under both; a brush stroke low in the stack, 925 under LRU against 1,236. A stroke revisits the
   tiles the last dab touched, which is the access pattern LRU serves best. Every chromobench cache that evicts is
   LRU. Its GPU memory work kept LRU on purpose: what it keeps are source images whose cost to remake is an upload
   roughly proportional to size, so cost / size is a constant and GreedyDual-Size orders them exactly as LRU does.

7. **Choose checkpoints from what fusion already writes.** Fused runs of pointwise steps keep no interior values
   ([Chapter 5](05-fused-interpreted-passes.md)). chromobench's planner materialises the target, every barrier
   (an operation that reads neighbours or several inputs), every barrier's inputs and every node with two readers.
   Those cost only memory to keep. A checkpoint inside a fused run also costs a write and a read of the image, 32
   bytes per pixel in four 32-bit channels. Rank candidates by (edit frequency above it × cost below it) per byte.
   In the textbook's eight-layer document one sharpening layer cost 87.1 of 259.5 ms; four checkpoints (after the
   first layer, either side of the sharpening, at the top) need 40 MB where caching every layer needs 80. chromobench
   caches only finished images (256 MiB of host copies); checkpoints with GreedyDual-Size are proposed, not built.

8. **A slower tier trusts nothing it reads, and its failures stay misses.** chromobench keeps colour tables on disk
   in the browser. A read checks magic number, version, that the stored key equals the requested key, and a payload
   SHA-256, and removes a rejected file. A write goes to a temporary file, is read back and compared, then written
   again under the final name; a comment says "moved into place", but nothing is renamed. Reads are verified, so a
   torn write costs only a rebuild. But a failed write (a full disk) propagates: the table manager takes it for a
   failed build, builds again with the next builder, and never releases the textures the failed attempts uploaded.

9. **Coalesce misses, and bound the coalescing map.** chromobench's compiled-program cache stores the promise of a
   compilation, so simultaneous misses compile once, and drops it on failure. Its table manager coalesces the same
   way but never drops a success: every table texture it resolved stays referenced for the device's life, outside
   any budget. A map of promises is a cache too.

## Variations

- **Plain or partitioned LRU.** Right when cost per byte is uniform. A partition gives small, cheap entries (sampled
  previews) their own pool, so they cannot push out a full-size stage. The split is a guess to be measured.
- **Keys from inputs only.** Bazel's action keys and Nix's input-addressed store paths: every name exists before any
  work, so the whole graph can be looked up at once, and no early cutoff.
- **Static identity tiles.** Where a mask is provably zero over a tile, pass the name below straight through. This
  recovers the masked case of early cutoff with one rectangle test and keeps names computable before work.
- **Recompute instead of keeping.** Training frameworks keep the activations of every √n-th of n layers and
  recompute the rest in the backward pass: O(√n) memory for about one extra forward pass.

## Consequences

- \+ A stale result is harmless: nothing asks for it.
- \+ Edits whose outputs do not change stop at the first checkpoint that notices.
- \+ Memory goes where recomputation is dearest; the policy is a setting, chosen by measurement.
- − Every input must reach the key; a forgotten one serves a wrong answer that no cache test notices.
- − Output hashes cost a reduction and a fence per checkpoint and remove look-ahead past it.
- − Cost-aware eviction needs measured costs and a heap, and loses to LRU on recency-shaped work.
- − Checkpoints inside fused runs cost bandwidth on every evaluation, not only on a miss.

## Known uses

- **GreedyDual**: Neal Young, "The k-server dual and loose competitiveness for paging", *Algorithmica* 11(6), 1994.
- **GreedyDual-Size**: Pei Cao and Sandy Irani, "Cost-Aware WWW Proxy Caching Algorithms", USENIX USITS 1997.
- **Build Systems à la Carte**: Andrey Mokhov, Neil Mitchell and Simon Peyton Jones, ICFP 2018, name constructive,
  verifying and deep constructive traces, and show that deep traces lose early cutoff.
- **Adapton**: Matthew Hammer, Khoo Yit Phang, Michael Hicks and Jeffrey Foster, PLDI 2014: demand-driven
  incremental computation.
- **Salsa** and **rust-analyzer**: memoised queries; a recomputed value equal to the old one keeps its old revision
  ("backdating"), so dependents are not recomputed.
- **Bazel's remote cache**: an action cache maps action digests to output digests, a content-addressable store maps
  digests to bytes; the sketch's traces and blobs.
- **Nix**: input-addressed store paths; content-addressed derivations add early cutoff.
- **ccache** keys a compilation by a hash of the compiler, its arguments and the preprocessed source.
- **git** names every object by the hash of its content and checks it on read.
- **GEGL**, under GIMP: an LRU tile cache with a swap file as its lower tier.
- **Gradient checkpointing**: Tianqi Chen, Bing Xu, Chiyuan Zhang and Carlos Guestrin, "Training Deep Nets with
  Sublinear Memory Cost", arXiv 2016.

## Related chapters

- [Chapter 2](02-precision-ladder.md) decides the precision that the key must name.
- [Chapter 3](03-one-grid-rule.md) makes a region bit-identical to a crop, so cached results serve other grids.
- [Chapter 5](05-fused-interpreted-passes.md): fusion decides which values exist to be kept.
- [Chapter 6](06-cross-the-bus-rarely.md): output hashes are reductions; read back a digest, not an image.
- [Chapter 7](07-budgeted-residency.md) owns the budget; [Chapter 8](08-retire-after-the-fence.md) frees an
  evicted entry only after the device's last use.
- [Chapter 10](10-measure-completion-gate-percentiles.md) measures the costs this policy needs and chooses the policy.
- Sibling volumes: [Interned Operation Graph](../01-interned-operation-graph.md) builds the names;
  [Barrier-Cut Fusion](../07-barrier-cut-fusion.md) plans the materialised nodes;
  [Keep What Is Dear](../modular/09-keep-what-is-dear.md) introduces keys and GreedyDual-Size.
- GoF: a caching **Proxy** in front of the producer; **Flyweight** for equal outputs sharing one entry.

## Exercises

1. **Build and measure.** Implement the sketch with a fake producer on the CPU: an eight-layer stack of 40 tiles,
   costs drawn from the textbook's table (one layer three times dearer than the rest), and one masked layer that
   is the identity on half its tiles. Replay ten edits, ten undos and ten redos, then a stroke that revisits
   neighbouring tiles. Report tiles recomputed under LRU and GreedyDual-Size, with and without output hashes at
   two checkpoints, and the time spent hashing. Test that a held entry is never evicted.
2. **Analyse.** (a) Prove that without holds the clock never decreases, and give a three-entry trace where holds
   make the victim's H smaller than the clock. (b) A product has 10⁶ users, each with 10⁶ lookups a session into
   a cache of 400 resident entries. How many bits must a key have for fewer than 10⁻³ expected wrong answers in
   total when every user runs one session? Is 52 enough? Is 64?
3. **Another domain.** A training step runs a chain of 32 layers with forward cost cᵢ and activation size sᵢ;
   memory allows 8 activations. Choose which to keep to minimise recomputation in the backward pass, and compare
   with keeping every fourth. When does your choice beat the uniform one?
4. **Read a real system.** Read the Remote Execution API's action cache and content-addressable store, or Salsa's
   backdating. Map them to the sketch's traces and blobs. What happens when a trace is present but its output gone?
