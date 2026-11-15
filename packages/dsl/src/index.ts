// @chromobench/dsl — the agent's DSL runtime (CHB-007; contract 1.0 in CHB-037 P6a): a QuickJS sandbox, a prelude
// whose handles are cuts of documents compiled by the one compiler, the editing builders (layers, groups, masks,
// the four mutations), the agent's door into the document log, result shaping and the agent-facing docs.
export { DslSession, DEFAULT_LIMITS, WRAP_PREFIX, WRAP_SUFFIX, loadQuickJS, type DslFrame, type DslLimits, type DslSessionOptions, type EvalTrace } from './session.ts';
export { agentSubmit, editsOf, historyOf, isBatch, memoryHistory, type DslHistory, type LogHost, type MemoryHistory, type Submission, type Submitted } from './history.ts';
export { Host, dslOps, layerOps, suggest, type DocsProvider, type FrameEntry, type HandleInfo, type LooksProvider } from './host.ts';
export { describeMutation, touched } from './describe.ts';
export { renderYaml, fmtNum, params, docLine } from './results/yaml.ts';
export { assemble } from './results/assemble.ts';
export { encodePng } from './results/png.ts';
export { usageReport, formatUsage, type UsageReport } from './telemetry.ts';
export { docsProvider } from './docs/provider.ts';
export { VOCABULARY } from './docs/vocabulary.ts';
export { genInstructions, genReference } from './docs/generate.ts';
