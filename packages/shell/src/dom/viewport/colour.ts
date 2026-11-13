// The stage colour around the picture: the default, and cssColour, which reads a CSS colour as 0–1 RGB.

import type { Colours } from '../../app/render/types.ts';

export const DEFAULT_COLOURS: Colours = { stage: [0.18, 0.18, 0.18], frame: [0, 0, 0] };
/** a CSS colour as 0–1 RGB: #rgb, #rrggbb or rgb()/rgba(); null for anything else */
export const cssColour = (s: unknown): [number, number, number] | null => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(t);
  if (m) return [m[1]!, m[2]!, m[3]!].map(x => parseInt(x + x, 16) / 255) as [number, number, number];
  m = /^#([0-9a-f]{6})$/i.exec(t);
  if (m) {
    const v = parseInt(m[1]!, 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(t);
  return m ? ([m[1]!, m[2]!, m[3]!].map(x => Math.min(255, Number(x)) / 255) as [number, number, number]) : null;
};
