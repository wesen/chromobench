# Chapter 9 · Keep What Is Dear

*Name every result by what it was made from; when memory runs short, let go of what is cheapest to make again.*

★ a good form among several; the Variations section names the others.

## Intent

Cache expensive results under keys computed from everything that produced them, so a stale entry is never asked for
and nothing has to find and delete it. Keep the cache under a budget; when it is full, evict by what each entry would
cost to remake per byte, with age as the tiebreaker that lets unused entries go.

## Also known as

Content-addressed cache; memoisation under a budget; cost-aware caching; GreedyDual-Size.

## Motivation

An image editor cuts each layer into **tiles**, squares of 128 × 128 pixels, and caches the picture after each layer
at each tile, so that moving a slider high in the stack does not recompute the layers below. A first version keeps
tiles in a table indexed by layer and position, clears entries when something changes, and, when memory is full,
drops the tile used longest ago. Four things go wrong.

1. **Invalidation forgets a dependency.** A blur reads a margin of pixels around its tile, called the **apron**, so
   painting in one tile changes the blurred result of its neighbours. The clearing code clears the painted tile and
   not the neighbours. The screen shows a stale picture and nothing reports an error.
2. **Undo recomputes.** To the invalidation code an undo is one more change. The old tiles, though identical to what
   is needed, were cleared.
3. **The cache keeps the wrong tiles.** Editor lab's bench ran ten edits, ten undos and ten redos on the top
   adjustment of an eight-layer document with the 32 MB cache of a modelled tablet. Every state shares the tiles below
   the edited layer, among them an expensive sharpening layer. Least-recently-used (LRU) eviction kept the newest tiles,
   let the shared ones age out, and recomputed 10,560 tiles. A policy that weighed each tile's cost recomputed 2,662.
4. **Hashed keys bring their own failure.** Replace the table with keys hashed from the inputs, and a key of too few
   bits, or one that leaves out an input, returns the wrong picture with full confidence.

The problem appears wherever results are expensive and states recur. A web proxy keeps pages of very different sizes
and fetch times; cost-aware eviction was invented there. A build system must know whether a stored object still
matches its sources. A database's buffer pool decides what to keep in memory.

## Problem

**How should a program remember expensive results so that it never serves a stale one, and decide what to forget
when it cannot remember everything?**

## Forces

- **Invalidation against keys.** Deleting stale entries is direct, but needs a record of who depends on what that
  every new feature must keep current. A key made from the inputs needs no record, but every input must reach it.
- **Narrow keys against wide keys.** A key that omits an input serves a wrong answer silently; one that includes
  something irrelevant, a timestamp or a counter, misses for nothing.
- **Cheap keys against safe keys.** A short hash is fast; collisions must stay negligible over the cache's life. The
  key itself costs time on every lookup.
- **Recency against cost.** What was used last is usually used next; but an expensive result shared by many states
  is the one most worth keeping, however old.
- **Memory against recomputation.** Every byte held is denied to the rest of the program; every byte dropped is work
  done again.
- **Freedom to forget against work in flight.** The cache must be able to drop anything, but not a result a running
  computation is reading.

## Solution

**Therefore: compute each result's key from everything that produced it (the operation, its settings, and the keys
or content hashes of its inputs), wide enough that collisions are negligible over the cache's life, and look results
up only by that key. Never delete a stale entry; stop asking for it. Give the cache one owner and a budget in bytes.
Store with each entry its size and the time it took to make. When the budget is passed, evict the entry with the
lowest priority H = clock + cost / size and raise the clock to that H, so expensive entries outlive cheap ones of the
same age and unused entries still age out. Never evict the entry just stored or one a computation holds. Make the
policy a setting, measure it on the workloads that matter, and keep plain least-recently-used eviction where every
entry costs about the same per byte.**

## Applicability

Use it when results are expensive, deterministic functions of inputs that hash cheaply; when states recur (undo,
toggling, comparing); when entries differ widely in cost per byte; and when the cache cannot hold everything.

