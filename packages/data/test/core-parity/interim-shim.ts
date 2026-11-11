// Stand-in for packages/core/src/data/interim.ts used only by vitest.core-parity.config.ts: core's own
// test suite runs unchanged, but every interimData() call is served from the packs.
import { nodePhysicsData } from '../../src/node.ts';

export function interimData(): ReturnType<typeof nodePhysicsData> {
  return nodePhysicsData();
}
