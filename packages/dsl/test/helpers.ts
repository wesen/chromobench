// Test setup: a DslSession on engine-mock with the M1 negative as frame "frame_m1", its document in a values Log
// (kind 'frame', LOG_RULES) held by a memory history with the agent's mode.
import { LOG_RULES, newDocument, sha256Hex, type AgentMode, type Document, type EvalResult, type SourceInfo } from '@chromobench/contract';
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { Log } from '@chromobench/values';
import { DslSession, memoryHistory, type DslLimits, type DslLinks, type MemoryHistory } from '../src/index.ts';
import { docsProvider } from '../src/docs/provider.ts';

export const FRAME = 'frame_m1';
/** Centre of the M1 grey patch (same transmittance as the guide's §7 grey card). */
export const GREY = [48, 32] as const;

/** The M1 frame's document: a negative scan at 6 µm per pixel on the film (synthetic, as the goldens). */
export function m1Doc(source: SourceInfo, frame = FRAME): Document {
  return newDocument('negative-scan', { sha256: source.sha256, width: source.width, height: source.height }, { frame, umPerPx: 6 });
}

/** A log holding documents as frames; `now` counts from 1000. */
export function frameLog(docs: Record<string, Document>): Log {
  let t = 1000;
  let log = Log.create({ rules: LOG_RULES, now: () => t++ });
  for (const [id, d] of Object.entries(docs)) log = log.open(id, d, { kind: 'frame', by: 'auto', source: { kind: 'ingest' } });
  return log;
}

export interface Setup {
  session: DslSession;
  engine: MockEngine;
  history: MemoryHistory;
  doc: Document;
  source: SourceInfo;
  run(code: string, opts?: { frame?: string | null; timeoutMs?: number }): Promise<EvalResult>;
}

export async function setup(opts: { mode?: AgentMode; limits?: Partial<DslLimits>; doc?: (d: Document) => Document; links?: () => DslLinks } = {}): Promise<Setup> {
  const engine = new MockEngine();
  const bytes = makeM1Tiff();
  const source = await engine.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
  let doc = m1Doc(source);
  if (opts.doc) doc = opts.doc(doc);
  const history = memoryHistory(frameLog({ [FRAME]: doc }), opts.mode ?? 'ask');
  const session = await DslSession.create({ engine, history, frames: { [FRAME]: { source, name: 'M1 test negative' } }, docs: docsProvider(), ...(opts.links ? { links: opts.links } : {}), ...(opts.limits ? { limits: opts.limits } : {}) });
  return {
    session, engine, history, doc, source,
    run: (code, o = {}) => session.eval({ code, ...(o.frame === null ? {} : { frame: o.frame ?? FRAME }), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) }),
  };
}
