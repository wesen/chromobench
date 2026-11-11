// The built-in `ui` passes: CraftKit's App.check() split into passes, plus the new ones.
//
//   normalize  apply pending fragment calls, collect panels, assemble commands and keys      X110–X123
//   slots      unknown options, lambdas in β slots, bad bind values, unknown forms            B130, B140, B141, B160
//   bindings   bind paths against the initial state or a route (probe mode)                   B110–B114
//   docking    unknown or twice-placed panels, modules without a centre                       D301–D303
//   menus      menu items naming missing commands                                             B150
//   keys       the K2xx checks                                                                K201–K221
//   match      ck.match exhaustiveness                                                        M201
//   tools      unknown tools, tools without on.down, springs to unknown tools                V302, T401, K221
//   icons      unknown icons                                                                  B170
//   a11y       unlabelled icon buttons                                                        B180
//   reach      panels placed nowhere, commands reachable from nothing                         I010, I011
//   summary    counts and totals                                                              I001

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Diagnostics } from '../core/diag.ts';
import { Store } from '../core/store.ts';
import { bindingPath, missingKey } from '../core/track.ts';
import { pathStr, suggest, parsePath, type Key, type Platform } from '../core/util.ts';
import type { CommandSpec } from '../core/commands.ts';
import { isNode, walk, type NodeData } from '../ir/node.ts';
import { commonSlots, type SlotTable } from '../ir/slots.ts';
import type { FormSpec } from '../ir/forms.ts';
import { ICONS } from '../ir/icons.ts';
import { assemble, type Assembled } from '../app/assemble.ts';
import { applyCalls, extendForms, indexFragments, type FragmentIndex } from './fragments.ts';
import { pass } from './passes.ts';
import type { PassCtx, PassDef, UiIR, MenuItem } from './types.ts';

export interface UiPassCtx extends PassCtx {
  D: Diagnostics;
  platform: Platform;
  builtins: Record<string, CommandSpec>;
}

const fx = (p: PassCtx): UiPassCtx => p as UiPassCtx;

/** every node once, with where it was found */
function eachNode(ir: UiIR, f: (n: NodeData, where: string) => void): void {
  const seen = new Set<NodeData>();
  for (const t of ir.trees())
    walk(t.node, n => {
      if (seen.has(n)) return false;
      seen.add(n);
      f(n, t.where);
      return undefined;
    });
}

const slotsOf = (forms: Map<string, FormSpec>, form: string): SlotTable | null => {
  const s = forms.get(form);
  return s ? { ...commonSlots, ...s.slots } : null;
};

export const normalizePass: PassDef<UiIR> = pass<UiIR>('normalize', { on: 'ui' }, (ir, p) => {
  const D = fx(p).D;
  const idx: FragmentIndex = indexFragments(ir.fragments, D);
  ir.forms = extendForms(ir.forms, idx);
  p.facts.set('fragments', idx);
  // pending fragment calls, in every tree
  for (const [id, panel] of ir.panels) ir.panels.set(id, applyCalls(panel, idx, ir.forms, D, `panel '${id}'`));
  for (const m of ir.modules)
    for (const [side, r] of Object.entries(m.regions)) if (r && isNode(r)) (m.regions as any)[side] = applyCalls(r, idx, ir.forms, D, `module '${m.id}' ${side}`);
  for (const t of ir.tools.values()) if (t.content && isNode(t.content)) t.content = applyCalls(t.content, idx, ir.forms, D, `tool '${t.id}'`);
  // panels defined inline where they are placed are panels too (first definition wins)
  for (const m of ir.modules)
    for (const r of Object.values(m.regions))
      if (r)
        walk(r, n => {
          if (n.$ === 'panel' && n.props['id'] != null && !ir.panels.has(String(n.props['id']))) ir.panels.set(String(n.props['id']), n);
        });
  // CraftKit compatibility: references to panels known only to the Ck instance (defined anywhere through it)
  const registry = (p as any).registry as Map<string, NodeData> | undefined;
  if (registry)
    for (const t of ir.trees())
      walk(t.node, n => {
        const id = String(n.props['id']);
        if (n.$ === 'panelref' && !ir.panels.has(id) && registry.has(id)) ir.panels.set(id, applyCalls(registry.get(id)!, idx, ir.forms, D, `panel '${id}'`));
      });
  const asm = assemble(ir, fx(p).builtins, fx(p).platform);
  p.facts.set('assembled', asm);
  ir.hasCommand = (id: string) => asm.commands.has(id);
});

