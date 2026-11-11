// CraftKit's look (shell.css :root), as data: light and dark token sets and the four interface greys.
import type { Theme } from '../build/types.ts';

const dark = {
  app: '#1b1b1b', panel: '#2a2a2a', panel2: '#232323', panel3: '#303030', field: '#1d1d1d', line: '#3a3a3a', line2: '#4b4b4b',
  text: '#d4d4d4', text2: '#9c9c9c', text3: '#6d6d6d', strong: '#fff',
  accent: '#378ef0', accent2: '#4b9cf5', onaccent: '#fff', accsoft: 'rgba(55, 142, 240, .18)',
  hover: 'rgba(255, 255, 255, .05)', active: 'rgba(255, 255, 255, .09)', sel: '#2f3f55', selline: '#4b9cf5',
  track: '#4a4a4a', knob: '#cfcfcf', knobline: '#1a1a1a', canvas: '#161616', cell: '#383838', cellsel: '#525252', cellhi: '#6a6a6a',
  menu: '#2e2e2e', shadow: '0 8px 28px rgba(0, 0, 0, .55), 0 1px 3px rgba(0, 0, 0, .4)',
  ok: '#3fb35b', warn: '#e5a50a', err: '#f15c63', info: '#4b9cf5',
  tip: '#f0f0f0', ontip: '#1b1b1b', hud: 'rgba(0, 0, 0, .66)', onhud: '#f3f3f3', star: '#d0d0d0', scroll: '#4e4e4e',
};

export const lightroom: Theme = {
  name: 'lightroom',
  doc: "CraftKit's interface greys: light by default, dark with the system, View ▸ Interface Gray picks one of four",
  light: {
    app: '#d6d6d6', panel: '#ececec', panel2: '#e2e2e2', panel3: '#f6f6f6', field: '#ffffff', line: '#c9c9c9', line2: '#b3b3b3',
    text: '#1f1f1f', text2: '#555', text3: '#8a8a8a', strong: '#000',
    accent: '#1473e6', accent2: '#0d66d0', onaccent: '#fff', accsoft: 'rgba(20, 115, 230, .14)',
    hover: 'rgba(0, 0, 0, .06)', active: 'rgba(0, 0, 0, .1)', sel: '#cfe1fb', selline: '#1473e6',
    track: '#bdbdbd', knob: '#fff', knobline: '#8a8a8a', canvas: '#9a9a9a', cell: '#c7c7c7', cellsel: '#e9e9e9', cellhi: '#f7f7f7',
    menu: '#fafafa', shadow: '0 6px 24px rgba(0, 0, 0, .22), 0 1px 3px rgba(0, 0, 0, .12)',
    ok: '#2d9d48', warn: '#c88a00', err: '#d7373f', info: '#1473e6',
    tip: '#2b2b2b', ontip: '#f2f2f2', hud: 'rgba(20, 20, 20, .72)', onhud: '#fff', star: '#444', scroll: '#b0b0b0',
    font: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif', fontSize: '12px', radius: '3px', rule: '1px',
  },
  dark,
  // the greys are applied by shell.css through data-gray on the app root (1 darkest … 4 lightest)
  grays: { 1: {}, 2: {}, 3: {}, 4: {} },
};
