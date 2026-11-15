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

The running example, chromobench, prints a photograph through a numerical film and paper model of about thirty
operations, most of them pointwise: each output pixel depends only on the same input pixel (the film's density, the
dyes that formed it, the light reaching the paper, the encoding for the screen). Above the print sit up to a dozen
digital layers (exposure, curves, hue bands, a channel mixer). A 4,000 × 2,674 image stored as `rgba32float` (four
32-bit floats per pixel) is 163 MiB, so a pass that reads one image and writes another moves 326 MiB. Three ways of
running such a chain on the GPU fail.

1. **One kernel per operation.** A kernel is the function the GPU runs once per pixel. An exposure change reads 16
   bytes, writes 16 and does about a dozen arithmetic operations, under half an operation per byte. Twelve such
   steps as twelve passes move 3.8 GiB; at the nominal 400 GB/s of an M1 Max (Apple's laptop chip) that is 10 ms of
   memory traffic, against under 1 ms for one pass doing all twelve.
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

**Therefore: compile one kernel that interprets a program, so that every edit changes data and never code.** Each
pointwise operation is an operation code with fixed parameter slots and an offset into a side buffer for variable-sized
data (matrices, curve knots); the kernel loops over a bounded program with one case per code. The program is the same
for every element, so every invocation takes the same branch and nothing diverges. A run of pointwise operations
becomes one program; a new pass starts only where an operation reads neighbours or several images, or where the
program's slots or resource bindings run out. Specialise a kernel only where the cost model and a measurement show
that the interpreter costs more than the compiles it avoids.

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
4. For each program the engine uploads the parameter block and side data and dispatches (launches) the interpreter
   over the output grid; the next program reads the previous one's output. An edit changes bytes in buffers only.

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
    out ← allocate(grid) ; u ← upload(pack(prog)) ; d ← upload(prog.data)
    dispatch(pipe, grid, { prog: u, data: d, tables: prog.tables, src: input, dst: out })
    temps ← temps ++ [u, d] ++ ([input] if input ≠ src else [])
    input ← out
  fence ← submit(batch)                          -- batch: the dispatches recorded above, one submission
  for t in temps: retire(t, after: fence)        -- Chapter 8: free only after the device is done
  return input

-- in use: a drag on the exposure slider changes programs[0].ops[0].p0 and nothing else
programs ← lower([exposure(+0.5 stop), curve(S), mix(top: [hsl(bands)], amount: 0.8)])
shown ← run(programs, source, screenGrid)        -- same pipeline as the previous frame: no compile
```

## Implementation notes

1. **A uniform switch does not diverge; measure what remains.** GPUs run invocations (one per pixel) in SIMD groups,
   lanes that execute one instruction stream together; a branch costs extra only when lanes disagree (divergence).
   Every lane reads the same op code from the same uniform buffer (a small read-only parameter block), so the
   condition is dynamically uniform and all lanes take the same case. What remains is a few instructions per
   operation per pixel, registers allocated for the costliest case, and no folding across operations. On the M1 Max,
   chromobench compiled unused digital operations and blend modes out with override constants (values fixed when a
   pipeline is created): nothing changed measurably. Six unmasked digital layers added about 1 ms to a preview and
   15–20 ms to a full-size export; one masked layer added 30 ms and 120 ms (three materialised, that is fully stored,
   textures and a combine pass). The barriers cost; the interpreter did not. In CUDA the program would sit in
   constant memory, which broadcasts a value read by every thread of a warp in one access.
2. **A cost model says when to fuse and when to specialise.** Per pixel and fused step, fusion saves an intermediate
   write and read, 2B bytes (32 for `rgba32float`), worth 2B/β at bandwidth β; the interpreter spends c instructions
   (load the op, branch, loop), worth c/F at a per-lane instruction rate F. Fusion pays while c < 2B·F/β. With
   β = 400 GB/s and F ≈ 5 × 10¹² per second (nominal figures for the M1 Max), the right side is about 400, far above
   the ten or so instructions of a switch. A specialised kernel removes c and folds across steps, saving about
   P·k·c/F per evaluation: 0.25 ms for k = 12 steps of c = 10 over P = 10.7 million pixels. A compile of C then pays
   after C·F/(P·k·c) evaluations of one structure, about 300 at C = 79 ms; a drag never gets there, an inference
   graph run a million times does. Specialisation also wins above the roofline's ridge (F/β operations per byte),
   where arithmetic, not memory, bounds the kernel, or when the worst case's registers cut occupancy: measure both.
3. **A cache cannot rescue baked constants.** A pipeline cache keyed by source text is useless when values are in
   the text: each slider position is a new key, and the hit rate during a drag is zero. Making the program data
   leaves one entry. chromobench's block (twelve op slots, twenty-four parameter slots, the chain's matrices) is
   about 0.9 KiB, far below WebGPU's 64 KiB default for a uniform buffer; curves
   and matrices go beside it in a storage buffer (a larger read-only array), so the block's layout never changes.
4. **Cut where bindings run out, not only where neighbours are read.** chromobench's lowerer starts a new program when
   twelve operations are used, when two operations need different tables of the film model in the same binding slot
   (three slots per dispatch), or when a second display transform arrives. Each cut costs an intermediate written
   and read: 326 MiB at full size, about 0.9 ms at 400 GB/s. Report cuts and their reasons with the plan.
5. **A register turns a diamond into a line.** A blend reads two images, a top and a backdrop (the image beneath),
   and looks like a barrier. When its top is a short pointwise chain applied to its own backdrop, both inputs are
   functions of the same pixel. chromobench fuses
   such a blend with two codes: `SAVE` copies the pixel into a backdrop register, the top's operations run, and `MIX`
   blends the register with the result. The register lives only within one dispatch, so the lowerer keeps the span
   whole, and the planner makes a blend whose top exceeds ten operations a barrier instead. All 32 unmasked blends
   in its parity suite (comparisons with the 64-bit reference engine) fused.
6. **Generate the operation table for both languages; this is chromobench's open debt.** Its operation codes are
   written three times: in the host table, as unused named constants in the kernel, and as bare case labels such as
   `case 19u`; the program length, 12, three times too. The default case does nothing, so a code the kernel lacks is
   silently the identity. The kernel linker already generates colour matrices from the host's numbers; generate the
   codes too, and make the default case write NaN.
7. **Key pipelines by what decides the machine code, and make the key cheap.** chromobench hashes the source text,
   entry point, override constants and layout. The linked interpreter is about 30 KiB of WGSL (the WebGPU shading
   language), and every program and combine pass hashed it to find its pipeline. When the kernels grew by a third, a
   tiled export became 3–6 % slower; memoising the hash by the string fixed it. The lookup is on the hot path.
8. **Compile before the gesture, and know what it cost.** Pipelines compile asynchronously; concurrent requests
   share one compile, and a failed compile leaves the cache so that a retry can succeed. The engine prewarms the
   interpreter, the reductions and the combine kernel at creation. The debt: compile times are recorded and never
   read, so nobody knows what the prewarm saves ([Chapter 10](10-measure-completion-gate-percentiles.md)).
9. **The interpreter reserves for its costliest case.** chromobench's kernel declares 3.5 KiB of workgroup memory
   (on-chip memory shared by one group of invocations; WebGPU guarantees 16 KiB) to stage spectra for the exact
   export solve. Every dispatch reserves it, even for an exposure and a curve. Where workgroup memory limits how many
   groups run at once, this lowers occupancy (resident groups that hide memory latency). It is unmeasured; if it
   shows, one override constant pays here: two pipelines, not one per structure.
10. **Test per code, then per program.** A program of one operation compared with the reference isolates that
    code's error; random programs catch interactions, such as an operation that leaves the backdrop register stale.
    chromobench compares every code with its 64-bit reference (within 5.8 × 10⁻⁶ on Metal, Apple's GPU interface)
    and six fixed stacks of layers; it does not generate random programs.

## Variations

- **A generated kernel per structure.** Compile once per sequence of operation kinds, values in a block: the fastest
  steady state, a compile per new structure. Right past note 2's break-even (graphs run millions of times).
- **Interpret now, specialise in the background.** Serve frames from the interpreter while a specialised kernel
  compiles off the critical path, then switch. Best of both, at the price of two implementations that must agree;
  Dolphin's hybrid ubershaders and tiered just-in-time compilers work this way.
- **Specialisation by a few switches.** Override constants (WebGPU) or specialisation constants (Vulkan) remove whole
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
- **Dolphin**, the GameCube and Wii emulator, described in a 2017 blog post ("Ubershaders: A Ridiculous Solution to
  an Impossible Problem") how one large shader interprets the console's pixel pipeline configuration, removing
  compile stutter while specialised shaders compile in the background.
- **Halide** (Ragan-Kelley et al., PLDI 2013) makes fusion a scheduling choice: an inlined stage is fused, a
  `compute_root` stage is materialised.
- **XLA** and **TVM** (Chen et al., OSDI 2018) fuse element-wise operators into generated kernels; TVM's operator
  classes (injective, reduction, complex-out-fusable, opaque) resemble the pointwise-or-barrier rule.
- **Vulkan** (`VkPipelineCache`, specialisation constants) and **WebGPU** (asynchronous pipeline creation, override
  constants) provide the cache and the switches; **Unity**'s shader variants show the cost of compiling per
  combination.
- **Vectorised and compiled query engines**: MonetDB/X100 interprets primitives over vectors (Boncz, Zukowski and Nes,
  CIDR 2005), HyPer compiles each query (Neumann, VLDB 2011), and Kersten et al. compare the two (PVLDB 2018).
- The **Roofline model** (Williams, Waterman and Patterson, *CACM* 2009) underlies note 2.

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
2. **Analyse a cost model.** Extend note 2's model to whole evaluations: k operations of f instructions each, program
   length m (so ⌈k/m⌉ passes), and a specialised kernel compiled once per structure in time C. Then add occupancy:
   suppose the interpreter's worst-case registers lower its achieved bandwidth to αβ. For a drag of sixty
   evaluations with C = 79 ms, P = 10.7 × 10⁶, B = 16, β = 400 GB/s and F = 5 × 10¹² per second, find the α below
   which the specialised kernel wins, and say how you would measure α.
3. **Another domain.** Interpret arithmetic expressions over columns of 10⁸ rows, per row and per vector of 1,024
   rows, and compare both with generated code. Relate your numbers to Kersten et al. (PVLDB 2018).
4. **Read a system.** Read Dolphin's 2017 ubershader post. Which forces did the hybrid resolve, which did it create,
   and what would you test to show that its two implementations agree?
