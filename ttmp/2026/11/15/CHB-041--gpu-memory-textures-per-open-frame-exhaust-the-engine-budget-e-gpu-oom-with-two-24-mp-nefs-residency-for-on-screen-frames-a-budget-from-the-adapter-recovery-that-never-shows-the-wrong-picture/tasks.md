# Tasks

## TODO

- [x] Residency per frame: frames not on screen evicted first (LRU), viewer frame and thumbnails being drawn pinned, proxies for renders smaller than their region <!-- t:50vb -->
- [x] Budget from the adapter (budgetFor rule, SwiftShader floor), one budget across both pools <!-- t:l7j3 -->
- [x] Recovery on E_GPU_OOM: let go and retry once, else a clear message for that frame, never the previous picture; journaled <!-- t:3t5m -->
- [x] High-water marks per render in the journal <!-- t:w7jl -->
- [ ] Checks: typecheck, lint, gen:check, vitest, goldens, gpu-parity SwiftShader and Metal, browser suite, owner's scenario <!-- t:al0s -->
