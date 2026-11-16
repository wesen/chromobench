# Changelog

## 2026-11-15

- Initial workspace created


## 2026-11-15

LAY-1: white balance before the film defined once in the contract (temperature and tint in Lightroom's units, CAT16 to D65; as-shot default); goldens reproduced bit for bit; cam-wb-tungsten (16fae66)

### Related Files

- /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb048/packages/contract/src/white-balance.ts — the one definition


## 2026-11-15

LAY-1 UI: White balance panel in Classic's Print and Scene, Before the film palette in Darkroom first, scene.whiteBalance, eyedropper (b225e76)

### Related Files

- /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb048/packages/studio-kit/src/commands/scene.ts — command and tool


## 2026-11-15

LAY-2: ClipColor in OkLCh (first exit from grey); the display knee's chroma search finds the first exit; stack-print-blends re-rendered (43dc1d6)

### Related Files

- /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb048/packages/contract/src/pixel.ts — clipColour


## 2026-11-15

LOOK-6: film stocks, papers, grades as medium presets from the data pack; medium.preset; cam-film-portra-800-push1 (0588159)

### Related Files

- /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb048/packages/contract/src/media-presets.ts — presets


## 2026-11-15

Checks green (vitest 3479, goldens 68/68, SwiftShader 170, Metal gpu-parity 62); contract 3.0.0 CC-027..029, STORAGE_FORMAT 5 (94094bd)

