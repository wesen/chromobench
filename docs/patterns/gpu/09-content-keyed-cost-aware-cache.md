# Chapter 9 · Content-Keyed, Cost-Aware Cache

*Name every result by what made it; stop early when an output repeats; when memory runs short, drop what is
cheapest to remake per byte.*

**★** A good form among several; the Variations section names the others.

## Intent

Name each expensive result by a hash of everything that produced it, so a stale result is never asked for again.
At chosen checkpoints, also name it by a hash of its output, so a recomputation that reproduces its output stops
the rebuild there. Evict by the cost of remaking per byte.

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
2. **A wide key is only as wide as its narrowest part.** The tile key is 52 bits, chosen because 10⁵ keys of 32 bits
   give about 1.2 expected colliding pairs. But a layer's settings enter that key through a 32-bit hash. Two
   settings states with the same 32-bit hash give every tile of the layer the same name, so the risk the 52 bits
   were bought to avoid is still there for settings.
3. **Recency keeps the wrong tiles.** Ten edits, ten undos and ten redos with a 32 MiB cache: least-recently-used
   (LRU) eviction kept the newest tiles, let the shared tiles under the edited layer age out, and recomputed 10,560
   tiles. Weighing each tile by its cost per byte recomputed 2,662. In a brush stroke the order reversed: LRU
   recomputed 925 tiles, the cost-aware policy 1,236.

The same problem appears in deep-learning training, which decides which activations to keep for the backward pass,
and in incremental compilers, where an edit that leaves a function's signature unchanged should not re-check every
caller.

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
- **Measuring cost against disturbing it.** Cost-aware eviction needs each entry's cost; timing device work to
  completion can stall it.

## Solution

**Therefore: name every result by a hash of everything that made it (operation, canonical parameters, input names,
precision, grid), wide enough that the expected number of wrong answers over the store's whole population is
negligible. At chosen checkpoints, record the hash of the output each name produced and name what is above by that
output hash, so a recomputation that reproduces its output stops the rebuild there. Keep outputs where they save the
most recomputation per byte. Evict the entry with the lowest H = clock + cost / size, cost being the time to remake
it from what stays cached, and raise the clock to the evicted H; where cost per byte is equal for all entries, this
is LRU. Let every slower tier verify what it reads, and treat any failure, read or write, as a miss.**

## Applicability

Use it when results are deterministic functions of hashable inputs; when states recur (undo, toggling); when
entries differ in cost per byte by an order of magnitude or more; and when edits often leave outputs unchanged.

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
and the tiers are device memory, host memory and disk.

## Collaborations

1. The evaluator computes each node's key bottom-up from its inputs' names before any device work.
2. At a checkpoint it looks the key up in the trace store. A trace gives the output's hash, which becomes the
   node's name for everything above; without a trace the producer runs the segment (the pointwise steps since the
   checkpoints below, fused into one pass over the image), hashes the output on the device and records the trace.
3. A value is needed only where a name above misses. The blob store answers from the fastest tier that holds it,
   promoting on a hit; a lower tier verifies before answering.
4. On a miss the producer runs the fused segment from the nearest cached checkpoints and stores the result with its
   size and measured cost. Over budget, the policy evicts the lowest-priority entry no one holds.

## Sketch

