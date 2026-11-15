// Catalog: layer ops (contract 1.0, design §21–§23). An entry in a stage's stack names one of these; `stages` says
// where it may live and the stage's law says what its amount, mask and blend mean.
//
// - darkroom (light law): the main exposure, burns, dodges, flashes and the preflash are light that reaches the
//   paper; density masks and filters are modulators in the light path. They return 'Term': the light law lowers them
//   to print.expose / print.densityMask nodes and one print.combine (print.ts), so no engine evaluates them.
// - scan and print (repair, composite): heal and clone are nodes of their own, with a structured spot list; adjacent
//   heal (or clone) layers coalesce into one node. clarity is a node in the print stage, radius in mm on the print.
// - composite.mix is what the composite and repair laws compile an entry's amount, mask and blend into; it is not a
//   layer a user adds.
import { BLEND_MODES } from '../document.ts';
import { defineOp, type OpDef } from '../registry.ts';
import type { ArgSpec } from '../spec.ts';

const TIME: ArgSpec = { type: 'number', unit: 's', min: 0, max: 600, optional: true, doc: 'Seconds of light (absolute). Give time_s or stops, not both.', ui: { widget: 'slider', step: 0.1, label: 'Time', scale: 'log2' } };
const STOPS: ArgSpec = { type: 'number', unit: 'stop', min: 0, max: 6, optional: true, doc: 'Relative to the main time: burn and flash t_main·(2^s − 1), dodge t_main·(1 − 2^−s). Give time_s or stops, not both.', ui: { widget: 'slider', step: 1 / 6, label: 'Stops' } };
const PACK: ArgSpec = { type: 'cmy', unit: 'CC', min: -100, max: 200, optional: true, doc: "The exposure's own pack, a shift on the database neutral like the main exposure's filtration; absent = the main exposure's.", ui: { widget: 'slider', step: 1, detents: [0], label: 'Filtration', components: ['C', 'M', 'Y'] } };

const oneTime = (a: Readonly<Record<string, unknown>>): string | null =>
  (a['time_s'] === undefined) === (a['stops'] === undefined) ? 'give exactly one of time_s and stops' : null;

const term = (def: Omit<OpDef, 'area' | 'owner' | 'on' | 'returns' | 'binding' | 'stages' | 'encoding' | 'class'> & { class?: OpDef['class'] }): OpDef => defineOp({
  area: 'darkroom', owner: 'CHB-037', on: 'none', returns: 'Term', binding: 'setting', stages: ['darkroom'], encoding: 'stage', ...def, class: def.class ?? 'pointwise',
});

export const darkroomLayerOps: OpDef[] = [
  term({
    name: 'expose', term: 'main',
    args: {
      time_s: { type: 'number', unit: 's', min: 0.1, max: 600, usual: [2, 60], default: 10, doc: 'Exposure time.', ui: { widget: 'slider', step: 0.1, label: 'Time', group: 'Enlarger', scale: 'log2', aside: 'stop' } },
      fstop: { type: 'number', unit: 'fstop', min: 2.8, max: 45, default: 8, doc: 'Enlarger lens aperture (every exposure through the lens uses it).', ui: { widget: 'stepper', label: 'Aperture', group: 'Enlarger', scale: 'log2' } },
      filtration: { type: 'cmy', unit: 'CC', min: -100, max: 200, default: { c: 0, m: 0, y: 0 }, doc: 'Dichroic filtration as a shift on the database neutral pack for (paper, film); 0 = neutral.', ui: { widget: 'slider', step: 1, detents: [0], label: 'Filtration', group: 'Enlarger', components: ['C', 'M', 'Y'] } },
    },
    doc: 'The main exposure through the negative: exactly one per document, id `main`. Amount scales its light (a card held over the whole print).',
    see: ['burn', 'dodge', 'print.expose'],
  }),
  term({
    name: 'burn', term: 'contribution',
    args: { time_s: TIME, stops: STOPS, filtration: PACK },
    validate: oneTime,
    doc: 'More light through the negative under a mask (a split exposure is a burn with its own filtration). Amount scales its time.',
  }),
  term({
    name: 'dodge', term: 'contribution',
    args: { time_s: TIME, stops: STOPS },
    validate: oneTime,
    doc: "Light held back from the main exposure under a mask (never more than the main gives: max(E_main − Σ E_dodge, 0)). Amount scales the time held back.",
  }),
  term({
    name: 'flash', term: 'contribution',
    args: {
      time_s: TIME, stops: STOPS, filtration: PACK,
      through: { type: 'enum', values: ['base', 'open'], default: 'base', doc: 'Through the film base (no image: dye amounts 0) or an empty gate (no film).' },
    },
    validate: oneTime,
    doc: 'Light that does not pass the image: uniform under its mask, not held back by density masks.',
  }),
  term({
    name: 'preflash', term: 'contribution',
    args: { fraction: { type: 'number', unit: 'fraction', min: 0, max: 0.2, usual: [0, 0.05], default: 0.02, doc: 'Uniform pre-exposure as a fraction of the grey-card exposure.', ui: { widget: 'slider', step: 0.005, label: 'Preflash' } } },
    identity: (p) => p['fraction'] === 0,
    doc: "A uniform pre-exposure of the paper, added after the filters (it is measured against the grey card's exposure, H = 1 at the aim): H ← H + a·m·φ.",
  }),
  term({
    name: 'densityMask', term: 'modulator', class: 'spatial',
    args: {
      gamma: { type: 'number', unit: 'none', min: 0, max: 1, default: 0.5, doc: 'Mask gamma γ_m (0.6: large-area contrast falls to 40 %).' },
      radius_um: { type: 'number', unit: 'um', min: 0, max: 5000, default: 300, doc: 'Gaussian σ of the blur on the film: wide for a contrast mask, a thin spacer for an unsharp mask.' },
      polarity: { type: 'enum', values: ['positive', 'same'], default: 'positive', doc: 'positive lowers large-area contrast; same raises it.' },
    },
    identity: (p) => p['gamma'] === 0,
    doc: 'A neutral silver mask made from the negative and sandwiched with it (CHB-010 §6.6): every exposure through the negative passes its density, flashes do not. Amount scales the density.',
  }),
  term({
    name: 'filter', term: 'modulator',
    args: {
      logH: {
        type: 'vec3', unit: 'logH', min: -1.5, max: 1.5, usual: [-0.5, 0.5], default: [0, 0, 0],
        usualHint: 'More than 20 points on one layer usually means the wrong paper or filtration.',
        redirects: { points: { hint: 'Printer lights are stored in log H: 1 point = 0.025 log H.', scale: 0.025 } },
        ui: { widget: 'slider', step: 0.025, detents: [0], displayUnit: 'point', label: 'Printer lights', components: ['R', 'G', 'B'] },
        doc: 'Offsets of paper log exposure per layer (R, G, B light): H ← H·10^(a·m·logH). Never a density offset (Hunt 14.17).',
      },
    },
    identity: (p) => Array.isArray(p['logH']) && (p['logH'] as number[]).every((x) => x === 0),
    doc: 'A filter in the light path: the printer lights, or a local colour correction in log H under a mask. Amount scales it.',
  }),
];

