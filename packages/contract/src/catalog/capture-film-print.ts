// v0 catalog: capture and film (CHB-012), print (CHB-003, CHB-010).
import { defineOp, type OpDef } from '../registry.ts';

export const captureOps: OpDef[] = [
  defineOp({
    name: 'capture.expose', area: 'capture', owner: 'CHB-012', on: 'Image', returns: 'Image', domainIn: 'scene-xyz', domainOut: 'film-logH',
    class: 'pointwise', binding: 'stock', recipePath: 'capture',
    args: {
      stock: { type: 'stockId', valuesFrom: 'stocks:film', default: 'kodak_portra_400', doc: 'Film stock the scene is shot on.', ui: { widget: 'select', label: 'Film stock', group: 'Capture' } },
      exposureEV: { type: 'number', unit: 'stop', min: -10, max: 10, usual: [-3, 3], default: 0, doc: 'Exposure relative to the stock reference.', ui: { widget: 'slider', step: 1 / 3, label: 'Exposure', group: 'Capture' } },
    },
    doc: 'Exposes film to a scene: scene XYZ to film log exposure per layer (grey card = 0).',
  }),
];

export const filmOps: OpDef[] = [
  defineOp({
    name: 'film.couple', area: 'film', owner: 'CHB-012', on: 'Image', returns: 'Image', domainIn: 'film-logH', domainOut: 'film-logH',
    class: 'spatial', binding: 'stock', recipePath: 'capture.development.dir',
    args: {
      amount: { type: 'number', unit: 'fraction', min: 0, max: 2.5, default: 1, doc: 'DIR coupler strength.', ui: { widget: 'slider', step: 0.05, label: 'Interlayer effects', group: 'Film' } },
      diffusion_um: { type: 'number', unit: 'um', min: 0, max: 150, default: 0, doc: 'DIR diffusion length.', ui: { widget: 'slider', step: 1, label: 'DIR diffusion', group: 'Film' } },
    },
    doc: 'DIR coupler interlayer effects.',
  }),
  defineOp({
    name: 'film.halation', area: 'film', owner: 'CHB-012', on: 'Image', returns: 'Image', domainIn: 'film-logH', domainOut: 'film-logH',
    class: 'spatial', binding: 'stock', recipePath: 'capture.development.halation',
    args: { strength: { type: 'number', unit: 'fraction', min: 0, max: 4, default: 1, doc: 'Halation strength relative to the stock.', ui: { widget: 'slider', step: 0.05, label: 'Halation', group: 'Film' } } },
    doc: 'Halation: light scattered back from the film base.',
  }),
  defineOp({
    name: 'film.develop', area: 'film', owner: 'CHB-012', on: 'Image', returns: 'Image', domainIn: 'film-logH', domainOut: 'film-dyes',
    class: 'pointwise', binding: 'stock',
    args: {
      push: { type: 'number', unit: 'stop', min: -2, max: 3, default: 0, path: 'capture.development.push', doc: 'Push (+) or pull (−) development.', ui: { widget: 'stepper', step: 1, label: 'Push/pull', group: 'Film' } },
      curves: { type: 'enum', values: ['datasheet', 'precorrected'], default: 'datasheet', doc: 'Set by compile to precorrected when film.couple precedes this op.' },
    },
    doc: 'Develops film log exposure to dye amounts through the characteristic curves.',
  }),
  defineOp({
    name: 'film.grain', area: 'film', owner: 'CHB-012', on: 'Image', returns: 'Image', domainIn: 'film-dyes', domainOut: 'film-dyes',
    class: 'spatial', binding: 'pixel', recipePath: 'capture.development.grain',
    args: {
      amount: { type: 'number', unit: 'fraction', min: 0, max: 4, default: 1, doc: 'Grain amount relative to the stock.', ui: { widget: 'slider', step: 0.05, label: 'Grain', group: 'Film' } },
      size_um: { type: 'number', unit: 'um', min: 3, max: 45, default: 12, doc: 'Grain clump size.', ui: { widget: 'slider', step: 0.5, label: 'Grain size', group: 'Film' } },
      seed: { type: 'number', unit: 'none', min: 0, max: 2 ** 31, integer: true, default: 1, doc: 'Seed; grain is a pure function of inputs, seed and print grid, independent of tiling.' },
    },
    doc: 'Film grain in dye amounts. Deterministic: same seed, same grain, whatever the region or tiling.',
  }),
];

