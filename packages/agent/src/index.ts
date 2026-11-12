// @chromobench/agent (CHB-008): the DSL session in a Web Worker, the in-app chat session with pluggable model
// transports, and the page side of the external-agent bridge.
export { DslWorkerClient, hostResult, type DslWorkerOptions, type EvalOptions, type FrameSource, type FrameView } from './worker/client.ts';
export { serveDsl } from './worker/server.ts';
export { createDslWorker, inThreadWorker } from './worker/spawn.ts';
export type { Endpoint, WorkerLike, FrameSnapshot, ProposalCall, ToWorker, FromWorker } from './worker/protocol.ts';
