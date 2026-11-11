// v0 catalog: source (CHB-006), scan (CHB-006), invert (CHB-003). Stubs: metadata now, mock maths in
// engine-mock; the owning ticket implements them in the reference and GPU engines.
import { DOMAIN_NAMES } from '../domains.ts';
import { defineOp, type OpDef } from '../registry.ts';

const BOX_DOC = 'Box in source (sensor) pixels; absent means automatic.';

export const sourceOps: OpDef[] = [
  defineOp({
    name: 'source.open', area: 'source', owner: 'CHB-006', on: 'none', returns: 'Image', domainOut: 'camera-linear',
    class: 'global', binding: 'scan', recipePath: 'source.decode',
    args: {
      source: { type: 'string', path: '', doc: 'SHA-256 of the source file (FrameRecipe.source.sha256); the engine must have opened it.' },
      encoding: { type: 'enum', values: ['linear', 'srgb', 'gamma22'], default: 'linear', doc: 'Transfer encoding of the stored samples.', ui: { widget: 'segmented', label: 'Encoding', group: 'Source' } },
    },
    doc: 'Opens a decoded source as linear sensor values (T = signal / flat after scan.flatField).',
    see: ['source.info', 'scan.flatField'],
  }),
  defineOp({
    name: 'source.info', area: 'source', owner: 'CHB-006', on: 'Image', returns: 'Value', domainIn: 'camera-linear',
    class: 'measure', binding: 'scan', args: {},
    fields: [
      { name: 'width', type: 'number', unit: 'px', doc: 'width in source pixels' },
      { name: 'height', type: 'number', unit: 'px', doc: 'height in source pixels' },
      { name: 'bits', type: 'number', unit: 'none', doc: 'bits per sample' },
      { name: 'encoding', type: 'string', doc: 'transfer encoding' },
      { name: 'sha256', type: 'string', doc: 'source identity' },
    ],
    doc: 'Facts about the decoded source.',
  }),
  defineOp({
    name: 'source.pattern', area: 'source', owner: 'CHB-002', on: 'none', returns: 'Image', domainOut: 'camera-linear', domainFromArg: 'domain',
    class: 'global', binding: 'pixel', internal: true, dsl: false,
    args: {
      domain: { type: 'enum', values: [...DOMAIN_NAMES], default: 'camera-linear', doc: 'Domain of the generated image.' },
      width: { type: 'number', unit: 'px', min: 1, max: 4096, integer: true, default: 32, doc: 'Width.' },
      height: { type: 'number', unit: 'px', min: 1, max: 4096, integer: true, default: 24, doc: 'Height.' },
      channels: { type: 'number', unit: 'none', min: 0, max: 4, integer: true, default: 0, doc: '0 = the domain default.' },
      seed: { type: 'number', unit: 'none', min: 0, max: 2 ** 31, integer: true, default: 1, doc: 'Generator seed.' },
    },
    doc: 'Seeded test image within the domain range. Conformance suite only; never in the DSL or the docs.',
  }),
  defineOp({
    name: 'source.xyz', area: 'source', owner: 'CHB-006', on: 'Image', returns: 'Image', domainIn: 'camera-linear', domainOut: 'scene-xyz',
    class: 'pointwise', binding: 'scan', recipePath: 'capture.whiteBalance',
    args: {
      mode: { type: 'enum', values: ['daylight', 'as-shot', 'custom'], default: 'daylight', doc: 'White balance source.', ui: { widget: 'segmented', label: 'White balance', group: 'Capture' } },
      temperature_K: { type: 'number', unit: 'K', min: 2000, max: 15000, usual: [2800, 10000], default: 5500, doc: 'Custom white balance temperature.', ui: { widget: 'slider', step: 50, label: 'Temperature', group: 'Capture', aside: 'mired' } },
      tint: { type: 'number', unit: 'none', min: -150, max: 150, default: 0, doc: 'Custom white balance tint (green–magenta).', ui: { widget: 'slider', step: 1, label: 'Tint', group: 'Capture' } },
    },
    doc: 'Photo mode: camera RGB to scene XYZ with the camera matrices in SourceInfo.camera (consumed by CHB-012).',
    see: ['capture.expose'],
  }),
];

