---
Title: GPU correctness and contrast blend modes spec
Ticket: CHB-045
Status: active
Topics:
    - gpu
    - correctness
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Phase 1 GPU correctness (GPUC-1..4) and D7 contrast blend modes in the display encoding: what changes, where, and how each is tested"
LastUpdated: 2026-11-15T18:23:46.947003-05:00
WhatFor: ""
WhenToUse: ""
---

# GPU correctness and contrast blend modes (CHB-045)

Phase 1 of the roadmap (CHB-044 `reference/01-consolidated-backlog.md`): the four GPU engine correctness items of
group 8 and decision D7 (LAY-3). Source tasks: CHB-037 P10-10, P10-15, P10-26, P10-11, P10-23. Background:
CHB-043's pattern chapters `docs/patterns/gpu/03-one-grid-rule.md` and `08-retire-after-the-fence.md` (branch
`task/chb-043-gpu-patterns`).

## 1. GPUC-1: field textures reused mid-export (P10-10)

**Problem.** An exact (tiled) export builds whole-frame blur fields once (`GpuEngine.fieldOf`) and every tile reads
them (`blurAt`, `extremesOf` → `Blur.upsampleAt`). Any non-exact render (a preview) calls `dropFields`, which released
every field into the texture pool at once. A tile that had taken a field and was awaiting its pipeline then bound a
texture the pool could hand to another render, which writes it: wrong pixels, no error.

**Rule.** A texture returns to the pool, or is destroyed, only after the last pass that declared a use of it has been
submitted (WebGPU's finish rule: queue order puts later writes after earlier reads; the API keeps destroyed objects
alive for submitted work).

**Design.** Per-object leases in the pools (`Pool.lease(obj) → end`): a task declares a use when it takes the handle
and ends it after the pass that reads it is submitted. `release` of a leased object is deferred to its last lease's
end; it never enters a free list while leased. `fieldOf` returns the field with a lease taken in the same synchronous
step as the cache lookup; `blurAt` and `extremesOf` end it after `upsampleAt` (which submits) returns.

**Test.** `law:field-race` (gpu-parity, SwiftShader and Metal): an exact export tile's first `upsampleAt` is
intercepted; inside it a preview renders (dropFields), then a texture with the field's descriptor is taken from the
pool and filled with a constant, then the tile proceeds. Before: the pool returns the field itself and the tile's
16-bit codes differ from the whole-frame export; after: a fresh texture, codes equal.

## 2. GPUC-4: retired memory counted (P10-11)

**Problem.** `discard` and free-list trims took bytes out of the budget at once, but `GpuRuntime.retire` destroyed
the object only when no render was in flight (one global counter, `busy`). Under overlapping renders the retired list
grows without bound while the budget believes the memory is free.

**Design.** Retirement per object, with the leases of §1, replaces the global quiet point:
- `Budget.pending`: bytes let go but not yet destroyed. `fits`, `makeRoom`/`trimFree`, `peak` and every render's
  `watch` window count `live + pending` (`held`).
- `discard(obj)`: out of `live` now; destroyed now when no lease is open, else at the last lease's end, its bytes in
  `pending` meanwhile.
- A free-list object has no open lease and every pass that used it was submitted before its release (the pool's rule,
  now stated in `pool.ts`), so trimming destroys it now: valid in WebGPU, which reclaims the memory after the submitted
  work completes.
- The residency's leases (a render between taking a kept source texture and submitting) take a pool lease too, so an
  evicted, replaced or forgotten texture a render still binds waits for that render's submit; the film grain's
  textures of ones are leased by the pass that reads them.
- `GpuRuntime.busy`/`retire`/`retiring` are removed (hard cut-off): one mechanism.
- The journal's render row reports `pending` and its high-water mark includes it.

**Tests.** Unit (`packages/gpu/test/residency.test.ts`, `runtime.test.ts`): discard of a leased object counts as
pending, blocks an allocation that would exceed the budget, and frees on the lease's end; peak includes pending;
release while leased stays out of the free list. Browser: the CHB-038 ones-texture regression rewritten on leases.

## 3. GPUC-2: one integer grid rule (P10-15)

**Rule.** Output pixel p of an n-pixel grid over a region (x, w) reads image pixel
`fp = x + ⌊(2p + 1)·w / 2n⌋`, in integers. Ties ((2p + 1)·w divisible by 2n) are exact; nothing else is near one.

**Where.** `@chromobench/contract` `gridSample` (one definition; refuses n·w ≥ 2³¹, the bound where u32
(2p + 1)·w could wrap); core `engine-ref.ts gridOf` and `print/masks.ts gridCentres`; mock `engine-mock.ts`;
GPU: `kernels/grid.wgsl` (`gridSample`, u32), included by `pointwise.wgsl` (outMap becomes the integer region),
`retouch.wgsl` and `frame.wgsl` (straighten); `residency.ts gridCoords` (proxies) uses the contract's function. The
host checks the bound before packing a uniform.

**Test.** Law test (vitest, `packages/gpu/test/grid.test.ts`): the integer rule against an exact rational reference
for every output width 1…4000 of a 4000-px region and a few heights, ties included; the old f32 rule as the broken
variant (554 widths differ). Browser (`law:grid`): the pointwise kernel's fp read back (a coordinate image) for every
width 1…4000 of a 4000-px frame row, compared with core column by column.

## 4. GPUC-3: floored log in density-mask mode 7 (P10-26)

`combine.wgsl` mode 7 takes `log10 max(b, MASK_T_FLOOR)`; `MASK_T_FLOOR = 1e-8` (contract `pixel.ts`, density 8:
denser than any negative) and the host floors the reference extreme the same way; core's `maskDensity`/`maskDensityPolar`
floor too (f64 underflows to 0 below 10⁻³²⁴). Tests: core with a transmittance that underflows; GPU `law:density-floor`
with 0, a subnormal and normal values.

## 5. LAY-3: contrast blend modes in the display encoding (P10-23, D7)

**Decision D7.** Overlay, soft light, hard light and the other contrast modes switch at display mid-grey: they are
evaluated in the display encoding; every other mode stays in linear light.

**Definition.** The display encoding is the sRGB transfer curve (IEC 61966-2-1) applied per channel to the entry's
linear working RGB, extended oddly below 0 (values above 1 follow the same formula). For a contrast mode,
`B(b, s) = dec(B_W3C(enc(b), enc(s)))`; an OkLab entry converts to linear RGB first, as before. The mix
(back + k·(B − back)) stays in the entry's encoding. Display mid-grey enc 0.5 = linear 0.2140.

**Modes.** `CONTRAST_BLENDS` = overlay, soft-light, hard-light, vivid-light, linear-light, pin-light, hard-mix. The last
four are new (Photoshop's definitions; vivid light is colour burn of 2s below ½ and colour dodge of 2(s − ½) above, linear
light b + 2s − 1, pin light min/max, hard mix: 1 when b + s ≥ 1, else 0), placed after soft-light in `BLEND_MODES`
(20 modes). The separable channel formula (`blendChannel`) and the encoding move to the contract (`pixel.ts`) so core
and the mock share one definition; WGSL mirrors them, with blend codes generated from `BLEND_MODES`.

**Consequences.** Documents with these modes render differently (by design); goldens with such stacks are regenerated
deliberately and their before/after recorded in the diary. Contract 1.5.0, CC-024.
