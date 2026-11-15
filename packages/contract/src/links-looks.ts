// The looks shipped with chromobench (contract 1.0, design §27, §31): registered look functions that return groups
// of ordinary layers. Darkroom looks are light: filters (colour and density in log H), the preflash, density masks
// and burns, so their Amount scales physically (design D2: half a look is half its filter density, half its burn
// time). Print looks are print-stage layers (clarity today; the composite op set arrives with phase 8). A look may
// touch several stages (crisp-warm: a darkroom filter and a print clarity, one link per stage, one Amount).
//
// Which sign of light is "warm" follows the studio's nudge: more blue light makes more yellow dye, less red light less
// cyan. Values were re-tuned for the light law, not carried over from the parameter-edit looks of CHB-021.
import { Coll, type Json } from '@chromobench/values';
import { layerEntry, type Entry, type Mask, type Params } from './document.ts';
import { fail } from './errors.ts';
import { defineLook, type LookInput } from './links.ts';
import type { ArgSpec } from './spec.ts';

/** Printer points in log H, and one stop in log H. */
const PT = 0.025;
const STOP = Math.log10(2);
const r6 = (x: number): number => Number(x.toFixed(6));

const points = (label: string, min: number, max: number, def: number, doc: string): ArgSpec =>
  ({ type: 'number', unit: 'point', min, max, default: def, doc, ui: { widget: 'slider', step: 0.5, label } });
const stops = (label: string, min: number, max: number, def: number, doc: string): ArgSpec =>
  ({ type: 'number', unit: 'stop', min, max, default: def, doc, ui: { widget: 'slider', step: 1 / 6, label } });
const fraction = (label: string, def: number, doc: string): ArgSpec =>
  ({ type: 'number', unit: 'fraction', min: 0, max: 1, default: def, doc, ui: { widget: 'slider', step: 0.05, label } });

const filter = (name: string, logH: readonly number[]): Entry => layerEntry('filter', { logH: logH.map(r6) }, { name, source: { kind: 'look' } });
const stack = (...es: [string, Entry][]): Coll<Entry> => Coll.of(es);
const num = (p: Readonly<Record<string, Json>>, k: string): number => p[k] as number;

/** A colour and density filter: R, G, B printer points plus a density in stops (+ is more light: a darker print). */
function balance(r: number, g: number, b: number, density = 0): number[] {
  return [r * PT + density * STOP, g * PT + density * STOP, b * PT + density * STOP];
}

export const LOOK_BALANCE = defineLook({
  name: 'balance', version: 1, label: 'Balance', group: 'Sweep', stages: ['darkroom'],
  doc: 'A filter in the head: printer points per colour of light and a density in stops (the ring-around and test strips sweep it).',
  params: {
    red: points('Red', -20, 20, 0, 'Red light, printer points (+ more red light: less cyan dye).'),
    green: points('Green', -20, 20, 0, 'Green light, printer points.'),
    blue: points('Blue', -20, 20, 0, 'Blue light, printer points (+ more blue light: more yellow dye).'),
    density: stops('Density', -2, 2, 0, 'More light overall, stops (+ is a darker print).'),
  },
  fn: (p) => ({ stacks: { darkroom: stack(['filter', filter('Balance', balance(num(p, 'red'), num(p, 'green'), num(p, 'blue'), num(p, 'density')))]) } }),
});

export const LOOK_NEUTRAL = defineLook({
  name: 'neutral', version: 1, label: 'Neutral colour', group: 'Print', stages: ['darkroom'],
  doc: 'A filter that takes out the colour offset of the printer lights and keeps their density; it follows the lights when they change.',
  params: {},
  fn: (_p, { doc }) => {
    const l = (doc.stages.darkroom.stack.items['lights'] as { params?: Params } | undefined)?.params?.['logH'];
    const v = Array.isArray(l) && l.length === 3 ? (l as number[]) : [0, 0, 0];
    const m = (v[0]! + v[1]! + v[2]!) / 3;
    return { stacks: { darkroom: stack(['neutral', filter('Neutral', v.map((x) => m - x))]) } };
  },
});

export const LOOK_WARM = defineLook({
  name: 'warm-print', version: 1, label: 'Warm print', group: 'Print', stages: ['darkroom'],
  doc: 'Warmer light in the head: less red and more blue light, half the warmth each; a density in stops.',
  params: {
    warmth: points('Warmth', 0, 10, 4, 'Printer points between red and blue light.'),
    density: stops('Density', -1, 1, 0, 'More light overall, stops (+ is a darker print).'),
  },
  fn: (p) => ({ stacks: { darkroom: stack(['warmth', filter('Warmth', balance(-num(p, 'warmth') / 2, 0, num(p, 'warmth') / 2, num(p, 'density')))]) } }),
});

export const LOOK_COOL = defineLook({
  name: 'cool-print', version: 1, label: 'Cool print', group: 'Print', stages: ['darkroom'],
  doc: 'Cooler light in the head (more red, less blue) and a weak contrast mask that opens the shadows.',
  params: { coolness: points('Coolness', 0, 10, 4, 'Printer points between blue and red light.') },
  fn: (p) => ({
    stacks: {
      darkroom: stack(
        ['coolness', filter('Coolness', balance(num(p, 'coolness') / 2, 0, -num(p, 'coolness') / 2))],
        ['mask', layerEntry('densityMask', { gamma: 0.15, radius_um: 300, polarity: 'positive' }, { name: 'Contrast mask', source: { kind: 'look' } })],
      ),
    },
  }),
});

