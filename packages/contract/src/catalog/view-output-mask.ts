// v0 catalog: view (CHB-003), output (CHB-003, CHB-011), mask (CHB-009, CHB-010).
import { KNEE_METHODS, ORIENTATIONS, OUTPUT_SPACES } from '../recipe.ts';
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
      knee: { type: 'enum', values: [...KNEE_METHODS], default: 'oklch', path: 'view.output.display.knee.method', doc: "Gamut compression; always the last colour step. 'oklch': OkLCh chroma knee (spektrafilm's parameters; called 'cam16-ucs' before contract 0.2); 'cam16-ucs': the same in CAM16-UCS (L_A 64, Y_b 20, average surround, D = 1; contract 0.3, CHB-011); 'tanh-shoulder': Chromogen's per-channel shoulder (kept for comparison; it cannot keep paper white at display white); 'clip': per channel." },
    },
    doc: "Turns the print's XYZ into encoded RGB in an output space. Finishing ops come before it; the knee is last.",
    see: ['output.encode', 'view.adapt'],
  }),
  defineOp({
    name: 'output.frame', area: 'output', owner: 'CHB-011', on: 'Image', returns: 'Image', domainIn: 'display-rgb', domainOut: 'display-rgb',
    class: 'geometric', binding: 'setting', recipePath: 'view.frame',
    args: {
      orientation: { type: 'enum', values: [...ORIENTATIONS], default: 'none', doc: 'Orientation applied for display.', ui: { widget: 'select', label: 'Orientation', group: 'Frame' } },
      angle_deg: { type: 'number', unit: 'deg', min: -45, max: 45, default: 0, doc: 'Straighten: the crop content is rotated about the crop centre, clockwise as shown (after the orientation); bilinear, empty corners are 0.', ui: { widget: 'slider', step: 0.1, detents: [0], label: 'Straighten', group: 'Frame' } },
      crop: { type: 'box', unit: 'px', optional: true, doc: 'Crop in source (sensor) pixels of the un-oriented frame; absent = full frame. The output has the box size, oriented.', ui: { widget: 'box', label: 'Crop', group: 'Frame' } },
    },
    doc: 'Crop, straighten and orientation, applied last, resampling once (DR-3: all coordinates are source pixels). Contract 0.3: recipe view.frame for both frame kinds (was scan.orientation / scan.crop).',
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
      { name: 'mime', type: 'string', doc: 'image/png or image/tiff' },
      { name: 'width', type: 'number', unit: 'px', doc: 'pixel width' },
      { name: 'height', type: 'number', unit: 'px', doc: 'pixel height' },
      { name: 'bits', type: 'number', unit: 'none', doc: '8 or 16' },
      { name: 'space', type: 'string', doc: 'output space id' },
      { name: 'iccSha256', type: 'string', doc: 'sha256 of the embedded profile (empty when none)' },
      { name: 'recipeSha256', type: 'string', doc: 'sha256 of the canonical recipe (empty when not given)' },
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
      above: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0, doc: 'Select values above this (normalised to the domain range). 0 means no lower bound (values below the domain range stay selected).' },
      below: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 1, doc: 'Select values below this. 1 means no upper bound.' },
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
    args: {
      box: { type: 'box', unit: 'px', default: { x: 0, y: 0, w: 16, h: 16 }, doc: 'Bounding box in source px (before rotation).' },
      angle_deg: { type: 'number', unit: 'deg', min: -90, max: 90, default: 0, doc: 'Rotation about the box centre.' },
    },
    doc: 'Elliptical mask. The edge is antialiased over one pixel; use mask.feather for a soft edge.',
  }),
  defineOp({
    name: 'mask.paint', area: 'mask', owner: 'CHB-009', on: 'Image', returns: 'Mask', domainIn: ANY_IMAGE, domainOut: 'mask',
    class: 'pointwise', binding: 'setting',
    args: { strokes: { type: 'string', default: '[]', doc: 'Canonical JSON of the strokes: [{kind: "stroke", points: [[x, y, pressure]…], radius, hardness, mode: "add"|"erase"}], sensor px, simplified (RDP 0.5 px).' } },
    doc: 'Painted mask: brush strokes rasterised with soft round dabs. Pressure is recorded but does not modulate the brush; add takes the maximum, erase multiplies by 1 − coverage.',
  }),
  defineOp({
    name: 'mask.feather', area: 'mask', owner: 'CHB-010', on: 'Mask', returns: 'Mask', domainIn: 'mask', domainOut: 'mask',
    class: 'spatial', binding: 'setting',
    args: { radius_px: { type: 'number', unit: 'px', min: 0, max: 500, usual: [2, 100], default: 10, doc: 'Feather radius in source px: a Gaussian of σ = radius/2 (the 10–90 % edge is 1.28 × radius wide).' } },
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

export const retouchOps: OpDef[] = [
  defineOp({
    name: 'retouch.heal', area: 'retouch', owner: 'CHB-022', on: 'Image', returns: 'Image', domainIn: 'print-xyz', domainOut: 'print-xyz',
    class: 'spatial', binding: 'setting', recipePath: 'retouch',
    args: { spots: { type: 'string', path: '', default: '{}', doc: 'Canonical JSON of the enabled retouch.spots record (compile fills it): {id: {mode, x, y, r, src: {x, y}, feather, opacity, enabled}}, sensor px of the un-oriented source.' } },
    doc: 'Heals and clones circular spots on the print (after view.adapt, before finishing). Every source is read from the image before retouching; a later spot covers an earlier one. Contract 0.3 stub: the engines pass the image through with W_PREVIEW_APPROX until CHB-022 implements it.',
    see: ['scan.heal'],
  }),
];