export const slotsPass = pass<UiIR>('slots', { on: 'ui', after: 'normalize' }, (ir, p) => {
  eachNode(ir, (n, where) => {
    for (const d of n.diags) fx(p).D.add(d);
    const spec = ir.forms.get(n.$);
    if (!spec) {
      const s = suggest(n.$, [...ir.forms.keys()]);
      p.error('CK-B160', `No form '${n.$}'`, { at: n.at, facts: [`in ${where}`], fix: s.length ? `Did you mean '${s[0]}'? (or install the kit that defines it)` : 'Install the kit that defines it with .use(kit), or define it with ck.form(…).' });
      return;
    }
    if (spec.open) return;
    const slots = slotsOf(ir.forms, n.$)!;
    for (const [k, v] of Object.entries(n.props)) {
      const t = slots[k];
      if (!t) {
        const s = suggest(k, Object.keys(slots));
        p.warn('CK-B130', `Unknown option '${k}' for ${n.$}`, {
          at: n.at,
          facts: [`${n.$} takes: ${Object.keys(spec.slots).join(', ')}`],
          fix: s.length ? `Did you mean '${s[0]}'?` : 'Remove it, or check the form’s options in the reference.',
        });
        continue;
      }
      if (t.time === 'β' && typeof v === 'function' && !(v as any).isCommand && !(v as any).form) {
        const taus = Object.entries(slots)
          .filter(([, b]) => b.time === 'τ')
          .map(([x]) => x)
          .slice(0, 6);
        p.error('CK-B140', `A lambda in a build-time option: ${n.$}.${k}`, {
          at: n.at,
          facts: [`'${k}' is read once while the program builds (β); a lambda here would run once and never again.`],
          fix: `Pass a value. If it should follow state, the form needs a τ slot for it; ${taus.join(', ')} are τ.`,
        });
      }
      if (t.time === 'bind' && v != null && typeof v !== 'function' && typeof v !== 'string')
        p.error('CK-B141', `${n.$}.${k} needs a lambda naming a path`, { at: n.at, facts: [`got ${typeof v}`], fix: `${k}: s => s.develop.light.exposure` });
    }
  });
});

export const bindingsPass = pass<UiIR>('bindings', { on: 'ui', after: 'slots' }, (ir, p) => {
  const st = new Store(withDefaults(ir.init), { view: ir.view, routes: ir.routes });
  for (const d of ir.derived) st.derive(d.path, d.fn);
  const check = (n: NodeData, key: string, bind: unknown): void => {
    let path: Key[] | null;
    let probed = false;
    if (typeof bind === 'string') path = parsePath(bind);
    else {
      const r = bindingPath(st, bind as (s: any) => unknown, { probe: true });
      if (r.error) {
        p.error('CK-B112', 'A binding failed on the initial state', { at: n.at, facts: [String((r.error as Error)?.message || r.error)], fix: 'Bindings run against the initial state at build; give every path an initial value.' });
        return;
      }
      path = r.path;
      // a read went through a missing value before the last key (s.dev[s.ui.selection.primary] with no selection)
      probed = r.probed && r.path != null && (missingKey(st.current, r.path)?.index ?? r.path.length) < r.path.length - 1;
    }
    if (!path) {
      p.error('CK-B113', 'A binding that reads no state', { at: n.at, facts: [`${n.$}.${key} = ${String(bind).slice(0, 60)}`], fix: `${key}: s => s.some.path` });
      return;
    }
    const route = ir.routes.find(r => {
      const pre = parsePath(r.prefix);
      return pre.every((k, i) => String(path![i]) === String(k));
    });
    if (route) {
      const pre = parsePath(route.prefix);
      const rest = path.slice(pre.length + (route.keyDepth ?? 0));
      const shown = [...pre, ...Array(route.keyDepth ?? 0).fill('*'), ...rest].join('.');
      const res = route.checkPath ? route.checkPath(rest) : null;
      if (res) {
        const r = typeof res === 'string' ? { message: res } : res;
        p.error('CK-B114', `Binding path not in route '${route.prefix}'`, {
          at: n.at,
          facts: [`s.${shown}: ${r.message}`],
          ...(r.fix ? { fix: r.fix } : {}),
          ...(r.valid ? { valid: r.valid } : {}),
          path: shown,
        });
      }
      return;
    }
    const miss = missingKey(st.current, path);
    if (miss && !st.derivedAt(path)) {
      if (miss.parentMissing || probed)
        p.warn('CK-B111', 'Binding path not in the initial state', {
          at: n.at,
          facts: [`s.${pathStr(path)}: s.${pathStr(miss.parent) || '(root)'} ${miss.parentMissing ? (miss.parent.length ? 'is not an object yet' : 'is missing') : `has no '${String(miss.key)}' yet`}.`],
          fix: `Give s.${pathStr(miss.parent.length ? miss.parent : path)} an initial value in .state(…), so the build can check the rest of the path.`,
        });
      else {
        const s = suggest(String(miss.key), miss.has);
        p.error('CK-B110', 'Binding path not in state', {
          at: n.at,
          facts: [`s.${pathStr(path)} does not exist.`, `${pathStr(miss.parent) || 'the state'} has: ${miss.has.slice(0, 12).join(', ')}${miss.has.length > 12 ? ', …' : ''}`],
          fix: s.length ? `Did you mean s.${pathStr(miss.parent.concat([s[0]!]))}?` : `Add ${String(miss.key)} to the initial state.`,
          path: pathStr(path),
        });
      }
    }
  };
  eachNode(ir, n => {
    if (n.props['lazy']) return;
    const slots = slotsOf(ir.forms, n.$);
    if (!slots) return;
    for (const [k, v] of Object.entries(n.props)) {
      if (slots[k]?.time === 'bind' && (typeof v === 'function' || typeof v === 'string')) check(n, k, v);
    }
    const sel = n.props['select'] as { bind?: unknown } | undefined;
    if (sel && typeof sel === 'object' && (typeof sel.bind === 'function' || typeof sel.bind === 'string')) check(n, 'select.bind', sel.bind);
  });
});

