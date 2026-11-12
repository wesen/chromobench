// @chromobench/studio-kit — `cb`: chromobench's studio vocabulary on the CraftKit shell (CHB-019).
// Headless: nothing here touches the DOM. Renderers are '@chromobench/studio-kit/dom'.
export { createCb, current, visibleFrames, libraryFrames, isOffline, FRAME_CONTEXT, CORE_STATE, type Cb, type CbState, type CatalogFrame } from './cb.ts';
export { defineVariant, buildVariant, type VariantDef, type VariantEnv, type BuiltVariant } from './variant.ts';
export { Studio, createStudio, type StudioOptions, type StudioHost, type HostFlags } from './studio.ts';
export { frameRef, isImageHandle, isFrameRef, effectiveRecipe, ACCESSORS, PRINT_OPTIONS, type FrameRef, type ImageHandle, type Accessor } from './handles.ts';
export { EditLogRoute, recipePathOf, BURST_MS, type Proposal } from './bridge/editlog-route.ts';
export { Frames, kindOf, asOf, logKey, stripFrameId, stripFrameRecipe, type FrameEntry, type Opened, type OpenResult, type InitialRecipe, type FrameKind, type OpenAs, type OpenOutcome, type SourceOpener, type OpenFileOptions } from './bridge/frames.ts';
export { FrameRenderBridge, evaluateBands, type Band, type Lowered } from './bridge/render-bridge.ts';
export { memoryKV, localStorageKV, KV_STORES, type KV, type KvStore } from './bridge/kv.ts';
export { kvPersistence } from './bridge/persistence.ts';
export { argModel, argProblem, parseEntry, parseStep, stepValue, controlModels, controlPaths, STRIPPABLE, type ArgModel } from './kit/args.ts';
export { CB_FORMS } from './kit/forms.ts';
export { explainError, controlTip, rangeText, entryHint, entryPlaceholder, badEntryText, clampEntry, clampedText, relativeText, isRelativeEntry, type Clamped } from './kit/messages.ts';
export { stockName, valueName, STOCK_PATHS } from './model/names.ts';
export * as units from './model/units.ts';
export * from './model/controls.ts';
export * from './model/history.ts';
export * from './model/arrangement.ts';
export * from './model/tools.ts';
export * from './model/recipes.ts';
