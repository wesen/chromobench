# Chapter 7 · Barrier-Cut Fusion ★★

*Cut the operation graph at the nodes that must exist as whole images (barriers), and run each run of pointwise
operations between them as one fused pass; release every intermediate after its last reader.*

## Intent

Evaluate a long chain of operations with as few passes over memory as possible. Most image operations are pointwise:
each output pixel depends only on the same input pixel. Such runs can be executed as one kernel that reads each pixel
once and writes it once. A few operations need more (a blur reads neighbours, a combine reads several images, a node
read by two consumers should be computed once); those are barriers where an image must be materialised. The planner
finds the barriers, fuses everything between them, and frees each materialised image as soon as no one needs it.

## Also known as

Pointwise fusion; kernel fusion; operator fusion; pipelining up to pipeline breakers; stage cutting.

## Motivation

The running example (chromobench, a browser darkroom that prints photographs through a film and paper model) runs
about thirty operations per print, most of them pointwise: density, dye inversion, paper exposure, printer lights,
paper development, reflection under a lamp, viewing flare, chromatic adaptation, display encoding. Executed one pass
per operation on a 4,000 × 2,674 image of four 32-bit floats per pixel, each pass reads and writes 171 MB. Four naive
designs fail.

1. **One pass per operation** is bandwidth-bound: exposure reads 16 bytes, writes 16 and does about a dozen
   arithmetic operations, so the GPU waits on memory. Thirty passes are thirty round trips through memory.
2. **One giant kernel** cannot exist: a blur needs its whole neighbourhood computed, a combine needs several images,
   and a feathered mask needs the mask finished before it is blurred.
3. **Fusing by hand** (writing "the film kernel", "the print kernel") freezes the operation boundaries; a new
   operation or a reordering breaks the hand-made kernels.
4. **Keeping every intermediate** runs out of memory on large images; freeing them too early forces recomputation of
   a node read twice.

Database engines compiling queries into pipelines, machine-learning compilers fusing element-wise operations and
shader-graph editors compiling a node graph into one shader face the same structure.

## Problem

**How do you execute a graph of mostly pointwise operations with the fewest passes over memory, without hand-fusing
kernels and without losing the operations that need whole images?**

## Forces

- **Fewer passes against more barriers.** Every materialised image costs a write and a read; every barrier is
  required by some operation's semantics.
- **Generality against speed.** A generic fused kernel interprets a list of operations; a generated kernel per chain
  is faster to run and costly to compile.
- **Parameters against pipelines.** Slider changes must not recompile; constants baked into a shader are fastest and
  force a recompile per value.
- **Memory against recomputation.** Freeing an image early saves memory; a second reader then recomputes it.
- **Fusion against caching.** A fused run has no intermediate results to cache; caching an intermediate needs it
  materialised.

## Solution

**Therefore: classify every operation as pointwise or as a barrier (it reads neighbours, reads several images, or
must be computed whole). Before evaluating a target, walk its graph inputs-first and mark as materialised the target,
every barrier, every input of a barrier, and every node read by two or more consumers. Cut the graph at the
materialised nodes; each remaining run of pointwise operations ends at one of them and becomes one pass of a generic
fused kernel that takes the run's operations and parameters as data (an opcode list and a uniform block), so a
parameter change reuses the compiled pipeline. Count the readers of each materialised image and release it after its
last read. Choose deliberately which materialised nodes to keep across evaluations as cache checkpoints.**

## Applicability

Use it when:

- the graph is dominated by pointwise operations and memory bandwidth bounds performance;
- the graph changes shape often (users compose operations), so hand-fused kernels cannot keep up;
- parameters change at interactive rates.

Do not use it when:

- the graph is mostly neighbourhood operations (a stack of blurs); fusion of pointwise runs saves little and tiles
  matter more (Chapter 8);
- every intermediate must be inspected or cached (a debugger view of every node); materialise everything instead;
- the per-pass overhead is negligible next to the arithmetic (expensive per-pixel models on small images).

## Structure

