// Test setup: engine-mock with the M1 negative as frame "frame_m1", its EditLog on the "page", and a
// DslWorkerClient whose worker runs in this thread on a MessageChannel (same protocol as the Web Worker).
import { EditLog, defaultRecipe, sha256Hex, type AgentMode, type SourceInfo } from '@chromobench/contract';
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { DslWorkerClient, inThreadWorker, type DslWorkerOptions, type FrameSource, type WorkerLike } from '../src/index.ts';

export const FRAME = 'frame_m1';

export interface Page {
  engine: MockEngine;
  log: EditLog;
  info: SourceInfo;
  frames: FrameSource;
  dsl: DslWorkerClient;
}

export async function page(o: { mode?: AgentMode; spawn?: () => WorkerLike; client?: Partial<DslWorkerOptions> } = {}): Promise<Page> {
  const engine = new MockEngine();
  const bytes = makeM1Tiff();
  const info = await engine.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
  const recipe = defaultRecipe('negative-scan', { sha256: info.sha256 }, { frame: FRAME });
  let t = 1000;
  const log = EditLog.create(recipe, { mode: o.mode ?? 'ask', now: () => t++ });
  const frames: FrameSource = { ids: () => [FRAME], get: (id) => (id === FRAME ? { log, info, name: 'M1 test negative' } : undefined) };
  const dsl = await DslWorkerClient.create({ spawn: o.spawn ?? inThreadWorker, engine, frames, txPrefix: 'chat1', ...o.client });
  return { engine, log, info, frames, dsl };
}