export const printOps: OpDef[] = [
  defineOp({
    name: 'print.expose', area: 'print', owner: 'CHB-003', on: 'Image', returns: 'Image', domainIn: 'film-dyes', domainOut: 'paper-logH',
    class: 'pointwise', binding: 'stock', recipePath: 'print.enlarger',
    args: {
      paper: { type: 'stockId', valuesFrom: 'stocks:print', default: 'kodak_portra_endura', path: 'print.paper', doc: 'Colour paper.', ui: { widget: 'select', label: 'Paper', group: 'Print' } },
      mode: { type: 'enum', values: ['real', 'normalised'], default: 'normalised', doc: 'normalised: the grey card prints at the aim at lights 0; real: a physical enlarger (CHB-010).', ui: { widget: 'segmented', label: 'Enlarger mode', group: 'Print' } },
      lamp: { type: 'string', valuesFrom: 'lamps', default: 'TH-KG3', doc: 'Enlarger lamp and heat filter.' },
      filtration: { type: 'cmy', unit: 'CC', min: -100, max: 200, default: { c: 0, m: 0, y: 0 }, doc: 'Dichroic filtration as a shift on the database neutral pack for (paper, film); 0 = neutral. The absolute pack is neutral + shift and must stay ≥ 0.', ui: { widget: 'slider', step: 1, detents: [0], label: 'Filtration', group: 'Print', components: ['C', 'M', 'Y'] } },
      time_s: { type: 'number', unit: 's', min: 0.1, max: 600, usual: [2, 60], default: 10, doc: 'Exposure time.', ui: { widget: 'slider', step: 0.1, label: 'Time', group: 'Print', scale: 'log2', aside: 'stop' } },
      fstop: { type: 'number', unit: 'fstop', min: 2.8, max: 45, default: 8, doc: 'Enlarger lens aperture.', ui: { widget: 'stepper', label: 'Aperture', group: 'Print', scale: 'log2' } },
      magnification: { type: 'number', unit: 'none', min: 0.5, max: 20, optional: true, doc: "Enlarger magnification; absent = the calibration's reference (CHB-010)." },
      aim: { type: 'enum', values: ['grey-0.184', 'midgray-normalised'], default: 'grey-0.184', path: 'print.aim', doc: 'What printer lights 0 mean: the grey card prints as a neutral 0.184 reflectance (grey-0.184), or the normalised mid-grey exposure alone.' },
      aimView: { type: 'string', valuesFrom: 'illuminants', default: 'D50', path: 'view.illuminant', doc: 'Viewing light the grey-0.184 aim is neutral under (compile passes the recipe viewing light).' },
    },
    doc: 'Exposes paper through the negative: the per-stock table from dye amounts to paper log exposure, without lights.',
    see: ['print.lights', 'print.develop'],
    examples: ['const neg = frame.negative(); await neg.print({ time_s: 12.6 }).look("time +1/3 stop")'],
  }),
  defineOp({
    name: 'print.lights', area: 'print', owner: 'CHB-003', on: 'Image', returns: 'Image', domainIn: 'paper-logH', domainOut: 'paper-logH',
    class: 'pointwise', binding: 'setting', recipePath: 'print.lights',
    args: {
      logH: {
        type: 'vec3', unit: 'logH', min: -1.5, max: 1.5, usual: [-0.5, 0.5],
        usualHint: 'More than 20 points on one layer usually means the wrong paper or filtration.',
        default: [0, 0, 0],
        redirects: { points: { hint: 'Printer lights are stored in log H: 1 point = 0.025 log H.', scale: 0.025 } },
        ui: { widget: 'slider', step: 0.025, detents: [0], displayUnit: 'point', label: 'Printer lights', group: 'Print', components: ['R', 'G', 'B'] },
        doc: 'Offsets of paper log exposure per layer (R, G, B light), applied after the negative→paper table.',
      },
    },
    doc: "Balance colour and density by shifting the paper's log exposure. Never a density offset (Hunt 14.17).",
    see: ['print.expose', 'measure.densitometer'],
    examples: ['await frame.negative().print({ lights: units.pt([4, 0, 0]) }).look("+4 pt red")'],
  }),
  defineOp({
    name: 'print.preflash', area: 'print', owner: 'CHB-010', on: 'Image', returns: 'Image', domainIn: 'paper-logH', domainOut: 'paper-logH',
    class: 'pointwise', binding: 'setting',
    args: { amount: { type: 'number', unit: 'fraction', min: 0, max: 0.2, usual: [0, 0.05], default: 0, path: 'print.preflash', doc: 'Uniform pre-exposure as a fraction of the grey-card exposure.', ui: { widget: 'slider', step: 0.005, label: 'Preflash', group: 'Print' } } },
    doc: 'Adds a uniform pre-exposure in linear H.',
  }),
  defineOp({
    name: 'print.combine', area: 'print', owner: 'CHB-010', on: 'Image', returns: 'Image', domainIn: 'paper-logH', domainOut: 'paper-logH',
    class: 'pointwise', binding: 'setting',
    args: {
      exposures: { type: 'Image[]', default: [], doc: 'Additional paper-logH exposures, summed in linear H.' },
      masks: { type: 'Mask[]', default: [], doc: 'One mask per additional exposure.' },
      modes: { type: 'string[]', default: [], doc: "Per exposure: 'add' (burn, flash, split) or 'subtract' (dodge)." },
    },
    validate: (a) => {
      const n = (a['exposures'] as unknown[]).length;
      const modes = a['modes'] as string[];
      if ((a['masks'] as unknown[]).length !== n || modes.length !== n) return 'exposures, masks and modes must have the same length';
      return modes.every((m) => m === 'add' || m === 'subtract') ? null : "modes must be 'add' or 'subtract'";
    },
    doc: 'Sums several exposures in linear H (dodge, burn, flash, split; CHB-010).',
  }),
  defineOp({
    name: 'print.develop', area: 'print', owner: 'CHB-003', on: 'Image', returns: 'Image', domainIn: 'paper-logH', domainOut: 'paper-dyes',
    class: 'pointwise', binding: 'stock',
    args: {
      paper: { type: 'stockId', valuesFrom: 'stocks:print', default: 'kodak_portra_endura', path: 'print.paper', doc: 'Colour paper.' },
      grade: { type: 'number', unit: 'none', min: 0, max: 5, usual: [1, 4], default: 2, path: 'print.grade', doc: 'Contrast grade.', ui: { widget: 'slider', step: 0.5, label: 'Grade', group: 'Print' } },
    },
    doc: 'Develops paper log exposure to paper dye amounts through the paper curves.',
  }),
  defineOp({
    name: 'print.densityMask', area: 'print', owner: 'CHB-010', on: 'Image', returns: 'Image', domainIn: 'printing-density', domainOut: 'printing-density',
    class: 'spatial', binding: 'scan',
    args: {
      amount: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0, doc: 'Strength of the unsharp density mask.' },
      radius_um: { type: 'number', unit: 'um', min: 0, max: 5000, default: 500, doc: 'Blur radius on the film.' },
    },
    doc: 'Contrast-reducing density mask (unsharp mask in printing density).',
  }),
];
