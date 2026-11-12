// Test setup: a DslSession on engine-mock with the M1 negative bound as frame "frame_m1".
import { EditLog, defaultRecipe, sha256Hex, type AgentMode, type EvalResult, type FrameRecipe } from '@chromobench/contract';
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { DslSession, type DslLimits } from '../src/index.ts';
import { docsProvider } from '../src/docs/provider.ts';
import { testLooks } from './looks-provider.ts';

export const FRAME = 'frame_m1';
/** Centre of the M1 grey patch (same transmittance as the guide's §7 grey card). */
export const GREY = [48, 32] as const;

export interface Setup {
  session: DslSession;
  engine: MockEngine;
  log: EditLog;
  recipe: FrameRecipe;
  run(code: string, opts?: { frame?: string | null; timeoutMs?: number }): Promise<EvalResult>;
}

export async function setup(opts: { mode?: AgentMode; limits?: Partial<DslLimits>; recipe?: (r: FrameRecipe) => FrameRecipe } = {}): Promise<Setup> {
  const engine = new MockEngine();
  const bytes = makeM1Tiff();
  const source = await engine.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
  let recipe = defaultRecipe('negative-scan', { sha256: source.sha256 }, { frame: FRAME });
  if (opts.recipe) recipe = opts.recipe(recipe);
  let t = 1000;
  const log = EditLog.create(recipe, { mode: opts.mode ?? 'ask', now: () => t++ });
  const session = await DslSession.create({ engine, frames: { [FRAME]: { log, source, name: 'M1 test negative' } }, docs: docsProvider(), looks: testLooks(), ...(opts.limits ? { limits: opts.limits } : {}) });
  return {
    session, engine, log, recipe,
    run: (code, o = {}) => session.eval({ code, ...(o.frame === null ? {} : { frame: o.frame ?? FRAME }), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) }),
  };
}
