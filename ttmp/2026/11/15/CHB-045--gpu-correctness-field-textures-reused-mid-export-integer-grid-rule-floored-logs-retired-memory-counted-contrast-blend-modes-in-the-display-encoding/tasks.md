# Tasks

## TODO

- [ ] GPUC-1 (CHB-037 P10-10): an exact export's field textures return to the pool only after the last reader's pass is submitted (per-object leases); deterministic interleaving test <!-- t:13dr -->
- [ ] GPUC-2 (CHB-037 P10-15): integer grid rule fp = region.x + floor((2p+1)·region.w / 2n) in pointwise, retouch, frame WGSL, residency gridCoords, core and mock (one function in the contract); law test sweeping widths with ties <!-- t:mbng -->
- [ ] GPUC-3 (CHB-037 P10-26): density-mask mode 7 floors the blurred transmittance before log2; test with zero and subnormal input <!-- t:zjci -->
- [ ] GPUC-4 (CHB-037 P10-11): retired-but-not-destroyed bytes counted in the budget (pending) until destroyed; allocation and high-water marks include them; unit tests <!-- t:rxs2 -->
- [ ] LAY-3 (CHB-037 P10-23, D7): overlay, soft/hard/vivid/linear/pin light and hard mix evaluated in the display encoding (switch at display mid-grey) in core, GPU and docs; parity and goldens <!-- t:f6ux -->
- [ ] Checks: typecheck, lint, gen:check, vitest, goldens, SwiftShader browser suite, gpu-parity on Metal <!-- t:hre2 -->
