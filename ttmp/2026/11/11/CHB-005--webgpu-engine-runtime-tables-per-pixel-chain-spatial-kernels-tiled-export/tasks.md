# Tasks

## TODO
- [ ] [stage 1] Create packages/gpu with GpuRuntime: adapter request (high-performance, then fallback), limits and feature negotiation capped by adapter limits, caps reporting, device-loss recovery with E_DEVICE_LOST <!-- t:y6wj -->
- [ ] [stage 1] Implement BufferPool and TexturePool with a byte budget, pinning, out-of-memory error scopes and a single retry <!-- t:wi0i -->
- [ ] [stage 1] Implement PipelineCache (WGSL hash keys, explicit bind group layouts, compile diagnostics with line numbers, prewarm) and the WGSL uniform layout packer, tested against the Studio's 112-byte SOLVE layout <!-- t:lw1r -->
- [ ] [stage 1] Implement GpuTimer (timestamp-query when present, else submit to onSubmittedWorkDone or mapAsync) and fallback-adapter detection with the Accel.order backend policy <!-- t:55j2 -->
- [ ] [stage 2] Implement planTiles(): halo from chained local kernels, global fields with the σ/s ≥ 2 px rule, tile size from budget and limits, row-major tiles; property tests and the 100 MP worked example <!-- t:522z -->
- [ ] [stage 3] Port the SOLVE and SPECTRAL WGSL kernels (workgroup staging, barrier before range check, select masks, gtol ≥ 1e-6), writing a storage buffer and a 3-D storage texture <!-- t:l8wd -->
- [ ] [stage 3] Build the f64 worker pool (module workers, shared queue, urgent jobs, transferred results) on core's table builders; verify bitwise equality with the main thread <!-- t:cn55 -->
- [ ] [stage 3] Implement TableKey hashing (consumed data, domain, N, solver options, scan SHA-256 when per-scan, builder) and the OPFS table cache with verification, persist() and LRU eviction <!-- t:o07a -->
- [ ] [stage 4] Port FS_DYES, FS_PD, FS_PRINT and FS_OUT to WGSL compute stage kernels with taps, exp2/log2, frame-coordinate uniforms and node-id result caching <!-- t:do0z -->
- [ ] [stage 4] Implement the export precision path: rgba16uint source upload, exact per-pixel solve, manual tetrahedral lookups, f32 intermediates, pack2x16unorm 16-bit output <!-- t:6bzj -->
- [ ] [stage 4] Implement GPU reductions: histogram, pairwise means and LATD, median of Y, gamut-class counts, densitometer patches for measure() <!-- t:erm0 -->
- [ ] [stage 5] Implement the separable blur with per-channel vec4 weights from uniforms, looping to the kernel radius, plus global-field sampling by frame coordinates <!-- t:qgqc -->
- [ ] [stage 5] Implement halation and DIR diffusion kernels in µm (spektrafilm form with 1 + a normalisation), fixing the Studio's halation channel packing <!-- t:5iyy -->
- [ ] [stage 5] Implement the pcg4d counter-based grain RNG keyed on full-resolution frame coordinates, replacing the repeating noise tile <!-- t:mhxj -->
- [ ] [stage 5] Write the SAT probe (f32 failure, wrapping-u32 exactness) and keep f32 SATs out of the kernels <!-- t:yd73 -->
- [ ] [stage 6] Set up the Playwright and Vite parity page with headless Chromium WebGPU flags (SwiftShader) in CI <!-- t:8zuv -->
- [ ] [stage 6] Table parity tests: solve ≤ 2.2e-6 with 0 flips, PD ≤ 7.2e-7, XYZ ≤ 4.2e-7, between-node lookup tests, each with a broken variant that fails <!-- t:06qm -->
- [ ] [stage 6] Chain and tile parity tests: 8-px halo within 1 level, no halo fails, per-tile wide kernel fails, grain tile-invariant; run the CHB-002 conformance suite against GpuEngine <!-- t:s2jl -->
- [ ] [review] Unconfirmed: WGSL accuracy table (hardware tolerance 1e-5 is a guess) and integer wrapping rule; verify with a probe kernel <!-- t:wqul -->
