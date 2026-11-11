// v0 catalog: view (CHB-003), output (CHB-003, CHB-011), mask (CHB-009, CHB-010).
import { ORIENTATIONS, OUTPUT_SPACES } from '../recipe.ts';
import { defineOp, type OpDef } from '../registry.ts';

export const viewOps: OpDef[] = [
  defineOp({
    name: 'view.reflect', area: 'view', owner: 'CHB-003', on: 'Image', returns: 'Image', domainIn: 'paper-dyes', domainOut: 'print-xyz',
    class: 'pointwise', binding: 'stock', recipePath: 'view',
    args: { illuminant: { type: 'string', valuesFrom: 'illuminants', default: 'D50', doc: 'Viewing light.', ui: { widget: 'select', label: 'Viewing light', group: 'View' } } },
    doc: 'The print seen under the viewing light: paper dyes to XYZ.',
  }),
  defineOp({
    name: 'view.flare', area: 'view', owner: 'CHB-003', on: 'Image', returns: 'Image', domainIn: 'print-xyz', domainOut: 'print-xyz',
    class: 'pointwise', binding: 'setting', recipePath: 'view',
    args: { flare: { type: 'number', unit: 'percent', min: 0, max: 10, usual: [0, 2], default: 0.48, doc: 'Viewing flare, percent of the paper white (0.48 % is the textbook value, §2.7).', ui: { widget: 'slider', step: 0.01, label: 'Viewing flare', group: 'View' } } },
    doc: 'Adds viewing flare. compile() uses 0 when view.output.rendering is scan-of-print.',
  }),
  defineOp({
    name: 'view.adapt', area: 'view', owner: 'CHB-003', on: 'Image', returns: 'Image', domainIn: 'print-xyz', domainOut: 'print-xyz',
    class: 'pointwise', binding: 'setting',
    args: { to: { type: 'enum', values: ['D50', 'D65'], default: 'D65', path: 'view.output.white', doc: 'White to adapt to.' } },
    doc: 'Chromatic adaptation of the print XYZ to the output white.',
  }),
  defineOp({
    name: 'view.inspect', area: 'view', owner: 'CHB-009', on: 'Image', returns: 'Image', domainIn: 'any', domainOut: 'display-rgb',
    class: 'pointwise', binding: 'setting',
    args: { mode: { type: 'enum', values: ['negative', 'density', 'dyes', 'classes', 'mask'], default: 'negative', doc: 'Inspection view.' } },
    doc: 'Renders an intermediate domain for inspection (negative, dye, class views) as display RGB.',
  }),
];

export const outputOps: OpDef[] = [
  defineOp({
    name: 'output.display', area: 'output', owner: 'CHB-011', on: 'Image', returns: 'Image', domainIn: 'print-xyz', domainOut: 'display-rgb',
    class: 'pointwise', binding: 'setting', recipePath: 'view.output',
    args: {
      space: { type: 'enum', values: [...OUTPUT_SPACES], default: 'srgb', path: '', doc: 'Output colour space (the display space for viewing; export uses view.output.export.space).' },
      rendering: { type: 'enum', values: ['print-as-seen', 'scan-of-print'], default: 'scan-of-print', redirects: { view: { hint: 'The paper-white rendering is called "rendering".' } }, doc: 'Paper white at its own level (as seen) or at display white (scan).', ui: { widget: 'segmented', label: 'Rendering', group: 'Output' } },
      knee: { type: 'enum', values: ['cam16-ucs', 'tanh-shoulder', 'clip'], default: 'cam16-ucs', path: 'view.output.display.knee.method', doc: 'Gamut compression; always the last colour step.' },
    },
    doc: "Turns the print's XYZ into encoded RGB in an output space. Finishing ops come before it; the knee is last.",
    see: ['output.encode', 'view.adapt'],
  }),
  defineOp({
    name: 'output.frame', area: 'output', owner: 'CHB-011', on: 'Image', returns: 'Image', domainIn: 'display-rgb', domainOut: 'display-rgb',
    class: 'geometric', binding: 'setting', recipePath: 'scan',
    args: {
      orientation: { type: 'enum', values: [...ORIENTATIONS], default: 'none', doc: 'Orientation applied for display.', ui: { widget: 'select', label: 'Orientation', group: 'Frame' } },
      crop: { type: 'box', unit: 'px', optional: true, doc: 'Crop in source (sensor) pixels; absent = full frame.', ui: { widget: 'box', label: 'Crop', group: 'Frame' } },
    },
    doc: 'Orientation and crop, applied last (DR-3: all coordinates are source pixels).',
  }),
  defineOp({
    name: 'output.encode', area: 'output', owner: 'CHB-011', on: 'Image', returns: 'Value', domainIn: 'display-rgb',
    class: 'global', binding: 'setting', recipePath: 'view.output.export', dsl: false,
    args: {
      format: { type: 'enum', values: ['tiff16', 'png16', 'png8', 'jpeg'], default: 'tiff16', doc: 'File format.' },
      compression: { type: 'enum', values: ['none', 'deflate'], default: 'deflate', doc: 'Lossless compression.' },
      dpi: { type: 'number', unit: 'none', min: 1, max: 4800, usual: [240, 360], default: 300, doc: 'Print resolution metadata.' },
    },
    fields: [
      { name: 'format', type: 'string', doc: 'file format' },
      { name: 'name', type: 'string', doc: 'file name in OPFS' },
      { name: 'bytes', type: 'number', unit: 'none', doc: 'file size' },
      { name: 'sha256', type: 'string', doc: 'content hash' },
    ],
    doc: 'Encodes a display-rgb image as a file in OPFS and returns its EncodedFile description. Not in the DSL in v0.',
  }),
];

