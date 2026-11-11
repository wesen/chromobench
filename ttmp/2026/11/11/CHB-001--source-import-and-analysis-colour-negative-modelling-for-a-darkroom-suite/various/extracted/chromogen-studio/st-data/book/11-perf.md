# Making it fast

The Studio's physics is expensive. One pixel, done honestly, needs a bounded least-squares solve that evaluates an 81-wavelength spectrum several times, then a spectral integral for the paper and another for the print's colour: hundreds of exponentials. A 2048-pixel frame has 2.8 million pixels, and a slider should redraw it in a few hundredths of a second. This chapter shows how the Studio closes that gap, and how to close it for image algorithms of this kind in general.

There are four tools:

- **Staging:** compute once what does not change per pixel.
- **The GPU's fragment shaders:** run the per-pixel and per-neighbourhood work.
- **Workers and WebGPU compute:** run the remaining precomputation on every core.
- **A better algorithm:** remove work before making it faster.

Every speed-up in the chapter was checked against the slower version it replaced, and the numbers are given. After it you should be able to look at an image algorithm, find where its time goes, and choose among these tools.

The measurements were made on the machine that built the Studio: two CPU cores and no GPU, so WebGL and WebGPU ran on SwiftShader, Chromium's software renderer. Times on the CPU are real. GPU times from a software renderer show which passes cost more than others, but not how fast a GPU is. The **Compute** section of the Print panel measures your own machine.

> **Try it.** [Run the benchmark](st:bench) on the sample. It builds the three tables on every backend your browser offers, times them, and compares each with the main thread.

## Where the time goes

The Studio does three kinds of work, at three frequencies.

| Work | When | Size | Cost here |
|---|---|---|---|
| the 3-D tables (dye solve, printing density, print) | the film, scanner, paper or Fade changes | 35,937 nodes each | 0.33 s, 53 ms, 56 ms on one core |
| the global pass and its statistics | the negative side changes | 640 px | a few ms of readback |
| the per-pixel chain | every redraw | up to 2048 px | the frame |

The first row is the expensive physics. The last row is what a slider pays. The rest of the chapter follows the work down this table.

**Measure before you change anything.** Every gain in this chapter came from a measurement that pointed somewhere unexpected. The fixed-length blur loop took 83 % of a frame, and nine tenths of the dye solve's iterations went into a quarter of its nodes, which the Studio flags as unreachable anyway. Guessing would have found neither.

**Measure the right thing.** A browser's GPU runs asynchronously: a draw call returns as soon as it is queued. WebGL's `gl.finish()` is meant to wait for the GPU, but in Chromium, as measured here, it returned at once: timing passes with it reported 2 ms for a frame that took 4.6 s. The Studio's render time used it, and so measured only how long it took to ask. The only reliable wait is to read something back, since a read is ordered after every queued draw. The Studio now reads one texel of the output after each frame. That costs one stall per frame and makes the number true.

## Staging: compute once what does not change

**Staging** moves work from where it repeats to where it does not. A slider changes printer lights, not the film's dyes, so the dye solve need not run again. The question for every stage is what its result depends on.

| Stage | Depends on | Computed |
|---|---|---|
| scanner density $\mathbf D$ | the scan, the rebate | per pixel, per frame |
| dye amounts $\mathbf c(\mathbf a)$ | scanner and film | once, as a 33³ table |
| printing density $PD(\mathbf c)$ | film and paper | once, as a 33³ table |
| paper exposure, curves | printer lights, paper | per pixel, per frame: cheap |
| print XYZ $(c_p)$ | paper, viewing light, Fade | once, as a 33³ table |

The tables turn a spectral computation into a texture fetch. Solving per pixel at the working size of the sample (1090 × 754) would be 822,000 solves per frame. The table holds 35,937, about 23 times fewer, and they are solved once per film and scanner rather than once per frame.