Do not use it when a result depends on something no key can hold (the time, randomness, an outside service); when
recomputing is cheaper than looking up, as with simple per-pixel steps fused into one GPU pass; when every entry costs
the same per byte (use plain LRU); when everything fits (use an unbounded memo); or for a single sweep that never
returns, which no policy helps.

## Structure

| Participant | Responsibility |
| --- | --- |
| **Key function** | computes a key from the operation, its settings and its inputs' keys; the only way to name a result |
| **Cache** | maps keys to entries; one owner; counts hits, misses, evictions and bytes |
| **Entry** | the value, its size, its cost to remake, its priority, how many computations hold it |
| **Policy** | orders entries for eviction (least recently used, or cost-aware); a setting |
| **Budget** | the bytes the cache may hold, set from the machine and counted by the owner |
| **Producer** | computes on a miss, times its own work, stores the result |
| **Lower tier** *(optional)* | a slower store behind the cache, every read of which is verified |

## Collaborations

1. The producer computes the key from the operation, the settings and the inputs' keys, without reading any pixels.
2. On a hit the cache renews the entry: to the back of the order, or a new priority from the current clock.
3. On a miss a lower tier may answer; what it returns is checked against the key first.
4. Otherwise the producer computes, timing only its own work, and stores the result with its size and cost.
5. Over budget, the policy evicts entries that are neither just stored nor held, until under budget or none may go.

## Sketch

```text
-- the key: everything the result was made from, and nothing else
key(op, settings, inputs) → Key:
  return hash(op.name, canonical(settings), [i.key for i in inputs])   -- 64 bits or more

value Entry: { key, value, bytes, cost, H, holds }

-- the cache: one owner, a byte budget, a policy that is a setting
cache Cache(budget, policy):
  entries ← {} ; used ← 0 ; clock ← 0

  get(k) → value | none:
    e ← entries[k] ; if e = none: misses += 1 ; return none
    hits += 1
    match policy:
      lru:  moveToBack(e)
      cost: e.H ← clock + e.cost / e.bytes
    return e.value

  put(k, v, bytes, cost):
    entries[k] ← Entry{ key: k, value: v, bytes, cost, H: clock + cost / bytes, holds: 0 }
    used += bytes ; evict(keep: k)

  evict(keep):
    while used > budget:
      free ← [e in entries where e.key ≠ keep and e.holds = 0]
      if free = []: return                          -- over budget; the owner reports it
      victim ← match policy:
        lru:  first(free)
        cost: minimum of free by H
      if policy = cost: clock ← victim.H            -- everything left ages relative to this
      remove victim ; used −= victim.bytes ; evictions += 1

-- a lower tier: nothing read back is trusted
fromDisk(k) → value | none:
  b ← disk.read(file(k)) ; if b = none: return none
  h ← header(b)
  if h.magic ≠ MAGIC or h.version ≠ VERSION or h.key ≠ k or hash(payload(b)) ≠ h.payloadHash:
    disk.remove(file(k)) ; return none              -- a bad entry is a miss, never an answer
  return payload(b)

-- the producer
resolve(op, settings, inputs) → value:
  k ← key(op, settings, inputs)
  v ← cache.get(k) ; if v ≠ none: return v
  t0 ← now() ; v ← op.run(settings, inputs) ; cost ← now() − t0
  cache.put(k, v, size(v), cost) ; return v

-- in use: ten edits, ten undos, ten redos land on keys already made
for s in edits ++ reverse(edits) ++ edits: show(resolve(stack(s)))
```

## Implementation notes

1. **Put every input in the key, and hash what is consumed, not its label.** Editor lab's tile key hashes the layer's
   settings, the revision numbers of the 64-pixel blocks under the tile, a brush mask's blocks grown by its feather,
   and the keys of every tile below that the layer reads, all of a blur's apron. chromobench's lookup-table keys hash
   the arrays the table builder consumes, so a data update changes the key without anyone bumping a version, and
   always include the table's domain and size.

