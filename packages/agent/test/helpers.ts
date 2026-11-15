// Test setup: engine-mock with the M1 negative as frame "frame_m1", its document in a values Log on the "page"
// (memoryDocs: the log, the mode, the one way to change it), and a DslWorkerClient whose worker runs in this thread
// on a MessageChannel (same protocol as the Web Worker).
import { LOG_RULES, newDocument, sha256Hex, type AgentMode, type Document, type SourceInfo } from '@chromobench/contract';
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { Log, transaction, type Mutation } from '@chromobench/values';
import { DslWorkerClient, inThreadWorker, memoryDocs, type DslWorkerOptions, type MemoryDocs, type WorkerLike } from '../src/index.ts';

export const FRAME = 'frame_m1';

export const m1Doc = (info: SourceInfo, frame = FRAME): Document =>
  newDocument('negative-scan', { sha256: info.sha256, width: info.width, height: info.height }, { frame, umPerPx: 6 });

export interface Page {
  engine: MockEngine;
  docs: MemoryDocs;
  info: SourceInfo;
  dsl: DslWorkerClient;
  /** the frame's current document */
  doc(id?: string): Document;
  /** a change by the photographer (one undo step) */
  userEdit(...ms: Mutation[]): void;
}

export async function page(o: { mode?: AgentMode; spawn?: () => WorkerLike; client?: Partial<DslWorkerOptions> } = {}): Promise<Page> {
  const engine = new MockEngine();
  const bytes = makeM1Tiff();
  const info = await engine.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
  let t = 1000;
  const log = Log.create({ rules: LOG_RULES, now: () => t++ }).open(FRAME, m1Doc(info), { kind: 'frame', by: 'auto', source: { kind: 'ingest' } });
  const docs = memoryDocs({ log, frames: { [FRAME]: { info, name: 'M1 test negative' } }, mode: o.mode ?? 'ask' });
  const dsl = await DslWorkerClient.create({ spawn: o.spawn ?? inThreadWorker, engine, docs, txPrefix: 'chat1', ...o.client });
  let u = 0;
  return {
    engine, docs, info, dsl,
    doc: (id = FRAME) => docs.log().doc<Document>(id),
    userEdit: (...ms) => docs.change((l) => l.commit({ doc: FRAME, tx: transaction({ id: `u${++u}`, label: 'photographer', by: 'user', mutations: ms }) })),
  };
}

/** A param of a darkroom entry of the frame's current document. */
export const param = (p: Page, entry: string, name: string): unknown =>
  (p.doc().stages.darkroom.stack.items[entry] as { params: Record<string, unknown> }).params[name];
