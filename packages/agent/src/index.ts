// @chromobench/agent (CHB-008): the DSL session in a Web Worker, the in-app chat session with pluggable model
// transports, and the page side of the external-agent bridge.
export { DslWorkerClient, hostResult, memoryDocs, type AgentDocs, type DslWorkerOptions, type EvalOptions, type FrameView, type MemoryDocs } from './worker/client.ts';
export { serveDsl } from './worker/server.ts';
export { createDslWorker, inThreadWorker } from './worker/spawn.ts';
export type { DocsSnapshot, Endpoint, WorkerLike, ToWorker, FromWorker } from './worker/protocol.ts';
export { ChatSession, MAX_STEPS, changesOf, describeChange, partialCode, toBase64, type ChatHost, type ChatSessionOptions, type ChatState, type ChatItem, type ChatEvent, type ChatStatus, type StepStatus, type LookView, type ApprovalView, type ChangeView } from './chat/session.ts';
export { ScriptedModel, ModelError, EFFORTS, lastToolResult, lastUserText, type ChatModel, type ModelRequest, type ModelReply, type ModelSink, type ScriptReply, type ScriptStep, type Effort, type MessageParam, type ModelErrorKind } from './chat/model.ts';
export { AnthropicModel, DEFAULT_MODEL, MODELS, toModelError, type AnthropicModelOptions } from './chat/anthropic.ts';
export { EVAL_TOOL, EVAL_TOOL_DESCRIPTION, MODE_TEXT, systemPrompt, playbookSection, type PromptOptions } from './chat/prompt.ts';
export { PLAYBOOKS, type Playbook } from './playbooks.generated.ts';
export { demoModel, type DemoOptions } from './chat/demo.ts';
export { BridgePageClient, type BridgePageOptions, type BridgeToPage, type PageToBridge, type SocketLike, type EvalRunner, type LookPayload } from './bridge/page-client.ts';
