// Built-in commands every shell has (an app or kit can replace any of them by id). At build the runtime is null:
// the specs are only checked and listed; their handlers never run.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CommandSpec } from '../core/commands.ts';
import type { Runtime } from './runtime.ts';
import type { Theme } from '../build/types.ts';
import { GRAY_IDS } from '../themes/tokens.ts';

export const GRAYS: Record<string, string> = { auto: 'Auto', 1: 'Darkest', 2: 'Dark', 3: 'Medium Gray', 4: 'Light' };

/** the command groups menus pick the theme and gray choices from: { label: 'Theme', items: [{ group: 'Theme' }] } */
export const THEME_GROUP = 'Theme';
export const GRAY_GROUP = 'Interface Gray';

/** View ▸ Theme: one checked command per registered theme (CHB-025); View ▸ Interface Gray: auto and the four grays */
function themeCommands(get: () => Runtime<any> | null, themes: Iterable<Theme>): Record<string, CommandSpec> {
  const out: Record<string, CommandSpec> = {};
  const rt = (): Runtime<any> => {
    const r = get();
    if (!r) throw new Error('built-in commands run only in a started app');
    return r;
  };
  for (const t of themes) {
    const label = t.label ?? t.name.charAt(0).toUpperCase() + t.name.slice(1);
    out['view.theme.' + t.name] = { label, group: THEME_GROUP, ...(t.doc ? { doc: t.doc } : {}), checked: (s: any) => get()?.themeName(s) === t.name, run: () => rt().setTheme(t.name) };
  }
  for (const g of GRAY_IDS) {
    out['view.gray.' + g] = { label: g === 'auto' ? 'Auto (follows the system)' : GRAYS[g]!, group: GRAY_GROUP, checked: (s: any) => String(s.prefs?.gray || 'auto') === g, run: () => rt().setGray(g) };
  }
  return out;
}

export function builtinCommands(get: () => Runtime<any> | null, themes: Iterable<Theme> = []): Record<string, CommandSpec> {
  const rt = (): Runtime<any> => {
    const r = get();
    if (!r) throw new Error('built-in commands run only in a started app');
    return r;
  };
  const noVp = { enabled: () => !!get()?.viewport(), why: 'No picture is shown' };
  return {
    'edit.undo': {
      // an undo that lands on another frame (channel) than the one on screen says which (CHB-027 F12)
      label: () => (get()?.history.last ? `Undo ${get()!.history.last}${get()!.whereOf(get()!.history.entries.at(-1) ?? null)}` : 'Undo'),
      group: 'Edit',
      enabled: () => !!get()?.history.canUndo,
      why: 'Nothing to undo yet',
      run: () => rt().undo(),
    },
    'edit.redo': {
      label: () => (get()?.history.next ? `Redo ${get()!.history.next}${get()!.whereOf(get()!.history.redoStack.at(-1) ?? null)}` : 'Redo'),
      group: 'Edit',
      enabled: () => !!get()?.history.canRedo,
      why: 'Nothing to redo',
      run: () => rt().redo(),
    },
    'app.palette': { label: 'Find a Command…', group: 'Help', run: () => rt().chrome.palette(), palette: false },
    'app.shortcuts': { label: 'Keyboard Shortcuts', group: 'Help', run: () => rt().chrome.shortcuts() },
    'app.diagnostics': { label: 'Build Report', group: 'Help', run: () => rt().chrome.showDiagnostics() },
    'view.hideSides': { label: 'Hide Side Panels', group: 'Window', run: () => rt().workspace.hideSides(), checked: (s: any) => !!s.workspace?.hide?.sides },
    'view.hideAll': { label: 'Hide All Panels', group: 'Window', run: () => rt().workspace.hideAll(), checked: (s: any) => !!s.workspace?.hide?.all },
    'view.toggleLeft': { label: 'Left Panels', group: 'Window', run: () => rt().workspace.toggle('left'), checked: (s: any) => !get()?.workspace.sideHidden(s, 'left') },
    'view.toggleRight': { label: 'Right Panels', group: 'Window', run: () => rt().workspace.toggle('right'), checked: (s: any) => !get()?.workspace.sideHidden(s, 'right') },
    'view.toggleBottom': { label: 'Filmstrip', group: 'Window', run: () => rt().workspace.toggle('bottom'), checked: (s: any) => !get()?.workspace.sideHidden(s, 'bottom') },
    'view.toggleTop': {
      label: 'Module Picker',
      group: 'Window',
      run: () => rt().store.set(['workspace', 'hide', 'top'], !rt().store.peek(['workspace', 'hide', 'top'])),
      checked: (s: any) => !s.workspace?.hide?.top,
    },
    'view.toggleToolbar': { label: 'Toolbar', group: 'View', run: () => rt().workspace.toggleToolbar(), checked: (s: any) => !s.workspace?.hide?.toolbar },
    'view.soloLeft': { label: 'Solo Mode (Left)', group: 'Window', run: () => rt().workspace.toggleSolo('left'), checked: (s: any) => !!s.workspace?.solo?.[s.view?.module + ':left'] },
    'view.soloRight': { label: 'Solo Mode (Right)', group: 'Window', run: () => rt().workspace.toggleSolo('right'), checked: (s: any) => !!s.workspace?.solo?.[s.view?.module + ':right'] },
    'workspace.reset': { label: 'Reset Workspace', group: 'Window', run: () => rt().workspace.reset(rt().store.peek(['view', 'module'])) },
    'view.zoomIn': { label: 'Zoom In', group: 'View', run: () => rt().viewport()?.zoomBy(1), ...noVp },
    'view.zoomOut': { label: 'Zoom Out', group: 'View', run: () => rt().viewport()?.zoomBy(-1), ...noVp },
    'view.fit': { label: 'Fit in Window', group: 'View', run: () => rt().viewport()?.setZoom('fit'), ...noVp },
    'view.actual': { label: 'Actual Pixels (1:1)', group: 'View', run: () => rt().viewport()?.setZoom(1), ...noVp },
    'view.toggle-1:1': {
      label: 'Toggle Zoom View',
      group: 'View',
      run: () => {
        const v = rt().viewport();
        if (v) v.setZoom(v.view.zoom === 'fit' ? 1 : 'fit');
      },
      ...noVp,
    },
    'tool.none': { label: 'No Tool', run: () => rt().selectTool(null), palette: false },
    'app.escape': { label: 'Cancel', palette: false, run: () => rt().escape() },
    'app.theme': { label: (s: any) => `Interface Gray: ${GRAYS[s.prefs?.gray] || 'Auto'}`, group: 'View', run: () => rt().cycleGray() },
    ...themeCommands(get, themes),
  };
}