**Hardware interpolation.** A 3-D texture with linear filtering returns the trilinear blend of the eight surrounding nodes in one fetch. To read a table of $N$ nodes spanning $[\ell, h]$ at value $v$, the coordinate must land on texel centres:

$$
u = \frac{v - \ell}{h - \ell}\cdot\frac{N - 1}{N} + \frac{1}{2N} .
$$

Without the half-texel terms, the end nodes sit at texel edges: the first and last half-cells read wrongly and the whole table is stretched by $N/(N-1)$. The Studio's `lut3` writes the same thing as `(u * 32.0 + 0.5) / 33.0`.

**Table size and keying.** Interpolation error falls with the square of the node spacing for smooth functions, and memory grows with the cube of $N$. At $N = 33$ each table is 35,937 × 4 floats, 575 KB. The cheaper gain was in the key: keying the solve on the analytical estimate $\mathbf a = K^{-1}\mathbf D$ instead of on $\mathbf D$ straightens the function the table holds and cut its interpolation error about threefold (§9.7). Choose the key so the tabulated function is close to linear before choosing the size.

**Float formats.** Linear filtering of 32-bit float textures needs the extension `OES_texture_float_linear`. Without it the Studio stores 16-bit floats, which have an 11-bit significand. Near 2.0 they step by 0.002, so densities and dye amounts are stored to about 0.001. That is below what a print shows, and ten times below the 0.01 D at which the solve's residual flags a pixel.

**Fold constants.** Anything that does not depend on the pixel belongs outside the shader:

- the OKLab matrices and their inverses are written into the shader as constants;
- the print table folds in the observer weights, the normalisation to white and the Bradford adaptation to D65, which is linear once the two whites are fixed;
- the blur weights are computed on the CPU once per pass (below).

**One-dimensional tables for one-dimensional functions.** The film's and paper's curves are 512-entry 1-D tables. A per-channel function never needs a 3-D table, and 512 entries interpolate a characteristic curve far below visible error.

## The GPU as an image processor

WebGL2 is a drawing API, and the Studio uses it as a programmable image processor. Each **pass** draws one triangle covering the output. The GPU runs a **fragment shader** once per output pixel, and the result goes to a texture instead of the screen. The next pass reads that texture. Rendering to float textures needs `EXT_color_buffer_float`, which the Studio requires.

The pass graph for one frame:

- **global pass, 640 px:** dyes (and film exposure for halation), printing density, guided-filter coefficients, halation and bloom blurs, statistics;
- **working size:** dyes, printing density, print, output.

**Gather, not scatter.** A fragment shader writes exactly one pixel, its own, and can read any texel. Algorithms that gather (blurs, lookups, per-pixel maths) map directly. Algorithms that scatter (histograms, sums, sorting) do not. The Studio builds its print-window histogram on the CPU from a small read-back. The alternatives on the GPU are to draw one point per pixel with additive blending, or to reduce by halving the image repeatedly.

**Where to cut passes.** Every pass writes its result to memory and the next reads it back. At 2048 × 1365 a 32-bit RGBA target is 45 MB, so the four per-pixel passes move a few hundred megabytes per frame. A GPU with a few hundred GB/s of bandwidth does that in a few milliseconds (an estimate from the sizes, not a measurement). Fusing passes saves that traffic, so cut a pass only where something needs neighbours. The Studio cuts after the dyes, because grain reduction reads the neighbouring dye amounts. It cuts after the printing density, because Texture reads its neighbours. It cuts after the print, because sharpening reads the neighbouring print. Everything between is fused.

**Arithmetic.** Fragment shaders in WebGL2 have 32-bit `highp` floats. A few habits help:

