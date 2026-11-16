// The DOM half of studio-kit: renderers for the cb forms, and mountStudio(), which mounts a built layout with the
// studio's services (adapters, bridges, persistence) plus these renderers, then attaches the studio to the runtime.
//
//   import { mountStudio } from '@chromobench/studio-kit/dom';
//   import '@chromobench/shell/shell.css'; import '@chromobench/studio-kit/studio-kit.css';
//   const { rt } = await mountStudio(app, el, studio, { presenter });

import { mount, type DomServices, type Mounted } from '@chromobench/shell/dom';
import type { BuiltApp } from '@chromobench/shell';
import type { Studio } from '../studio.ts';
import { CB_RENDERERS } from './panels.ts';

export { CB_RENDERERS } from './panels.ts';
export { renderArg } from './arg.ts';
export { exportForm } from './output.ts';
import { exportForm } from './output.ts';

export async function mountStudio<S>(app: BuiltApp<S>, root: HTMLElement, studio: Studio, extra: DomServices = {}): Promise<Mounted<S>> {
  const services = studio.services(extra) as DomServices;
  services.renderers = { ...CB_RENDERERS, ...(extra.renderers || {}) };
  // File ▸ Export…'s form (CHB-047)
  services['exportForm'] ??= exportForm;
  const mounted = await mount(app, root, services);
  studio.attach(mounted.rt);
  return mounted;
}
