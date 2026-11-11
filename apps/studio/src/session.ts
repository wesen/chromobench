// One open frame: engine + graph + edit log. CHB-009 replaces this with the library and frame store.
import { compile, defaultRecipe, EditLog, Graph, sha256Hex, type AgentMode, type Engine, type Node } from '@chromobench/contract';

export interface FrameSession {
  engine: Engine;
  graph: Graph;
  log: EditLog;
  /** The display node of the current state (including any drag preview). */
  displayNode(): Node;
}

export async function openFrame(engine: Engine, bytes: Uint8Array, name: string, mode: AgentMode): Promise<FrameSession> {
  const sha = sha256Hex(bytes);
  const info = await engine.open({ kind: 'file', sha256: sha, name, bytes });
  const graph = new Graph();
  graph.registerSource(info);
  // frame.add with the default recipe, by 'auto' (ingest).
  const log = EditLog.create(defaultRecipe('negative-scan', { sha256: sha, name }), { mode, by: 'auto', graph });
  return {
    engine, graph, log,
    displayNode() {
      const n = compile(log.state, graph, { displaySpace: 'srgb' });
      engine.adopt(graph.closure(n.id));
      return n;
    },
  };
}
