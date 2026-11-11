# CHB-007 contract requests

Requests for `@chromobench/contract`, applied by the orchestrator at merge time. The DSL works
without them today; each describes what the DSL does locally in the meantime.

## R1. JavaScript error names as diagnostic codes

**What.** `EvalResult.error.code` is sometimes a JavaScript error name: `SyntaxError`, `ReferenceError`,
`TypeError`, `RangeError`, or `Error` for a plain `throw new Error()`. These are not in
`ERROR_CODES`, which the contract calls "the closed list of codes".

**Why.** goja-cv reports guest exceptions under their own names, and agents recognise them. Wrapping
them all in one code (for example `E_EVAL`) would lose the distinction between a syntax error and a
missing variable, which the hints rely on.

**Proposed diff** (`packages/contract/src/errors.ts`, after the CHB-007 block):

```diff
   E_MEMORY: 'Sandbox memory limit exceeded.',
+  // JavaScript exceptions from agent code keep their names (CHB-007)
+  SyntaxError: 'The agent code does not parse; where.line points at it.',
+  ReferenceError: 'An undefined name; the hint says whether mem or a missing timer is the cause.',
+  TypeError: 'A JavaScript type error in agent code.',
+  RangeError: 'A JavaScript range error in agent code.',
+  Error: 'The agent code threw a plain Error (or a non-Error value).',
```

## R2. `ContextBlock.changed`: clarify the doc comment

**What.** The contract says "Recipe paths changed by this eval". The CHB-007 guide §5.10 describes
`changed` as paths that differ from `defaultRecipe`, with authors. The DSL follows the contract:
`changed` lists the paths this eval's edits touch.

**Proposed diff** (`packages/contract/src/eval.ts`): none needed if the contract's meaning stands;
otherwise add a separate `recipe?: string[]` field for "differs from the default, by author".
