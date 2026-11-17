# Chapter 9 · Keep What Is Dear

*Name every result by what it was made from; when memory runs short, let go of what is cheapest to make again.*

**★** A good form among several; the Variations section names the others.

## Intent

Cache expensive results under keys computed from everything that produced them, so a stale entry is simply never
asked for again. Keep the cache under a budget; when it is full, evict by what each entry would cost to remake per
byte, with age as the tiebreaker.

## Also known as

Content-addressed cache; cost-aware caching; GreedyDual-Size.

## Motivation

An image editor stacks **layers**, each an adjustment applied to the picture below it. It cuts the picture into
**tiles**, squares of 128 × 128 pixels, and caches the result of each layer at each tile, so that moving a slider on
a high layer does not recompute the layers below. A first version indexes tiles by layer and position, clears
entries when something changes, and, when memory is full, drops the tile used longest ago. Four things go wrong.

1. **Invalidation forgets a dependency.** A blur reads a margin of pixels around its tile, so painting in one tile
   changes the blurred result of its neighbours. The clearing code clears the painted tile and not the neighbours. The
   screen shows a stale picture and nothing reports an error.
2. **Undo recomputes.** To the invalidation code an undo is one more change; the old tiles it needs were cleared.
3. **The cache keeps the wrong tiles.** Editor lab's benchmark ran ten edits, ten undos and ten redos on the top layer
   of an eight-layer document, with a 32 MB cache. Every state shares the tiles of the layers below, among them an
   expensive sharpening layer. Least-recently-used (LRU) eviction kept the newest tiles, let the shared ones age out,
   and recomputed 10,560 tiles. A policy that weighed each tile's cost recomputed 2,662, a quarter of the work.
4. **Hashed keys bring their own failure.** A hashed key of too few bits, or one missing an input, returns the wrong
   picture with full confidence.

The same problem appears in a web proxy, whose pages differ in size and fetch time (cost-aware eviction was invented
there), in a build system deciding whether a stored object file still matches its sources, and in a spreadsheet.

## Problem

**How should a program remember expensive results so that it never serves a stale one, and decide what to forget
when it cannot remember everything?**

## Forces

- **Invalidation against keys.** Deleting stale entries is direct, but needs a record of who depends on what that
  every new feature must keep current. A key made from the inputs needs no record, but every input must reach it.
- **Narrow keys against wide keys.** A key that omits an input serves a wrong answer silently; one that includes
  something irrelevant, a timestamp or a counter, misses for nothing.
- **Cheap keys against safe keys.** A short hash is fast; collisions must stay negligible over the cache's life.
- **Recency against cost.** What was used last is usually used next; but an expensive result shared by many states
  is the one most worth keeping, however old.
- **Memory against recomputation.** A byte held is denied to the rest of the program; a byte dropped is work redone.
- **Freedom to forget against work in flight.** The cache must be able to drop anything, but not a result someone is
  still reading.

## Solution

**Therefore: compute each result's key from everything that produced it (the operation, its settings, and the keys
or content hashes of its inputs), wide enough that collisions are negligible over the cache's life, and look results
up only by that key. Never delete a stale entry; stop asking for it. Give the cache one owner and a budget in bytes.
Store with each entry its size and the time it took to make. When the budget is passed, evict the entry with the
lowest priority H = clock + cost / size and raise the clock to that H, so expensive entries outlive cheap ones of the
same age and unused entries still age out. Never evict an entry someone holds. Make the policy a setting, measure it
on the workloads that matter, and keep plain LRU where every entry costs about the same per byte.**

## Applicability

Use it when results are expensive, deterministic functions of inputs that hash cheaply; when states recur (undo,
toggling, comparing); when entries differ widely in cost per byte; and when the cache cannot hold everything.

Do not use it when a result depends on something no key can hold (the time, randomness, an outside service); when
recomputing is cheaper than looking up; when everything fits (use an unbounded memo); or for a single sweep that never
returns. When every entry costs the same per byte, keep the keys and use plain LRU.

## Structure

| Participant | Responsibility |
| --- | --- |
| **Key function** | computes a key from the operation, its settings and its inputs' keys; the only way to name a result |
| **Cache** | maps keys to entries; one owner; counts hits, misses, evictions and bytes |
| **Entry** | the value, its size, its cost to remake, its priority, how many readers hold it |
| **Policy** | orders entries for eviction (LRU or cost-aware); a setting |
| **Budget** | the bytes the cache may hold, counted by the owner |
| **Producer** | computes on a miss, times its own work, stores the result |
| **Lower tier** *(optional)* | a slower store such as a disk; every read verified |

In a web proxy the key is the URL and its version, the producer is the fetch from the origin server, the cost is
the fetch time and the budget is the proxy's disk.

## Collaborations

1. The producer computes the key from the operation, the settings and the inputs' keys, before any real work.
2. On a hit the cache renews the entry and hands it out held; on a miss a verified lower tier may answer.
3. Otherwise the producer computes, timing only its own work, and stores the result with its size and cost.
4. Over budget, the policy evicts entries no one holds. A reader releases its entry when done.

