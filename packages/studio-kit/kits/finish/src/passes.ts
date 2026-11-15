// cb.kits.finish: the passes (split from kit.ts, CHB-032): CB-F101 finishing controls in a Print or Darkroom
// module, CB-F102 finish tools without the kit.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Ck, NodeData } from '@chromobench/shell';

// ── passes ──
function walk(n: unknown, f: (n: NodeData) => void, seen = new Set<unknown>()): void {
  if (!n || typeof n !== 'object' || seen.has(n)) return;
  seen.add(n);
  const d = n as NodeData;
  if (typeof d.$ === 'string' && d.props) {
    f(d);
    for (const k of d.kids ?? []) walk(k, f, seen);
    for (const v of Object.values(d.props)) {
      if (Array.isArray(v)) for (const x of v) walk(x, f, seen);
      else if (v && typeof v === 'object') {
        walk(v, f, seen);
        for (const x of Object.values(v as object)) walk(x, f, seen);
      }
    }
  }
}
/** CB-F101: a finishing control in a module labelled Print or Darkroom (a pass of the kit); CB-F102: finish tools
 *  without the kit (a check cb.core's pass cb.kits runs, since the kit's own passes run only where it is installed). */
export function finishPasses(ck: Ck): { labelPass: any; missing: (ir: any, p: any) => void } {
  const label = ck.pass('cb.finish.label', { on: 'ui', after: 'slots' }, (ir: any, p) => {
    for (const m of ir.modules as { id: string; label: string; regions: Record<string, NodeData | null> }[]) {
      if (!/print|darkroom/i.test(m.label ?? '')) continue;
      for (const r of Object.values(m.regions ?? {})) walk(r, (n) => {
        if (n.$ === 'cb.arg' && String(n.props['path'] ?? '').startsWith('finishing.'))
          p.warn('CB-F101', `cb.arg('${n.props['path']}') is a finishing control in the module '${m.label}'`, { at: n.at, facts: ['finishing tones are digital, after the print; the Print module is physical'], fix: 'move it to a Finish module (cb.kits.finish.panels.tones()) or relabel the module' });
      });
    }
  });
  const missing = (ir: any, p: any): void => {
    for (const n of ir.find('viewport') as NodeData[]) {
      const tools = (n.props['tools'] as string[] | undefined) ?? [];
      if ((tools.includes('crop') || tools.includes('spot')) && !ir.kits.some((k: any) => k.name === 'cb.finish'))
        p.error('CB-F102', `viewer '${n.props['id']}' lists the finish tools, but the finish kit is not installed`, { at: n.at, fix: '.use(cb.kits.finish.kit) on the studio' });
    }
  };
  return { labelPass: label, missing };
}