const ANY_IMAGE = 'any' as const;
export const maskOps: OpDef[] = [
  defineOp({
    name: 'mask.luminance', area: 'mask', owner: 'CHB-010', on: 'Image', returns: 'Mask', domainIn: ANY_IMAGE, domainOut: 'mask',
    class: 'pointwise', binding: 'setting',
    args: {
      above: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0, doc: 'Select values above this (normalised to the domain range).' },
      below: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 1, doc: 'Select values below this.' },
      softness: { type: 'number', unit: 'fraction', min: 0, max: 0.5, default: 0.05, doc: 'Transition width.' },
    },
    validate: (a) => ((a['above'] as number) <= (a['below'] as number) ? null : 'above must not exceed below'),
    doc: 'Mask from a luminance range of the receiver.',
  }),
  defineOp({
    name: 'mask.gradient', area: 'mask', owner: 'CHB-010', on: 'Image', returns: 'Mask', domainIn: ANY_IMAGE, domainOut: 'mask',
    class: 'pointwise', binding: 'setting',
    args: {
      from: { type: 'point', unit: 'px', default: { x: 0, y: 0 }, doc: 'Where the mask is 1 (source px).' },
      to: { type: 'point', unit: 'px', default: { x: 0, y: 100 }, doc: 'Where the mask is 0 (source px).' },
    },
    doc: 'Linear gradient mask (graduated burn).',
  }),
  defineOp({
    name: 'mask.ellipse', area: 'mask', owner: 'CHB-010', on: 'Image', returns: 'Mask', domainIn: ANY_IMAGE, domainOut: 'mask',
    class: 'pointwise', binding: 'setting',
    args: { box: { type: 'box', unit: 'px', default: { x: 0, y: 0, w: 16, h: 16 }, doc: 'Bounding box in source px.' } },
    doc: 'Elliptical mask.',
  }),
  defineOp({
    name: 'mask.paint', area: 'mask', owner: 'CHB-009', on: 'Image', returns: 'Mask', domainIn: ANY_IMAGE, domainOut: 'mask',
    class: 'pointwise', binding: 'setting',
    args: { strokes: { type: 'string', default: 'none', doc: 'Id of a stroke set stored with mask.set.' } },
    doc: 'Painted mask.',
  }),
  defineOp({
    name: 'mask.feather', area: 'mask', owner: 'CHB-010', on: 'Mask', returns: 'Mask', domainIn: 'mask', domainOut: 'mask',
    class: 'spatial', binding: 'setting',
    args: { radius_px: { type: 'number', unit: 'px', min: 0, max: 500, usual: [2, 100], default: 10, doc: 'Feather radius.' } },
    doc: 'Feathers (blurs) a mask.',
  }),
  defineOp({
    name: 'mask.and', area: 'mask', owner: 'CHB-010', on: 'Mask', returns: 'Mask', domainIn: 'mask', domainOut: 'mask',
    class: 'pointwise', binding: 'setting', args: { other: { type: 'Mask', doc: 'Second mask.' } }, doc: 'Intersection (minimum).',
  }),
  defineOp({
    name: 'mask.or', area: 'mask', owner: 'CHB-010', on: 'Mask', returns: 'Mask', domainIn: 'mask', domainOut: 'mask',
    class: 'pointwise', binding: 'setting', args: { other: { type: 'Mask', doc: 'Second mask.' } }, doc: 'Union (maximum).',
  }),
  defineOp({
    name: 'mask.not', area: 'mask', owner: 'CHB-010', on: 'Mask', returns: 'Mask', domainIn: 'mask', domainOut: 'mask',
    class: 'pointwise', binding: 'setting', args: {}, doc: 'Inverse (1 − m).',
  }),
];