## Sketch

```text
-- helpers named for what they do: hash, moveToBack, sizeInBytes, now, disk, fileFor
-- the key: everything the result was made from, and nothing else
key(op, settings, inputs) → Key:
  return hash(op.name, canonical(settings), [i.key for i in inputs])   -- 64 bits or more
  -- canonical: equal settings always spell the same way

value Entry: { key, value, bytes, cost, H, holds }   -- cost in ms; H in ms per byte

-- the cache: one owner, a byte budget, a policy that is a setting
cache Cache(budget, policy):
  entries ← {}        -- kept in order of last use, oldest first
  used ← 0 ; clock ← 0

  get(k) → value | none:                   -- a value handed out is held until release(k)
    e ← entries[k] ; if e = none: misses += 1 ; return none
    hits += 1 ; e.holds += 1
    moveToBack(entries, e)                 -- newest use last, for LRU
    e.H ← clock + e.cost / e.bytes         -- renewed priority, for cost-aware
    return e.value

  put(k, v, bytes, cost) → value:          -- returns the stored value, held
    if entries[k] ≠ none: return get(k)    -- another producer stored it first; keep theirs
    entries[k] ← Entry{ key: k, value: v, bytes, cost, H: clock + cost / bytes, holds: 1 }
    used += bytes ; evict() ; return v

  release(k):
    entries[k].holds −= 1 ; evict()        -- a cache over budget can shrink now

  evict():
    while used > budget:
      free ← [e in entries where e.holds = 0]
      if free = []: return                 -- everything is in use: over budget until a release
      victim ← match policy:
        lru:  first(free)
        cost: the e in free with the least e.H
      clock ← max(clock, victim.H)         -- what is left now ages relative to this
      remove victim from entries ; used −= victim.bytes ; evictions += 1

-- a lower tier: a bad entry is a miss, never an answer
fromDisk(k) → value | none:
  b ← disk.read(fileFor(k))                -- the file holds a header (magic, version, key, payload hash)
  if b = none or b.magic ≠ MAGIC or b.version ≠ VERSION or b.key ≠ k or hash(b.payload) ≠ b.payloadHash:
    disk.remove(fileFor(k)) ; return none
  return b.payload

-- the producer: returns the key with the value so the caller can release it
resolve(op, settings, inputs) → (Key, value):
  k ← key(op, settings, inputs)
  v ← cache.get(k) ; if v ≠ none: return (k, v)
  t0 ← now() ; v ← op.run(settings, inputs) ; cost ← now() − t0
  return (k, cache.put(k, v, sizeInBytes(v), cost))

-- in use: undo and redo land on keys already made (render: the operation that draws a state)
for s in edits ++ reverse(edits) ++ edits:
  (k, v) ← resolve(render, s, []) ; show(v) ; cache.release(k)
```

## Implementation notes

1. **Put every input in the key, and hash what is consumed, not its label.** Editor lab's tile key hashes the layer's
   settings, a revision number for each 64-pixel block under the tile, and the keys of every tile below that the layer
   reads, a blur's margin included. chromobench's keys for its precomputed colour tables hash the arrays the builder
   actually reads, so new data changes the key without anyone bumping a version.

2. **A key that names the wrong thing brings invalidation back.** In chromobench's reference engine (the slow, exact one
   kept beside the fast one) an image's id names the file, not the way it was decoded. Opening the same file decoded
   another way would find the old results, so a `forgetSource` method clears every cache. The repair within this pattern
   is to put the decoding in the key. A forgotten input costs a wrong picture; a cleared cache only costs time.

3. **Choose the width from the birthday bound.** Among N random keys of b bits, about N² / 2^(b+1) pairs collide. A long
   editing session makes about 10⁵ keys: with 32 bits that is 1.2 expected collisions, a wrong tile more likely than
   not. Editor lab uses 52 bits, the most a JavaScript number holds exactly: about 10⁻⁶. The bound assumes a hash that
   mixes well.

4. **Revision counters are cheap; content hashes find undo.** Undoing a brush stroke in Editor lab restores the old
   pixels but raises the block's revision number, so the old tiles are not found. Hashing each touched block would find
   them, at a cost on every stroke.

5. **Time only the entry's own work.** Editor lab times one layer applied to one tile, not the fetching of its inputs,
   which have their own entries, and floors the cost at 0.01 ms so no entry is free.