- `exp2` and `log2` are native, so $10^x$ is written `exp2(3.3219 * x)` and $\log_{10}$ as `log2(x) * 0.30103`. `pow(x, y)` is `exp2(y * log2(x))` underneath, and undefined for $x < 0$.
- Prefer `mix`, `step`, `clamp` and `smoothstep` to `if`. Neighbouring pixels run in lockstep, typically 32 or 64 at a time. A branch that goes different ways within such a group runs both sides. A branch on a uniform, which every pixel takes the same way, costs nothing: the Studio's views and its optional operators are uniform branches.
- Loops should run to the bound they need (below).

## Spatial operators

A per-pixel operator costs one evaluation per pixel. A spatial operator costs one per pixel per tap, so its radius decides its price.

**Separable kernels.** A 2-D Gaussian is the product of two 1-D Gaussians. A horizontal pass and then a vertical pass give the same result with $2(2R+1)$ taps per pixel instead of $(2R+1)^2$: for $R = 26$, 106 taps instead of 2,809. A box filter separates the same way. The Studio's blurs are all separable.

**Loop bounds.** The first version of the Studio's blur looped over a fixed range, $-96 \le i \le 96$, and skipped the taps outside the kernel's radius with `continue`. In outline:

```glsl
for (int i = -96; i <= 96; i++) {
  if (i < -R || i > R) continue;
  float fi = float(i);
  vec2 k = exp(-0.5 * fi * fi / (r * r));
  acc += vec4(k.xx, k.yy) * texture(t, uv + dir * fi); w += vec4(k.xx, k.yy);
}
```

That pattern dates from GLSL ES 1.0, which required constant loop bounds. A skipped iteration still costs its loop overhead, and the weights were recomputed with an `exp` per tap per pixel. With every operator on, the blurs took 83 % of a frame in the software renderer. The version now in the Studio loops to the kernel's own radius, which GLSL ES 3.00 allows. It reads the taps at $+i$ and $-i$ together, since the kernel is symmetric, and takes its weights from a uniform array computed once on the CPU:

```glsl
uniform int R; uniform vec2 kw[97];
vec4 acc = texture(t, uv) * kw[0].xxyy;
for (int i = 1; i <= R; i++) {
  vec2 d = dir * float(i);
  acc += (texture(t, uv + d) + texture(t, uv - d)) * kw[i].xxyy;
}
```

The blurs became 3.3 times faster and the frame 2.3 times faster. No output pixel changed by more than one level in 255.

**Two kernels in one pass.** An RGBA texture has four channels. The Studio's guided filter needs box means at two radii, and its halation needs the red and green layers' exposures blurred at two widths. Each such pair runs in one pass, with the weights of one kernel applied to two channels and those of the other to the other two. The loop runs to the larger radius, and each fetch serves both kernels.

**Lower resolution for wide kernels.** The cost of a blur is pixels × taps, and both scale with resolution. Halve the resolution and a kernel of the same physical width costs an eighth.

- **The global pass.** All the large-radius work runs at 640 px on the long side, not at the working size. The radii are fractions of the frame, so the results agree at any size.
- **Bloom.** The glow is the widest kernel ($\sigma$ = 3.5 % of the long side, 22 px at 640). It is now thresholded at 640 px and blurred at 320 px. A texel of the half-size target has its centre exactly between four texels of the full-size one, so its single filtered fetch averages them. The downsample needs no pass of its own. The bloom blur's cost fell from about 550 ms to 62 ms in the software renderer. With bloom at 30 % the print changed by 0.02 levels on average and by at most 6 levels in 255.

**Linear-sampling pairs.** Two adjacent taps $i$ and $i+1$ with weights $w_i$ and $w_{i+1}$ can be read with one filtered fetch at offset

$$
i + \frac{w_{i+1}}{w_i + w_{i+1}}, \qquad\text{weight } w_i + w_{i+1},
$$

because linear filtering blends the two texels in exactly that ratio. That halves the fetches of a 1-D Gaussian. The Studio does not use it, because its packed passes carry two kernels whose pairs would need different offsets.

