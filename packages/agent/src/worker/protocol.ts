// The DSL worker protocol (CHB-007 task 44uo, done in CHB-008; contract 1.0 in CHB-037 P6a): the DslSession and its
// QuickJS VM run in a Web Worker; the page keeps the engine and the document log. The worker reaches the engine only
// through adopt (node closures, fire-and-forget), measure and evaluate (request/response); it reads documents from a
// copy of the page's log (the log's own serialisation, sent when it changed, before an eval), and the submission an
// eval makes there is made again on the page's log through the same door (agentSubmit), which stays the one way
// in for the agent's edits.
import type { AgentMode, Diagnostic, EngineCaps, EngineId, EvalRequest, EvalResult, EvalTarget, MeasureSpec, NodeDef, NodeRef, SourceInfo } from '@chromobench/contract';
import type { DslLimits, DslLinks, Submission, WbMethod } from '@chromobench/dsl';
import type { LogData } from '@chromobench/values';

/** The page's documents as the worker copies them: the log, the mode, the frames the agent may open. */
export interface DocsSnapshot {
  log: LogData;
  mode: AgentMode;
  frames: Record<string, { source: SourceInfo; name?: string }>;
  /** the data links resolve against (rolls, presets: CHB-037 P7); looks are registered in the contract */
  links?: DslLinks;
}

/** ImageResult without its lazy read(): the samples travel with the reply (transferred). */
export interface ImagePayload {
  node: string;
  info: NodeRef['info'];
  scale: number;
  region: { x: number; y: number; w: number; h: number };
  width: number;
  height: number;
  format: 'f32' | 'f64' | 'u16';
  data: Float32Array | Float64Array | Uint16Array;
  preview?: boolean;
  warnings: Diagnostic[];
}

export type ToWorker =
  /** workbench: the page has one (the studio); the worker's `wb` calls go to it (CHB-037 P6b) */
  | { t: 'init'; engine: { id: EngineId; caps: EngineCaps }; limits?: Partial<DslLimits>; txPrefix?: string; workbench?: boolean }
  | { t: 'docs'; snapshot: DocsSnapshot }
  | { t: 'eval'; id: number; req: EvalRequest }
  | { t: 'interrupt'; id: number }
  | { t: 'engine.reply'; call: number; ok?: unknown; err?: Diagnostic }
  | { t: 'wb.reply'; call: number; ok?: unknown; err?: Diagnostic };

export type FromWorker =
  | { t: 'ready' }
  | { t: 'adopt'; defs: NodeDef[] }
  | { t: 'engine'; call: number; method: 'measure'; node: NodeRef; spec: Omit<MeasureSpec, 'signal'> }
  | { t: 'engine'; call: number; method: 'evaluate'; node: NodeRef; target: Omit<EvalTarget, 'signal'> }
  | { t: 'engine.cancel'; call: number }
  /** a workbench call (wb.*, cb.looks.define), answered by the page's Workbench */
  | { t: 'wb'; call: number; method: WbMethod; args: unknown[] }
  /** the eval's result as the worker's copy of the log saw it, and the submission to make on the page's log */
  | { t: 'result'; id: number; result: EvalResult; submission?: Submission }
  | { t: 'failed'; id: number; error: Diagnostic };

/** The part of Worker / MessagePort / DedicatedWorkerGlobalScope both sides use. */
export interface Endpoint {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
  removeEventListener?(type: 'message', fn: (e: MessageEvent) => void): void;
  start?(): void;
}

/** A worker the client can stop by force (Worker.terminate, or closing a MessagePort in tests). */
export interface WorkerLike extends Endpoint {
  terminate(): void;
}