6. **Plain LRU is right when cost per byte is uniform.** chromobench keeps source images in the graphics processor's
   (GPU's) memory; remaking one is a copy into that memory, roughly proportional to its size. Cost / size is then a
   constant, and GreedyDual-Size would order entries exactly as LRU does. The team kept LRU, deferred the cost-aware
   policy until intermediate results are cached, and kept the eviction order in one function so that change has one
   place to land. In a brush stroke, where each dab revisits the last dab's tiles, LRU even won: 925 tiles recomputed
   against 1,236.

7. **Say which policy you run.** Every cache in chromobench is plain LRU, and its reference engine's caches are
   unbounded unless the host sets a limit. Their one gesture towards cost is a partition: small preview images have
   their own pool and cannot push out a full-size result.

8. **Never evict what is in use.** Both programs keep the newest entry even when it alone exceeds the budget.
   chromobench's GPU memory manager lets a render **lease** an image while the GPU reads it and **pins** the images on
   screen; only recovery from running out of memory may take those.

9. **Coalesce concurrent misses; do not cache failures; memoise the key.** chromobench's cache of compiled GPU programs
   stores the *promise* of a compilation, so two simultaneous misses compile once, and drops it on failure. Hashing 30
   kB of program text on every use cost an export tens of milliseconds until the hash itself was memoised.

10. **A slower tier trusts nothing it reads.** chromobench keeps its colour tables in a 16-entry memory cache in front
    of a 200 MB disk store in the browser. Every read is checked as in the sketch's `fromDisk`. Debts: the memory tier
    counts entries, not bytes, and a comment says files are "moved into place" when the code writes them twice.

## Variations

- **Plain LRU.** One order, no costs. Right when cost per byte is uniform or access is recent; it loses when an
  expensive shared entry has not been touched lately.
- **Partitioned LRU.** Separate pools with separate budgets, so cheap entries cannot evict dear ones. Predictable; the
  split of the budget is a guess to be measured.
- **Verifying traces and early cutoff.** Build keys from hashes of the *outputs* below, so a step whose output did
  not change stops the rebuild above it. In Editor lab, editing a layer that touches only part of the picture left 16
  to 26 of 40 tiles unchanged: up to half the work above was avoidable. The price is hashing every output (15 to 22 %
  of the cheapest layers' cost) and no keys before work starts.

## Consequences

- \+ No invalidation code: a stale entry is harmless, because nothing asks for it.
- \+ Undo, redo and toggling find earlier results.
- \+ The policy is a setting, so the choice is measured, not argued.
- − Every input must reach the key; a forgotten one gives a wrong answer no test of the cache notices.
- − The cost-aware policy needs a cost per entry and a search or heap, and loses to LRU on recency-shaped work.
- − Keys made from keys cannot stop a rebuild when an output happens not to change.

## Known uses

- **GreedyDual**: Neal Young, "The k-server dual and loose competitiveness for paging" (*Algorithmica*, 1994).
- **GreedyDual-Size**: Pei Cao and Sandy Irani, "Cost-Aware WWW Proxy Caching Algorithms" (USENIX USITS, 1997).
- **Build systems**: Bazel's remote cache and Nix's store name outputs by hashes of their inputs; Mokhov, Mitchell and
  Peyton Jones, "Build Systems à la Carte" (ICFP 2018), show that such keys lose early cutoff.
- **git** names every object by a hash of its content; **Memcached** keeps one LRU per size class, a partitioned LRU.
- **CPU cache hierarchies**: tiers of growing size and latency, each evicting by approximate recency.

## Related chapters

- [Chapter 8](08-count-what-you-own.md) gives the budget one owner; this chapter decides what that owner lets go.
- [Chapter 5](05-solve-once-apply-many.md): what is hoisted out of a loop is often worth caching.
- [Chapter 10](10-measure-from-the-users-clock.md): policies are compared by running scenarios.
- [Chapter 1](01-one-contract-several-engines.md): a slow reference engine checks that the cache never lied.
- GoF: a caching **Proxy** fronts the producer; **Flyweight** shares equal values by key; a **Memento** of settings
  lets undo land on old keys.
- Parent volume: [Interned Operation Graph](../01-interned-operation-graph.md) builds these content keys;
  [Tabulated Preview, Exact Export](../06-tabulated-preview-exact-export.md) makes the tables cached on disk.

The pattern allows piecemeal growth: a new feature only puts its inputs in its key, and nothing else must learn
about it. That keeps the cache habitable.

## Exercises

1. **A web proxy.** A cache of 4 units holds A (size 1, fetch cost 8), B (size 2, cost 3) and C (size 1, cost 1),
   used in that order. Then D (size 2, cost 6), A and E (size 1, cost 1) are requested. Trace LRU and GreedyDual-Size
   (clock starting at 0): what does each evict, and which requests miss?
2. **Your own forces.** Find a cache, memo or global dictionary in code you have written. Write down its key, the
   inputs it leaves out, and what each omission would do. Does it include anything it should not?
3. **Early cutoff in a spreadsheet.** Cells are keyed by their formula and their inputs' keys. Change an input so
   that a `MAX` over it keeps its value. Which cells recompute, and which would under keys built from output hashes?
4. **Build it.** Implement the sketch's cache in a language you know, with a fake producer whose cost you set. Replay
   the trace of exercise 1, then a trace of your own where LRU wins. Test that a held entry is never evicted.