**Edge-aware smoothing.** The guided filter (Chapter 6) is a handful of box means and per-pixel arithmetic. Box means can be computed at a cost independent of the radius, with running sums along a row or a summed-area table. Fragment shaders cannot keep a running sum, so the Studio pays $O(R)$ per pass and keeps $R$ small by working at 640 px. The **fast guided filter** (He and Sun, 2015) is what makes that sound: the coefficients $a$ and $b$ vary slowly, so they can be computed at low resolution and applied to the full-resolution guide. The Studio computes them at 640 px and applies $aY + b$ per pixel at the working size, so edges keep the working resolution.

A bilateral filter cannot be split this way, because its weights depend on the centre pixel. Its cost is the full window. The Studio's grain reduction uses one only at 5 × 5 pixels, where the window is small.

**Area averages, precomputed.** Grain must look the same at every zoom: its variance falls with the area it is averaged over (Chapter 5). Averaging a noise field over the area a screen pixel covers would need a variable-size window per pixel. A mipmap holds those averages, precomputed at every power-of-two size. The Studio samples a 1024 × 1024 noise texture through its mipmap, and normalises each level by its measured standard deviation.

**Tiles and halos.** A full-size export can exceed what one texture holds. The Studio renders it in tiles of 1024 px. Each tile carries a border of 8 px, the **halo**, which must be at least the largest per-pixel kernel's radius: 1 px for sharpening, 2 for grain reduction and Texture. The wide fields (bases, halation, bloom) are not recomputed per tile. They come from the one global pass, and every tile reads them through its position in the whole frame (the `g2` uniform), so seams cannot appear. The test renders the frame in 256-px tiles and in one pass: no pixel differs by more than one level in 255.

## Moving data

Moving data between the CPU and the GPU is slow and, worse, it synchronises them.

- **Uploads.** The working image goes up once per change of source. The Studio converts it to 16-bit floats on the CPU first, which halves the upload to 6.6 MB for the sample. The 11-bit significand stores density to about 0.0002 D, far below the scan's own noise of 0.007 to 0.012 D (Chapter 10).
- **Read-backs.** `readPixels` waits for every queued draw, then copies. The Studio reads back the 640-px printing density and dyes, for the statistics and the base map. It does so only when the negative side changes, which a key over the negative-side settings detects. The histogram is then rebuilt on the CPU from that copy.
- **Asynchronous reads.** WebGL2 can avoid the stall: read into a pixel buffer object, insert a fence with `fenceSync`, and fetch the data with `getBufferSubData` once the fence has signalled, a frame or two later. The Studio does not need this, because its read-backs are rare. WebGPU's `mapAsync` is asynchronous by design.

**Memory.** The Studio keeps 19 render targets, about 100 MB for the sample. A 32-bit float RGBA texel is 16 bytes. Halving to 16-bit floats halves memory and bandwidth where the precision allows.

## GPU state is shared state

WebGL is a state machine: textures are bound to numbered units, and each sampler in a shader names a unit. Two bugs in the Studio came from that state, and both are worth knowing.

**The black export.** Adding the base map gave the output shader a new sampler. The export's output pass did not bind it. An unset sampler keeps its last unit, and creating the export's render target had bound that target's texture to the active unit, which was the same one. The shader was now reading the texture it was drawing into, a **feedback loop**. WebGL refuses such a draw, so the export came out black. The fix gives every sampler of a program a binding on every draw: the textures the pass names, and a 1-texel placeholder for the rest.

**The wrong first frame.** Creating that placeholder texture bound it to the active unit. That unit had just been given the film's curves, so the first draw that needed a placeholder read empty curves. In the test it was the first frame after Halation was turned on, and the frame's statistics, computed from those values, stayed wrong until the next change. A test that rendered the same settings twice and compared found it at once. The fix activates the placeholder's own unit before creating it.

The general lessons:

- Keep binding in one function that owns all units for every draw. Never rely on what an earlier pass left.
- Test the first call after a state change as well as the steady state: render twice and compare.
- **Cache keys need identity.** Two scans opened with the same settings had the same key for their working images, so switching between them could show the first image. A per-scan identifier in the key fixed it.

