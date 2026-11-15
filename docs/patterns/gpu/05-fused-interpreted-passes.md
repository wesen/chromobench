# Chapter 5 · Fused Interpreted Passes

*One kernel interprets a fused program of pointwise steps; passes break only where neighbours are read.*

**★** A good form among several; the Variations section names the others.

## Intent

Run a long, user-composed chain of per-pixel operations at the cost of about one pass over memory, without compiling
a GPU program when the chain or its parameters change. One precompiled kernel applies a short program of operation
codes and parameters to every pixel; a pass ends only where an operation reads neighbours or the program is full.

## Also known as

Uber-shader; interpreted pipeline; stage list; bytecode kernel; fusion by interpretation.

## Motivation

The running example, chromobench, prints a photograph through about thirty operations, most of them pointwise (each
output pixel depends only on the same input pixel: density, dye inversion, paper exposure, display encoding), and,
above the print, up to a dozen digital layers (exposure, curves, hue bands, a channel mixer). A full-size image of
4,000 × 2,674 pixels stored as `rgba32float` (four 32-bit floats per pixel) is 171 MB, so every pass that reads one
image and writes another moves 342 MB. Three ways of running such a chain on the GPU fail.

1. **One kernel per operation.** A kernel is the function the GPU runs once per pixel. An exposure change reads 16
   bytes, writes 16 and does about a dozen arithmetic operations, under half an operation per byte. Twelve such
   steps as twelve passes move 4.1 GB; at an M1 Max's nominal 400 GB/s that is 10 ms of memory traffic, against
   under 1 ms for one pass doing all twelve. The arithmetic is nearly free; the trips through memory are not.
2. **One generated kernel with the values written in.** Editor lab, the teaching editor, generated one shader per
   fused run of layers and wrote every parameter into the source as a literal, so the compiler could fold it. Every
   slider step changed the text, and every new text was a new compile: 79 ms in its textbook's measurement, nearly
   five display refreshes at 60 Hz, on every step of a drag.
3. **One generated kernel per combination of operations.** The textbook's fix passes values in a parameter block and
   compiles once per combination of layer kinds. That moves the compile from the drag to the click. With thirty
   operation codes and programs of up to twelve steps, every structural edit (adding a layer, reordering two,
   enabling a mask) can be a combination never seen before, and its first use stalls for a compile.

The same choice appears elsewhere. GPU emulators reproduce a console's fixed-function pixel pipeline, which games
reconfigure between draws; a shader generated per configuration made games stutter while it compiled. Database
engines evaluating `price · (1 − discount)` over billions of rows choose between interpreting an expression over
vectors of values and compiling machine code per query.

## Problem

**How do you run an arbitrary, frequently edited chain of per-pixel operations at the speed of one pass over memory,
without compiling a GPU program per value or per combination?**

## Forces

- **Bandwidth against compile time.** Fusing saves passes over memory; a specialised fused kernel must first be
  compiled, tens of milliseconds on the path of a gesture.
- **Specialisation against generality.** Constant folding and dead-code removal give the shortest instruction stream;
  one kernel for every program carries every operation's code and the register needs of the worst case.
- **Few pipelines against fast kernels.** A pipeline (a compiled kernel bound to its resource layout) cache stays
  small and warm when kernels are few; specialisation multiplies its entries by the number of structures seen.
- **Fixed slots against long chains.** A fixed-size parameter block and a bounded loop keep the interpreter simple;
  a chain longer than the slots is split and pays an extra pass.
- **One operation table against two languages.** Host and kernel are written in different languages; their
  operation codes must agree, and a disagreement shows only as wrong pixels.

## Solution

**Therefore: compile one kernel that interprets a program, so that every edit changes data and never code.** Encode
each pointwise operation as an operation code with a fixed number of parameter slots and an offset into a side buffer
for variable-sized data (matrices, curve knots), and give the kernel a bounded loop with one case per code; because
the program is the same for every pixel, every invocation takes the same branch. Lower each run of pointwise
operations into such programs, and start a new pass only where an operation reads neighbours or several images, where
the program's slots or resource bindings run out, or where a value must be kept. Key compiled pipelines by everything
that decides the machine code (source text, entry point, constants, layout), compile them asynchronously before first
use, and generate the operation table for both languages from one declaration. Specialise only where a measurement
shows that the interpreter costs more than the bandwidth it saves.

