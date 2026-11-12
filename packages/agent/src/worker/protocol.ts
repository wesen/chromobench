// The DSL worker protocol (CHB-007 task 44uo, done in CHB-008): the DslSession and its QuickJS VM run in a Web
// Worker; the page keeps the engine and the frames' EditLogs. The worker reaches the engine only through
// adopt (node closures, fire-and-forget), measure and evaluate (request/response); it reads recipes from mirror
// copies of the logs the page sends before each eval, and its proposals are replayed on the page's real logs
// through EditLog.propose, which stays the one door for agent mutations.
import type {
  AgentMode, Diagnostic, EditLogData, EngineCaps, EngineId, EvalRequest, EvalResult, EvalTarget, MeasureSpec,
  Mutation, NodeDef, NodeRef, SourceInfo,
} from '@chromobench/contract';
import type { DslLimits } from '@chromobench/dsl';

/** One frame as the worker mirrors it. */
export interface FrameSnapshot {
  data: EditLogData;
  mode: AgentMode;
  source: SourceInfo;
  name?: string;
}

/** A propose() call the session made on a mirror log, replayed on the page. */
export interface ProposalCall {
  frame: string;
  ms: Mutation[];
  meta: { tx: string; why?: string; label?: string; batch?: string };
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
  | { t: 'init'; engine: { id: EngineId; caps: EngineCaps }; limits?: Partial<DslLimits> }
  | { t: 'frames'; set: Record<string, FrameSnapshot> }
  | { t: 'eval'; id: number; req: EvalRequest }
  | { t: 'interrupt'; id: number }
  | { t: 'engine.reply'; call: number; ok?: unknown; err?: Diagnostic };

export type FromWorker =
  | { t: 'ready' }
  | { t: 'adopt'; defs: NodeDef[] }
  | { t: 'engine'; call: number; method: 'measure'; node: NodeRef; spec: Omit<MeasureSpec, 'signal'> }
  | { t: 'engine'; call: number; method: 'evaluate'; node: NodeRef; target: Omit<EvalTarget, 'signal'> }
  | { t: 'engine.cancel'; call: number }
  | { t: 'result'; id: number; result: EvalResult; proposals: ProposalCall[] }
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
