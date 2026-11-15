// Catalog: capture and film (CHB-012), print (CHB-003, CHB-010). Contract 1.0: these are the nodes the stage media
// and the light law compile to; the darkroom's layers (expose, burn, …) are in layers.ts. print.lights and
// print.preflash are gone: the printer lights are `filter` layers and preflash a `preflash` layer, both terms of the
// one print.combine (design §22, §29).
import { defineOp, type OpDef } from '../registry.ts';
import type { ArgSpec } from '../spec.ts';

/** print.combine's term roles: light through the negative (burn), withheld from the main (dodge), or a flash. */
export const COMBINE_ROLES: readonly string[] = ['burn', 'dodge', 'flash-base', 'flash-open'];

const WEIGHT: ArgSpec = { type: 'number', unit: 'none', min: 0, max: 256, doc: "The term's amount: the entry's amount times its groups' amounts (light law: scales the light or the density)." };
const COVER: ArgSpec = { type: 'Mask', optional: true, doc: "The term's coverage: the entry's mask times its groups' masks; absent = everywhere." };

export const captureOps: OpDef[] = [
  defineOp({
    name: 'capture.expose', area: 'capture', owner: 'CHB-012', on: 'Image', returns: 'Image', domainIn: 'scene-xyz', domainOut: 'film-logH',
    class: 'pointwise', binding: 'stock',
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
    class: 'spatial', binding: 'stock',
    args: {
      amount: { type: 'number', unit: 'fraction', min: 0, max: 2.5, default: 1, doc: 'DIR coupler strength.', ui: { widget: 'slider', step: 0.05, label: 'Interlayer effects', group: 'Film' } },
      diffusion_um: { type: 'number', unit: 'um', min: 0, max: 150, default: 0, doc: 'DIR diffusion length.', ui: { widget: 'slider', step: 1, label: 'DIR diffusion', group: 'Film' } },
    },
    doc: 'DIR coupler interlayer effects.',
  }),
  defineOp({
    name: 'film.halation', area: 'film', owner: 'CHB-012', on: 'Image', returns: 'Image', domainIn: 'film-logH', domainOut: 'film-logH',
    class: 'spatial', binding: 'stock',
    args: { strength: { type: 'number', unit: 'fraction', min: 0, max: 4, default: 1, doc: 'Halation strength relative to the stock.', ui: { widget: 'slider', step: 0.05, label: 'Halation', group: 'Film' } } },
    doc: 'Halation: light scattered back from the film base.',
  }),
  defineOp({
    name: 'film.develop', area: 'film', owner: 'CHB-012', on: 'Image', returns: 'Image', domainIn: 'film-logH', domainOut: 'film-dyes',
    class: 'pointwise', binding: 'stock',
    args: {
      push: { type: 'number', unit: 'stop', min: -2, max: 3, default: 0, doc: 'Push (+) or pull (−) development.', ui: { widget: 'stepper', step: 1, label: 'Push/pull', group: 'Film' } },
      curves: { type: 'enum', values: ['datasheet', 'precorrected'], default: 'datasheet', doc: 'Set by compile to precorrected when film.couple precedes this op.' },
    },
    doc: 'Develops film log exposure to dye amounts through the characteristic curves.',
  }),
  defineOp({
    name: 'film.grain', area: 'film', owner: 'CHB-012', on: 'Image', returns: 'Image', domainIn: 'film-dyes', domainOut: 'film-dyes',
    class: 'spatial', binding: 'pixel',
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
    class: 'pointwise', binding: 'stock',
    args: {
      paper: { type: 'stockId', valuesFrom: 'stocks:print', default: 'kodak_portra_endura', doc: 'Colour paper (darkroom medium).', ui: { widget: 'select', label: 'Paper', group: 'Print' } },
      mode: { type: 'enum', values: ['real', 'normalised'], default: 'real', doc: 'real: a physical enlarger, where time, aperture and magnification expose the paper (CHB-010; the default since contract 0.4, CHB-031); normalised: the grey card prints at the aim at lights 0 whatever the optics, so time, aperture and magnification do nothing.', ui: { widget: 'segmented', label: 'Enlarger mode', group: 'Print' } },
      lamp: { type: 'string', valuesFrom: 'lamps', default: 'TH-KG3', doc: 'Enlarger lamp and heat filter.' },
      filtration: { type: 'cmy', unit: 'CC', min: -100, max: 200, default: { c: 0, m: 0, y: 0 }, doc: 'Dichroic filtration as a shift on the database neutral pack for (paper, film); 0 = neutral. The absolute pack is neutral + shift and must stay ≥ 0.', ui: { widget: 'slider', step: 1, detents: [0], label: 'Filtration', group: 'Print', components: ['C', 'M', 'Y'] } },
      time_s: { type: 'number', unit: 's', min: 0.1, max: 600, usual: [2, 60], default: 10, doc: 'Exposure time.', ui: { widget: 'slider', step: 0.1, label: 'Time', group: 'Print', scale: 'log2', aside: 'stop' } },
      fstop: { type: 'number', unit: 'fstop', min: 2.8, max: 45, default: 8, doc: 'Enlarger lens aperture.', ui: { widget: 'stepper', label: 'Aperture', group: 'Print', scale: 'log2' } },
      magnification: { type: 'number', unit: 'none', min: 0.5, max: 20, default: 8, doc: "Enlarger magnification: light ∝ 1/(m + 1)² in real mode (8 = the calibration's reference), and the print's pitch: ImageInfo.umPerPx.paper = umPerPx.film × m (CHB-010; contract 1.0: always given)." },
      aim: { type: 'enum', values: ['grey-0.184', 'midgray-normalised'], default: 'grey-0.184', doc: 'What printer lights 0 mean: the grey card prints as a neutral 0.184 reflectance (grey-0.184), or the normalised mid-grey exposure alone.' },
      aimView: { type: 'string', valuesFrom: 'illuminants', default: 'D50', doc: 'Viewing light the grey-0.184 aim is neutral under (the compiler passes the print medium\'s illuminant).' },
    },
    doc: 'Exposes paper through the negative: the per-stock table from dye amounts to paper log exposure, without lights. The light law makes one per contribution (the main exposure, each burn, dodge and flash).',
    see: ['print.combine', 'print.develop'],
  }),
  defineOp({
    name: 'print.combine', area: 'print', owner: 'CHB-010', on: 'Image', returns: 'Image', domainIn: 'paper-logH', domainOut: 'paper-logH',
    class: 'pointwise', binding: 'setting',
    args: {
      mainAmount: { type: 'number', unit: 'none', min: 0, max: 256, default: 1, doc: "The main exposure's amount (the receiver: the print.expose of the entry main)." },
      mainMask: { type: 'Mask', optional: true, doc: "The main exposure's coverage; absent = everywhere." },
      terms: {
        type: 'list', default: [], doc: 'Light terms besides the main exposure, each a print.expose of its own seconds and pack.',
        of: {
          role: { type: 'enum', values: [...COMBINE_ROLES], doc: "burn: added through the negative (burn, split); dodge: withheld from the main exposure; flash-base / flash-open: the exposure's print.expose settings evaluated uniformly, through the film base with no image (dye amounts 0) or through an empty gate (no film)." },
          image: { type: 'Image', doc: 'The print.expose of the term (paper-logH).' },
          amount: WEIGHT,
          mask: COVER,
        },
      },
      densities: {
        type: 'list', default: [], doc: 'Density masks d_m (print.densityMask, scalar-field): every exposure through the negative is multiplied by 10^−Σ a·m·d_m; flashes and the preflash are not.',
        of: { image: { type: 'Image', doc: 'The print.densityMask node (scalar-field, D).' }, amount: WEIGHT, mask: COVER },
      },
      filters: {
        type: 'list', default: [], doc: 'Filters in the light path: H is multiplied by 10^(Σ a·m·logH) per layer (the printer lights; a colour correction in H).',
        of: { logH: { type: 'vec3', unit: 'logH', min: -1.5, max: 1.5, doc: 'Log exposure offset per paper layer (R, G, B light).' }, amount: WEIGHT, mask: COVER },
      },
      preflash: {
        type: 'list', default: [], doc: 'Uniform pre-exposures, added after the filters (a fraction of the grey-card exposure, H = 1 at the aim).',
        of: { fraction: { type: 'number', unit: 'fraction', min: 0, max: 0.2, doc: 'Pre-exposure as a fraction of the grey-card exposure.' }, amount: WEIGHT, mask: COVER },
      },
    },
    doc: 'The light law of the darkroom in one node (design §22): H = T_all·(T_neg·(max(E_main − Σ E_dodge, 0) + Σ E_burn) + Σ E_flash) + Σ E_pre, with E = a·m·r·10^x per term (r = t_i / t_main in normalised mode, else 1), T_neg = 10^−Σ a·m·d, T_all = 10^Σ a·m·logH, one log at the end: x = log10 max(H, 1e-8). lightH (packages/contract pixel.ts) is the formula per pixel.',
    see: ['print.expose', 'print.densityMask', 'print.develop'],
  }),
  defineOp({
    name: 'print.develop', area: 'print', owner: 'CHB-003', on: 'Image', returns: 'Image', domainIn: 'paper-logH', domainOut: 'paper-dyes',
    class: 'pointwise', binding: 'stock',
    args: {
      paper: { type: 'stockId', valuesFrom: 'stocks:print', default: 'kodak_portra_endura', doc: 'Colour paper.' },
      grade: { type: 'number', unit: 'none', min: 0, max: 5, usual: [1, 4], default: 2, doc: 'Contrast grade: a gamma about the aim grey, so the grey card stays (0 → 0.7, 1 → 0.82, 2 → 1 the paper as made, 3 → 1.2, 4 → 1.45, 5 → 1.8). Colour papers have no grades; this is a contrast control (darkroom medium).', ui: { widget: 'slider', step: 0.5, label: 'Grade', group: 'Print' } },
    },
    doc: 'Develops paper log exposure to paper dye amounts through the paper curves.',
  }),
  defineOp({
    name: 'print.densityMask', area: 'print', owner: 'CHB-010', on: 'Image', returns: 'Image', domainIn: 'paper-logH', domainOut: 'scalar-field',
    class: 'spatial', binding: 'scan',
    args: {
      gamma: { type: 'number', unit: 'none', min: 0, max: 1, default: 0, doc: 'Mask gamma γ_m (0.6: large-area contrast falls to 40 %).' },
      radius_um: { type: 'number', unit: 'um', min: 0, max: 5000, default: 500, doc: 'Gaussian σ of the blur on the film (spacer and diffuser), converted with ImageInfo.umPerPx.film.' },
      polarity: { type: 'enum', values: ['positive', 'same'], default: 'positive', doc: "positive lowers large-area contrast (d_m = γ(log10 H_m − log10 min H_m)); same raises it (d_m = γ(log10 max H_m − log10 H_m))." },
    },
    doc: "The density d_m ≥ 0 of a neutral silver mask made from the negative: H_m = blur of the negative's mean transmittance 10^−PD, with PD = x_clear − x read from the receiver (the main print.expose; x_clear its clear-film exposure). print.combine applies it (densities).",
  }),
];