## Applicability

Use it when:

- chains are composed by people or by data and change at interactive rates;
- most operations are bandwidth-bound (few arithmetic operations per byte moved);
- the set of operations is bounded and stable (tens of codes, not an open language);
- the program is the same for every element of a dispatch.

Do not use it when:

- the chain is fixed when the program is built; compile it ahead of time;
- the operations are compute-bound and gain from specialisation (unrolled loops over constants, folded matrices);
- users write their own per-pixel code; you then need a compiler, perhaps with an interpreter as its first tier;
- the operations to apply differ from element to element (per-element programs make invocations diverge).

## Structure

| Participant | Responsibility |
| --- | --- |
| **Operation table** | one declaration per code: parameter layout, side data, kernel case, reference function |
| **Lowerer** | turns a run of pointwise graph nodes into programs; cuts at slot, binding and span limits |
| **Program** | op codes, two four-value parameter slots per op, side-data offsets, in a fixed-size block |
| **Side buffer** | variable-sized data (matrices, knots, bands), addressed by each op's offset |
| **Interpreter kernel** | one compiled kernel: load a pixel, run the program, store the pixel |
| **Pipeline cache** | compiled pipelines keyed by what decides their code; compiles asynchronously, prewarms |
| **Reference engine** | evaluates the same nodes one by one in 64-bit, for parity |

In a vectorised database engine the same roles are the function catalogue, the expression planner, the expression
bytecode, the column vectors, the primitive loop over a vector, the query-plan cache and a row-at-a-time evaluator.

## Collaborations

1. When the engine starts, the pipeline cache compiles the interpreter and the few barrier kernels asynchronously.
2. For each evaluation the planner ([Barrier-Cut Fusion](../07-barrier-cut-fusion.md)) yields runs of pointwise
   nodes between materialised images.
3. The lowerer turns each node into one operation (a fused blend into a span of several), with parameters prepared
   on the host, and cuts a new program when slots or bindings run out.
4. For each program the engine packs the parameter block, writes the side data, binds the program's tables and
   dispatches the interpreter over the output grid; the next program reads the previous one's output.
5. The cache returns the same pipeline every time: an edit changes bytes in buffers only, and parity tests compare
   each code and each program with the reference engine.

## Sketch

