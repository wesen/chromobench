// Assemble the command table and the key map from the ui IR. The build (keys pass) and the runtime use the same
// function, so what the build checks is exactly what the runtime answers. Built-in commands come first; a program
// or kit may replace any of them by id.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Commands, type CommandSpec } from '../core/commands.ts';
import { Keymap, type KeyTarget } from '../core/keys.ts';
import { OTHER, type Platform } from '../core/util.ts';
import { isNode, walk } from '../ir/node.ts';
import type { MenuDef, MenuItem, UiIR } from '../build/types.ts';

export const COLLECTION_FORMS = ['listview', 'gridview', 'filmstrip', 'treeview'];

export interface Assembled {
  commands: Commands;
  keymap: Keymap;
  /** tool id → the modules whose viewports list it */
  offered: Map<string, Set<string>>;
}

export const BUILTIN_KEYS = (palette: string): Record<string, KeyTarget> => ({
  'Mod+Z': 'edit.undo',
  'Mod+Shift+Z': 'edit.redo',
  [palette || 'Mod+K']: 'app.palette',
  'Mod+/': 'app.shortcuts',
  Tab: 'view.hideSides',
  'Shift+Tab': 'view.hideAll',
  F5: 'view.toggleTop',
  F6: 'view.toggleBottom',
  F7: 'view.toggleLeft',
  F8: 'view.toggleRight',
  'Mod+=': 'view.zoomIn',
  'Mod+-': 'view.zoomOut',
  'Mod+0': 'view.fit',
  'Mod+Alt+0': 'view.actual',
  Escape: 'app.escape',
});

export function assemble(ir: UiIR, builtins: Record<string, CommandSpec>, platform: Platform = OTHER, selectTool: (id: string) => void = () => {}): Assembled {
  const commands = new Commands();
  const keymap = new Keymap(platform);
  for (const [id, spec] of Object.entries(builtins)) commands.add(id, { at: ir.at, builtin: true, ...spec });
  keymap.bindMap('global', BUILTIN_KEYS(ir.palette.keys), ir.at);
  for (const c of ir.commands) commands.add(c.id, c.spec);
  for (const k of ir.keys) keymap.bindMap(k.scope, k.map, k.at);
  for (const mod of ir.modules) {
    for (const k of mod.keys) keymap.bindMap(k.scope, k.map, k.at);
    if (mod.key) {
      if (!commands.has('module.' + mod.id))
        commands.add('module.' + mod.id, { label: mod.label, run: (ctx: any) => ctx.go(mod.id), checked: (s: any) => s.view?.module === mod.id, group: 'Window', at: mod.at });
      keymap.bind('module:*', mod.key, 'module.' + mod.id, mod.at);
    }
  }
  // which modules offer each tool: the tools their viewports name
  const offered = new Map<string, Set<string>>();
  for (const md of ir.modules)
    for (const r of Object.values(md.regions))
      if (r && isNode(r))
        walk(r, n => {
          if (n.$ === 'viewport' || n.props['viewport'] === true) for (const t of (n.props['tools'] as string[]) || []) (offered.get(t) || offered.set(t, new Set()).get(t)!).add(md.id);
        });
  for (const [id, t] of ir.tools) {
    // a tool shows in menus and the palette, and answers its key, only in the modules that offer it
    const where = t.module ? ([] as string[]).concat(t.module) : [...(offered.get(id) || [])];
    if (t.key) {
      if (!where.length) keymap.bind('module:*', t.key, 'tool.' + id, t.at ?? null);
      else for (const mid of where) keymap.bind('module:' + mid, t.key, 'tool.' + id, t.at ?? null);
    }
    if (!commands.has('tool.' + id) || commands.get('tool.' + id)!.builtin)
      commands.add('tool.' + id, {
        label: t.label || id,
        ...(t.icon ? { icon: t.icon } : {}),
        run: () => selectTool(id),
        checked: (s: any) => s.ui?.tool === id,
        ...(t.enabled !== undefined ? { enabled: t.enabled } : {}),
        ...(t.why !== undefined ? { why: t.why } : {}),
        at: t.at ?? null,
        group: 'Tools',
        ...(where.length ? { module: where } : {}),
      });
  }
  for (const s of ir.springs) {
    try {
      keymap.spring(s.chord, s.tool, s.opts, s.at);
    } catch (e) {
      keymap.bindings.push({ scope: 'spring', chord: s.chord, bad: (e as Error).message, target: '', at: s.at });
    }
  }
  // a collection's own keys join the key map under collection:<id>, so they are checked and listed in the
  // shortcut sheet (the collection still handles them itself while it has focus)
  const seen = new Set<unknown>();
  for (const { node } of ir.trees())
    walk(node, n => {
      if (seen.has(n)) return false;
      seen.add(n);
      if (COLLECTION_FORMS.includes(n.$) && n.props['keys']) keymap.bindMap('collection:' + (n.props['id'] || n.$), n.props['keys'] as Record<string, KeyTarget>, n.at);
      return undefined;
    });
  return { commands, keymap, offered };
}

/** command id → the label of the first menu that places it (menus are the one source of where a command is) */
export function menuIndex(menus: readonly MenuDef[]): Map<string, string> {
  const out = new Map<string, string>();
  const add = (items: readonly MenuItem[], label: string): void => {
    for (const it of items || []) {
      if (typeof it === 'string') {
        if (it !== '-' && !out.has(it)) out.set(it, label);
      } else if (it && typeof it === 'object' && Array.isArray(it.items)) add(it.items, label);
    }
  };
  for (const m of menus) add(m.items, m.label);
  return out;
}