const SPOTS: ArgSpec = {
  type: 'list', default: [], doc: 'Spots in order; each reads the image as the spots before it left it (in a document: a Coll of spots).',
  of: {
    x: { type: 'number', unit: 'px', doc: 'Target centre x, document px.' },
    y: { type: 'number', unit: 'px', doc: 'Target centre y, document px.' },
    r: { type: 'number', unit: 'px', min: 0.1, max: 5000, doc: 'Radius, document px.' },
    src: { type: 'point', unit: 'px', doc: 'Source centre, document px (always explicit).' },
    feather: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0.3, doc: 'Soft edge as a fraction of r: 1 inside r(1 − feather), 0 from r on, a smoothstep between.' },
    opacity: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 1, doc: 'Opacity of the spot.' },
  },
};

const repair = (name: 'heal' | 'clone', doc: string): OpDef => defineOp({
  name, area: 'retouch', owner: 'CHB-037', on: 'Image', returns: 'Image', domainIn: ['scanner-density', 'print-xyz'], domainOut: 'same',
  class: 'spatial', binding: 'setting', stages: ['scan', 'print'], encoding: 'stage',
  coalesce: { list: 'spots', opacity: 'opacity' },
  identity: (p) => Array.isArray(p['spots']) && p['spots'].length === 0,
  args: { spots: SPOTS },
  doc,
  see: [name === 'heal' ? 'clone' : 'heal'],
});

export const retouchLayerOps: OpDef[] = [
  repair('heal', 'Heals circular spots: the source patch, matched to the target\'s surroundings, replaces the target (dust on the negative in the scan stage, blemishes on the print). Adjacent heal layers coalesce into one node.'),
  repair('clone', 'Clones circular spots: the source patch replaces the target as it is. Adjacent clone layers coalesce into one node.'),
];

export const compositeOps: OpDef[] = [
  defineOp({
    name: 'clarity', area: 'composite', owner: 'CHB-037', on: 'Image', returns: 'Image', domainIn: 'print-xyz', domainOut: 'print-xyz',
    class: 'spatial', binding: 'setting', stages: ['print'], encoding: 'linear',
    identity: (p) => p['strength'] === 0,
    args: {
      strength: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0.25, doc: 'Local contrast: positive adds, negative softens.', ui: { widget: 'slider', step: 0.01, label: 'Clarity' } },
      radius_mm: { type: 'number', unit: 'mm', min: 0.1, max: 100, usual: [1, 30], default: 10, doc: 'Radius of the low-pass on the print, mm (converted with ImageInfo.umPerPx.paper, so it is the same at every export size).', ui: { widget: 'slider', step: 0.5, label: 'Radius' } },
    },
    doc: 'Local contrast on the print (a large unsharp mask weighted to the midtones), in linear light. Replaces finishing.clarity, whose radius was in preview pixels.',
  }),
  defineOp({
    name: 'composite.mix', area: 'composite', owner: 'CHB-037', on: 'Image', returns: 'Image', domainIn: ['scanner-density', 'scene-xyz', 'print-xyz'], domainOut: 'same',
    class: 'pointwise', binding: 'setting', dsl: false,
    args: {
      top: { type: 'Image', doc: 'What the entry made from the backdrop (its op applied, or a group\'s children).' },
      amount: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 1, doc: 'Opacity.' },
      mask: { type: 'Mask', optional: true, doc: 'Coverage; absent = everywhere.' },
      blend: { type: 'enum', values: [...BLEND_MODES], default: 'normal', doc: 'Blend mode B(back, top) (normal: top; the W3C set arrives with phase 8).' },
    },
    doc: 'The composite law per entry (design §4, §22): out = back + a·m·(B(back, top) − back). The receiver is the backdrop. mixPixel (pixel.ts) is the formula.',
  }),
];
