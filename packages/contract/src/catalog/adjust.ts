// Catalog: the digital adjustment layers of the composite stages (contract 1.1, design §23, phase 8): Editor lab's
// tools re-defined in linear light and OkLab instead of sRGB numbers (design §13). Each op is a layer of the scene and
// print stages (sharpen: print only, its radius is on the print) and computes in its declared encoding; the composite
// law converts its input to that encoding and mixes its result by amount, mask and blend. Core
// (packages/core/src/composite/) is the f64 definition of every formula; packages/gpu mirrors it.
import { domainsOf, WORKING_DOMAINS } from '../encodings.ts';
import { defineOp, type OpDef } from '../registry.ts';
import type { ArgSpec } from '../spec.ts';

const STAGES = ['scene', 'print'] as const;
const LINEAR = domainsOf('linear');
const OKLAB = domainsOf('oklab');

/** L: OkLab lightness; R, G, B: the cube root of that linear RGB channel (on a neutral, L = ∛R = ∛G = ∛B). */
const CHANNEL: ArgSpec = {
  type: 'enum', values: ['L', 'R', 'G', 'B'], default: 'L',
  doc: 'What the tone function maps: L = OkLab lightness (tone without hue shifts); R, G, B = the cube root of that linear RGB channel, the same lightness scale (a neutral\'s R, G and B curves are its L curve).',
  ui: { widget: 'segmented', label: 'Channel' },
};
const CHANNEL_ENCODING = { arg: 'channel', values: { L: 'oklab', R: 'linear', G: 'linear', B: 'linear' } } as const;

const isIdentityPoints = (p: unknown): boolean => Array.isArray(p) && p.every((q) => (q as { x: number; y: number }).x === (q as { x: number; y: number }).y);

/** The eight hue bands of Lightroom's HSL panel at OkLCh hues, with no change. */
const BANDS = [['red', 25], ['orange', 55], ['yellow', 105], ['green', 145], ['aqua', 195], ['blue', 260], ['purple', 295], ['magenta', 330]] as const;
export const DEFAULT_HSL_BANDS: readonly Record<string, number>[] = BANDS.map(([, c]) => ({ centre_deg: c, width_deg: 45, hue_deg: 0, saturation: 0, lightness: 0 }));

const wheel = (name: 'shadows' | 'midtones' | 'highlights', label: string, hue: number): Record<string, ArgSpec> => ({
  [`${name}Hue_deg`]: { type: 'number', unit: 'deg', min: 0, max: 360, default: hue, doc: `${label}: the OkLCh hue of the tint.`, ui: { widget: 'wheel', label: 'Hue', group: label } },
  [`${name}Chroma`]: { type: 'number', unit: 'none', min: 0, max: 0.3, usual: [0, 0.1], default: 0, doc: `${label}: the tint's strength, OkLab chroma added at L = 1 (scaled by L, so black stays black).`, ui: { widget: 'wheel', step: 0.002, label: 'Strength', group: label } },
  [`${name}Lightness`]: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0, doc: `${label}: lightness change, ΔL = 0.25 · lightness · weight.`, ui: { widget: 'slider', step: 0.01, detents: [0], label: 'Lightness', group: label } },
});

const VEC_ROW = (d: [number, number, number], label: string, doc: string): ArgSpec => ({
  type: 'vec3', unit: 'fraction', min: -2, max: 2, default: d, doc, ui: { widget: 'slider', step: 0.01, label, components: ['R', 'G', 'B'] },
});
const REC2020_Y: [number, number, number] = [0.2627, 0.678, 0.0593];

