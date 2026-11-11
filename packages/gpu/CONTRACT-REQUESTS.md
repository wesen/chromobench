# CHB-005 contract requests

## 1. A browser-safe entry point for the conformance generator

**What.** Add a subpath export to `@chromobench/conformance` that does not import Vitest. For example:

```diff
--- a/packages/conformance/package.json
+++ b/packages/conformance/package.json
-  "exports": { ".": "./src/index.ts" },
+  "exports": { ".": "./src/index.ts", "./generate": "./src/generate.ts" },
```

**Why.** The GPU engine runs only in a browser, so its conformance run happens inside the parity page (`packages/gpu/src/parity/page.ts`, test `conformance`). The package index also re-exports `run.ts`, which imports `vitest` at the top level and cannot load in a page. Until this subpath exists, the page imports the generator by relative path (`../../../conformance/src/generate.ts`). That crosses the package boundary.

**After the change:** `import { generateCases, makeEnv } from '@chromobench/conformance/generate'`.

## 2. (Note, no diff) "Within one 8-bit level" and "identical in every 8-bit value"

Guide §8 states two chain acceptance criteria in 8-bit terms. The parity tests read them as follows:

- **Within one 8-bit level:** the 8-bit encodings differ by at most 1. The continuous difference is also reported. The export path peaks at 1.10 levels on synthetic Gold 200 frames; that error comes from the pd and print tables' interpolation, not from the solve.
- **Identical in every 8-bit value:** the renders from f64 tables and from GPU tables differ by less than 0.01 level. One value in 18,432 sat on a rounding boundary and flipped, so strict bitwise 8-bit identity is a statistical outcome, not a law.

CHB-003 should confirm these readings when it publishes its golden numbers.
