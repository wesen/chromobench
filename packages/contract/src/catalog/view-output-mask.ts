// Catalog: view (CHB-003), output (CHB-003, CHB-011), mask (CHB-009, CHB-010). Contract 1.0: the mask ops are the
// components and the one algebra of design §25 (add = max, subtract = a·(1 − b), intersect = a·b, invert = 1 − m,
// each faded by an amount); mask.and / mask.or (min / max) are gone. Geometry is in document pixels.
import { KNEE_METHODS, MASK_COMBINES, ORIENTATIONS, OUTPUT_SPACES } from '../document.ts';
import { domainsOf } from '../encodings.ts';
import { defineOp, type OpDef } from '../registry.ts';

export const viewOps: OpDef[] = [
  defineOp({
    name: 'view.reflect', area: 'view', owner: 'CHB-003', on: 'Image', returns: 'Image', domainIn: 'paper-dyes', domainOut: 'print-xyz',
    class: 'pointwise', binding: 'stock',
    args: { illuminant: { type: 'string', valuesFrom: 'illuminants', default: 'D50', doc: 'Viewing light.', ui: { widget: 'select', label: 'Viewing light', group: 'View' } } },
    doc: 'The print seen under the viewing light: paper dyes to XYZ.',
  }),
  defineOp({
    name: 'view.flare', area: 'view', owner: 'CHB-003', on: 'Image', returns: 'Image', domainIn: 'print-xyz', domainOut: 'print-xyz',
    class: 'pointwise', binding: 'setting',
    args: { flare: { type: 'number', unit: 'percent', min: 0, max: 10, usual: [0, 2], default: 0.48, doc: 'Viewing flare, percent of the paper white (0.48 % is the textbook value, §2.7).', ui: { widget: 'slider', step: 0.01, label: 'Viewing flare', group: 'View' } } },
    doc: 'Adds viewing flare. The compiler uses 0 when Document.output.rendering is scan-of-print.',
  }),
  defineOp({
    name: 'view.adapt', area: 'view', owner: 'CHB-003', on: 'Image', returns: 'Image', domainIn: 'print-xyz', domainOut: 'print-xyz',
    class: 'pointwise', binding: 'setting',
    args: { to: { type: 'enum', values: ['D50', 'D65'], default: 'D65', doc: 'White to adapt to (Document.output.white).' } },
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
    class: 'pointwise', binding: 'setting',
    args: {
      space: { type: 'enum', values: [...OUTPUT_SPACES], default: 'srgb', doc: 'Output colour space (the display space for viewing; export uses Document.output.export.space).' },
      rendering: { type: 'enum', values: ['print-as-seen', 'scan-of-print'], default: 'scan-of-print', redirects: { view: { hint: 'The paper-white rendering is called "rendering".' } }, doc: 'Paper white at its own level (as seen) or at display white (scan).', ui: { widget: 'segmented', label: 'Rendering', group: 'Output' } },
      knee: { type: 'enum', values: [...KNEE_METHODS], default: 'oklch', doc: "Gamut compression; always the last colour step. 'oklch': OkLCh chroma knee (spektrafilm's parameters; called 'cam16-ucs' before contract 0.2); 'cam16-ucs': the same in CAM16-UCS (L_A 64, Y_b 20, average surround, D = 1; contract 0.3, CHB-011); 'tanh-shoulder': Chromogen's per-channel shoulder (kept for comparison; it cannot keep paper white at display white); 'clip': per channel." },
    },
    doc: "Turns the print's XYZ into encoded RGB in an output space. The print stage comes before it; the knee is last.",
    see: ['output.encode', 'view.adapt'],
  }),
  defineOp({
    name: 'output.frame', area: 'output', owner: 'CHB-011', on: 'Image', returns: 'Image', domainIn: ['display-rgb', 'mask'], domainOut: 'same',
    class: 'geometric', binding: 'setting',
    args: {
      orientation: { type: 'enum', values: [...ORIENTATIONS], default: 'none', doc: 'Orientation applied for display.', ui: { widget: 'select', label: 'Orientation', group: 'Frame' } },
      angle_deg: { type: 'number', unit: 'deg', min: -45, max: 45, default: 0, doc: 'Straighten: the crop content is rotated about the crop centre, clockwise as shown (after the orientation); bilinear, empty corners are 0.', ui: { widget: 'slider', step: 0.1, detents: [0], label: 'Straighten', group: 'Frame' } },
      crop: { type: 'box', unit: 'px', optional: true, doc: 'Crop in document pixels of the un-oriented frame; absent = full frame. The output has the box size, oriented.', ui: { widget: 'box', label: 'Crop', group: 'Frame' } },
    },
    doc: 'Crop, straighten and orientation (Document.geometry), applied last, resampling once (DR-3: all coordinates are document pixels). On a mask (contract 1.4, CHB-039) it puts the mask where the display cut shows the picture: the viewer\'s mask overlay.',
  }),
  defineOp({
    name: 'output.encode', area: 'output', owner: 'CHB-011', on: 'Image', returns: 'Value', domainIn: 'display-rgb',
    class: 'global', binding: 'setting', dsl: false,
    args: {
      format: { type: 'enum', values: ['tiff16', 'png16', 'png8', 'jpeg'], default: 'tiff16', doc: 'File format.' },
      compression: { type: 'enum', values: ['none', 'deflate'], default: 'deflate', doc: 'Lossless compression.' },
      dpi: { type: 'number', unit: 'none', min: 1, max: 4800, usual: [240, 360], default: 300, doc: 'Print resolution metadata.' },
      quality: { type: 'number', unit: 'none', min: 1, max: 100, integer: true, usual: [70, 95], default: 90, doc: 'JPEG quality (the IJG scale: 100 is the finest quantisation); the lossless formats ignore it.' },
    },
    fields: [
      { name: 'format', type: 'string', doc: 'file format' },
      { name: 'name', type: 'string', doc: 'file name in OPFS' },
      { name: 'bytes', type: 'number', unit: 'none', doc: 'file size' },
      { name: 'sha256', type: 'string', doc: 'content hash' },
      { name: 'mime', type: 'string', doc: 'image/png, image/tiff or image/jpeg' },
      { name: 'width', type: 'number', unit: 'px', doc: 'pixel width' },
      { name: 'height', type: 'number', unit: 'px', doc: 'pixel height' },
      { name: 'bits', type: 'number', unit: 'none', doc: '8 or 16' },
      { name: 'space', type: 'string', doc: 'output space id' },
      { name: 'iccSha256', type: 'string', doc: 'sha256 of the embedded profile (empty when none)' },
      { name: 'documentSha256', type: 'string', doc: 'sha256 of the canonical document (empty when not given)' },
    ],
    doc: 'Encodes a display-rgb image as a file in OPFS and returns its EncodedFile description. Not in the DSL in v0.',
  }),
];

