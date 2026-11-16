// @chromobench/studio-kit — `cb`: chromobench's studio vocabulary on the CraftKit shell (CHB-019; CHB-037: frames
// are format-3 documents in the store's log). Headless: nothing here touches the DOM. Renderers are
// '@chromobench/studio-kit/dom'.
export { createCb, FRAME_CONTEXT, CORE_STATE, NO_FRAME, type Cb } from './cb.ts';
export { sel, NO_RATING, type Sel, type CbState, type CatalogFrame, type CatalogEntry, type Rating, type Selection, type Snapshot, type CbView, type CbUi, type CbPrefs } from './sel.ts';
export { defineLayout, buildLayout, type LayoutDef, type LayoutEnv, type BuiltLayout } from './layout.ts';
export { Studio, createStudio, frameName, initialInMode, type StudioOptions, type StudioHost, type HostFlags, type Proposal, type LogView, type Approved } from './studio.ts';
export { frameRef, isImageHandle, isFrameRef, effectiveDoc, cutOf, ACCESSORS, type FrameRef, type ImageHandle, type Accessor } from './handles.ts';
export { Frames, kindOf, asOf, logKey, stripFrameId, stripFrameDocument, rescaleStrip, hashBytes, type FrameEntry, type Opened, type OpenResult, type InitialDocument, type FrameKind, type OpenAs, type OpenOutcome, type SourceOpener, type OpenFileOptions } from './bridge/frames.ts';
export { FrameRenderBridge, evaluateBands, type Band, type Lowered } from './bridge/render-bridge.ts';
export { memoryKV, localStorageKV, KV_STORES, type KV, type KvStore } from './bridge/kv.ts';
export { kvPersistence } from './bridge/persistence.ts';
export { frameSave, restoreFrame, replayFrame, isFrameSave, resetStorage, STORAGE_FORMAT, STORAGE_RESET_MESSAGE, FRAME_SAVE_FORMAT, type FrameSave, type SavedTx } from './bridge/saved.ts';
export { argModel, argProblem, modelAt, parseEntry, parseStep, stepValue, controlModels, controlPaths, STRIPPABLE, type ArgModel } from './kit/args.ts';
export { CB_FORMS } from './kit/forms.ts';
export { explainError, controlTip, rangeText, entryHint, entryPlaceholder, badEntryText, clampEntry, clampedText, relativeText, isRelativeEntry, type Clamped } from './kit/messages.ts';
export { setStockNames, stockName, valueName, STOCK_PATHS } from './model/names.ts';
export { mediumStocks, pickerOf, presetsOf, setMediumStocks, PICKER_KINDS, PRESET_PATHS, type Picker, type PickerKind, type PickerOption } from './model/presets.ts';
export * from './model/white-balance.ts';
export * as units from './model/units.ts';
export * from './model/controls.ts';
export * from './model/history.ts';
export * from './model/arrangement.ts';
export * from './model/tools.ts';
export * from './model/settings.ts';
export * from './model/enlarger-mode.ts';
export * from './model/aim.ts';
export * from './model/doc.ts';
