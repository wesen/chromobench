// The layout registry: ids to lazy imports (production builds contain only these).
export const LAYOUTS = {
  classic: () => import('./classic.js'),
  darkroom: () => import('./darkroom.js'),
  simple: () => import('./simple.js'),
  lab: () => import('./lab.js'),
  tiny: () => import('./tiny.js'),
  roll: () => import('./roll.js'),
  finish: () => import('./finish.js'),
  looks: () => import('./looks.js'),
};
export const DEFAULT_LAYOUT = 'classic';
