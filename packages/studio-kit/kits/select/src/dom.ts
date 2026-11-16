// The DOM half of the select kit: the tools' row of the Mask panel (form `select.tools`): Rectangle, Ellipse, Lasso,
// Polygon, Wand, and the magic wand's Tolerance and Contiguous (view state, through select.options).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { h, listen, type Renderer } from '@chromobench/shell/dom';
import { btn, numberControl, run } from '../../stack/src/controls/dom.ts';
import { SELECT_TOOLS, TOOL_WORDS } from './commands.ts';

const tools: Renderer = (_n, m) => {
  const row = h('div', { class: 'cb-card-b cb-select-tools', 'aria-label': 'Select' });
  for (const t of SELECT_TOOLS) {
    const b = btn(TOOL_WORDS[t], `cb-select-tool-${t}`, { 'data-tool': t });
    listen(m.scope, b, 'click', () => run(m, `tool.${t}`));
    row.append(b);
  }
  m.cell((s) => s.ui?.tool ?? '', (tool: string) => {
    for (const b of row.children) (b as HTMLElement).classList.toggle('is-on', (b as HTMLElement).dataset['tool'] === tool);
  });
  const none = (): string | null => null;
  const tol = numberControl(m, {
    label: 'Tolerance', path: 'select.tolerance', frame: none, min: 0, max: 0.4, hard: [0, 1], step: 0.005, show: (x) => `${Math.round(x * 255)} / 255`,
    parse: (t) => (Number.isFinite(Number(t.replace(/\s*\/\s*255$/, ''))) ? Number(t.replace(/\s*\/\s*255$/, '')) / 255 : null),
    stepLabel: 'Wand tolerance', tip: 'How different a pixel may be from the one clicked and still be selected (of 255, per channel)',
    commit: (x) => void run(m, 'select.options', { tolerance: x }), read: (s) => Number(s?.select?.tolerance ?? 0.1),
  });
  const cont = h('input', { type: 'checkbox', 'aria-label': 'Contiguous' }) as HTMLInputElement;
  listen(m.scope, cont, 'change', () => run(m, 'select.options', { contiguous: cont.checked }));
  m.cell((s) => s?.select?.contiguous !== false, (v: boolean) => void (cont.checked = v));
  const wand = h('div', { class: 'cb-select-wand' }, tol, h('label', { class: 'cb-stack-num' }, h('span', { class: 'cb-stack-num-l', text: 'Contiguous' }), cont));
  m.cell((s) => s.ui?.tool === 'select-wand', (on: boolean) => void (wand.hidden = !on));
  return h('div', { class: 'cb-select' }, h('div', { class: 'cb-stack-num' }, h('span', { class: 'cb-stack-num-l', text: 'Select' }), row), wand);
};

/** the select kit's renderers (part of CB_RENDERERS) */
export const SELECT_RENDERERS: Record<string, Renderer> = { 'select.tools': tools };