export const scanOps: OpDef[] = [
  defineOp({
    name: 'scan.flatField', area: 'scan', owner: 'CHB-006', on: 'Image', returns: 'Image', domainIn: 'camera-linear', domainOut: 'camera-linear',
    class: 'pointwise', binding: 'scan', recipePath: 'scan',
    args: { flat: { type: 'string', optional: true, doc: 'SHA-256 of the flat-field frame (opened like a source).' } },
    doc: 'Divides by the flat field in sensor coordinates.',
  }),
  defineOp({
    name: 'scan.flare', area: 'scan', owner: 'CHB-006', on: 'Image', returns: 'Image', domainIn: 'camera-linear', domainOut: 'camera-linear',
    class: 'pointwise', binding: 'scan', recipePath: 'scan',
    args: { flare: { type: 'number', unit: 'percent', min: 0, max: 20, usual: [0, 3], default: 0, doc: 'Scanner veiling flare, percent of the open-gate signal.', ui: { widget: 'slider', step: 0.05, label: 'Scanner flare', group: 'Scan' } } },
    doc: 'Removes scanner flare.',
  }),
  defineOp({
    name: 'scan.rebate', area: 'scan', owner: 'CHB-006', on: 'Image', returns: 'Value', domainIn: 'camera-linear',
    class: 'measure', binding: 'scan', recipePath: 'scan',
    args: { rebate: { type: 'box', unit: 'px', optional: true, doc: BOX_DOC, ui: { widget: 'box', label: 'Rebate', group: 'Scan' } } },
    fields: [
      { name: 'T', type: 'vec3', unit: 'fraction', doc: 'mean transmittance of the rebate' },
      { name: 'box', type: 'box', unit: 'px', doc: 'the box used' },
    ],
    doc: 'Measures the rebate (unexposed base) transmittance.',
  }),
  defineOp({
    name: 'scan.density', area: 'scan', owner: 'CHB-006', on: 'Image', returns: 'Image', domainIn: 'camera-linear', domainOut: 'scanner-density',
    class: 'pointwise', binding: 'scan', recipePath: 'scan',
    args: { rebate: { type: 'box', unit: 'px', optional: true, doc: BOX_DOC } },
    doc: 'Scanner density relative to the rebate: d = −log10(T / T_rebate).',
    see: ['scan.rebate', 'invert.dyes'],
  }),
  defineOp({
    name: 'scan.noise', area: 'scan', owner: 'CHB-006', on: 'Image', returns: 'Value', domainIn: ['camera-linear', 'scanner-density'],
    class: 'measure', binding: 'scan',
    args: { box: { type: 'box', unit: 'px', optional: true, doc: 'Region; absent = whole frame.' } },
    fields: [{ name: 'sigma', type: 'vec3', unit: 'D', doc: 'noise σ per channel in density' }],
    doc: 'Measures noise σ per channel (MAD), in density.',
  }),
  defineOp({
    name: 'scan.baseClass', area: 'scan', owner: 'CHB-006', on: 'Image', returns: 'Mask', domainIn: 'scanner-density', domainOut: 'mask',
    class: 'pointwise', binding: 'scan',
    args: { class: { type: 'enum', values: ['below', 'blank'], default: 'blank', doc: 'Which base class to select.' } },
    doc: 'Mask of pixels below base or indistinguishable from blank film.',
  }),
  defineOp({
    name: 'scan.conditioning', area: 'scan', owner: 'CHB-006', on: 'Image', returns: 'Image', domainIn: 'film-dyes', domainOut: 'scalar-field', channels: 1,
    class: 'pointwise', binding: 'scan', args: {},
    doc: 'One-channel noise gain 1/σ₃ of the dye solve.',
  }),
  defineOp({
    name: 'scan.rankStocks', area: 'scan', owner: 'CHB-006', on: 'Image', returns: 'Value', domainIn: 'scanner-density',
    class: 'measure', binding: 'scan', args: {},
    fields: [{ name: 'ranking', type: 'table', doc: 'rows {stock, score}' }],
    doc: 'Ranks candidate film stocks by how well the base and the frame fit.',
  }),
  defineOp({
    name: 'scan.specks', area: 'scan', owner: 'CHB-006', on: 'Image', returns: 'Regions', domainIn: 'scanner-density',
    class: 'measure', binding: 'scan',
    args: { threshold: { type: 'number', unit: 'none', min: 1, max: 20, usual: [3, 8], default: 5, doc: 'Detection threshold in σ.' } },
    fields: [
      { name: 'count', type: 'number', unit: 'none', doc: 'number of specks' },
      { name: 'regions', type: 'table', doc: 'rows {x, y, r} in sensor px' },
    ],
    doc: 'Detects dust specks.',
  }),
  defineOp({
    name: 'scan.heal', area: 'scan', owner: 'CHB-006', on: 'Image', returns: 'Image', domainIn: 'scanner-density', domainOut: 'scanner-density',
    class: 'spatial', binding: 'scan', recipePath: 'scan.dust',
    args: {
      spots: { type: 'string', path: '', default: '[]', doc: 'Canonical JSON of the spots (filled by compile from scan.dust.spots).' },
      method: { type: 'enum', values: ['patch', 'diffuse', 'neutral'], default: 'patch', doc: 'Healing method.' },
      marginPx: { type: 'number', unit: 'px', min: 0, max: 50, integer: true, default: 2, doc: 'Margin around each spot.' },
    },
    doc: 'Heals dust spots in scanner density.',
  }),
  defineOp({
    name: 'scan.checkDust', area: 'scan', owner: 'CHB-006', on: 'Image', returns: 'Value', domainIn: 'scanner-density',
    class: 'measure', binding: 'scan', args: {},
    fields: [
      { name: 'count', type: 'number', unit: 'none', doc: 'remaining specks' },
      { name: 'coverage', type: 'number', unit: 'fraction', doc: 'fraction of the frame covered' },
    ],
    doc: 'Checks for remaining dust after healing.',
  }),
];