export const adjustOps: OpDef[] = [
  defineOp({
    name: 'exposure', area: 'composite', owner: 'CHB-037', on: 'Image', returns: 'Image', domainIn: LINEAR, domainOut: 'same',
    class: 'pointwise', binding: 'setting', stages: STAGES, encoding: 'linear', ui: { label: 'Exposure', menu: 'tone', order: 10 },
    identity: (p) => p['stops'] === 0 && p['offset'] === 0,
    args: {
      stops: { type: 'number', unit: 'stop', min: -6, max: 6, usual: [-3, 3], default: 0, doc: 'Exposure change: linear RGB × 2^stops.', ui: { widget: 'slider', step: 1 / 30, detents: [0], label: 'Exposure' } },
      offset: { type: 'number', unit: 'fraction', min: -0.2, max: 0.2, usual: [-0.05, 0.05], default: 0, doc: 'Added after the gain, a fraction of white (a black level: negative removes a veil).', ui: { widget: 'slider', step: 0.001, detents: [0], label: 'Offset', advanced: true } },
    },
    doc: 'Exposure in linear light: rgb · 2^stops + offset (Editor lab `exposure`, without its sRGB round trip and gamma).',
    see: ['levels', 'curve'],
  }),
  defineOp({
    name: 'curve', area: 'composite', owner: 'CHB-037', on: 'Image', returns: 'Image', domainIn: [...OKLAB, ...LINEAR], domainOut: 'same',
    class: 'pointwise', binding: 'setting', stages: STAGES, encoding: CHANNEL_ENCODING, ui: { label: 'Curve', menu: 'tone', order: 20 },
    identity: (p) => isIdentityPoints(p['points']),
    validate: (a) => {
      const p = a['points'] as { x: number }[];
      for (let i = 1; i < p.length; i++) if (!(p[i]!.x > p[i - 1]!.x)) return 'points must have strictly increasing x';
      return null;
    },
    args: {
      channel: CHANNEL,
      points: {
        type: 'list', minItems: 2, maxItems: 16, default: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        doc: 'Control points in order of x (in a document: a Coll of points). The curve is the monotone cubic through them (Fritsch–Carlson): it never overshoots, so monotone points give a monotone curve; beyond the end points it continues along the end tangents.',
        of: {
          x: { type: 'number', unit: 'fraction', min: 0, max: 1, doc: 'Input value (the channel\'s lightness, 0 black, 1 white).' },
          y: { type: 'number', unit: 'fraction', min: 0, max: 1, doc: 'Output value.' },
        },
      },
    },
    doc: "A point curve (Lightroom's point curve, Photoshop's Curves) on lightness or one channel. Not Editor lab's parametric curve, whose negative contrast added contrast (design §13).",
    see: ['levels'],
  }),
  defineOp({
    name: 'levels', area: 'composite', owner: 'CHB-037', on: 'Image', returns: 'Image', domainIn: [...OKLAB, ...LINEAR], domainOut: 'same',
    class: 'pointwise', binding: 'setting', stages: STAGES, encoding: CHANNEL_ENCODING, ui: { label: 'Levels', menu: 'tone', order: 30 },
    identity: (p) => p['black'] === 0 && p['white'] === 1 && p['gamma'] === 1 && p['outBlack'] === 0 && p['outWhite'] === 1,
    validate: (a) => ((a['black'] as number) < (a['white'] as number) ? null : 'black must be below white'),
    args: {
      channel: CHANNEL,
      black: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0, doc: 'Input black point (the channel\'s lightness).', ui: { widget: 'slider', step: 0.002, label: 'Black' } },
      white: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 1, doc: 'Input white point.', ui: { widget: 'slider', step: 0.002, label: 'White' } },
      gamma: { type: 'number', unit: 'none', min: 0.1, max: 10, usual: [0.3, 3], default: 1, doc: 'Midtone gamma: t^(1/gamma) between black and white (above 1 brightens).', ui: { widget: 'slider', step: 0.01, detents: [1], label: 'Gamma', scale: 'log2' } },
      outBlack: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0, doc: 'Output black: where the input black lands.', ui: { widget: 'slider', step: 0.002, label: 'Output black', advanced: true } },
      outWhite: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 1, doc: 'Output white: where the input white lands.', ui: { widget: 'slider', step: 0.002, label: 'Output white', advanced: true } },
    },
    doc: 'Levels on lightness or one channel: out = outBlack + (outWhite − outBlack)·g((x − black)/(white − black)), g(t) = t^(1/gamma) on [0, 1] and continued with slope 1 beyond, so nothing is clipped in the working encoding (the display knee clips).',
    see: ['curve', 'exposure'],
  }),
  defineOp({
    name: 'hsl', area: 'composite', owner: 'CHB-037', on: 'Image', returns: 'Image', domainIn: OKLAB, domainOut: 'same',
    class: 'pointwise', binding: 'setting', stages: STAGES, encoding: 'oklab', ui: { label: 'HSL', menu: 'colour', order: 10 },
    identity: (p) => Array.isArray(p['bands']) && (p['bands'] as Record<string, number>[]).every((b) => b['hue_deg'] === 0 && b['saturation'] === 0 && b['lightness'] === 0),
    args: {
      bands: {
        type: 'list', maxItems: 16, default: DEFAULT_HSL_BANDS,
        doc: 'Hue bands (in a document: a Coll; default the eight of Lightroom\'s HSL panel: red, orange, yellow, green, aqua, blue, purple, magenta). A band weighs a pixel by w = smoothstep(cos width, 1, cos(h − centre)); weights are normalised by max(1, Σw) and faded towards neutral (chroma below 0.04).',
        of: {
          centre_deg: { type: 'number', unit: 'deg', min: 0, max: 360, doc: 'The band\'s OkLCh hue.' },
          width_deg: { type: 'number', unit: 'deg', min: 5, max: 180, default: 45, doc: 'Half-width: the weight falls from 1 at the centre to 0 at this distance.', ui: { advanced: true } },
          hue_deg: { type: 'number', unit: 'deg', min: -60, max: 60, default: 0, doc: 'Hue shift.' },
          saturation: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0, doc: 'Chroma change: C × (1 + saturation) (−1 removes the colour).' },
          lightness: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0, doc: 'Lightness change: ΔL = 0.25 · lightness.' },
        },
      },
    },
    doc: 'Hue, saturation and lightness per hue band in OkLCh (Lightroom\'s HSL panel); replaces the never-compiled finishing.hue.',
    see: ['vibrance', 'grade'],
  }),
  defineOp({
    name: 'vibrance', area: 'composite', owner: 'CHB-037', on: 'Image', returns: 'Image', domainIn: OKLAB, domainOut: 'same',
    class: 'pointwise', binding: 'setting', stages: STAGES, encoding: 'oklab', ui: { label: 'Vibrance', menu: 'colour', order: 20 },
    identity: (p) => p['vibrance'] === 0 && p['saturation'] === 0,
    args: {
      vibrance: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0.25, doc: 'Chroma change weighted to muted colours: C × (1 + v·(1 − C/0.3)²) below C = 0.3 (monotone: colours keep their order).', ui: { widget: 'slider', step: 0.01, detents: [0], label: 'Vibrance' } },
      saturation: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0, doc: 'Uniform chroma change after vibrance: C × (1 + saturation).', ui: { widget: 'slider', step: 0.01, detents: [0], label: 'Saturation' } },
    },
    doc: 'Vibrance and saturation in OkLCh chroma (Editor lab `vibrance`, in chroma instead of an sRGB spread).',
    see: ['hsl'],
  }),
  defineOp({
    name: 'grade', area: 'composite', owner: 'CHB-037', on: 'Image', returns: 'Image', domainIn: OKLAB, domainOut: 'same',
    class: 'pointwise', binding: 'setting', stages: STAGES, encoding: 'oklab', ui: { label: 'Colour grading', menu: 'colour', order: 30 },
    identity: (p) => ['shadows', 'midtones', 'highlights'].every((k) => p[`${k}Chroma`] === 0 && p[`${k}Lightness`] === 0),
    args: {
      ...wheel('shadows', 'Shadows', 230), ...wheel('midtones', 'Midtones', 60), ...wheel('highlights', 'Highlights', 70),
      balance: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0, doc: 'Moves the split between the wheels: positive gives the highlights more of the range (t = clamp(L, 0, 1)^(2^−balance)).', ui: { widget: 'slider', step: 0.01, detents: [0], label: 'Balance', advanced: true } },
    },
    doc: 'Colour grading with shadow, midtone and highlight wheels in OkLab (Lightroom\'s Color Grading): weights (1 − t)², 2t(1 − t), t² of the lightness, a, b += L·Σ w·chroma·(cos hue, sin hue), L += 0.25·Σ w·lightness.',
    see: ['hsl'],
  }),
  defineOp({
    name: 'mixer', area: 'composite', owner: 'CHB-037', on: 'Image', returns: 'Image', domainIn: LINEAR, domainOut: 'same',
    class: 'pointwise', binding: 'setting', stages: STAGES, encoding: 'linear', ui: { label: 'Channel mixer', menu: 'colour', order: 40 },
    identity: (p) => !p['monochrome'] && [[1, 0, 0], [0, 1, 0], [0, 0, 1]].every((row, i) => (p[['red', 'green', 'blue'][i]!] as number[]).every((v, j) => v === row[j])),
    args: {
      red: VEC_ROW([1, 0, 0], 'Red', 'Output red from input R, G, B (linear RGB).'),
      green: VEC_ROW([0, 1, 0], 'Green', 'Output green from input R, G, B.'),
      blue: VEC_ROW([0, 0, 1], 'Blue', 'Output blue from input R, G, B.'),
      monochrome: { type: 'bool', default: false, doc: 'Black and white: every channel becomes grey = grey · (R, G, B); the rows are not used.', ui: { widget: 'toggle', label: 'Monochrome' } },
      grey: { ...VEC_ROW(REC2020_Y, 'Grey', 'Weights of R, G, B in the monochrome grey (default the luminance of Rec. 2020: a neutral conversion; filters shift them, as a red filter on panchromatic film).'), ui: { widget: 'slider', step: 0.01, label: 'Grey', components: ['R', 'G', 'B'] } },
    },
    doc: 'A 3 × 3 channel mixer in linear RGB, or black and white from weighted channels (Editor lab `bw`, generalised and in linear light).',
  }),
  defineOp({
    name: 'vignette', area: 'composite', owner: 'CHB-037', on: 'Image', returns: 'Image', domainIn: LINEAR, domainOut: 'same',
    class: 'pointwise', binding: 'setting', stages: STAGES, encoding: 'linear', ui: { label: 'Vignette', menu: 'effect', order: 10 },
    identity: (p) => p['stops'] === 0,
    args: {
      stops: { type: 'number', unit: 'stop', min: -4, max: 4, usual: [-2, 2], default: -0.5, doc: 'Exposure change at the corners (negative darkens).', ui: { widget: 'slider', step: 1 / 30, detents: [0], label: 'Amount' } },
      size: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0.5, doc: 'Where the falloff starts, a fraction of the distance from the centre to the corners on the frame\'s ellipse.', ui: { widget: 'slider', step: 0.01, label: 'Size' } },
      feather: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0.5, doc: 'How much of the rest of the way the falloff takes (0: a hard edge, 1: it reaches the corners).', ui: { widget: 'slider', step: 0.01, label: 'Feather' } },
    },
    doc: 'A vignette in linear light, centred on the frame (document pixels): rgb · 2^(stops · smoothstep(size, size + feather·(1 − size), ρ)), ρ = 1 at the corners.',
  }),
];