WebGPU removes the first class of bug: a pass declares all its resources in a bind group, and nothing carries over from the previous pass.

## Many cores: Web Workers

The three tables are built node by node, and no node depends on another. JavaScript runs one thread per page, but **Web Workers** add threads with their own memory, which talk to the page by messages.

**Shipping code.** The Studio's worker is a second bundle of the engine (39 KB), carried in the page as text and started from a `blob:` URL. Each worker receives the engine's data once (11 film and paper profiles, 159 KB), rebuilds the scanner, film and paper from their names with the same code as the page, and then answers requests of the form "nodes $q_0$ to $q_1$ of this table".

**Dynamic scheduling.** The nodes are not equally hard. Splitting the table into one contiguous part per worker would leave the worker with the hard region running alone at the end. The Studio cuts each table into ranges (512 nodes for the solve, 2048 for the others) and keeps one queue. A worker that finishes takes the next range. The short printing-density and print tables go to the front of the queue, so they are not left waiting behind a long solve.

**Transfer, do not copy.** Each result is a `Float32Array` whose buffer is *transferred* to the page, which moves ownership without copying.

**Determinism.** The workers run the same JavaScript on the same 64-bit floats as the page. Their tables are bitwise identical to the page's: the benchmark's difference column reads exactly zero.

**What it buys.** Here, with two cores, the dye solve fell from 0.33 s to 0.15 s, and the two print tables from about 55 ms to about 31 ms. Starting the workers costs a few hundred milliseconds once (each parses the bundle and the data), so the Studio starts them with the first table build and keeps them.

> **Try it.** [Use the workers](st:backend?b=workers) and watch the times in the Compute section, then [go back to Auto](st:backend?b=auto).

## Many more cores: WebGPU compute

A GPU has thousands of lanes, and **WebGPU** exposes them for general computation. A **compute shader**, written in WGSL, runs once per **invocation**. Invocations come in **workgroups** of a size the shader declares (the Studio uses 64), and a **dispatch** launches enough workgroups to cover the work. Unlike a fragment shader, a compute shader reads and writes arbitrary buffers, and the invocations of a workgroup share a small fast **workgroup memory** (16 KB is the guaranteed minimum).

The Studio has two kernels:

- **the solve:** one invocation per node, running the same bounded Levenberg–Marquardt solve as the CPU (below);
- **the spectral tables:** one invocation per node, summing $\sum_\lambda W_k T$ for printing density or the print's XYZ.

**Workgroup memory.** Every invocation loops over the same seven spectra: three scanner channels, three dyes and the base, 81 samples each. Each workgroup first copies them into workgroup memory, every invocation copying a share. Then it waits at a barrier, and then all of them read the fast copy:

```wgsl
for (var i = li; i < 7u * U.n; i += WG) { sh[i] = spec[i]; }
workgroupBarrier();
let q = gid.x;
if (q >= U.total) { return; }
```

The order matters. A barrier must be reached by every invocation of the workgroup, which WGSL checks as **uniform control flow**. So the invocations past the end of the table must not return before it.

**Single precision.** The CPU solves in 64-bit floats and the GPU in 32-bit ones, so two things change:

- **The residual has a floor.** The residual is $-\log_{10}$ of a sum of 81 terms, so its rounding error is near $10^{-7}$. A stopping test far below that never fires, so the GPU stops when the projected gradient falls below $10^{-6}$ rather than $10^{-9}$.
- **The answers differ, slightly.** Against the CPU table, the GPU's dye amounts differ by at most $2.2 \times 10^{-6}$ over the nodes the solve reaches, and no node changes sides of the 0.01 D threshold. The printing-density table differs by at most $7 \times 10^{-7}$ D. The print rendered from the GPU's tables is identical to the main thread's in every 8-bit pixel.

