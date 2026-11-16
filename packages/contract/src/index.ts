// @chromobench/contract — the shared vocabulary every ticket codes against.
// Contract 1.0 (CHB-037, CHB-035 design 01 v2): document format 3 (stages with media and stacks of layers and groups,
// masks, links with registered look functions, bindings), the op catalogue with stages and encodings, the stage laws (light, composite, repair), the
// one compiler with named cuts, validation through the values hooks (a frame's history is the values document log
// with LOG_RULES). Contract 1.1 (CHB-037 P8a): the composite op set, blend modes, working encodings, colour and radial
// masks. Importing this module registers the catalogue.
export const CONTRACT_VERSION = '1.6.0';

export * from './errors.ts';
export * from './units.ts';
export * from './domains.ts';
export * from './spectrum.ts';
export * from './spec.ts';
export * from './source.ts';
export * from './document.ts';
export {
  AREAS, DISPLAY_RGB_CONSUMERS, ENCODINGS, LAYER_MENUS, acceptsDomain, allOps, bindArgs, closest, defineOp, editDistance, getOp, hasOp,
  nodeArgs, nodeSlots, opEncoding, opsAccepting, opsByArea, opsForStage, opsProducing, outputChannels, registerOp,
  type Area, type Binding, type BindResult, type Coalesce, type EncodingSpec, type LayerMenu, type OpEncoding, type OpUi, type Kind, type LightTerm,
  type NodeSlot, type OpClass, type OpDef,
} from './registry.ts';
export * from './encodings.ts';
export * from './graph.ts';
export * from './pixel.ts';
export * from './stage-laws.ts';
export * from './links.ts';
export * from './links-looks.ts';
export * from './bindings.ts';
export * from './schema.ts';
export * from './compile.ts';
export * from './validate.ts';
export * from './builders.ts';
export * from './engine.ts';
export * from './eval.ts';
export * from './laws.ts';
export * from './roll.ts';
export * from './frame.ts';
export * from './scale.ts';
export { CATALOG } from './catalog/index.ts';
export { DEFAULT_HSL_BANDS } from './catalog/adjust.ts';
export { COMBINE_ROLES } from './catalog/capture-film-print.ts';
export type { OpArgs, OpName } from './generated/op-args.ts';
