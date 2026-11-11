// The shell demo: the mini studio (Library grid + filmstrip, Develop viewport with docked slider panels, commands,
// menus, the palette (Mod+K), keys, the probe tool (I), Space for the hand) on a procedural render bridge and the
// Canvas2D presenter. `?fresh` starts without the saved workspace (the browser smoke test uses it).
//
//   pnpm --filter @chromobench/shell demo        → http://localhost:4186/demo/

import { createCk, localStoragePersistence, memoryPersistence, type Runtime } from '../src/index.ts';
import { mount } from '../src/dom/index.ts';
import '../src/dom/shell.css';
import { miniStudio, type MiniState } from '../test/fixtures/mini-studio.ts';
import { gradientBridge } from './gradient-bridge.ts';

declare global {
  interface Window {
    demo?: { rt: Runtime<MiniState>; bridge: ReturnType<typeof gradientBridge> };
  }
}

const fresh = new URLSearchParams(location.search).has('fresh');
const app = miniStudio(createCk<MiniState>(), { n: 40 }).build();
for (const d of app.diagnostics.list) if (d.level !== 'info') console.warn(d.code, d.message);
const bridge = gradientBridge();
const { rt } = await mount(app, document.getElementById('app')!, {
  bridges: [bridge],
  persistence: fresh ? memoryPersistence() : localStoragePersistence(),
});
window.demo = { rt, bridge };
document.body.dataset['ready'] = '1';
