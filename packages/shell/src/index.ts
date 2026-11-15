// @chromobench/shell — `ck`: the CraftKit Shell ported to TypeScript. Headless-safe: nothing here touches document,
// window or navigator at module load. The DOM half is '@chromobench/shell/dom'; test helpers '@chromobench/shell/testing'.

import { createCk } from './build/ck.ts';

export { createCk };
export type { Ck, CkOptions, FormNode, FormMethods, FormCtor, Chain, Child, Overlay, PropsFor } from './build/ck.ts';
/** the default instance */
export const ck = createCk();
export default ck;

// core
export { Store, Draft, Writer, MAIN, PathIndex, strip, TxRefused } from './core/store.ts';
export type { Write, TxOpts, WriteInfo, MountDecl, StoreOpts } from './core/store.ts';
export { Cell, Scope, Scheduler } from './core/cells.ts';
export type { CellOpts, SchedulerStats } from './core/cells.ts';
export { browserClock } from './core/clock.ts';
export type { Clock, IdleDeadline } from './core/clock.ts';
export { Commands } from './core/commands.ts';
export type { Command, CommandSpec } from './core/commands.ts';
export { Keymap, KeyRouter, parseChord, chordFromEvent, chordLabel, chordParts, everyModule } from './core/keys.ts';
export type { Binding, KeyTarget, Spring, KeyEventLike } from './core/keys.ts';
export { diag, Diagnostics, BuildError, formatDiag, site, libraryRoot, where, familyOf } from './core/diag.ts';
export type { Diag, DiagLevel, DiagExtra, CallSite } from './core/diag.ts';
export { track, bindingPath, missingKey, Tracker, unwrap, rawOf } from './core/track.ts';
export { parseValue, evalArith, UNITS, MIXED, snap, fmtNum, modStep, monotone } from './core/math.ts';
export { MAC, OTHER, detectPlatform, suggest, getIn, setIn, pathStr, parsePath, deepEq, shallowEq, stable, hash } from './core/util.ts';
export type { Platform, Key, Path } from './core/util.ts';

// ir
export { makeNode, isNode, isProps, walk, mapTree, findAll, rebuildNode, nodeMods, NodeVocab, NODE } from './ir/node.ts';
export type { NodeData } from './ir/node.ts';
export { slot, commonSlots } from './ir/slots.ts';
export type { Slot, Time, PropOf, PropsOf, Traced, CommandRef, NotFn, SlotTable } from './ir/slots.ts';
export { builtinForms } from './ir/forms.ts';
export type { FormSpec, FormSlotsMap, BuiltinForm } from './ir/forms.ts';
export { ICONS } from './ir/icons.ts';

// build
export { shellMods, moduleMods, menu, MENUS, type ShellValue, type ModuleValue, type ModuleProps, type MenuValue, type ShellDef } from './build/shell.ts';
export { kit, isKit, kitMods, product, type KitValue, type KitProduct, type ProductParts, type CommandTable, type ToolTable } from './build/kits.ts';
export { BuilderKind, type Built, type BuilderWith, type TrailStep } from './build/builder.ts';
export { fragment, isFragment } from './build/fragments.ts';
export { pass, isPass, runPasses, orderPasses } from './build/passes.ts';
export { explainNode, explainKit, explainApp, explainDiags } from './build/explain.ts';
export { BUILTIN_PASSES } from './build/checks.ts';
export type { UiIR, Kit, KitDef, Fragment, FragmentSpec, PassDef, PassCtx, IrSpec, Theme, ToolSpec, ToolEvent, ModuleDef, StateOpts, ShellOpts, Region, MenuItem } from './build/types.ts';

// app
export { BuiltApp } from './app/built-app.ts';
export { Runtime } from './app/runtime.ts';
export type { Services, Ctx, Explained, WriterOf, ViewportApi, Inspect } from './app/runtime.ts';
export { RecordingChrome, resolveMenu, menuBar, paletteEntries, searchPalette } from './app/chrome.ts';
export type { ChromeApi, DialogSpec, ToastOpts, MenuRow, PaletteEntry } from './app/chrome.ts';
export { Workspace, SIDES } from './app/workspace.ts';
export { memoryPersistence, localStoragePersistence, startAutosave } from './app/persist.ts';
export type { PersistenceAdapter, SaveKey, Saved } from './app/persist.ts';
export { RenderQueue, chooseTarget, DRAFT_PIXELS } from './app/render/queue.ts';
export type { RenderBridge, RenderTarget, Rendered, Presenter, PresentImage, ViewTransform, Colours, Rect, Lane, RenderPass } from './app/render/types.ts';

// themes
export { craftkit, lightroom } from './themes/craftkit.ts';
export { THEME_GROUP, GRAY_GROUP } from './app/builtins.ts';
export { themeTokens, resolveTheme, GRAY_IDS, DEFAULT_THEME, THEME_ALIASES, type ThemeTokens } from './themes/tokens.ts';
export { chromogen } from './themes/chromogen.ts';