**Divergence.** An iterative solver runs a different number of iterations at each node. The invocations of a group run in lockstep, so each group takes as long as its slowest member. With the original solver, the iteration counts within a group of 64 consecutive nodes spread by 45 on average: almost every group held a node that converged in 2 iterations and one that ran to the cap of 50. The algorithmic change below cut that spread to between 1 and 4. It helps the GPU even more than the CPU, because a GPU pays for the spread as well as the total.

**Compile, dispatch, read.** The pipeline is compiled once per session (0.3 to 0.8 s in the software renderer, less on a GPU). One dispatch covers the table. The result is copied to a buffer that `mapAsync` maps for reading. A WGSL error is reported with its line, so a broken kernel falls back to the workers with a message instead of failing silently.

**Fallbacks.** WebGPU is in every major browser now, but not on every platform: at the time of writing Firefox ships it on Windows and Apple-silicon Macs, and Chrome on Linux only with some GPUs. A browser may also offer a **fallback adapter**, a software implementation that is usually slower than the workers. So *Auto* uses a hardware GPU if there is one, then the workers, then the main thread. Choosing *GPU* forces even a software adapter, which is how the tests check the kernels on a machine without a GPU.

**What it buys.** On this machine the only adapter is software, so its times (0.59 s for the solve) say nothing about a GPU. The arithmetic gives an estimate. The solve now averages about 2.5 iterations, each about three spectral loops of 81 samples and some 20 operations: roughly 0.4 billion operations per table. A GPU that sustains a few hundred billion operations a second needs about a millisecond for that, and dispatch and read-back add a few more. Run the benchmark to see your own number.

> **Try it.** [Force the GPU](st:backend?b=gpu), [run the benchmark](st:bench) again, and compare the dye-solve column. Then [go back to Auto](st:backend?b=auto).

## The algorithm first

The largest speed-up in this chapter came from changing the algorithm, and it came from counting the solver's work.

The dye solve is a bounded Levenberg–Marquardt fit: three dye amounts, each kept in $[0, 4]$ by clipping every step to the box. Counting iterations per node over the whole table, with the X-T5 profile and Gold 200, gave:

- a median of 2 iterations, but a mean of 13.9;
- 8,885 nodes, a quarter of the table, ending at the cap of 50 iterations;
- those nodes doing 89 % of all the iterations.

They are the nodes outside the film's gamut. Their best fit has a dye at zero, and the solve flags them unreachable anyway.

The cause is the clipping. A full Levenberg–Marquardt step treats all three dyes as free. When one dye sits at its bound and the gradient pushes it further out, the step's component for that dye is cut off, and the components for the other two are wrong too, since they were computed assuming the first would move. The fit creeps along the bound by a small amount each iteration until it reaches the cap.

The fix is the **projected Newton step** (Bertsekas, 1982). Let $\mathbf g = J^\top \mathbf r$ be the gradient. A dye $j$ is **held** if it sits at a bound and $\mathbf g$ points out of the box:

$$
\text{held}_j \iff (c_j = 0 \text{ and } g_j > 0) \text{ or } (c_j = 4 \text{ and } g_j < 0) .
$$

The step is then solved for the free dyes alone. In the 3 × 3 system, a held dye's row and column are replaced by the identity and its gradient by zero, which leaves it where it is. The fit stops when the gradient of the free dyes falls below a tolerance. The change is a few lines in the solver and the same few in the WGSL kernel.

| Scanner, film | Before | After | Mean iterations | Δc, reachable nodes | Residual |
|---|---|---|---|---|---|
| X-T5 LEDs, Gold 200 | 1.62 s | 0.33 s | 13.9 → 2.3 | $2.7 \times 10^{-6}$ | better at 7,188 nodes, never worse |
| book's LEDs, Portra 400 | 1.83 s | 0.28 s | 13.9 → 2.2 | 0 | better at 2,478 nodes, never worse |
| Status M, Portra 400 | 1.70 s | 0.32 s | 14.1 → 2.5 | 0 | better at 4,578 nodes, never worse |
| white LED, Portra 400 | 2.89 s | 0.59 s | 23.2 → 5.1 | up to 0.15 | better at 8,163 nodes, worse at 1 |

