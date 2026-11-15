// The studio's workbench for the agent (CHB-037 P6b, design §34): studio-kit's studioWorkbench over the runtime on
// screen, with what only the host can do — say which layout is mounted and which ones it can switch to, ask the
// photographer to use a layout the agent wrote (a dialog; approved, it is mounted in place like View ▸ Layout), and
// register a look the agent wrote where the studio compiles. Loaded with the assistant (host/chat.ts).
import { defineLookSource, type Workbench } from '@chromobench/agent';
import type { Runtime } from '@chromobench/shell';
import type { LayoutDef, Studio } from '@chromobench/studio-kit';
import { studioWorkbench, type LayoutInfo } from '@chromobench/studio-kit/kits/chat';

/** What main.ts tells the workbench about layouts. */
export interface LayoutHost {
  current(): LayoutInfo;
  available(): { id: string; label: string }[];
  /** mounts a layout in place of the one on screen (the open frames and the history stay) */
  mount(def: LayoutDef): Promise<void>;
}

const el = (tag: string, text: string): HTMLElement => {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
};

export function createWorkbench(studio: Studio, rt: () => Runtime | null, layouts: LayoutHost): Workbench {
  const wb = studioWorkbench({
    rt,
    studio,
    layout: () => layouts.current(),
    available: () => layouts.available(),
    propose(def, o) {
      const r = rt();
      if (!r) return { status: 'refused', note: 'the studio has no layout mounted' };
      const body = document.createElement('div');
      body.append(el('p', `The assistant wrote a layout: ${def.label}${def.description ? ` (${def.description})` : ''}.`));
      if (o.why) body.append(el('p', `Why: ${o.why}`));
      body.append(el('p', 'Your open frames and your history stay as they are; View ▸ Layout switches back.'));
      const d = r.chrome.dialog({
        title: 'Use the assistant’s layout?',
        body,
        buttons: [{ label: 'Keep this layout', value: 'keep' }, { label: `Use ${def.label}`, value: 'use', primary: true }],
      });
      void d.result.then((v) => {
        if (v === 'use') return layouts.mount(def);
        return undefined;
      });
      return { status: 'proposed', note: `the photographer is asked: "Use ${def.label}" or "Keep this layout"; wb.layout() says which is on screen` };
    },
    defineLook: async (src) => {
      const d = await defineLookSource(src, { file: 'agent.cblook.js', existing: 'keep' });
      return { name: d.name, version: d.version, label: d.label };
    },
  });
  return wb as unknown as Workbench;
}