export const dockingPass = pass<UiIR>('docking', { on: 'ui', after: 'normalize' }, (ir, p) => {
  const ids = [...ir.panels.keys()];
  const missing = (n: NodeData, id: string, where: string): void => {
    const s = suggest(id, ids);
    p.error('CK-D302', `No panel '${id}'`, { at: n.at, facts: [`placed in ${where}`, `panels: ${ids.join(', ') || 'none defined'}`], fix: s.length ? `Did you mean '${s[0]}'?` : `Define it with ck.panel('${id}', { title }, …) first.` });
  };
  for (const t of ir.trees())
    walk(t.node, n => {
      if (n.$ === 'docktabs') for (const id of (n.props['panels'] as string[]) || []) if (!ir.panels.has(id)) missing(n, id, `a tab group in ${t.where}`);
      if (n.$ === 'panelref' && !ir.panels.has(String(n.props['id']))) missing(n, String(n.props['id']), t.where);
    });
  for (const mod of ir.modules) {
    const placed = new Map<string, string>();
    for (const [side, r] of Object.entries(mod.regions)) {
      if (!r) continue;
      walk(r, n => {
        const list = n.$ === 'docktabs' ? (n.props['panels'] as string[]) || [] : n.$ === 'panelref' || n.$ === 'panel' ? [String(n.props['id'])] : [];
        for (const id of list) {
          if (placed.has(id))
            p.error('CK-D301', `Panel '${id}' placed twice in module '${mod.id}'`, { at: n.at, facts: [`first: ${placed.get(id)}`, `again: ${side}`], fix: 'A panel lives in one place per module; use ck.dock.tabs to group it with others.' });
          else placed.set(id, side);
        }
      });
    }
    if (!mod.regions.center) p.warn('CK-D303', `Module '${mod.id}' has no centre`, { at: mod.at, facts: ['Nothing fills the middle of the window.'], fix: `.module('${mod.id}', m => m.center(ck.viewport(…)))` });
  }
});

