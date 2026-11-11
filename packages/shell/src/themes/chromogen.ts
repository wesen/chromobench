// The Chromogen look (CHB-009's studio.css) mapped onto the shell's token names: white ground, one ink, Arial,
// 1 px rules, radius 0, red only for selection, pending changes and errors.
import type { Theme } from '../build/types.ts';

const ink = '#1a1a1a';
const ink2 = '#737373';
const red = '#e2001a';

export const chromogen: Theme = {
  name: 'chromogen',
  doc: 'White ground, one ink, Arial, 1 px rules, radius 0, red only for selection, pending changes and errors',
  light: {
    app: '#ffffff', panel: '#ffffff', panel2: '#f6f6f6', panel3: '#ffffff', field: '#ffffff', line: '#d6d6d6', line2: '#bdbdbd',
    text: ink, text2: ink2, text3: '#a3a3a3', strong: '#000',
    accent: ink, accent2: '#000', onaccent: '#fff', accsoft: 'rgba(26, 26, 26, .08)',
    hover: 'rgba(0, 0, 0, .04)', active: 'rgba(0, 0, 0, .08)', sel: 'rgba(226, 0, 26, 0.10)', selline: red,
    track: '#d6d6d6', knob: '#ffffff', knobline: ink, canvas: '#ffffff', cell: '#f6f6f6', cellsel: '#e6e6e6', cellhi: '#ffffff',
    menu: '#ffffff', shadow: '0 0 0 1px #d6d6d6',
    ok: ink, warn: red, err: red, info: ink,
    tip: ink, ontip: '#fff', hud: 'rgba(255, 255, 255, .92)', onhud: ink, star: ink, scroll: '#d6d6d6',
    font: 'Arial, "Helvetica Neue", Helvetica, sans-serif', fontSize: '12px', radius: '0', rule: '1px',
  },
  dark: {
    app: '#1a1a1a', panel: '#1a1a1a', panel2: '#222222', panel3: '#1a1a1a', field: '#1a1a1a', line: '#3d3d3d', line2: '#4d4d4d',
    text: '#f2f2f2', text2: '#9a9a9a', text3: '#6a6a6a', strong: '#fff',
    accent: '#f2f2f2', accent2: '#fff', onaccent: '#1a1a1a', accsoft: 'rgba(242, 242, 242, .1)',
    hover: 'rgba(255, 255, 255, .05)', active: 'rgba(255, 255, 255, .09)', sel: 'rgba(255, 59, 74, 0.16)', selline: '#ff3b4a',
    track: '#3d3d3d', knob: '#1a1a1a', knobline: '#f2f2f2', canvas: '#1a1a1a', cell: '#222222', cellsel: '#3a3a3a', cellhi: '#2a2a2a',
    menu: '#1a1a1a', shadow: '0 0 0 1px #3d3d3d',
    ok: '#f2f2f2', warn: '#ff3b4a', err: '#ff3b4a', info: '#f2f2f2',
    tip: '#f2f2f2', ontip: '#1a1a1a', hud: 'rgba(26, 26, 26, .9)', onhud: '#f2f2f2', star: '#f2f2f2', scroll: '#3d3d3d',
  },
};