export const sharpenOp: OpDef = defineOp({
  name: 'sharpen', area: 'composite', owner: 'CHB-037', on: 'Image', returns: 'Image', domainIn: 'print-xyz', domainOut: 'print-xyz',
  class: 'spatial', binding: 'setting', stages: ['print'], encoding: 'stage', ui: { label: 'Sharpen', menu: 'detail', order: 20 },
  identity: (p) => p['strength'] === 0,
  args: {
    strength: { type: 'number', unit: 'fraction', min: 0, max: 3, usual: [0, 1.5], default: 0.5, doc: 'Sharpening: the lightness detail added, L′ = L + s·(L − L̄).', ui: { widget: 'slider', step: 0.01, label: 'Amount' } },
    radius_mm: { type: 'number', unit: 'mm', min: 0.01, max: 2, usual: [0.03, 0.5], default: 0.1, doc: 'Radius (Gaussian σ) of the low-pass on the print, mm (converted with ImageInfo.umPerPx.paper, so it is the same at every export size).', ui: { widget: 'slider', step: 0.01, label: 'Radius' } },
  },
  doc: 'An unsharp mask on the print\'s lightness (clarity without the midtone weight, at a small radius): the low-pass of Y in linear light, L = (Y / Y_w)^⅓, out = XYZ·(L′/L)³ (chromaticity kept, no clipping).',
  see: ['clarity'],
});

/** The compiler's conversion between the working encodings of a stage (encodings.ts); not a layer a user adds. */
export const encodeOp: OpDef = defineOp({
  name: 'composite.encode', area: 'composite', owner: 'CHB-037', on: 'Image', returns: 'Image', domainIn: [...WORKING_DOMAINS], domainOut: 'same', domainFromArg: 'to',
  class: 'pointwise', binding: 'setting', dsl: false,
  args: {
    to: { type: 'enum', values: [...WORKING_DOMAINS], doc: 'The encoding to convert to, a domain of the same stage as the receiver.' },
    white: { type: 'enum', values: ['D50', 'D65'], default: 'D65', doc: "The XYZ white of the stage (print: Document.output.white, after view.adapt; scene: D65): XYZ is adapted from it to D65 (Bradford) before linear Rec. 2020." },
  },
  doc: 'Converts a composite stage\'s image between its encodings: XYZ (the stage\'s), linear Rec. 2020 RGB, OkLab over that RGB (contract encodings.ts). The compiler inserts it where adjacent ops differ in encoding.',
});