2. **A key that names the wrong thing brings invalidation back.** In chromobench's reference engine a source's id
   names the file, not the way it was decoded. Re-opening the file decoded another way would find the old results,
   so a `forgetSource` method clears every cache. That costs a cold render; the repair within this pattern is to put
   the decoding in the key. A forgotten input costs a wrong picture; a cleared cache only costs time.

3. **Choose the width from the birthday bound.** Among N random keys of b bits about N² / 2^(b+1) pairs collide. At
   10⁵ keys, a long session, 32 bits give 1.2 expected collisions. Editor lab joins two 32-bit hashes into a 52-bit
   integer, which a JavaScript number holds exactly: about 10⁻⁶. The bound assumes a hash that mixes well.
   chromobench uses SHA-256 for tables and also stores the whole key in the file, comparing it on read.

4. **Revision counters are cheap; content hashes find undo.** Undoing a brush stroke in Editor lab restores the old
   bytes but raises the block's revision, so the old tiles are not found. Hashing each touched 16 KiB block would find
   them, at a cost on every stroke.

5. **Time only the entry's own work.** Editor lab records the time spent applying one layer to one tile, not the time
   to fetch its inputs, which have their own entries. It floors the cost at 0.01 ms so no entry is free.

6. **Plain LRU is right when cost per byte is uniform.** chromobench's GPU residency keeps only source images and
   their screen-sized copies, whose cost to remake is an upload roughly proportional to size. Then cost / size is a
   constant, and GreedyDual-Size orders entries exactly as LRU does. The team kept LRU, deferred the cost-aware policy
   until intermediate results are cached, and kept the eviction order in one function so the change has one place to
   land. Editor lab's low brush stroke shows the other side: each dab revisits the tiles of the last; LRU recomputed
   925 tiles, the cost-aware policy 1,236.

7. **Say which policy you run.** Every cache in chromobench is plain LRU: tables, the reference engine's images, the
   GPU residency. The reference engine's caches are unbounded unless the host sets a limit; its one gesture towards
   cost is a partition, in which small preview images have their own pool and never push out a full-resolution
   stage.

8. **Never evict what was just stored or what is in use.** Editor lab's `evict` skips the entry just added;
   chromobench's reference engine keeps the newest entry even when it alone exceeds the budget. Its GPU residency lets
   a render **lease** a texture while it is bound and **pins** the frames on screen; only recovery from an
   out-of-memory error may take those.

9. **Coalesce concurrent misses; do not cache failures; memoise the key.** chromobench's pipeline cache, which keeps
   compiled GPU programs keyed by a hash of their source text, stores the *promise* of a compilation, so two requests
   that miss together compile once, and removes it if compilation fails. Hashing about 30 kB of source on every
   dispatch cost a tiled export tens of milliseconds until the hash was memoised by the text.

10. **A slower tier trusts nothing it reads.** chromobench keeps tables in a 16-entry memory LRU in front of a 200 MB
    store in the browser's Origin Private File System, a private disk area per website. A read checks a magic number,
    the format version, that the stored key equals the requested one, and a SHA-256 of the payload; a mismatch deletes
    the file and counts as a miss. A write goes to a `.tmp` file that is read back and compared; then, although the
    comment says "moved into place", the bytes are written a second time. The verified read is what makes that safe.
    Debts: the memory tier counts entries, not bytes, and every store hit rewrites the whole index file.

## Variations

- **Plain LRU.** One order, no costs. Right when cost per byte is uniform or access has strong recency, as in brush
  strokes; it loses when an expensive shared entry is not touched recently.
- **Partitioned LRU.** Separate pools with separate budgets for classes of entries, so cheap ones cannot evict dear
  ones. Simple and predictable; the split of the budget is a guess to be measured.
- **Age counters with protection.** darktable ages every cache line on each lookup and protects a hit line for as many
  lookups as there are lines. It suits a few large entries.