```text
-- helpers: hash (SHA-256 over length-prefixed fields), canonical, bytesOf, now (ms); push, popMin (a binary heap
-- ordered by its tuples, first field first); hashOnDevice(v): the same hash, computed by a reduction kernel, with 32
-- bytes read back; retire(v): free v once the device's last use of it has finished (Chapter 8);
-- produce(n, inputs) → (value, ms): runs the fused segment that ends at n, timed from submit to its fence
MIN_MS ← 0.01                                  -- no entry is free: a zero cost would make H = clock

key(n, inNames, target) → Key:
  return hash(DOMAIN, n.op, canonical(n.params), inNames, target.precision, target.grid)

traces ← {}                                    -- key → hash of the output that key produced
blobs ← Cache(budget)                          -- output hash → output

evaluate(root, target) → value | refuse:       -- the root must be a checkpoint, or nothing is stored
  names ← {} ; vals ← {} ; held ← [] ; bad ← none
  name(n) → Key:
    if n in names: return names[n]
    k ← key(n, [name(i) for i in n.inputs], target)
    names[n] ← k
    if n.checkpoint:
      if traces[k] = none: run(n, k)           -- no trace yet: run once to learn what it makes
      names[n] ← traces[k]                     -- above this node, the output is the name
    return names[n]
  value(n) → value:
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
      if traces[k] ≠ none and traces[k] ≠ h: bad ← n ; return     -- same inputs, other output: not deterministic
      traces[k] ← h ; blobs.put(h, v, bytesOf(v), ms) ; held ← held ++ [h] ; toDisk(h, v)
  out ← value(root)
  for h in held: blobs.release(h)              -- every hold taken above, on every path
  if bad ≠ none: return refuse(nondeterministic, "a recomputation changed its output", where: bad)
  return out

value Entry: { key, value, bytes, cost, H, holds, seq }

cache Cache(budget):                           -- GreedyDual-Size with holds; ties go to the least recently used
  entries ← {} ; heap ← [] ; used ← 0 ; clock ← 0 ; tick ← 0
  touch(e): tick += 1 ; e.seq ← tick ; e.H ← clock + e.cost / e.bytes ; push(heap, (e.H, e.seq, e))
  get(h) → value | none:                       -- a value handed out is held until release(h)
    e ← entries[h] ; if e = none: return none
    touch(e) ; e.holds += 1 ; return e.value
  put(h, v, bytes, cost):                      -- the stored entry is held by the caller
    if entries[h] ≠ none: get(h) ; return      -- equal outputs share one entry
    e ← Entry{ key: h, value: v, bytes: max(bytes, 1), cost: max(cost, MIN_MS), holds: 1 }
    entries[h] ← e ; touch(e) ; used += e.bytes ; evict()
  release(h): entries[h].holds −= 1 ; evict()
  evict():
    busy ← []
    while used > budget and heap ≠ []:
      (H, seq, e) ← popMin(heap)
      if entries[e.key] ≠ e or e.seq ≠ seq: continue           -- an outdated heap record
      if e.holds > 0: busy ← busy ++ [(H, seq, e)] ; continue
      clock ← max(clock, H)                    -- a held entry's H can lie below the clock
      remove e.key from entries ; used −= e.bytes ; retire(e.value)
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

1. **A key is as wide as its narrowest link, over its whole population.** For an ideal b-bit hash, N distinct
   inputs give C(N, 2) / 2^b ≈ N² / 2^(b+1) expected colliding pairs, and the probability of any collision is at
   most that (union bound). For N = 10⁵: 1.16 pairs at 32 bits, 1.1 × 10⁻⁶ at 52. This is an a-priori figure for an
   ideal hash, not a measurement. It suits a store that never forgets; a bounded cache errs only when a lookup
   meets a resident entry of the same name, at most C / 2^b per lookup with C entries resident, so L · C / 2^b over
   L lookups. Multiply by sessions and users. Editor lab's 52-bit key takes the settings through a 32-bit hash and
   each pixel block's revision through a 32-bit mix, so for those inputs it has 32 bits. chromobench names graph
   nodes, colour tables and compiled programs by SHA-256.

2. **Precision and grid belong in the key.** chromobench's table key names the builder (`f64` or `gpu-f32`), the
   domain, the table size and the sampling conventions. Its cache of finished images is keyed by node, scale,
   region and precision class (`preview` or `export`), but a preview may use tables from either builder, so two
   previews under one key can differ in the last bits. Equal keys then mean "equal within the preview tolerance";
   say so, or name the builder.

3. **A name that stands for content is invalidation in disguise.** In chromobench's reference engine a source's id
   is the SHA-256 of the file's bytes, not of how they were decoded, so reopening a file decoded another way clears
   every cache (`forgetSource`). The compiled-program cache likewise trusts a caller's label for the binding layout.
   Put the decode mode, and the layout's content, in the key.

4. **On a device, an output hash is a reduction**, a kernel (a function run per element on the device) that
   combines every element into one value; read back 32 bytes, not the image ([Chapter 6](06-cross-the-bus-rarely.md)).
   The names above wait for its **fence**, the device's signal that a batch has finished, so look-ahead stops at
   every checkpoint. The textbook measured the trade on the CPU (one machine, one run): hashing a 256 KiB tile took
   0.093 ms, 15 to 22 % of a tile of the cheapest layers, against 33 to 52 % of the work above masked edits saved
   (tile counts that are exact on any machine). Cut off only on bit-identical outputs; a tolerance makes the picture
   depend on the order of edits. A trace that disagrees with a recomputation is a determinism bug.

5. **GreedyDual-Size, carefully.** Young showed that GreedyDual, for entries of equal size and differing cost, is
   k-competitive (total cost at most k times the optimal offline policy's, plus a constant) when the cache holds k
   entries; Cao and Irani extended the algorithm to differing sizes. Scaling every cost scales every H and the clock
   alike, so units do not matter. Without holds every H is at least the clock, so the clock only rises; holds break
   that, hence the `max`. If cost / size is the same c for every entry, H is the clock at last use plus c; the clock
   moves only at evictions, so entries used between two evictions tie, and GreedyDual-Size equals LRU only when ties
   go to the least recently used, as `seq` does. Editor lab breaks ties by first insertion and scans every entry; a
   heap is O(log n), rebuilt when outdated records outnumber entries. A cost floor keeps a zero-cost entry from
   sitting at H = clock.

6. **Measure the policy on the workloads that matter.** On the textbook's tablet profile, one run: undo, 10,560
   tiles recomputed under LRU against 2,662 cost-aware; toggling each layer, 4,620 against 3,474; scrubbing the
   lowest layer, 1,388 under both; a brush stroke, 925 under LRU against 1,236. LRU counts repeat exactly; the
   cost-aware ones depend on measured costs and can move between runs. A stroke revisits the tiles the last dab
   touched, the access pattern LRU serves best. Every chromobench cache that evicts is LRU. Its GPU memory work kept
   LRU on purpose: it keeps source images whose cost to remake is an upload roughly proportional to size, so cost /
   size is nearly constant and GreedyDual-Size would order them nearly as LRU does.

7. **Choose checkpoints from what fusion already writes.** Fused runs keep no interior values
   ([Chapter 5](05-fused-interpreted-passes.md)). chromobench's planner writes to memory the target, every barrier
   (an operation reading neighbours or several inputs), its inputs and every node with two readers; keeping those
   costs only memory. A checkpoint inside a fused run also costs a write and a read of the image, 32 bytes per pixel
   at four 32-bit channels. Rank candidates by (edit frequency above × cost below) per byte. In the textbook's
   document one sharpening layer cost 87.1 of 259.5 ms; four checkpoints around it need 40 MiB against 80 for every
   layer. chromobench caches only finished images (256 MiB); checkpoints are proposed, not built.

8. **A slower tier trusts nothing it reads, and its failures stay misses.** chromobench keeps colour tables in the
   browser's Origin Private File System, a per-site file store. A read checks magic number, version, stored key
   against requested key, and a payload SHA-256, and removes a rejected file. A write goes to a temporary file, is
   read back and compared, then written again under the final name (a comment says "moved into place"; nothing is
   renamed). A failed write, though, propagates: the table manager takes it for a failed build, builds again with
   the next builder, and never releases the **textures** (images in device memory) the failed attempts uploaded.

9. **Coalesce misses, and bound the coalescing map.** chromobench's compiled-program cache stores the promise of a
   compilation, so simultaneous misses compile once, and drops it on failure. Its table manager never drops a
   success: every table texture it resolved stays referenced, outside any budget. A map of promises is a cache.

## Variations

- **Plain or partitioned LRU.** Right when cost per byte is uniform. A partition gives small, cheap entries (sampled
  previews) their own pool, so they cannot push out a full-size stage. The split is a guess to be measured.
- **Keys from inputs only.** Every name exists before any work, so the whole graph is looked up at once; no early
  cutoff.
- **Static identity tiles.** Where a mask is provably zero over a tile, pass the name below straight through. This
  recovers the masked case of early cutoff with one rectangle test and keeps names computable before work.
- **Recompute instead of keeping.** Training frameworks keep the activations of every √n-th of n layers and
  recompute the rest in the backward pass: O(√n) memory for about one extra forward pass.

## Consequences

- \+ A stale result is harmless: nothing asks for it.
- \+ Edits whose outputs do not change stop at the first checkpoint that notices.
- \+ Memory goes where recomputation is dearest.
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
- **ccache** keys a compilation by a hash of compiler, arguments and preprocessed source.
- **git** names every object by the hash of its content and checks it on read.
- **GEGL**, under GIMP: an LRU tile cache with a swap file as its lower tier.
- **Gradient checkpointing**: Tianqi Chen, Bing Xu, Chiyuan Zhang and Carlos Guestrin, "Training Deep Nets with
  Sublinear Memory Cost", arXiv 2016.

## Related chapters

- [Chapter 2](02-precision-ladder.md) sets the precision the key names; [Chapter 3](03-one-grid-rule.md) lets
  cached results serve other grids; [Chapter 5](05-fused-interpreted-passes.md) decides which values exist.
- [Chapter 7](07-budgeted-residency.md) owns the budget; [Chapter 8](08-retire-after-the-fence.md) frees an
  evicted entry after the device's last use; [Chapter 10](10-measure-completion-gate-percentiles.md) measures costs.
- Sibling volumes: [Interned Operation Graph](../01-interned-operation-graph.md) builds the names;
  [Barrier-Cut Fusion](../07-barrier-cut-fusion.md) plans the materialised nodes;
  [Keep What Is Dear](../modular/09-keep-what-is-dear.md) introduces keys and GreedyDual-Size.
- GoF: a caching **Proxy** in front of the producer; **Flyweight** for equal outputs sharing one entry.

## Exercises

1. **Build and measure.** Implement the sketch on the CPU with a fake producer: eight layers of 40 tiles of 256 KiB,
   per-tile costs of 0.5 ms except one layer at 2.2 ms, a 32 MiB budget (128 tiles), and one masked layer that is
   the identity on 20 of its tiles. Replay ten edits of the top layer, ten undos and ten redos. Report tiles
   recomputed (a) under GreedyDual-Size with ties broken by recency, (b) the same with ties broken by key order,
   (c) with equal costs, where (a) must match an LRU you write separately; then add output hashes at two
   checkpoints and report the work saved above an edit of the masked layer against the time spent hashing.
2. **Analyse.** (a) Prove that without holds the clock never decreases, and give a trace of three entries where a
   hold makes the victim's H smaller than the clock. (b) A product has 10⁶ users, each with 10⁶ lookups a session
   into a cache of 400 resident entries. Using the union bound L · C / 2^b (a linearised estimate, valid while it
   is small), how many bits must a key have for fewer than 10⁻³ expected wrong answers when every user runs one
   session? Is 52 enough? Is 64?
3. **Another domain.** A training step runs a chain of 32 layers, each with a 1 MiB activation and a forward cost
   of 1 ms, except layers 8 and 24 at 10 ms; memory holds 8 activations besides the input. Choose which to keep to
   minimise recomputation in the backward pass, and compare with keeping every fourth layer.
4. **Read a real system.** Read the Remote Execution API's action cache and content-addressable store, or Salsa's
   backdating. Map them to the sketch's traces and blobs. What happens when a trace is present but its output gone?
