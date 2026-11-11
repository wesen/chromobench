// Workspaces (the state half of CraftKit ui/dock.js): each module arranges left, right, bottom and top columns
// around a centre. Sizes, hidden sides, open panels, solo mode and tab choices live in the view tier
// (workspace.layout[module][side], workspace.panels[id].open, …): saved per viewer, never undone. Tab hides the
// side columns, Shift+Tab everything; F5–F8 toggle one side each (Lightroom's keys). The DOM dock renders this.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Runtime } from './runtime.ts';

export const SIDES = ['left', 'right', 'bottom', 'top'] as const;
export type Side = (typeof SIDES)[number];

export class Workspace {
  /** panel id → open by default (Reset Workspace goes back to these) */
  defaults = new Map<string, boolean>();
  private readonly rt: Runtime<any>;
  constructor(rt: Runtime<any>) {
    this.rt = rt;
    for (const [id, p] of rt.panels) this.defaults.set(id, p.props['open'] !== false);
  }
  private get st() {
    return this.rt.store;
  }
  layoutPath(mod: string, side: string): string[] {
    return ['workspace', 'layout', mod, side];
  }
  get(mod: string, side: string): { size?: number; hidden?: boolean } {
    return this.st.peek(this.layoutPath(mod, side)) || {};
  }
  setSide(mod: string, side: string, patch: { size?: number; hidden?: boolean }): void {
    const path = this.layoutPath(mod, side);
    this.st.set(path, Object.assign({}, this.st.peek(path) || {}, patch));
  }
  get module(): string {
    return this.st.peek(['view', 'module']);
  }
  sideHidden(s: any, side: string): boolean {
    const L = s.workspace?.layout?.[s.view?.module];
    const g = s.workspace?.hide || {};
    return !!L?.[side]?.hidden || !!g.all || (!!g.sides && (side === 'left' || side === 'right'));
  }
  toggle(side: string): void {
    const mod = this.module;
    const g = this.st.peek(['workspace', 'hide']) || {};
    if (g.all || g.sides) {
      // everything was hidden (Tab, or a phone): show only the side asked for
      this.st.set(['workspace', 'hide'], {});
      for (const s of ['left', 'right'].concat(g.all ? ['bottom'] : [])) this.setSide(mod, s, { hidden: s !== side });
      if (side === 'bottom' || side === 'top') this.setSide(mod, side, { hidden: false });
      return;
    }
    const cur = this.get(mod, side);
    this.setSide(mod, side, { hidden: !cur.hidden });
  }
  /** Tab: the side columns */
  hideSides(): void {
    const g = this.st.peek(['workspace', 'hide']) || {};
    this.st.set(['workspace', 'hide'], g.sides ? {} : { sides: true });
  }
  /** Shift+Tab: everything but the centre */
  hideAll(): void {
    const g = this.st.peek(['workspace', 'hide']) || {};
    this.st.set(['workspace', 'hide'], g.all ? {} : { all: true, toolbar: true });
  }
  toggleToolbar(): void {
    const g = this.st.peek(['workspace', 'hide']) || {};
    this.st.set(['workspace', 'hide'], Object.assign({}, g, { toolbar: !g.toolbar }));
  }
  /** solo: open this panel, close its siblings (the panels of its column) */
  solo(id: string, siblings: string[]): void {
    const panels = Object.assign({}, this.st.peek(['workspace', 'panels']) || {});
    for (const pid of siblings) panels[pid] = Object.assign({}, panels[pid] || {}, { open: pid === id });
    this.st.set(['workspace', 'panels'], panels);
  }
  toggleSolo(side: string): void {
    const key = this.module + ':' + side;
    this.st.set(['workspace', 'solo', key], !this.st.peek(['workspace', 'solo', key]));
  }
  isOpen(id: string): boolean {
    const w = this.st.peek(['workspace', 'panels', id]);
    return !w || w.open !== false;
  }
  setOpen(id: string, open: boolean): void {
    this.st.set(['workspace', 'panels', id, 'open'], open);
  }
  /** show a panel: its side, everything unhidden, open; the DOM scrolls to it and focuses it */
  reveal(id: string): void {
    const side = this.sideOf(id);
    if (!side) {
      this.rt.chrome.toast(`The ${this.rt.panelTitle(id)} panel is not in this module`, { kind: 'info' });
      return;
    }
    this.setSide(this.module, side, { hidden: false });
    this.st.set(['workspace', 'hide'], {});
    this.setOpen(id, true);
    this.rt.emit('reveal', id);
  }
  /** the side of the current module a panel is placed in */
  sideOf(id: string): string | null {
    const mod = this.rt.modules.get(this.module);
    if (!mod) return null;
    for (const [side, r] of Object.entries(mod.regions)) {
      if (!r) continue;
      let found = false;
      const visit = (n: any): void => {
        if (!n || found) return;
        if ((n.$ === 'panel' || n.$ === 'panelref') && String(n.props.id) === id) found = true;
        if (n.$ === 'docktabs' && (n.props.panels || []).includes(id)) found = true;
        for (const k of n.kids || []) visit(k);
      };
      visit(r);
      if (found) return side;
    }
    return null;
  }
  reset(modId: string): void {
    const layout = Object.assign({}, this.st.peek(['workspace', 'layout']) || {});
    delete layout[modId];
    this.st.set(['workspace', 'layout'], layout);
    this.st.set(['workspace', 'hide'], {});
    const panels: Record<string, { open: boolean }> = {};
    for (const [id, open] of this.defaults) panels[id] = { open };
    this.st.set(['workspace', 'panels'], panels);
    this.rt.chrome.toast('Workspace reset', { kind: 'info' });
  }
}