const ANY_IMAGE = 'any' as const;
const FRACTION_AMOUNT = { type: 'number', unit: 'fraction', min: 0, max: 1, default: 1, doc: 'How much the component acts: v ← v + amount·(op(v, other) − v).' } as const;

export const maskOps: OpDef[] = [
  defineOp({
    name: 'mask.luminance', area: 'mask', owner: 'CHB-010', on: 'Image', returns: 'Mask', domainIn: ANY_IMAGE, domainOut: 'mask',
    class: 'pointwise', binding: 'setting',
    args: {
      above: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0, doc: 'Select values above this (normalised to the domain range). 0 means no lower bound (values below the domain range stay selected).' },
      below: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 1, doc: 'Select values below this. 1 means no upper bound.' },
      softness: { type: 'number', unit: 'fraction', min: 0, max: 0.5, default: 0.05, doc: 'Transition width.' },
    },
    validate: (a) => ((a['above'] as number) <= (a['below'] as number) ? null : 'above must not exceed below'), ui: { label: 'Luminance range', menu: 'mask', order: 50 },
    doc: "Mask component 'luminance': how far the receiver's luminance (the mean of its channels, normalised to its domain range) lies inside [above, below]. The receiver is the cut the mask reads.",
  }),
  defineOp({
    name: 'mask.linear', area: 'mask', owner: 'CHB-010', on: 'Image', returns: 'Mask', domainIn: ANY_IMAGE, domainOut: 'mask',
    class: 'pointwise', binding: 'setting',
    args: {
      from: { type: 'point', unit: 'px', default: { x: 0, y: 0 }, doc: 'Where the mask is 1 (document px).' },
      to: { type: 'point', unit: 'px', default: { x: 0, y: 100 }, doc: 'Where the mask is 0 (document px).' },
    },
    ui: { label: 'Linear gradient', menu: 'mask', order: 10 },
    doc: "Mask component 'linear': 1 at `from`, 0 at `to`, linear between, constant beyond (a graduated burn). The receiver only gives the size.",
  }),
  defineOp({
    name: 'mask.radial', area: 'mask', owner: 'CHB-037', on: 'Image', returns: 'Mask', domainIn: ANY_IMAGE, domainOut: 'mask',
    class: 'pointwise', binding: 'setting',
    args: {
      box: { type: 'box', unit: 'px', default: { x: 0, y: 0, w: 16, h: 16 }, doc: 'Bounding box of the outer ellipse in document px (before rotation).' },
      angle_deg: { type: 'number', unit: 'deg', min: -90, max: 90, default: 0, doc: 'Rotation about the box centre.' },
      feather: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0.5, doc: 'Soft edge as a fraction of the radius: 1 inside the ellipse scaled by 1 − feather, 0 from the outer ellipse on, a smoothstep between.' },
    },
    ui: { label: 'Radial gradient', menu: 'mask', order: 20 },
    doc: "Mask component 'radial': an ellipse with its own soft edge (Lightroom's radial gradient), pointwise: no blur, unlike the mask's feather. The receiver only gives the size.",
  }),
  defineOp({
    name: 'mask.ellipse', area: 'mask', owner: 'CHB-010', on: 'Image', returns: 'Mask', domainIn: ANY_IMAGE, domainOut: 'mask',
    class: 'pointwise', binding: 'setting',
    args: {
      box: { type: 'box', unit: 'px', default: { x: 0, y: 0, w: 16, h: 16 }, doc: 'Bounding box in document px (before rotation).' },
      angle_deg: { type: 'number', unit: 'deg', min: -90, max: 90, default: 0, doc: 'Rotation about the box centre.' },
    },
    ui: { label: 'Ellipse', menu: 'mask', order: 30 },
    doc: "Mask component 'ellipse': the ellipse inscribed in the box. The edge is antialiased over one pixel; the mask's feather softens it.",
  }),
  defineOp({
    name: 'mask.paint', area: 'mask', owner: 'CHB-009', on: 'Image', returns: 'Mask', domainIn: ANY_IMAGE, domainOut: 'mask',
    class: 'pointwise', binding: 'setting',
    args: {
      strokes: {
        type: 'list', default: [], doc: 'Brush strokes in order (in a document: a Coll of strokes).',
        of: {
          points: { type: 'polyline', doc: 'The stroke: [x, y, pressure] in document px, simplified (RDP 0.5 px). Pressure is recorded but does not modulate the brush.' },
          radius: { type: 'number', unit: 'px', min: 0.1, max: 5000, doc: 'Brush radius in document px.' },
          hardness: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0.5, doc: 'Brush hardness.' },
          mode: { type: 'enum', values: ['add', 'erase'], default: 'add', doc: 'add takes the maximum; erase multiplies by 1 − coverage.' },
        },
      },
    },
    ui: { label: 'Brush', menu: 'mask', order: 40 },
    doc: "Mask component 'paint': brush strokes rasterised with soft round dabs.",
  }),
  defineOp({
    name: 'mask.colour', area: 'mask', owner: 'CHB-037', on: 'Image', returns: 'Mask', domainIn: domainsOf('oklab'), domainOut: 'mask',
    class: 'pointwise', binding: 'setting',
    args: {
      colour: { type: 'vec3', unit: 'none', min: -0.5, max: 1.5, default: [0.7, 0, 0], doc: 'The colour to select, OkLab (L, a, b) (the eyedropper reads it from the image the mask measures).', ui: { components: ['L', 'a', 'b'], label: 'Colour' } },
      tolerance: { type: 'number', unit: 'none', min: 0, max: 1, usual: [0, 0.3], default: 0.1, doc: 'OkLab distance ΔE within which the mask is 1.', ui: { widget: 'slider', step: 0.005, label: 'Tolerance' } },
      softness: { type: 'number', unit: 'none', min: 0, max: 1, usual: [0, 0.3], default: 0.05, doc: 'Distance over which it falls to 0 beyond the tolerance (a smoothstep).', ui: { widget: 'slider', step: 0.005, label: 'Softness' } },
    },
    ui: { label: 'Colour range', menu: 'mask', order: 60 },
    doc: "Mask component 'colour': how close the image's colour is to a sample, 1 − smoothstep(tolerance, tolerance + softness, ΔE_OK) (Editor lab's colour range, in OkLab ΔE instead of an RGB distance). The receiver is the cut the mask reads, encoded to OkLab by the compiler.",
  }),
  defineOp({
    name: 'mask.constant', area: 'mask', owner: 'CHB-037', on: 'Image', returns: 'Mask', domainIn: ANY_IMAGE, domainOut: 'mask',
    class: 'pointwise', binding: 'setting',
    args: { value: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0, doc: 'The coverage everywhere (0: the empty mask, where every fold starts).' } },
    doc: 'A uniform mask of the receiver\'s size: the empty mask (0) a component fold starts from, or full coverage (1).',
  }),
  defineOp({
    name: 'mask.combine', area: 'mask', owner: 'CHB-037', on: 'Mask', returns: 'Mask', domainIn: 'mask', domainOut: 'mask',
    class: 'pointwise', binding: 'setting',
    args: {
      other: { type: 'Mask', doc: 'The component (or mask) folded in.' },
      mode: { type: 'enum', values: [...MASK_COMBINES], doc: 'add: max(v, c); subtract: v·(1 − c); intersect: v·c (product forms: feathered edges meet smoothly, design D4).' },
      amount: FRACTION_AMOUNT,
    },
    doc: 'The one mask algebra (design §25): v ← v + amount·(op(v, c) − v), op add = max, subtract = v·(1 − c), intersect = v·c. maskCombine (pixel.ts) is the formula.',
  }),
  defineOp({
    name: 'mask.feather', area: 'mask', owner: 'CHB-010', on: 'Mask', returns: 'Mask', domainIn: 'mask', domainOut: 'mask',
    class: 'spatial', binding: 'setting',
    args: { radius_px: { type: 'number', unit: 'px', min: 0, max: 100000, usual: [0.5, 500], default: 10, doc: "Feather radius in document px: a Gaussian of σ = radius/2 (the 10–90 % edge is 1.28 × radius wide). The compiler converts the mask's feather_mm on the print with the print's pitch." } },
    doc: 'Feathers (blurs) a mask.',
  }),
  defineOp({
    name: 'mask.invert', area: 'mask', owner: 'CHB-010', on: 'Mask', returns: 'Mask', domainIn: 'mask', domainOut: 'mask',
    class: 'pointwise', binding: 'setting', args: {}, doc: 'Inverse (1 − m), an involution.',
  }),
];