export const menusPass = pass<UiIR>('menus', { on: 'ui', after: 'normalize' }, (ir, p) => {
  const has = (id: string): boolean => ir.hasCommand(id);
  const asm = p.facts.get('assembled') as Assembled;
  const checkItems = (items: MenuItem[], menu: { label: string; at: any }): void => {
    for (const it of items || []) {
      if (typeof it === 'string' && it !== '-' && !has(it)) {
        const s = asm.commands.suggest(it);
        p.error('CK-B150', `Menu '${menu.label}' names a command that does not exist`, { at: menu.at, facts: [`'${it}'`], fix: s.length ? `Did you mean '${s[0]}'?` : 'Add the command first.' });
      }
      if (it && typeof it === 'object' && Array.isArray(it.items)) checkItems(it.items, menu);
    }
  };
  for (const m of ir.menus) checkItems(m.items, m);
  for (const [scope, items] of ir.contexts) if (Array.isArray(items)) checkItems(items as MenuItem[], { label: `context ${scope}`, at: ir.at });
  eachNode(ir, n => {
    if (n.$ === 'toolbar')
      for (const it of (n.props['items'] as unknown[]) || [])
        if (typeof it === 'string' && it !== '-' && it !== '~' && !has(it)) {
          const s = asm.commands.suggest(it);
          p.error('CK-B151', `A toolbar names a command that does not exist`, { at: n.at, facts: [`'${it}'`], fix: s.length ? `Did you mean '${s[0]}'?` : 'Add the command first.' });
        }
    if (n.$ === 'button' && typeof n.props['run'] === 'string' && !has(n.props['run'])) {
      const s = asm.commands.suggest(n.props['run']);
      p.error('CK-B152', `A button runs a command that does not exist`, { at: n.at, facts: [`'${n.props['run']}'`], fix: s.length ? `Did you mean '${s[0]}'?` : 'Add the command first.' });
    }
  });
});

export const keysPass = pass<UiIR>('keys', { on: 'ui', after: 'normalize' }, (ir, p) => {
  const asm = p.facts.get('assembled') as Assembled;
  for (const b of asm.keymap.bindings.filter(x => x.scope === 'spring' && x.bad))
    p.error('CK-K202', 'A spring chord that does not parse', { at: b.at, facts: [`'${b.chord}': ${b.bad}`] });
  asm.keymap.bindings = asm.keymap.bindings.filter(x => x.scope !== 'spring');
  asm.keymap.check(fx(p).D, asm.commands, ir.modules.map(m => m.id));
});

export const matchPass = pass<UiIR>('match', { on: 'ui', after: 'normalize' }, (ir, p) => {
  eachNode(ir, n => {
    if (n.$ === 'match' && Array.isArray(n.props['of'])) {
      const cases = (n.props['cases'] || {}) as Record<string, unknown>;
      const missing = (n.props['of'] as string[]).filter(k => !(k in cases));
      if (missing.length && !('default' in cases))
        p.error('CK-M201', 'ck.match does not cover every case', { at: n.at, facts: [`missing: ${missing.join(', ')}`], fix: `Add ${missing.map(k => `${k}: …`).join(', ')}, or a default case.` });
    }
  });
});

export const toolsPass = pass<UiIR>('tools', { on: 'ui', after: 'normalize' }, (ir, p) => {
  const ids = [...ir.tools.keys()];
  eachNode(ir, n => {
    if (n.$ !== 'viewport' && n.props['viewport'] !== true) return;
    for (const t of (n.props['tools'] as string[]) || [])
      if (!ir.tools.has(t)) {
        const s = suggest(t, ids);
        p.error('CK-V302', `Viewport names a tool that does not exist: '${t}'`, { at: n.at, facts: [`tools: ${ids.join(', ') || 'none'}`], fix: s.length ? `Did you mean '${s[0]}'?` : `Add it with .tools(t => t.tool('${t}', { … }))` });
      }
  });
  for (const t of ir.tools.values())
    if (t.on && !t.on.down && !t.select && !t.image && !t.content)
      p.warn('CK-T401', `Tool '${t.id}' has no on.down`, { at: t.at ?? null, facts: ['It can be selected but does nothing on the canvas.'], fix: 'Give it on: { down, drag, up }.' });
  for (const s of ir.springs)
    if (typeof s.tool === 'string' && !ir.tools.has(s.tool) && !['hand', 'zoom'].includes(s.tool))
      p.error('CK-K221', `Spring to a tool that does not exist: '${s.tool}'`, { at: s.at, facts: [`tools: ${ids.join(', ') || 'none'} (and the built-in hand, zoom)`] });
});

export const iconsPass = pass<UiIR>('icons', { on: 'ui', after: 'normalize' }, (ir, p) => {
  const known = { ...ICONS, ...ir.icons };
  const pool = Object.keys(known);
  const check = (name: unknown, at: any, what: string): void => {
    if (typeof name !== 'string' || !name || known[name]) return;
    const s = suggest(name, pool);
    p.warn('CK-B170', `Unknown icon '${name}'`, { at, facts: [`on ${what}`], fix: s.length ? `Did you mean '${s[0]}'?` : `Add it with .icons({ ${name}: 'M…' }) (12-unit path data).` });
  };
  eachNode(ir, n => {
    if (n.$ === 'glyph' && typeof n.props['name'] === 'string') check(n.props['name'], n.at, 'an icon');
    if (n.props['icon'] !== undefined) check(n.props['icon'], n.at, n.$);
  });
  for (const m of ir.modules) if (m.icon) check(m.icon, m.at, `module '${m.id}'`);
  for (const c of ir.commands) if (c.spec.icon) check(c.spec.icon, c.at, `command '${c.id}'`);
  for (const t of ir.tools.values()) if (t.icon) check(t.icon, t.at ?? null, `tool '${t.id}'`);
});