```text
MAXOPS = 12                                      -- operations per program; a longer run becomes several programs

value Op: code, flags, p0, p1, offset, aux       -- p0, p1: four f32 each; offset: into the program's side data
value Program: ops, data, tables                 -- ops: at most MAXOPS; data: f32 list; tables: slot → table

-- one declaration; host packing, kernel constants and kernel case labels are all generated from it
OPS = declare([ EXPOSURE, MIXER(data: 9), CURVE(data: 3·aux), LUT3(table slot: lut), SAVE, MIX ])
INTERPRETER = kernel spec of interpret (text generated with OPS, entry point, layout)

-- helpers: opsFor(node) and tablesFor(node) read OPS; sideData(op) is op's variable data ([] if none);
-- pack(prog) writes ops and parameters into the fixed-size block; mat3, monotoneCubic, trilinear and blend
-- read side data or a table and are each one operation's mathematics, mirrored by the reference engine

lower(run) → programs:                           -- run: pointwise nodes in evaluation order
  programs ← [] ; cur ← Program(ops: [], data: [], tables: {})
  for node in run:
    span ← opsFor(node)                          -- one op; a fused blend is [SAVE] ++ top's ops ++ [MIX]
    need ← tablesFor(node)                       -- slot → table, e.g. { lut: L }
    if |span| > MAXOPS: return refuse(tooLong, node, hint: "materialise the blend's top")
    clash ← some slot s in need with s ∈ cur.tables and cur.tables[s] ≠ need[s]
    if |cur.ops| + |span| > MAXOPS or clash:
      programs ← programs ++ [cur] ; cur ← Program(ops: [], data: [], tables: {})
    for op in span:
      cur ← copy(cur, ops: cur.ops ++ [copy(op, offset: |cur.data|)], data: cur.data ++ sideData(op))
    cur ← copy(cur, tables: cur.tables ⊕ need)
  if |cur.ops| > 0: programs ← programs ++ [cur]
  return programs

kernel interpret(prog, data, tables, src, dst) over grid:
  v ← src[p] ; bk ← v                            -- p: this invocation's pixel; bk: a blend's backdrop register
  for i in 0 ..< |prog.ops|:                     -- the same count for every invocation
    op ← prog.ops[i]
    match op.code:                               -- uniform: every invocation takes the same case
      EXPOSURE → v.rgb ← v.rgb · op.p0.x + op.p0.y
      MIXER    → v.rgb ← mat3(data, op.offset) · v.rgb
      CURVE    → v.rgb ← monotoneCubic(data, op.offset, op.aux, v.rgb)
      LUT3     → v.rgb ← trilinear(tables.lut, v.rgb)
      SAVE     → bk ← v
      MIX      → v ← blend(op.flags, bk, v, op.p0.x)
      _        → v ← (NaN, NaN, NaN, NaN)        -- an unknown code poisons the pixel; parity fails loudly
  dst[p] ← v

hashes ← {} ; cache ← {}                         -- text → hash; key → promise of a compiled pipeline

pipelineKey(k) → hash(canonical({ text: memoHash(k.text), entry: k.entry, constants: k.constants,
                                   layout: k.layout }))
memoHash(text) → hashes[text] if text ∈ hashes else (hashes[text] ← hash(text))   -- text hashed once

cache.get(k):
  key ← pipelineKey(k)
  if key ∉ cache:
    cache[key] ← compileAsync(k)                 -- a promise: concurrent callers share one compile
    onFailure(cache[key], () → remove(cache, key))
  return cache[key]

run(programs, src, grid) → image:
  if programs = []: return src
  pipe ← await cache.get(INTERPRETER)
  input ← src ; temps ← []
  for prog in programs:
    out ← allocate(grid)
    dispatch(pipe, grid, { prog: pack(prog), data: prog.data, tables: prog.tables, src: input, dst: out })
    if input ≠ src: temps ← temps ++ [input]
    input ← out
  fence ← submit(batch)                          -- batch: the dispatches recorded above, one submission
  for t in temps: retire(t, after: fence)        -- Chapter 8: free only after the device is done
  return input

-- in use: a drag on the exposure slider changes programs[0].ops[0].p0 and nothing else
programs ← lower([exposure(+0.5 stop), curve(S), mix(top: [hsl(bands)], amount: 0.8)])
shown ← run(programs, source, screenGrid)        -- same pipeline as the previous frame: no compile
```

## Implementation notes

1. **A uniform switch does not diverge; measure what remains.** GPUs run invocations (one per pixel) in groups that
   share an instruction stream; a branch costs extra only when lanes of a group disagree (divergence). The
   interpreter's branch depends on the program alone, so all lanes agree. What remains is a few scalar instructions
   per operation per pixel, registers allocated for the costliest case, and no folding across operations. On the
   M1 Max, chromobench compiled unused digital operations and blend modes out with override constants: nothing
   changed measurably. Six unmasked digital layers added about 1 ms to a preview and 15–20 ms to a full-size export;
   one masked layer added 30 ms and 120 ms (three materialised textures and a combine pass). The barriers cost; the
   interpreter did not.
2. **A cache cannot rescue baked constants.** A pipeline cache keyed by source text is useless when values are in
   the text: each slider position is a new key, the hit rate during a drag is zero, and the cache grows with the
   user's history. Moving values into a block makes the cache work; making the program data makes it hold one entry.
   chromobench's block (twelve op slots, twenty-four parameter slots, the chain's matrices) is about 0.9 KiB, far
   below WebGPU's 64 KiB default for a uniform buffer (a small read-only parameter block). Curves, hue bands and
   mixer matrices travel beside it in a storage buffer (a larger read-only array), each at an offset its operation
   names, so the block's layout never changes.
3. **Cut where bindings run out, not only where neighbours are read.** chromobench's lowerer starts a new program when
   twelve operations are used, when two operations need different tables in the same binding slot (one dye-solve
   table, one printing-density table and one print table per dispatch), or when a second display transform arrives.
   Each cut costs an intermediate written and read: 342 MB at full size, about 0.9 ms at 400 GB/s. Report cuts and
   their reasons with the plan, so an engineer sees why a chain took three passes instead of one.
