// @chromobench/contract — the shared vocabulary every ticket codes against.
// Contract 1.0 (CHB-037, CHB-035 design 01 v2): document format 3 (stages with media and stacks of layers and groups,
// masks, links, bindings), the op catalogue with stages and encodings, the stage laws (light, composite, repair), the
// one compiler with named cuts, validation through the values hooks. Importing this module registers the catalogue.
export const CONTRACT_VERSION = '1.0.0';

export * from './errors.ts';
export * from './units.ts';
export * from './domains.ts';
export * from './spectrum.ts';
export * from './spec.ts';
export * from './source.ts';
export * from './document.ts';
export {
  AREAS, DISPLAY_RGB_CONSUMERS, ENCODINGS, acceptsDomain, allOps, bindArgs, closest, defineOp, editDistance, getOp, hasOp,
  nodeArgs, nodeSlots, opsAccepting, opsByArea, opsForStage, opsProducing, outputChannels, registerOp,
  type Area, type Binding, type BindResult, type Coalesce, type Encoding, type Kind, type LightTerm, type NodeSlot, type OpClass, type OpDef,
} from './registry.ts';
export * from './graph.ts';
export * from './pixel.ts';
export * from './stage-laws.ts';
export * from './links.ts';
export * from './bindings.ts';
export * from './schema.ts';
export * from './compile.ts';
export * from './validate.ts';
export * from './builders.ts';
export * from './editlog.ts';
export * from './engine.ts';
export * from './eval.ts';
export * from './laws.ts';
export * from './roll.ts';
export * from './frame.ts';
export { CATALOG } from './catalog/index.ts';
export { COMBINE_ROLES } from './catalog/capture-film-print.ts';
export type { OpArgs, OpName } from './generated/op-args.ts';
