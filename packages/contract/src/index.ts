// @chromobench/contract — the shared vocabulary every ticket codes against.
// Importing this module registers the v0 catalog.
export const CONTRACT_VERSION = '0.1.0';

export * from './errors.ts';
export * from './units.ts';
export * from './domains.ts';
export * from './spectrum.ts';
export * from './spec.ts';
export * from './source.ts';
export * from './recipe.ts';
export {
  AREAS, DISPLAY_RGB_CONSUMERS, acceptsDomain, allOps, argPath, bindArgs, closest, defineOp, editDistance, getOp, hasOp,
  nodeArgs, opsAccepting, opsByArea, opsProducing, outputChannels, pathOwners, recipeBackedArgs, registerOp,
  type Area, type Binding, type BindResult, type Kind, type OpClass, type OpDef,
} from './registry.ts';
export * from './graph.ts';
export * from './paths.ts';
export * from './mutations.ts';
export * from './editlog.ts';
export * from './engine.ts';
export * from './eval.ts';
export * from './laws.ts';
export { CATALOG } from './catalog/index.ts';
export type { OpArgs, OpName } from './generated/op-args.ts';
