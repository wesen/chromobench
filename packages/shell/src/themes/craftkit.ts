// CraftKit's look (CraftKit Studio's shell.css :root), as data: light and dark token sets and the four interface
// greys (View ▸ Interface Gray: 1 darkest … 4 lightest). The default theme of every shell (CHB-025); it was called
// 'lightroom' before, and that name still selects it.
import type { Theme } from '../build/types.ts';

/** tokens that are the same in light and dark: Lightroom's colour labels, the monospace face */
const common = {
  'label-red': '#e34850', 'label-yellow': '#e0b400', 'label-green': '#2d9d48', 'label-blue': '#1473e6', 'label-purple': '#8d4fd8',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

const light = {
  app: '#d6d6d6', panel: '#ececec', panel2: '#e2e2e2', panel3: '#f6f6f6', field: '#ffffff', line: '#c9c9c9', line2: '#b3b3b3',
  text: '#1f1f1f', text2: '#555', text3: '#8a8a8a', strong: '#000',
  accent: '#1473e6', accent2: '#0d66d0', onaccent: '#fff', accsoft: 'rgba(20, 115, 230, .14)',
  hover: 'rgba(0, 0, 0, .06)', active: 'rgba(0, 0, 0, .1)', sel: '#cfe1fb', selline: '#1473e6',
  track: '#bdbdbd', knob: '#fff', knobline: '#8a8a8a', canvas: '#9a9a9a', cell: '#c7c7c7', cellsel: '#e9e9e9', cellhi: '#f7f7f7',
  menu: '#fafafa', shadow: '0 6px 24px rgba(0, 0, 0, .22), 0 1px 3px rgba(0, 0, 0, .12)',
  ok: '#2d9d48', warn: '#c88a00', err: '#d7373f', info: '#1473e6',
  // an agent's change that waits for approval (Chromogen's red, kept as a meaning of its own)
  pending: '#d7373f', onpending: '#fff', pendsoft: 'rgba(215, 55, 63, .1)',
  tip: '#2b2b2b', ontip: '#f2f2f2', hud: 'rgba(20, 20, 20, .72)', onhud: '#fff', star: '#444', scroll: '#b0b0b0',
  // dark wells under pictures and plots (navigator, histogram, scopes)
  well: '#111', onwell: '#eee',
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif', fontSize: '12px', radius: '3px', rule: '1px',
  ...common,
};

const dark = {
  app: '#1b1b1b', panel: '#2a2a2a', panel2: '#232323', panel3: '#303030', field: '#1d1d1d', line: '#3a3a3a', line2: '#4b4b4b',
  text: '#d4d4d4', text2: '#9c9c9c', text3: '#6d6d6d', strong: '#fff',
  accent: '#378ef0', accent2: '#4b9cf5', onaccent: '#fff', accsoft: 'rgba(55, 142, 240, .18)',
  hover: 'rgba(255, 255, 255, .05)', active: 'rgba(255, 255, 255, .09)', sel: '#2f3f55', selline: '#4b9cf5',
  track: '#4a4a4a', knob: '#cfcfcf', knobline: '#1a1a1a', canvas: '#161616', cell: '#383838', cellsel: '#525252', cellhi: '#6a6a6a',
  menu: '#2e2e2e', shadow: '0 8px 28px rgba(0, 0, 0, .55), 0 1px 3px rgba(0, 0, 0, .4)',
  ok: '#3fb35b', warn: '#e5a50a', err: '#f15c63', info: '#4b9cf5',
  pending: '#f15c63', onpending: '#fff', pendsoft: 'rgba(241, 92, 99, .14)',
  tip: '#f0f0f0', ontip: '#1b1b1b', hud: 'rgba(0, 0, 0, .66)', onhud: '#f3f3f3', star: '#d0d0d0', scroll: '#4e4e4e',
  well: '#0b0b0b', onwell: '#eee',
};

export const craftkit: Theme = {
  name: 'craftkit',
  label: 'CraftKit',
  doc: "CraftKit's interface greys: light by default, dark with the system, View ▸ Interface Gray picks one of four",
  light,
  dark,
  // the four interface greys (CraftKit's shell.css data-gray rules); 1–3 lie over the dark set, 4 over the light one
  grays: {
    1: {
      app: '#111', panel: '#1e1e1e', panel2: '#181818', panel3: '#242424', field: '#141414', line: '#2c2c2c', line2: '#3c3c3c',
      text: '#cfcfcf', text2: '#8f8f8f', text3: '#5e5e5e', strong: '#fff', hover: 'rgba(255, 255, 255, .05)', active: 'rgba(255, 255, 255, .09)',
      sel: '#26364c', track: '#3e3e3e', knob: '#c8c8c8', knobline: '#000', canvas: '#0d0d0d', cell: '#2b2b2b', cellsel: '#444', cellhi: '#5c5c5c',
      menu: '#232323', star: '#c8c8c8', scroll: '#3e3e3e', accent: '#378ef0', tip: '#eee', ontip: '#111',
    },
    2: {},
    3: {
      app: '#3c3c3c', panel: '#535353', panel2: '#4a4a4a', panel3: '#5c5c5c', field: '#3a3a3a', line: '#424242', line2: '#6a6a6a',
      text: '#f0f0f0', text2: '#c4c4c4', text3: '#969696', strong: '#fff', hover: 'rgba(255, 255, 255, .07)', active: 'rgba(255, 255, 255, .12)',
      sel: '#3d5470', track: '#6e6e6e', knob: '#eee', knobline: '#2a2a2a', canvas: '#3a3a3a', cell: '#5e5e5e', cellsel: '#7a7a7a', cellhi: '#8c8c8c',
      menu: '#4a4a4a', star: '#eee', scroll: '#727272', accent: '#4b9cf5', tip: '#f0f0f0', ontip: '#1b1b1b',
    },
    4: {},
  },
};

/** the old name of the CraftKit theme */
export const lightroom = craftkit;