The white-LED case is the hard one, because broadband channels make the fit ill-conditioned. There, 124 reachable nodes moved by more than 0.01 in dye amount. Every one of them had stopped at the 50-iteration cap, and every one now reaches a lower residual. The 27 nodes that the old solver left between 0.0100 and 0.0127 D now fall below 0.01. The new solver is faster and better, so the Studio uses it.

A cheaper shortcut failed. Stopping when an iteration improves the fit by less than 0.1 % made the narrowband cases more than five times faster, changed no reachable node by more than $2.3 \times 10^{-5}$ and flipped none. But in the white-LED case, where progress is slow even far from the answer, it stopped reachable nodes early, moved them by up to 0.66 and flipped 34 across the threshold. A stopping rule tuned on easy cases can quietly damage hard ones, which is why every change here was compared node by node with the slow version.

The solver also had two older economies that any iterative per-pixel solver can use:

- **One spectral pass gives everything.** The residual and the closed-form Jacobian come from the same loop over the 81 samples (§9.3), and the loop allocates nothing.
- **A warm start.** The solve starts from the analytical estimate, and in the table that estimate is the node's own key, so the start costs nothing.

## Measuring honestly

- Time CPU work with `performance.now()` around it.
- Time GPU work by forcing a read-back after it, not with `gl.finish()`. Where the browser allows it, GPU timer queries (`EXT_disjoint_timer_query_webgl2`, WebGPU's optional `timestamp-query`) time a pass without stalling, but they are often unavailable.
- Do not trust a software renderer's absolute times. Its ratios show which pass is heavy, as the blur's 83 % did here, but a GPU's balance of arithmetic and memory is different.
- Check correctness with every speed-up. Here: the workers' tables were bitwise equal; the GPU's were within $2.2 \times 10^{-6}$ with no flips; the tiled export and the new blur were within one level; half-size bloom was within 6 levels; and the active-set solve's residual was worse at one node only.

## A checklist

- Find where the time goes before changing anything, and measure the work's distribution, not only its total.
- Change the algorithm before the hardware: a quarter of the nodes doing 89 % of the work is a property of the algorithm.
- Stage: tabulate what depends on few inputs, key the table so the function is nearly linear, and let the texture unit interpolate.
- Fold every per-frame constant out of the shader.
- Split 2-D kernels into 1-D passes, loop to the kernel's own radius, and compute weights once.
- Run wide kernels at lower resolution; let one filtered fetch do the downsampling.
- Cut passes only where neighbours are needed; fuse the rest.
- Read back rarely, small, and only when the inputs changed.
- Bind every resource on every draw, and test the first call after a change.
- Parallelise independent work with a shared queue of small ranges, not one range per thread.
- On the GPU, keep shared inputs in workgroup memory, keep barriers in uniform control flow, and keep the work per invocation even.
- Keep a slow, simple reference and compare against it.

## Further reading

- D. P. Bertsekas, "Projected Newton methods for optimization problems with simple constraints", *SIAM Journal on Control and Optimization* 20(2), 1982.
- K. He, J. Sun and X. Tang, "Guided image filtering", *IEEE Transactions on Pattern Analysis and Machine Intelligence* 35(6), 2013.
- K. He and J. Sun, "Fast guided filter", arXiv:1505.00996, 2015.
- C. Tomasi and R. Manduchi, "Bilateral filtering for gray and color images", *ICCV* 1998.
- K. Levenberg (1944) and D. W. Marquardt (1963), the damped least-squares method of §9.3.
- The W3C WebGPU and WGSL specifications, for workgroups, uniform control flow and the limits quoted here.
