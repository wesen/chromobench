// cb.kits.select (CHB-049, MASK-2, decision D3): selections as mask components, in their own kit. The tools (the
// marquees, the lassos, the magic wand), the Select menu (Select All, Deselect, Inverse, Grow, Contract, Feather, Use
// Selection as Mask), the wand's options, and the tools' row in the Mask panel (the form `select.tools`). Every
// selection is a step on the selected layer's mask (commands.ts): the engines see components of the one algebra.
//
//   cb.kits.select.menus.select()      // the Select menu (cb.menus.standard() places it)
//   cb.kits.select.tools               // the tool ids, for a viewer's `tools`
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Ck } from '@chromobench/shell';
import type { Cb } from '../../../src/cb.ts';
import { selectCommands, selectTools, selectView, SELECT_TOOLS, TOOL_WORDS } from './commands.ts';
import { SELECT_STATE } from './state.ts';

const SELECT_DOCS = `## cb.kits.select
Selections are mask components (decision D3): a selection is the selected layer's mask, so there is nothing else to
keep. The rectangular and elliptical marquees, the lasso (drag) and the polygonal lasso (click the corners, click the
first one or double-click to close) and the magic wand (Tolerance, Contiguous; it samples the image the mask reads)
add a part to it; Shift adds, Alt subtracts, Shift+Alt intersects. Select ▸ Select All (Mod+A), Deselect (Mod+D: the
layer acts everywhere again), Inverse (Mod+Shift+I), Grow and Contract (0.5 mm on the print), Feather (1 mm), Use
Selection as Mask (the selection last made becomes the selected layer's mask, a copy). Each is one step (Mod+Z).
Commands for an agent: select.rect(box), select.ellipse(box), select.lasso(points), select.wand(x, y, { tolerance,
contiguous }), select.all, select.none, select.invert, select.grow(mm), select.contract(mm), select.feather(mm),
select.toLayer, select.options({ tolerance, contiguous }).`;

export function createSelectKit(ck: Ck, _cb: Cb) {
  const kit = ck
    .kit('cb.select')
    .version('1')
    .requires('cb.core')
    .state('select', { init: SELECT_STATE.select, view: true })
    .forms({ name: 'select.tools', slots: {}, doc: 'The selection tools as buttons and the magic wand\'s options (the Mask panel places it; renderer: SELECT_RENDERERS)', kind: 'cb' })
    .commands(selectCommands())
    .tools(selectTools())
    .keys({ 'Mod+A': 'select.all', 'Mod+D': 'select.none', 'Mod+Shift+I': 'select.invert' })
    .docs(SELECT_DOCS);
  return ck.product(kit, {
    menus: {
      /** the Select menu */
      select: () =>
        ck.menu('Select', [
          'select.all', 'select.none', 'select.invert', '-', 'select.grow', 'select.contract', 'select.feather', '-', 'select.toLayer', '-',
          ...SELECT_TOOLS.map((t) => `tool.${t}`),
        ] as any),
    },
    sel: {
      /** the wand's options and the last selection: { tolerance, contiguous, last } */
      options: (s: any) => {
        const { poly: _p, ...v } = selectView(s);
        return v;
      },
    },
    lib: { SELECT_TOOLS, TOOL_WORDS },
    /** the selection tools, for a viewer's `tools` */
    tools: [...SELECT_TOOLS],
  });
}

export type SelectKit = ReturnType<typeof createSelectKit>;