export const invertOps: OpDef[] = [
  defineOp({
    name: 'invert.dyes', area: 'invert', owner: 'CHB-003', on: 'Image', returns: 'Image', domainIn: 'scanner-density', domainOut: 'film-dyes', channels: 4,
    class: 'pointwise', binding: 'stock', recipePath: 'scan',
    args: {
      stock: { type: 'stockId', valuesFrom: 'stocks:film', default: 'kodak_portra_400', doc: 'Film stock.', ui: { widget: 'select', label: 'Film stock', group: 'Scan' } },
      scanner: { type: 'string', valuesFrom: 'scanners', default: 'xt5-rgb-led', doc: 'Scanner model.', ui: { widget: 'select', label: 'Scanner', group: 'Scan' } },
    },
    doc: 'Solves scanner density for dye amounts; channel 4 is the solve residual in D.',
    see: ['invert.classify', 'print.expose'],
  }),
  defineOp({
    name: 'invert.classify', area: 'invert', owner: 'CHB-003', on: 'Image', returns: 'Value', domainIn: 'film-dyes',
    class: 'measure', binding: 'stock', args: {},
    fields: [
      { name: 'reachable', type: 'number', unit: 'fraction', doc: 'fraction solved within tolerance' },
      { name: 'blank', type: 'number', unit: 'fraction', doc: 'fraction indistinguishable from blank film' },
      { name: 'belowBase', type: 'number', unit: 'fraction', doc: 'fraction below the base' },
      { name: 'unreachable', type: 'number', unit: 'fraction', doc: 'fraction out of the stock gamut' },
    ],
    doc: 'Fractions of the frame per inversion class.',
  }),
  defineOp({
    name: 'invert.classes', area: 'invert', owner: 'CHB-003', on: 'Image', returns: 'Image', domainIn: 'film-dyes', domainOut: 'scan-classes',
    class: 'pointwise', binding: 'stock', args: {},
    doc: 'Per-pixel class map: 0 ok, 1 blank, 2 below base, 3 out of gamut.',
  }),
];
