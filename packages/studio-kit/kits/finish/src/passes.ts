// cb.kits.finish: the pass (split from kit.ts, CHB-032): CB-F102 finish tools without the kit. The stage policy
// (which stages a module shows) is the stack kit's pass (CB-S101), which replaced CB-F101.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NodeData } from '@chromobench/shell';

/** CB-F102: finish tools without the kit (a check cb.core's pass cb.kits runs, since the kit's own passes run only
 *  where it is installed). */
export function finishPasses(): { missing: (ir: any, p: any) => void } {
  const missing = (ir: any, p: any): void => {
    for (const n of ir.find('viewport') as NodeData[]) {
      const tools = (n.props['tools'] as string[] | undefined) ?? [];
      if ((tools.includes('crop') || tools.includes('spot')) && !ir.kits.some((k: any) => k.name === 'cb.finish'))
        p.error('CB-F102', `viewer '${n.props['id']}' lists the finish tools, but the finish kit is not installed`, { at: n.at, fix: '.use(cb.kits.finish.kit) on the studio' });
    }
  };
  return { missing };
}