- **Verifying traces and early cutoff.** Build keys from hashes of the *outputs* below. A layer whose output did not
  change then stops the rebuild above it: on Editor lab's document, edits of masked layers left 16 to 26 of 40 output
  tiles bit-identical, so up to half the work above was avoidable. The price is a hash of every output (0.093 ms per
  256 KiB tile, 15 to 22 % of the cheapest layers) and no keys before work starts.

## Consequences

- \+ No invalidation code: a stale entry is harmless, because nothing asks for it.
- \+ Undo, redo and toggling find earlier results, even from another process.
- \+ Expensive shared results survive bursts of cheap work: in the undo scenario, a quarter of the recomputation.
- \+ The policy is a setting a bench can compare, so the choice is measured, not argued.
- − Every input must reach the key; a forgotten one gives a wrong answer no test of the cache notices.
- − Keys cost time on every lookup, and wide keys cost more.
- − The cost-aware policy needs a cost per entry and a search or heap, and loses to LRU on recency-shaped work.
- − Keys made from keys cannot stop a rebuild when an output happens not to change.

## Known uses

- **GreedyDual**: Neal Young, "The k-server dual and loose competitiveness for paging" (*Algorithmica*, 1994).
- **GreedyDual-Size**: Pei Cao and Sandy Irani, "Cost-Aware WWW Proxy Caching Algorithms" (USENIX Symposium on
  Internet Technologies and Systems, 1997), H = L + cost / size.
- **Build systems**: Bazel's remote cache and Nix's store name outputs by hashes of their inputs; Mokhov, Mitchell and
  Peyton Jones, "Build Systems à la Carte" (ICFP 2018), classify such rebuilders and show that deep constructive
  traces lose early cutoff.
- **git** names every object by a hash of its content.
- **Memcached** keeps a separate LRU for each slab class of item sizes: a partitioned LRU.
- **CPU cache hierarchies**: tiers of growing size and latency, each evicting by an approximation of recency.

## Related chapters

- [Chapter 8, Count What You Own](08-count-what-you-own.md): the budget has one owner with a ledger; this chapter
  decides what that owner lets go.
- [Chapter 5, Solve Once, Apply Many](05-solve-once-apply-many.md): what is hoisted out of a loop is often worth
  caching.
- [Chapter 10, Measure From the User's Clock](10-measure-from-the-users-clock.md): policies are compared by running
  scenarios.
- [Chapter 1, One Contract, Several Engines](01-one-contract-several-engines.md): the slow reference is the check that
  a cache never served a wrong result.
- GoF: a caching **Proxy** stands in front of the producer; **Flyweight** shares equal values by key; a **Memento** of
  settings is what lets undo land on old keys.
- Parent volume: [Interned Operation Graph](../01-interned-operation-graph.md) builds the content keys this chapter
  assumes; [Tabulated Preview, Exact Export](../06-tabulated-preview-exact-export.md) makes the tables chromobench
  caches on disk.

The pattern allows piecemeal growth: a new feature only has to put its inputs in its key, and nothing else in the
cache must learn about it. That is what keeps the cache habitable.

## Exercises

1. **A web proxy.** A cache of 4 units holds A (size 1, fetch cost 8), B (size 2, cost 3) and C (size 1, cost 1),
   used in that order. Then D (size 2, cost 6), A and E (size 1, cost 1) are requested. Trace LRU and GreedyDual-Size
   (clock starting at 0): what does each evict, and which requests miss?
2. **Width.** A build cache will see 10⁸ distinct keys in its life. How many bits keep the expected colliding pairs
   below 10⁻⁶? What else must be true for the bound to mean anything?
3. **Your own forces.** Find a cache, memo or global dictionary in code you have written. Write down its key, the
   inputs it leaves out, and what each omission would do. Does it include anything it should not?
4. **Early cutoff in a spreadsheet.** A cell's cached value is keyed by its formula and its inputs' keys. Change an
   input so that a `MAX` over it keeps its value. Which cells recompute under these keys, and which under keys built
   from output hashes? What does the second design cost?