export const LOOK_SOFT = defineLook({
  name: 'soft-contrast', version: 1, label: 'Softer contrast', group: 'Contrast', stages: ['darkroom'],
  doc: 'Lower contrast by light, as at the enlarger: a contrast mask sandwiched with the negative and a preflash for the highlights.',
  params: { strength: fraction('Strength', 0.5, 'How much softer: the mask gamma is 0.6 × strength, the preflash 4 % × strength.') },
  fn: (p) => ({
    stacks: {
      darkroom: stack(
        ['mask', layerEntry('densityMask', { gamma: r6(0.6 * num(p, 'strength')), radius_um: 300, polarity: 'positive' }, { name: 'Contrast mask', source: { kind: 'look' } })],
        ['preflash', layerEntry('preflash', { fraction: r6(0.04 * num(p, 'strength')) }, { name: 'Preflash', source: { kind: 'look' } })],
      ),
    },
  }),
});

export const LOOK_HARD = defineLook({
  name: 'more-contrast', version: 1, label: 'More contrast', group: 'Contrast', stages: ['darkroom'],
  doc: 'Higher large-area contrast by light: a density mask of the same polarity as the negative.',
  params: { strength: fraction('Strength', 0.5, 'How much harder: the mask gamma is 0.6 × strength.') },
  fn: (p) => ({ stacks: { darkroom: stack(['mask', layerEntry('densityMask', { gamma: r6(0.6 * num(p, 'strength')), radius_um: 300, polarity: 'same' }, { name: 'Contrast mask', source: { kind: 'look' } })]) } }),
});

export const LOOK_DENSITY = defineLook({
  name: 'print-density', version: 1, label: 'Print density', group: 'Print', stages: ['darkroom'],
  doc: 'More or less light overall, in stops, as a neutral filter (a darker print is more light).',
  params: { stops: stops('Darker by', -2, 2, 1 / 3, 'Stops of light (+ is a darker print).') },
  fn: (p) => ({ stacks: { darkroom: stack(['density', filter('Density', balance(0, 0, 0, num(p, 'stops')))]) } }),
});

/** The frame inset by `inset` of its short side, in document pixels. */
function inner(size: LookInput['size'], inset: number, what: string): { x: number; y: number; w: number; h: number } {
  if (!size) return fail('E_LINK', `${what} places a mask on the frame and needs the image size`, { hint: 'compile with a graph that knows the source, or pass LinkContext.size' });
  const [w, h] = size;
  const d = Math.round(Math.min(w, h) * inset);
  return { x: d, y: d, w: Math.max(1, w - 2 * d), h: Math.max(1, h - 2 * d) };
}

export const LOOK_EDGE_BURN = defineLook({
  name: 'edge-burn', version: 1, label: 'Edge burn', group: 'Dodge and burn', stages: ['darkroom'],
  doc: 'A burn of the print\'s edges and corners through a soft oval card: more light outside an ellipse inset from the frame.',
  params: {
    stops: stops('Burn', 0, 2, 0.5, 'Stops of extra light at the edges.'),
    feather: { type: 'number', unit: 'mm', min: 0, max: 100, default: 25, doc: 'Softness of the card\'s edge, mm on the print.', ui: { widget: 'slider', step: 1, label: 'Feather' } },
  },
  fn: (p, { size }) => {
    const box = inner(size, 0.08, 'edge-burn');
    const mask: Mask = {
      name: 'Edges', feather_mm: num(p, 'feather'), invert: true, reads: 'stage-input',
      components: Coll.of([['oval', { kind: 'ellipse', params: { box, angle_deg: 0 }, combine: 'add', amount: 1, enabled: true }]]),
    };
    return {
      stacks: { darkroom: stack(['burn', layerEntry('burn', { stops: num(p, 'stops') }, { name: 'Edge burn', mask: 'edges', source: { kind: 'look' } })]) },
      masks: Coll.of([['edges', mask]]),
    };
  },
});

export const LOOK_CLARITY = defineLook({
  name: 'crisp-print', version: 1, label: 'Crisp print', group: 'Finishing', stages: ['print'],
  doc: 'Local contrast on the print (clarity with a 10 mm radius on the paper).',
  params: { strength: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0.25, doc: 'Clarity: + adds local contrast, − softens.', ui: { widget: 'slider', step: 0.05, label: 'Clarity' } } },
  fn: (p) => ({ stacks: { print: stack(['clarity', layerEntry('clarity', { strength: num(p, 'strength'), radius_mm: 10 }, { name: 'Clarity', source: { kind: 'look' } })]) } }),
});

export const LOOK_CRISP_WARM = defineLook({
  name: 'crisp-warm', version: 1, label: 'Crisp and warm', group: 'Print', stages: ['darkroom', 'print'],
  doc: 'Warmer light at the enlarger and local contrast on the print: one look over two stages, one Amount.',
  params: {
    warmth: points('Warmth', 0, 10, 3, 'Printer points between red and blue light.'),
    clarity: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0.2, doc: 'Clarity on the print.', ui: { widget: 'slider', step: 0.05, label: 'Clarity' } },
  },
  fn: (p) => ({
    stacks: {
      darkroom: stack(['warmth', filter('Warmth', balance(-num(p, 'warmth') / 2, 0, num(p, 'warmth') / 2))]),
      print: stack(['clarity', layerEntry('clarity', { strength: num(p, 'clarity'), radius_mm: 10 }, { name: 'Clarity', source: { kind: 'look' } })]),
    },
  }),
});

/** The built-in looks, in library order. */
export const BUILTIN_LOOKS = Object.freeze([LOOK_NEUTRAL, LOOK_WARM, LOOK_COOL, LOOK_DENSITY, LOOK_SOFT, LOOK_HARD, LOOK_EDGE_BURN, LOOK_CLARITY, LOOK_CRISP_WARM, LOOK_BALANCE]);