| Participant | Responsibility |
|---|---|
| **Operation class** | pointwise, spatial, multi-input, generator (does not read its receiver's values) |
| **Planner** | inputs-first order, materialised set, read counts, segments |
| **Segment** | a run of pointwise operations from a start (source, materialised image, generator) to a materialised end |
| **Fused kernel** | one compiled program executing an opcode list with parameters from a uniform block |
| **Barrier executors** | blurs, combines, healing; each reads materialised inputs, writes a materialised output |
| **Texture pool** | allocates materialised images and takes them back after their last reader |

## Collaborations

1. The engine asks the planner for the plan of a target node.
2. The planner orders nodes inputs-first, marks materialised nodes and counts how often each is read.
3. For each materialised node in order: if it ends a pointwise segment, the fused kernel runs the segment's opcodes
   with its parameters; if it is a barrier, the barrier's executor runs on its materialised inputs.
4. After each read of a materialised image the count drops; at zero the texture returns to the pool, unless it is a
   chosen checkpoint.

```mermaid
flowchart LR
  S[source] --> A[density]
  A --> B[invert dyes]
  B --> C[expose paper]
  C --> X[combine exposures: barrier]
  B --> X
  X --> D[lights]
  D --> E[develop]
  E --> F[view, adapt, display]
```

Read the graph left to right: `invert dyes` is read twice and is materialised; `combine` reads several images and is a
barrier; the planner fuses density + invert into one pass, expose into another, and lights → display into a third.

## Sketch

```text
match class(op): pointwise | spatial | multiInput | generator

plan(graph, target) → (order, materialised, reads):
  order ← inputsFirst(graph, target)
  consumers ← count of users of each node within order
  materialised ← { target }
  for n in order:
    if class(n.op) ∈ { spatial, multiInput }: materialised ← materialised ∪ { n } ∪ inputs(n)
    if consumers[n] ≥ 2: materialised ← materialised ∪ { n }
  reads ← for each m in materialised: number of segments and barriers that read m
  return (order, materialised, reads)

segment(m) → ops:                         -- the pointwise run ending at m
  walk back from m through pointwise nodes until a source, a materialised node or a generator

execute(plan):
  for m in plan.order where m ∈ plan.materialised:
    if class(m.op) is pointwise: tex[m] ← fusedKernel(opcodes(segment(m)), uniforms(segment(m)),
        start(segment(m)))
    else:                        tex[m] ← barrierExecutor(m.op)(tex[i] for i in inputs(m))
    for i in inputs read by this step: reads[i] ← reads[i] − 1; if reads[i] = 0 and not
        checkpoint(i): release(tex[i])
  return tex[plan.target]
```

## Implementation notes

1. **Parameters are data, never constants.** Editor lab (a browser photo editor whose GPU path was a probe) generated
   one shader per fused run with parameters baked in as constants, and every slider step recompiled it (79 ms per
   change). The running example's fused kernel reads opcodes and parameters from a uniform block; pipelines are
   cached by code and a drag compiles nothing.
2. **Bound the opcodes per pass.** The running example's kernel takes at most 12 operations per pass; a longer run is
   split into consecutive passes. This keeps the uniform block fixed-size and the kernel's loop small, at the price
   of an extra pass on very long chains.
3. **Generators do not read their receiver.** Gradient, ellipse and painted masks depend only on coordinates or
   strokes. Treating them as segment starts, not as consumers of their receiver, keeps the receiver from being
   materialised for nothing.
4. **Mark the inputs of barriers, not only the barriers.** A blur needs its input whole; the planner must materialise
   the blur's input as well as its output.
5. **A node read twice is materialised once.** The running example's dye inversion feeds the main exposure and every
   dodge or burn exposure; without the read count it would be recomputed per exposure.
6. **Release after the last reader.** Read counts let the texture pool reuse memory during one evaluation. In the
   running example nothing survives between evaluations except the decoded source, which is simple and safe, and
   means a drag on a late operation reruns every earlier pass. Fusion and checkpoints pull in opposite directions;
   choose checkpoints (the film output, the print before the digital stage) explicitly.
7. **Keep the plan's grid uniform.** The running example evaluates every materialised texture on the target's grid;
   pointwise steps commute with nearest sampling, so a fused preview equals the reference's sampled full-resolution
   result, and spatial steps scale their kernels to the grid. Mixed grids inside one plan make parity hard to state.
8. **Fusion changes evaluation order; prove it harmless.** Fused and unfused evaluation must agree within the
   reference's tolerance (Chapter 3). A segment computed in 32-bit floats in one pass rounds differently from the
   same operations in 64-bit floats one at a time.
9. **Cost of the plan.** Planning runs on every evaluation. Walking thirty nodes is microseconds; planning per tile
   of a large export multiplies it, so compute the plan once per target and reuse it across tiles.

## Variations

- **Generated kernels.** Generate and compile a specialised kernel per segment shape (operations, not values); fastest
  execution, compile cost per new shape, a cache of pipelines keyed by shape.
- **Recompute instead of materialise.** For a node read twice by cheap consumers, recompute it in both segments
  (Halide's inlining); saves a write and a read, costs arithmetic.
- **Tile-local fusion.** Fuse across a neighbourhood operation by computing its input with an apron inside each tile
  (Chapter 8); removes a barrier at the cost of overlap recomputation.
- **Checkpointed fusion.** Keep chosen segment ends in a cache across evaluations; later edits start from the nearest
  checkpoint.

## Consequences

- \+ A long pointwise chain costs about one pass over memory instead of one per operation.
- \+ New operations join fusion by declaring their class and an opcode; no hand-made kernel changes.
- \+ Memory peaks at the widest set of live materialised images, not at the graph's size.
- − Fused runs leave no intermediates to inspect or cache unless chosen as checkpoints.
- − A generic interpreted kernel is slower per operation than a specialised one.
- − Every operation needs a second implementation as an opcode, kept in parity with the reference.

## Known uses

- **Halide** separates the algorithm from its schedule; inlining and `compute_at` choices decide which stages are
  fused and which are materialised.
- **XLA and TVM** fuse element-wise operations of machine-learning graphs into single kernels.
- **Compiled database engines** (HyPer, and the pipeline model behind many since) compile query operators into
  pipelines that run until a pipeline breaker such as a hash-table build or a sort.
- **Apache Spark** groups narrow transformations into stages and cuts stages at shuffles.
- **Shader-graph editors** (Unity Shader Graph, Unreal's material editor) compile a node graph into one shader.

## Related chapters

- [Chapter 1 · Interned Operation Graph](01-interned-operation-graph.md) supplies the graph and the read counts' node ids.
- [Chapter 8 · Reach-Declared Tiling](08-reach-declared-tiling.md) handles what lies across a spatial barrier.
- [Chapter 6 · Tabulated Preview, Exact Export](06-tabulated-preview-exact-export.md) supplies the lookups fused into passes.
- [Chapter 3 · Reference Oracle](03-reference-oracle.md) proves fusion does not change answers.
- GoF: **Interpreter** (the fused kernel executing opcodes), **Composite** (segments of operations treated as one).
