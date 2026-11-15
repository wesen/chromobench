// Sweeps (guide §5.5; CHB-037 P7): looks at fixed parameters instead of picked ones — the ring-around (the print
// through the balance look moved one step in each of six colour directions and in density) and a row along one
// parameter of a look (a test-strip-like row). A survey renders them like any look; applying a tile inserts the
// look's link at the tile's params. The centre tile is the frame's own print (no link: the same node).
// Boundary with CHB-019: its ring-around *tool* keeps its layout and tile source (cb.views.ringAround).
import type { Json } from '@chromobench/values';
import { getLook, LOGH_PER_POINT } from '@chromobench/contract';
import { ringTiles } from '../../../../src/model/tools.ts';
import { lookItem, type LookItem } from './looks.ts';

const at = (base: LookItem, id: string, name: string, fixed: Record<string, Json>): LookItem => Object.freeze({ ...base, id, name, group: 'Ring-around', params: {}, fixed, origin: 'sweep' as const });

/** nine tiles: the six colour directions, current, and density ±1 step (the CHB-009 ring), on the balance look */
export function ring(o: { step?: number; density?: boolean } = {}): LookItem[] {
  const base = lookItem('balance');
  return ringTiles(o.step ?? 4)
    .filter((t) => o.density !== false || t.row !== 3)
    .filter((t) => t.row !== 3 || Math.abs(Number(t.id.slice(1))) === 1)
    .map((t) => {
      const pt = t.offset.map((x) => Number((x / LOGH_PER_POINT).toFixed(4)));
      return at(base, `ring-${t.id}`, t.label, t.id === 'current' ? {} : { red: pt[0]!, green: pt[1]!, blue: pt[2]! });
    });
}

/** a row of tiles moving one parameter of a look by the given values */
export function along(look: string, param: string, values: readonly number[]): LookItem[] {
  const base = lookItem(look);
  const spec = getLook(look).params[param];
  if (!spec) throw new Error(`look ${look} has no parameter ${param}`);
  return values.map((v) => Object.freeze({ ...at(base, `along-${look}-${param}-${v}`, `${spec.ui?.label ?? param} ${v}`, { [param]: v }), group: 'Sweep' }));
}
