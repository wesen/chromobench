// @chromobench/dsl — the agent's DSL runtime (CHB-007): a QuickJS sandbox, a prelude generated
// from the op registry, result shaping and the agent-facing docs.
export { DslSession, DEFAULT_LIMITS, WRAP_PREFIX, WRAP_SUFFIX, loadQuickJS, type DslFrame, type DslLimits, type DslSessionOptions, type EvalTrace } from './session.ts';
export { Host, PRINT_OPTIONS, dslOps, suggest, type HandleInfo, type LooksProvider } from './host.ts';
export { renderYaml, fmtNum, params, docLine } from './results/yaml.ts';
export { assemble } from './results/assemble.ts';
export { encodePng } from './results/png.ts';
export { usageReport, formatUsage, type UsageReport } from './telemetry.ts';
export { docsProvider } from './docs/provider.ts';
export { VOCABULARY } from './docs/vocabulary.ts';
export { genInstructions, genReference } from './docs/generate.ts';
