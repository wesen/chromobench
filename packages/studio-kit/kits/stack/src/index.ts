// @chromobench/studio-kit/kits/stack — one stack kit for every stage (CHB-035 §33). Headless; the renderers are in dom.ts.
export { createStackKit, STACK_FORMS, type LayersOptions, type StackKit } from './kit.ts';
export * from './model.ts';
export { STACK_STATE, selectedIn, type StackView } from './state.ts';
export { stagePolicy, stagesShown, walk } from './passes.ts';
export { MASK_TOOLS, maskTools, stackCommands } from './commands.ts';
