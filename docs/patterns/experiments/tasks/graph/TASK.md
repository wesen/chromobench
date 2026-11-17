# Task: an image-operation graph with result reuse

You are building the core of a small image-processing engine for an interactive editor. The editor rebuilds the whole
computation from the user's settings every time a slider moves (dozens of times per second), so the engine must
recognise work it has already done. A second process (a worker) must be able to receive a computation from the main
thread and refer to its parts by the same identities.

## Images

A single-channel image is `{ width: number, height: number, data: Float32Array }` (row-major, `data.length ===
width * height`).

## Operations

| Name | Inputs | Arguments (defaults) | Result |
|---|---|---|---|
| `source` | none | `width` (required int), `height` (required int), `kind`: `"ramp"` (default) or `"noise"`, `seed` (default 0) | `ramp`: value at (x, y) = x / max(1, width − 1). `noise`: values in [0, 1) from a deterministic generator seeded by `seed` (any generator, but the same seed must give the same image) |
| `gain` | 1 | `factor` (1), `offset` (0) | v × factor + offset |
| `blur` | 1 | `radius` (1, integer ≥ 0) | box blur of the given radius in x then in y (each pass averages the 2r + 1 neighbours, clamping coordinates to the image edge) |
| `threshold` | 1 | `level` (0.5) | 1 where v ≥ level, else 0 |
| `blend` | 2 | `mode`: `"mix"` (default), `"add"`, `"multiply"`; `amount` (0.5) | mix: a + amount × (b − a); add: a + amount × b; multiply: a × (1 − amount + amount × b) |

**Scale.** Evaluating with `scale` s (0 < s ≤ 1) computes the whole chain at reduced size: `source` produces
`round(width × s) × round(height × s)` pixels (`ramp` divides by the reduced width − 1; `noise` draws the reduced
number of values from the same seed), and `blur` uses `round(radius × s)`. Other operations are unchanged.

## API (`project/src/index.ts`, ES module, TypeScript runnable with Node 24 type stripping)

```ts
export interface NodeRef { readonly id: string }
export interface Image { width: number; height: number; data: Float32Array }
export interface Graph {
  /** Builds (or finds) the node for an operation; throws on unknown operations, wrong input counts or bad arguments. */
  op(name: string, inputs: NodeRef[], args?: Record<string, unknown>): NodeRef;
  /** Evaluates a node; default scale 1. */
  evaluate(node: NodeRef, opts?: { scale?: number }): Image;
  /** evaluations: how many operation executions actually ran (results served without computing do not count). */
  stats(): { evaluations: number };
  /** A JSON-serialisable description of the node and everything it depends on. */
  export(node: NodeRef): unknown;
  /** Rebuilds an exported description in this graph; returns the node. */
  import(data: unknown): NodeRef;
}
export function createGraph(): Graph;
```

## Requirements

1. **Reuse.** Evaluating a computation that was already evaluated (at the same scale) must not run any operation
   again, even if the node was rebuilt through a different sequence of `op` calls, for example after the user changed
   a slider and changed it back.
2. **Shared work.** When only a late operation's arguments change, the earlier operations must not run again. An
   operation used by two later operations runs once per evaluation.
3. **Same computation, same id.** Argument spellings that mean the same computation (different key order, an
   argument omitted or given explicitly at its default value) must give the same node and the same id. Different
   computations must give different ids.
4. **Stable ids across processes.** The same computation must get the same id in any `Graph` instance, including one
   that receives it through `export` → `JSON.stringify` → `JSON.parse` → `import`. Evaluating the imported node must
   give the same pixels.
5. **Scale.** Results at different scales are different results; a full-size evaluation after a reduced one must
   return the full-size image.
6. **Reproducible noise.** The same seed gives the same id and the same pixels; a different seed gives a different id.
7. **Robustness.** Callers may modify images returned by `evaluate`; this must not change later results.

## Deliverables

The working rules in your instructions apply: the project lives in `project/`, the API module is
`project/src/index.ts`.
