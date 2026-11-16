// @chromobench/studio-kit/kits/select — selections as mask components (CHB-049, D3). Headless; the renderer is dom.ts.
export { createSelectKit, type SelectKit } from './kit.ts';
export { SELECT_TOOLS, selectCommands, selectTools, combineOf, boxOf, outlineOf } from './commands.ts';
export { SELECT_STATE, type SelectView } from './state.ts';