4. **A register turns a diamond into a line.** A blend reads two images and looks like a barrier. When its top is a
   short pointwise chain applied to its own backdrop, both inputs are functions of the same pixel. chromobench fuses
   such a blend with two codes: `SAVE` copies the pixel into a backdrop register, the top's operations run, and `MIX`
   blends the register with the result. The register lives only within one dispatch, so the lowerer keeps the span
   whole, and the planner makes a blend whose top exceeds ten operations a barrier instead. All 32 unmasked blends
   in its parity suite fused.
5. **Generate the operation table for both languages; this is chromobench's open debt (task P10-8).** Its operation
   codes are written three times: in the host table, as named constants in the kernel that nothing uses, and as bare
   case labels such as `case 19u`. The program length, 12, appears in the host, in a kernel constant and as the
   length of the kernel's operation array. The default case does nothing, so a code the kernel lacks is silently
   the identity. The kernel linker already generates colour matrices from the host's numbers ("one definition for
   both engines"); generate the codes too, and make the default case write NaN.
6. **Key pipelines by what decides the machine code, and make the key cheap.** chromobench hashes the source text,
   entry point, override constants and layout. The linked interpreter is about 30 kB of WGSL (the WebGPU shading
   language), and every program and combine pass hashed it to find its pipeline. When the kernels grew by a third, a
   tiled export became 3–6 % slower; memoising the hash by the string fixed it. The lookup is on the hot path.
7. **Compile before the gesture, and know what it cost.** Pipelines compile asynchronously; concurrent requests
   share one compile, and a failed compile leaves the cache so that a retry can succeed. The engine prewarms the
   interpreter, the reductions and the combine kernel at creation. The debt: compile times are recorded and never
   read, so nobody knows what the prewarm saves ([Chapter 10](10-measure-completion-gate-percentiles.md)).
8. **The interpreter reserves for its costliest case.** chromobench's kernel declares 3.5 KiB of workgroup memory
   (on-chip memory shared by one group of invocations) to stage spectra for the exact export solve. Every dispatch
   reserves it, even for an exposure and a curve. Where workgroup memory limits how many groups run at once, this
   lowers occupancy (resident groups that hide memory latency). It is unmeasured; if it shows, one override constant
   pays here: two pipelines, not one per structure.
9. **Test per code, then per program.** A program of one operation compared with the reference isolates that code's
   error; random programs catch interactions, such as an operation that leaves the backdrop register stale.
   chromobench compares every code and encoding with its 64-bit reference (within 5.8 × 10⁻⁶ on Metal) and six
   fixed stacks of layers; it does not generate random programs.

## Variations

- **A generated kernel per structure.** Compile once per sequence of operation kinds, values in a block: the fastest
  steady state, a compile per new structure. Right for machine-learning graphs, compiled once and run millions of
  times.
- **Interpret now, specialise in the background.** Serve every frame from the interpreter while a kernel specialised
  to the current structure compiles off the critical path, then switch to it. Best of both, at the price of two
  implementations that must agree; Dolphin's hybrid ubershaders and tiered just-in-time compilers work this way.
- **Specialisation by a few switches.** Override constants (values fixed when a pipeline is created) remove whole
  families of operations a program does not use. Pipelines number 2ᵏ for k switches; in the running example two
  switches gained nothing measurable (note 1).
- **A stage list on the CPU.** The same program, interpreted by function pointers over SIMD batches of pixels, so
  that dispatch is paid once per batch rather than per pixel; nothing is compiled at run time.

## Consequences

- \+ A slider drag compiles nothing, and neither does adding, removing or reordering an operation.
- \+ One pipeline serves every program: a small cache, one prewarm, no first-use stall.
- \+ Each code is a small case with a reference twin, testable in isolation.
- \+ A run of pointwise steps costs one pass; every extra pass has a named reason.
- − The kernel carries the worst case: registers, workgroup memory, instruction footprint, no cross-step folding.
- − The operation table exists in two languages unless it is generated, and an unknown code is silent unless poisoned.
- − Fixed slots split long chains, and each split costs an intermediate image.
- − Programs that would differ per element diverge; the pattern needs one program per dispatch.

## Known uses