export const a11yPass = pass<UiIR>('a11y', { on: 'ui', after: 'normalize' }, (ir, p) => {
  eachNode(ir, n => {
    if (n.$ === 'button' && n.props['icon'] && n.props['label'] === undefined && n.props['text'] === undefined && n.props['tip'] === undefined && typeof n.props['run'] !== 'string')
      p.warn('CK-B180', 'An icon button without a label', { at: n.at, facts: [`icon '${String(n.props['icon'])}' has no label, text or tip; a screen reader says nothing.`], fix: "Add tip: 'What it does', or run a command (which brings its label)." });
  });
});

export const reachPass = pass<UiIR>('reach', { on: 'ui', after: ['docking', 'keys'] }, (ir, p) => {
  const placed = new Set<string>();
  for (const m of ir.modules)
    for (const r of Object.values(m.regions))
      if (r)
        walk(r, n => {
          if (n.$ === 'panel' || n.$ === 'panelref') placed.add(String(n.props['id']));
          if (n.$ === 'docktabs') for (const id of (n.props['panels'] as string[]) || []) placed.add(id);
        });
  // panels referenced inside other panels count as placed too
  for (const panel of ir.panels.values())
    walk(panel, n => {
      if (n !== panel && (n.$ === 'panel' || n.$ === 'panelref')) placed.add(String(n.props['id']));
    });
  const unplaced = [...ir.panels.keys()].filter(id => !placed.has(id));
  if (unplaced.length) p.info('CK-I010', 'Panels placed nowhere', { at: ir.at, facts: [unplaced.join(', ')], fix: 'Place them in a module (or leave them for the palette: "Show … panel" still lists them).' });
  const asm = p.facts.get('assembled') as Assembled;
  const inMenus = new Set<string>();
  const addItems = (items: MenuItem[]): void => {
    for (const it of items || []) {
      if (typeof it === 'string') inMenus.add(it);
      else if (it && typeof it === 'object' && Array.isArray(it.items)) addItems(it.items);
    }
  };
  for (const m of ir.menus) addItems(m.items);
  eachNode(ir, n => {
    if (n.$ === 'button' && typeof n.props['run'] === 'string') inMenus.add(n.props['run']);
    if (n.$ === 'toolbar') addItems((n.props['items'] as MenuItem[]) || []);
  });
  const keyed = new Set(asm.keymap.bindings.map(b => (Array.isArray(b.target) ? b.target[0] : b.target)).filter(x => typeof x === 'string'));
  const lost = asm.commands
    .all()
    .filter(c => !c.builtin && c.palette === false && !inMenus.has(c.id) && !keyed.has(c.id) && !(ir.menus.length === 0 && c.menu))
    .map(c => c.id);
  if (lost.length) p.info('CK-I011', 'Commands reachable from nothing', { at: ir.at, facts: [lost.join(', ')], fix: 'Give them a menu, a key, a toolbar button, or palette: true.' });
});

export const summaryPass = pass<UiIR>('summary', { on: 'ui' }, (ir, p) => {
  const asm = p.facts.get('assembled') as Assembled;
  const D = fx(p).D;
  const scopes = new Set(asm.keymap.bindings.map(b => b.scope));
  p.info('CK-I001', 'Build summary', {
    at: ir.at,
    facts: [`${ir.modules.length} modules · ${ir.panels.size} panels · ${asm.commands.map.size} commands · ${asm.keymap.bindings.length} key bindings in ${scopes.size} scopes · ${ir.tools.size} tools · ${ir.kits.length} kits`, D.summary()],
  });
});

/** summary runs last, outside the ordering (build() calls it after every other pass) */
export const BUILTIN_PASSES: PassDef<UiIR>[] = [normalizePass, slotsPass, bindingsPass, dockingPass, menusPass, keysPass, matchPass, toolsPass, iconsPass, a11yPass, reachPass];

/** the state every shell has, under the program's initial state */
export function withDefaults(init: unknown): any {
  return Object.assign({ view: {}, ui: {}, workspace: {}, prefs: {} }, init || {});
}
