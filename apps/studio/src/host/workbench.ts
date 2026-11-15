// The studio's workbench for the agent (CHB-037 P6b, design §34): studio-kit's studioWorkbench over the runtime on
// screen, with what only the host can do — say which layout is mounted and which ones it can switch to, ask the
// photographer to use a layout the agent wrote (a dialog; approved, it is mounted in place like View ▸ Layout), and
// register a look the agent wrote where the studio compiles. Loaded with the assistant (host/chat.ts).
import { defineLookSource, type Workbench } from '@chromobench/agent';
import type { Runtime } from '@chromobench/shell';
import type { LayoutDef, Studio } from '@chromobench/studio-kit';
import { studioWorkbench, type AgentLayout, type LayoutInfo } from '@chromobench/studio-kit/kits/chat';

/** What main.ts tells the workbench about layouts (and where the agent's layouts and looks are kept). */
export interface LayoutHost {
  current(): LayoutInfo;
  available(): { id: string; label: string }[];
  /** mounts a layout in place of the one on screen (the open frames and the history stay) */
  mount(def: LayoutDef): Promise<void>;
  /** keeps a layout he accepted (the studio's KV), so View ▸ Layout lists it and a reload keeps it (CHB-037 P9) */
  keepLayout?(l: AgentLayout): Promise<void>;
  /** keeps a look the agent wrote, registered again at the next start (documents may link it) */
  keepLook?(name: string, src: string): Promise<void>;
  /** the id is a built-in layout's (an agent layout may not shadow it) */
  builtIn?(id: string): boolean;
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
      if (layouts.builtIn?.(def.id)) return { status: 'refused', note: `${def.id} is a built-in layout's id: give the layout an id of its own` };
      const body = document.createElement('div');
      body.append(el('p', `The assistant wrote a layout: ${def.label}${def.description ? ` (${def.description})` : ''}.`));
      if (o.why) body.append(el('p', `Why: ${o.why}`));
      body.append(el('p', 'Your open frames and your history stay as they are; View ▸ Layout switches back.'));
      const d = r.chrome.dialog({
        title: 'Use the assistant’s layout?',
        body,
        buttons: [{ label: 'Keep this layout', value: 'keep' }, { label: `Use ${def.label}`, value: 'use', primary: true }],
      });
      void d.result.then(async (v) => {
        if (v !== 'use') return;
        await layouts.mount(def);
        await layouts.keepLayout?.(o.layout).catch(() => undefined);
      });
      return { status: 'proposed', note: `the photographer is asked: "Use ${def.label}" or "Keep this layout"; wb.layout() says which is on screen` };
    },
    defineLook: async (src) => {
      const d = await defineLookSource(src, { file: 'agent.cblook.js', existing: 'keep' });
      await layouts.keepLook?.(d.name, src).catch(() => undefined);
      return { name: d.name, version: d.version, label: d.label };
    },
  });
  return wb as unknown as Workbench;
}
