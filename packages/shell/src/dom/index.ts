// The DOM half: mount a built app (or a started runtime) into an element. Importing this module registers the
// built-in renderers; the headless half ('@chromobench/shell') never touches the DOM.
//
//   import { mount } from '@chromobench/shell/dom';
//   import '@chromobench/shell/shell.css';
//   const { rt } = await mount(app, document.getElementById('app')!, { bridges: [myBridge] });

import './forms/basic.ts';
import './forms/container.ts';
import './forms/collection.ts';
import './forms/plane.ts';
import './viewport.ts';

export { mount, mountRuntime, defineRenderer, RENDERERS, MountCtx, Binding, setDisabled, isElement } from './mount.ts';
export type { Renderer, DomApp, DomServices, Mounted } from './mount.ts';
export { DomChrome } from './chrome.ts';
export { DomDock } from './dock.ts';
export { applyTheme } from './theme.ts';
export { h, append, svgEl, icon, hasIcon, listen, clear, drag } from './h.ts';
export * as habits from './habits.ts';
export { resettables } from './forms/container.ts';
export { mountViewport, ZOOMS } from './viewport.ts';
export type { DomViewport } from './viewport.ts';
export { Canvas2DPresenter } from './presenter-2d.ts';