- **chromobench** interprets programs of up to twelve operations from 30 codes in one compute kernel; one pipeline
  serves every chain. **Editor lab**'s GPU probe compiled a shader per parameter change (79 ms).
- **Skia's SkRasterPipeline** builds, per draw, a list of stages (load, convert, blend, store) that fixed SIMD routines
  execute over runs of pixels: an interpreted program of pointwise steps on the CPU.
- **Dolphin**, the GameCube and Wii emulator, described in a 2017 post on its blog ("Ubershaders: A Ridiculous Solution
  to an Impossible Problem") how it interprets the console's pixel pipeline configuration in one large shader to
  remove compile stutter, while specialised shaders compile in the background.
- **Halide** (Ragan-Kelley et al., PLDI 2013) makes fusion a scheduling choice: an inlined stage is fused, a
  `compute_root` stage is materialised.
- **XLA** and **TVM** (Chen et al., OSDI 2018) fuse element-wise operators of machine-learning graphs into single
  generated kernels; TVM classifies operators as injective, reduction, complex-out-fusable or opaque, close to this
  chapter's pointwise-or-barrier rule.
- **Vulkan** (`VkPipelineCache`, specialisation constants) and **WebGPU** (asynchronous pipeline creation, override
  constants) provide the cache and the switches; **Unity**'s shader variants show the cost of compiling per
  combination.
- **Vectorised and compiled query engines**: MonetDB/X100 interprets primitives over vectors (Boncz, Zukowski and Nes,
  CIDR 2005), HyPer compiles each query (Neumann, VLDB 2011), and Kersten et al. compare the two (PVLDB 2018).
- The **Roofline model** (Williams, Waterman and Patterson, *CACM* 2009): below the ridge point, time is bytes over
  bandwidth.

## Related chapters

- [Barrier-Cut Fusion](../07-barrier-cut-fusion.md) plans where passes break; this chapter is about the kernel
  between the breaks and its cost.
- [Chapter 4 · Wide Kernels at Constant Cost](04-wide-kernels-at-constant-cost.md) supplies the barriers that end
  a program.
- [Chapter 2 · Precision Ladder](02-precision-ladder.md): parameters are prepared on the host in 64-bit and applied
  in 32-bit.
- [Chapter 6 · Cross the Bus Rarely](06-cross-the-bus-rarely.md) decides what leaves the last pass.
- [Chapter 8 · Retire After the Fence](08-retire-after-the-fence.md) frees the intermediates between programs.
- [Chapter 10 · Measure Completion, Gate Percentiles](10-measure-completion-gate-percentiles.md) times compiles and
  passes.
- [One Declaration, Many Readers](../modular/02-one-declaration-many-readers.md) generates the operation table;
  [Solve Once, Apply Many](../modular/05-solve-once-apply-many.md) names the binding times.
- GoF: **Interpreter** (the kernel), **Command** (an operation as a record), **Flyweight** (one compiled kernel
  shared by every program).

## Exercises

1. **Implement and measure (CPU model).** On a laptop, write three versions of a chain of k pointwise operations
   over a 4,000 × 2,674 × 4 array of 32-bit floats: one pass per operation, an interpreter looping over a program
   per pixel, and a hand-fused loop. Time k = 1 … 12, measure bandwidth with a copy loop, and plot all three against
   a roofline. Then let the interpreter run each operation over a whole row before the next, and explain the change.
2. **Analyse a cost model.** For P pixels of B bytes, k operations of f flops each, bandwidth β, peak arithmetic F,
   program length m and interpreter overhead c flops per operation per pixel, write the time of one pass per
   operation, of ⌈k/m⌉ interpreted passes and of one specialised pass. Add a compile time C for the specialised
   kernel and find the number of evaluations N after which it pays. Evaluate with C = 79 ms, β = 400 GB/s,
   F = 10 TFLOP/s, B = 16, f = 12, c = 4, P = 10.7 × 10⁶: is a drag of sixty evaluations enough?
3. **Another domain.** Interpret arithmetic expressions over columns of 10⁸ rows, per row and per vector of 1,024
   rows, and compare both with generated code. Relate your numbers to Kersten et al. (PVLDB 2018).
4. **Read a system.** Read Dolphin's 2017 ubershader post. Which forces did the hybrid resolve, which did it create,
   and what would you test to show that its two implementations agree?
