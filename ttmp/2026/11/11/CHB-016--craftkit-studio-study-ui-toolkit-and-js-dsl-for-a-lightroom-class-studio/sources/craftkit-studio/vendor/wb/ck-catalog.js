/* CraftKit op catalog: what a fluent call means, where it comes from, and how it runs.
 * id = "<kind>.<method path>" ("*." applies to any kind). `args` names positional arguments
 * ("params" = an options object merged into params; a Value argument becomes an input edge).
 * `out`: result kind ("same" keeps the receiver's kind, "self" returns the receiver unchanged).
 */
(function (root) {
  const ops = {};
  const N = (min, max, d, extra) => ({ type: 'number', min, max, default: d, ...(extra || {}) });
  const S = (d, opts) => ({ type: 'string', default: d, ...(opts ? { enum: opts } : {}) });
  const C = (d) => ({ type: 'color', default: d });
  function op(id, spec) {
    const [on] = id.split('.');
    ops[id] = { on, args: ['params'], out: 'same', tier: 'T1', ...spec };
  }
  const PC = 'photocraft/crates/', VC = 'vectorcraft/crates/', EC = 'effectcraft/crates/', FC = 'filmcraft/crates/', LC = 'lightcraft/crates/';

  // ── image: tone & colour (pointwise → fusable)
  op('image.autoTone', { pointwise: true, tier: 'T2', params: { strength: N(0, 1, 1) }, src: PC + 'algo (auto levels) → compose.wgsl adjust()', desc: 'Auto levels per channel, clipped at 0.1%.' });
  op('image.levels', { pointwise: true, tier: 'T2', params: { in: { type: 'range' }, gamma: N(0.1, 9.99, 1), out: { type: 'range' } }, src: PC + 'compose/src/adjust.rs', desc: 'Input/output levels with gamma.' });
  op('image.curves', { pointwise: true, tier: 'T2', params: { rgb: { type: 'curve' }, r: { type: 'curve' }, g: { type: 'curve' }, b: { type: 'curve' } }, src: PC + 'compose/src/adjust.rs ↔ gpu/src/compose.wgsl', desc: 'Per-channel monotone curves, evaluated through a LUT.' });
  op('image.hsl', { pointwise: true, tier: 'T2', params: { hue: N(-180, 360, 0), sat: N(-100, 100, 0), saturation: N(-100, 100, 0), light: N(-100, 100, 0), lightness: N(-100, 100, 0), colorize: { type: 'boolean' }, range: S('master') }, src: PC + 'compose/src/adjust.rs', desc: 'Hue/saturation/lightness, optionally on a hue range; colorize: true tints with hue 0–360.' });
  op('image.vibrance', { pointwise: true, tier: 'T2', params: { amount: N(-100, 100, 0), saturation: N(-100, 100, 0) }, src: PC + 'compose/src/adjust.rs', desc: 'Saturation weighted toward low-saturation pixels.' });
  op('image.gradientMap', { pointwise: true, tier: 'T2', args: ['stops'], params: { stops: { type: 'gradient' }, reverse: { type: 'boolean' } }, src: PC + 'compose/src/adjust.rs', desc: 'Map luminance onto a gradient: colours, [t, colour] stops, or a palette value (sorted dark to light).' });
  op('image.lut', { pointwise: true, tier: 'T2', args: ['lut'], params: { lut: S('') }, src: FC + 'color (cube/3dl) · gpu/src/lut.wgsl', desc: 'Apply a 3D LUT: a baked .toLut() value, .cube text, or a built-in look name (nocturne, tealorange, bleach, kodak, mono, cyanotype, sepia).' });
  op('image.grade', { pointwise: true, tier: 'T2', params: { lift: { type: 'wheel' }, gamma: { type: 'wheel' }, gain: { type: 'wheel' }, curve: { type: 'curve' }, saturation: N(0, 2, 1), exposure: N(-5, 5, 0) }, src: FC + 'render/src/effects.rs (Lumetri) · gpu/src/fx.wgsl', desc: 'Lumetri-style grade: wheels, curves, saturation.' });
  op('image.develop', { tier: 'T2', args: ['settings'], params: { settings: { type: 'develop' } }, src: LC + 'pipeline/src/lib.rs · gpu/src/wgsl/finish.wgsl', desc: 'LightCraft develop: one settings object through 5 cached stages.' });
  op('image.quantize', { params: { colors: N(2, 256, 16), dither: S('none', ['none', 'floyd', 'ordered']) }, src: PC + 'algo/src/quantize', desc: 'Palette reduction with optional dither.', roi: 'global' });
  op('image.palette', { args: ['n', 'params'], out: 'palette', params: { n: N(2, 32, 6), method: S('median-cut', ['median-cut', 'kmeans', 'perceptual']), weights: { type: 'boolean' } }, src: PC + 'algo/src/quantize', desc: 'Extract a palette as a value.', roi: 'global' });
  op('image.mapColors', { args: ['palette'], pointwise: true, tier: 'T2', params: {}, src: PC + 'algo/src/quantize (nearest in OkLab)', desc: 'Recolour every pixel to its nearest palette colour.' });
  op('image.convert', { args: ['model', 'params'], params: { model: S('cmyk', ['rgb', 'cmyk', 'lab', 'gray']), profile: S('Coated FOGRA39'), intent: S('relative', ['perceptual', 'relative', 'saturation', 'absolute']), bpc: { type: 'boolean' } }, src: PC + 'cms', desc: 'ICC conversion to another colour model/profile.' });
  op('image.softProof', { args: ['profile', 'params'], pointwise: true, tier: 'T2', params: { profile: S('Coated FOGRA39') }, src: PC + 'cms (soft proof, gamut warning on GPU)', desc: 'Show how the image prints on a profile.' });
  op('image.channels', { args: [], out: 'list', elem: 'image', count: 4, params: {}, src: PC + 'raster', desc: 'Split into channel plates.' });
  op('image.separate', { args: ['n', 'params'], out: 'list', elem: 'image', params: { n: N(1, 8, 2), inks: { type: 'array' } }, src: PC + 'algo/src/quantize + cms (spot separation)', desc: 'Spot-colour separation into n ink plates.' });
  op('image.toLut', { params: { size: N(9, 65, 33) }, out: 'lut', src: PC + 'cms lut3d · runtime (bakes the pointwise subgraph)', desc: 'Bake the colour ops above (grades, curves, adjustments, develop) into a 3D LUT value: apply it with .lut(l) or export it as .cube.' });

  // ── image: filters
  op('image.blur', { args: ['radius'], params: { radius: N(0, 1000, 4), kind: S('gaussian', ['gaussian', 'box', 'motion', 'radial', 'lens', 'surface', 'tiltShift', 'iris']) }, tier: 'T1', src: PC + 'algo/src/blur.rs (running-sum box passes)', desc: 'Blurs. Large Gaussian radii use running-sum box passes.', roi: { radius: 'radius' } });
  op('image.sharpen', { params: { amount: N(0, 500, 80), radius: N(0.1, 250, 1), threshold: N(0, 255, 0) }, src: PC + 'algo/src/sharpen', desc: 'Unsharp mask / smart sharpen.' });
  op('image.denoise', { params: { strength: N(0, 1, 0.5), detail: N(0, 1, 0.5) }, src: PC + 'algo/src/denoise.rs · ' + LC + 'denoise (U-Net, T2)', desc: 'Noise reduction; classical by default, U-Net with weights.' });
  op('image.stylize', { args: ['name', 'params'], open: true, params: { name: S('oilPaint', ['oilPaint', 'emboss', 'findEdges', 'wind', 'extrude', 'diffuse', 'solarize', 'tiles', 'posterEdges', 'watercolor', 'cutout']) }, src: PC + 'algo/src/oil.rs, stylize*.rs, artistic*.rs', desc: 'Stylize and Filter Gallery effects by name.' });
  op('image.distort', { args: ['name', 'params'], open: true, params: { name: S('twirl', ['twirl', 'wave', 'ripple', 'pinch', 'spherize', 'zigzag', 'shear', 'polar']) }, src: PC + 'algo/src/distort*.rs', desc: 'Distort filters by name.' });
  op('image.displace', { args: ['by', 'params'], params: { amount: N(-999, 999, 10) }, src: PC + 'algo/src/distort.rs (Displace)', desc: 'Displace by a field or image.' });
  op('image.grain', { args: ['amount'], pointwise: true, tier: 'T2', params: { amount: N(0, 1, 0.3), size: N(0.5, 4, 1) }, src: PC + 'algo/src/noise.rs (coordinate-hashed)', desc: 'Film grain, hashed from document coordinates.' });
  op('image.liquify', { args: ['strokes'], params: {}, src: PC + 'algo/src/liquify.rs', desc: 'Apply liquify strokes.' });
  op('image.puppet', { params: { pins: { type: 'array' } }, src: PC + 'algo/src/puppet.rs (ARAP)', desc: 'As-rigid-as-possible puppet warp.' });

  // ── image: geometry
  op('image.resize', { args: ['w', 'h', 'params'], params: { w: N(1, 300000, 1600), h: N(1, 300000, 0), filter: S('lanczos', ['lanczos', 'bicubic', 'nearest']) }, src: PC + 'algo/src/resample.rs', desc: 'Resample.' });
  op('image.crop', { args: ['box'], open: true, params: {}, src: PC + 'engine (crop)', desc: 'Crop to a rectangle.' });
  op('image.translate', { args: ['offset'], params: { offset: { type: 'xy' } }, src: PC + 'geom (affine)', desc: 'Move by an offset.' });
  op('image.transform', { args: ['m'], params: {}, src: PC + 'algo/src/perspective.rs, warp.rs', desc: 'Affine or perspective transform.' });
  op('image.deskew', { args: [], params: {}, src: 'pdfcraft/crates/engine/src/camera_edges.rs · ' + LC + 'pipeline (upright)', desc: 'Detect the dominant text angle and rotate it straight.' });
  op('image.upright', { args: ['mode'], params: { mode: S('auto', ['auto', 'level', 'vertical', 'full']) }, src: LC + 'pipeline (upright)', desc: 'Perspective correction from vanishing points.' });
  op('image.mask', { args: ['mask'], params: {}, src: PC + 'compose', desc: 'Use a mask as alpha.' });

  // ── image: selection, analysis, repair (masks/fields/json out)
  op('image.select.subject', { args: [], out: 'mask', params: {}, src: PC + 'algo/src/segment (saliency → GrabCut)', desc: 'Select the main subject. Classical, no model weights.', roi: 'global' });
  op('image.select.sky', { args: [], out: 'mask', params: {}, src: PC + 'algo/src/segment (sky)', desc: 'Select the sky.', roi: 'global' });
  op('image.select.color', { args: ['color', 'fuzz'], out: 'mask', params: { color: C('#ffffff'), fuzz: N(0, 200, 40) }, src: PC + 'algo/src/selection.rs', desc: 'Colour range selection.' });
  op('image.select.wand', { args: ['at', 'tolerance'], out: 'mask', params: { at: { type: 'xy' }, tolerance: N(0, 255, 32) }, src: PC + 'algo/src/selection.rs', desc: 'Magic wand flood selection.' });
  op('image.depth', { args: [], out: 'field', tier: 'T3', params: {}, src: 'none yet: needs a depth model (MiDaS-class) on a browser runtime', desc: 'Monocular depth (needs model weights).' });
  op('image.edges', { out: 'mask', params: { method: S('canny', ['canny', 'sobel']) }, src: PC + 'algo/src/features.rs', desc: 'Edge map.' });
  op('image.histogram', { args: [], out: 'json', params: {}, src: PC + 'algo/src/histogram.rs', desc: 'Histogram per channel.', roi: 'global' });
  op('image.contentAwareFill', { args: ['hole', 'params'], params: {}, open: true, src: PC + 'algo/src/content_aware.rs (PatchMatch)', desc: 'Fill a hole from the rest of the image.', roi: 'global' });
  op('image.inpaint', { args: ['hole', 'params'], params: { patchRadius: N(2, 16, 4) }, open: true, src: LC + 'inpaint (PatchMatch + Wexler)', desc: 'Inpaint a masked region.', roi: 'global' });
  op('image.heal', { args: ['mask'], params: {}, src: PC + 'algo/src/poisson.rs, retouch.rs', desc: 'Healing brush / spot heal.' });
  op('image.ocr', { out: 'json', tier: 'T3', params: { lang: S('eng'), layout: { type: 'boolean' } }, src: 'pdfcraft/crates/ocr (ocrs on rten) + render/src/text.rs reading order', desc: 'Recognize text with blocks and reading order.', roi: 'global' });
  op('image.trace', { out: 'shapes', params: { mode: S('outline', ['outline', 'centerline']), preset: S('', ['Default', 'Auto Color', 'High Fidelity Photo', 'Low Fidelity Photo', '3 Colors', '6 Colors', '16 Colors', 'Shades of Gray', 'Black and White Logo', 'Sketched Art', 'Silhouettes', 'Line Art', 'Technical Drawing', 'Outline', 'Flat Logo']), colors: N(1, 64, 4), detail: N(0, 1, 0.5), smooth: N(0, 1, 0.5), ignoreWhite: { type: 'boolean' }, strokeWidth: N(0.5, 40, 6), params: { type: 'object' } }, src: VC + 'trace · ' + PC + 'vector (mask → Bézier)', desc: 'Raster to vector shapes.', roi: 'global' });
  op('image.toField', { args: ['channels', 'init'], out: 'field', params: {}, open: true, src: 'runtime', desc: 'Reinterpret channels as a float field.' });
  op('image.blend', { args: ['top', 'mode', 'params'], pointwise: true, tier: 'T2', params: { mode: S('normal'), opacity: N(0, 1, 1), mask: { type: 'mask' } }, src: PC + 'color/src/blend.rs ↔ gpu/src/compose.wgsl', desc: 'Blend another image over this one.' });

  // ── mask
  op('mask.feather', { args: ['radius'], params: { radius: N(0, 250, 2) }, src: PC + 'vector/src/feather.rs', desc: 'Feather edges.' });
  op('mask.grow', { args: ['radius'], params: { radius: N(0, 500, 2) }, src: PC + 'algo/src/selection.rs', desc: 'Expand.' });
  op('mask.shrink', { args: ['radius'], params: { radius: N(0, 500, 2) }, src: PC + 'algo/src/selection.rs', desc: 'Contract.' });
  op('mask.invert', { args: [], pointwise: true, tier: 'T2', params: {}, src: PC + 'raster', desc: 'Invert.' });
  op('mask.refine', { args: ['image', 'params'], params: { radius: N(0, 250, 8), edge: N(0, 1, 0.5) }, src: PC + 'algo/src/matting.rs (guided filter)', desc: 'Refine edge against an image.' });
  op('mask.and', { args: ['other'], pointwise: true, tier: 'T2', params: {}, src: PC + 'raster', desc: 'Intersect.' });
  op('mask.or', { args: ['other'], pointwise: true, tier: 'T2', params: {}, src: PC + 'raster', desc: 'Union.' });
  op('mask.minus', { args: ['other'], pointwise: true, tier: 'T2', params: {}, src: PC + 'raster', desc: 'Subtract.' });
  op('mask.toPath', { args: ['params'], out: 'path', params: { tolerance: N(0.1, 10, 1) }, src: PC + 'vector (mask → Bézier tracing)', desc: 'Trace the mask outline to a path.' });
  op('mask.distance', { args: [], out: 'field', params: {}, src: PC + 'gpu/src/fx.rs (exact EDT, CPU)', desc: 'Euclidean distance field.' });

  // ── field
  op('field.toImage', { args: [], out: 'image', params: {}, src: 'runtime', desc: 'View a field as an image.' });
  op('image.toImage', { args: [], out: 'image', params: {}, src: 'runtime', desc: 'Make sure the value is an image (a px result over an image may be a one-channel field).' });
  op('field.threshold', { args: ['level'], out: 'field', pointwise: true, tier: 'T2', params: { level: N(0, 1, 0.5) }, src: 'runtime (fused)', desc: 'Threshold to 0/1.' });
  op('field.toField', { args: ['channels', 'init'], out: 'field', params: {}, open: true, src: 'runtime', desc: 'Name channels and initial values.' });
  op('field.channel', { args: ['name'], out: 'field', pointwise: true, tier: 'T2', params: { name: S('a') }, src: 'runtime', desc: 'Pick one channel.' });
  op('field.blur', { args: ['radius'], params: { radius: N(0, 250, 4) }, src: LC + 'gpu/src/wgsl/blur.wgsl', tier: 'T2', desc: 'Blur a field.' });
  op('field.contours', { args: ['levels', 'params'], out: 'shapes', params: { levels: { type: 'any' }, colors: { type: 'any' }, width: N(0.1, 20, 1) }, open: true, src: 'new: marching squares (small; no app has it as a reusable crate)', desc: 'Iso-contours as paths.' });
  op('field.remap', { args: ['lo', 'hi'], pointwise: true, tier: 'T2', params: {}, src: 'runtime', desc: 'Remap range.' });

  // ── vector
  ['union', 'subtract', 'intersect', 'exclude'].forEach(b => op('path.' + b, { args: ['other'], params: {}, src: VC + 'pathops (analytic Bézier booleans)', desc: `Boolean ${b}.` }));
  op('path.offset', { args: ['d', 'join'], params: { d: N(-500, 500, 4), join: S('round', ['miter', 'round', 'bevel']) }, src: VC + 'pathops (offset)', desc: 'Offset a path.' });
  op('path.outline', { args: ['stroke'], params: {}, src: VC + 'pathops (outline stroke)', desc: 'Stroke to outline.' });
  op('path.simplify', { args: ['tolerance'], params: { tolerance: N(0, 10, 0.5) }, src: VC + 'pathops', desc: 'Reduce nodes.' });
  op('path.roughen', { params: { size: N(0, 100, 4), detail: N(0, 100, 20) }, src: VC + 'effects (roughen)', desc: 'Hand-drawn jitter.' });
  op('path.zigzag', { params: { size: N(0, 100, 4), ridges: N(1, 100, 10) }, src: EC + 'render/src/shapes.rs', desc: 'Zig zag.' });
  op('path.morph', { args: ['to', 't'], params: { t: N(0, 1, 0.5) }, src: 'deckcraft/crates/geom/src/morph.rs', desc: 'Morph toward another path.' });
  op('path.fill', { args: ['paint'], out: 'shapes', params: {}, src: VC + 'render', desc: 'Fill into a shape.' });
  op('path.stroke', { args: ['style'], out: 'shapes', params: {}, open: true, src: VC + 'render (stroker)', desc: 'Stroke into a shape.' });
  op('path.pointAt', { args: ['t'], out: 'point', params: { t: N(0, 1, 0) }, src: EC + 'path', desc: 'Point at arc-length t.' });
  op('shapes.select', { out: 'path', open: true, params: {}, src: VC + 'doc (selection by appearance)', desc: 'Select shapes by fill/stroke and return their outlines.' });
  op('shapes.add', { args: ['other', 'params'], params: {}, open: true, src: VC + 'doc', desc: 'Group with another shape or text.' });
  op('shapes.fill', { args: ['paint'], params: { paint: C('#000000') }, src: VC + 'render', desc: 'Set fill.' });
  op('shapes.simplify', { args: ['tolerance'], params: { tolerance: N(0, 10, 0.5) }, src: VC + 'pathops', desc: 'Reduce nodes.' });
  op('shapes.orderForPlotter', { args: [], params: {}, src: 'new: nearest-neighbour path ordering (small)', desc: 'Reorder paths to cut pen-up travel.' });
  op('shapes.grid', { args: ['cols', 'rows', 'each'], each: true, params: { cols: N(1, 64, 2), rows: N(1, 64, 2) }, src: 'figcraft/crates/layout (grid)', desc: 'Lay out cells; the function runs at build time for each cell.' });
  op('shapes.blend', { args: ['to', 'steps'], params: { steps: N(1, 256, 8) }, src: VC + 'effects (blend)', desc: 'Intermediate shapes between two.' });
  op('shapes.extrude', { args: ['depth'], out: 'scene', params: { depth: N(0, 1000, 20) }, src: VC + 'three-d', desc: '3D extrude.' });
  op('shapes.rasterize', { args: ['size'], out: 'image', params: {}, src: PC + 'vector (exact-area rasterizer)', desc: 'Rasterize.' });

  // ── text, story, pages
  op('text.onPath', { args: ['path', 'params'], params: { offset: N(-1, 1, 0) }, src: EC + 'text · ' + VC + 'text (type on a path)', desc: 'Set text along a path.' });
  op('text.animate', { params: { by: S('char', ['char', 'word', 'line']), props: { type: 'object' } }, open: true, src: EC + 'text/src/selectors.rs (text animators)', desc: 'Per-character animators driven by keys or expressions.' });
  op('text.at', { args: ['point'], params: {}, src: 'runtime', desc: 'Place at a point.' });
  op('text.toPaths', { args: [], out: 'path', params: {}, src: PC + 'text (outlines)', desc: 'Convert glyphs to outlines.' });
  op('story.flow', { args: ['frames', 'params'], out: 'pages', params: { breaker: S('knuthPlass', ['knuthPlass', 'greedy', 'balanced']), hyphenate: S('en'), baselineGrid: N(0, 72, 0) }, src: 'designcraft/crates/compose/src/breaker.rs · wordcraft/crates/layout', desc: 'Typeset a story through frames.' });
  op('pages.place', { args: ['item', 'params'], params: {}, open: true, src: 'designcraft/crates/compose (anchored objects, wrap)', desc: 'Place an item on a page; `wrap` makes text flow around a path.' });
  op('pages.frames', { args: [], out: 'json', params: {}, src: 'designcraft/crates/compose (FrameSpec)', desc: 'Text frames of the layout.' });
  op('pages.flow', { args: ['story', 'params'], params: {}, open: true, src: 'designcraft/crates/compose', desc: 'Flow a story into the layout.' });
  op('pages.page', { args: ['n'], params: { n: N(1, 99999, 1) }, src: 'pdfcraft/crates/cos', desc: 'Pick a page.' });
  op('pages.render', { out: 'image', params: { dpi: N(36, 1200, 150) }, src: 'pdfcraft/vendor/hayro-interpret on vello_cpu', desc: 'Rasterize a page.' });
  op('json.story', { out: 'story', params: {}, open: true, src: 'pdfcraft/crates/export (text blocks → paragraphs)', desc: 'Turn OCR blocks into a styled story.' });
  op('json.figures', { args: [], out: 'list', elem: 'json', count: 2, params: {}, src: 'pdfcraft/crates/export (image regions)', desc: 'Figure regions found by layout analysis.' });
  op('json.envelope', { out: 'number', params: { decay: N(0.01, 2, 0.2) }, src: 'soundcraft/crates/dsp (envelope follower)', desc: 'Envelope follower over events.' });
  op('json.cell', { args: ['ref'], out: 'number', params: {}, src: 'gridcraft', desc: 'A cell.' });

  // ── time & video
  op('clip.grade', { pointwise: true, tier: 'T2', params: { lift: { type: 'wheel' }, gamma: { type: 'wheel' }, gain: { type: 'wheel' }, curve: { type: 'curve' }, saturation: N(0, 2, 1) }, src: FC + 'render/src/effects.rs (Lumetri) · gpu/src/fx.wgsl', desc: 'Grade a clip.' });
  op('clip.toLut', { params: { size: N(9, 65, 33) }, out: 'lut', src: 'runtime (bake pointwise subgraph) · ' + FC + 'color (cube writer)', desc: 'Bake the pointwise grade into a LUT.' });
  op('clip.map', { args: ['fn', 'params'], map: true, params: { temporal: S('none', ['none', 'track']), coherent: { type: 'ref' } }, open: true, src: FC + 'render (per-frame effect stack)', desc: 'Lift an image graph to every frame.' });
  op('clip.flow', { args: [], out: 'field', params: {}, src: FC + 'render/src/flow.rs (Lucas–Kanade)', desc: 'Optical flow per frame.' });
  op('clip.track', { args: ['region'], out: 'json', params: {}, src: EC + 'track (KLT + RANSAC)', desc: 'Track a region.' });
  op('clip.stabilize', { params: { method: S('subspaceWarp', ['subspaceWarp', 'perspective', 'position']) }, src: EC + 'track (warp stabilizer)', desc: 'Stabilize.' });
  op('clip.trim', { args: ['a', 'b'], params: {}, src: FC + 'edit', desc: 'Trim.' });
  op('clip.speed', { args: ['x'], params: { x: N(0.01, 100, 1) }, src: FC + 'edit (rate stretch, optical flow)', desc: 'Change speed.' });
  op('clip.lut', { args: ['lut'], pointwise: true, tier: 'T2', params: {}, src: FC + 'gpu/src/lut.wgsl', desc: 'Apply a LUT.' });
  op('comp.at', { args: ['t'], out: 'image', params: {}, src: EC + 'render (comp_frame)', desc: 'Render one frame.' });
  op('comp.duration', { args: [], out: 'number', params: {}, src: EC + 'project', desc: 'Duration.' });
  op('image.lut ', {}); delete ops['image.lut '];

  // ── audio
  op('audio.bands', { args: ['n', 'params'], out: 'json', params: { n: N(2, 128, 16), smooth: N(0, 1, 0.5) }, src: 'soundcraft/crates/dsp (FFT spectrum)', desc: 'Smoothed FFT band energies over time.' });
  op('audio.onsets', { out: 'json', params: { hz: { type: 'range' } }, src: 'soundcraft/crates/dsp (spectral flux)', desc: 'Onset events in a frequency range.' });
  op('audio.duration', { args: [], out: 'number', params: {}, src: 'soundcraft/crates/audio-io', desc: 'Duration in seconds.' });
  op('audio.eq', { args: ['bands'], params: {}, src: FC + 'audio-dsp (parametric EQ)', desc: 'Parametric EQ.' });
  op('audio.compress', { params: { threshold: N(-60, 0, -18), ratio: N(1, 20, 3) }, src: FC + 'audio-dsp', desc: 'Compressor.' });
  op('audio.loudness', { args: [], out: 'number', params: {}, src: FC + 'audio-dsp/src/loudness.rs (BS.1770)', desc: 'Integrated loudness (LUFS).' });
  op('audio.transcribe', { args: [], out: 'json', tier: 'T3', params: {}, src: FC + 'speech (Whisper on candle)', desc: 'Speech to text with word timings.' });

  // ── data
  op('table.cell', { args: ['ref'], out: 'number', params: {}, src: 'gridcraft/crates/calc (recalc DAG)', desc: 'A cell as a reactive value.' });
  op('table.set', { args: ['ref', 'value'], params: {}, src: 'gridcraft/crates/calc', desc: 'Set a cell or formula.' });
  op('table.chart', { args: ['kind', 'params'], out: 'shapes', params: {}, open: true, src: 'gridcraft/crates/chart', desc: 'Chart from a range.' });

  // ── 3D, sketch
  op('scene.add', { args: ['item', 'params'], params: {}, open: true, src: 'artcraft/frontend/libs/pagescene (three.js scene JSON)', desc: 'Add an object.' });
  op('scene.camera', { params: { fov: N(5, 150, 35) }, open: true, src: 'artcraft/frontend/libs/pagescene', desc: 'Set the render camera.' });
  op('scene.render', { out: 'record', params: { passes: { type: 'array' } }, open: true, src: 'artcraft editor.ts snapShotOfCurrentFrame (beauty only today)', desc: 'Render passes from the stage camera.' });
  op('sketch.circle', { out: 'record', open: true, params: {}, src: 'cadcraft/crates/constraints', desc: 'A circle entity.' });
  op('sketch.line', { args: [], out: 'record', params: {}, src: 'cadcraft/crates/constraints', desc: 'A line entity.' });
  ['tangent', 'collinear', 'parallel', 'perpendicular', 'coincident', 'ratio', 'distance', 'equal', 'horizontal', 'vertical'].forEach(c =>
    op('sketch.' + c, { args: ['a', 'b', 'c'], out: 'constraint', accumulate: true, params: {}, open: true, src: 'cadcraft/crates/constraints', desc: `${c} constraint; adds to the sketch and returns it, so calls chain.` }));
  op('sketch.solve', { args: [], out: 'sketch', params: {}, src: 'cadcraft/crates/constraints (damped Gauss–Newton)', desc: 'Solve; reports DOF and conflicts.' });
  op('sketch.toShapes', { out: 'shapes', open: true, params: {}, src: 'cadcraft/crates/render (display list)', desc: 'Solved geometry as shapes.' });
  op('sketch.below', { args: ['entity', 'gap'], out: 'point', params: {}, src: 'cadcraft/crates/geom', desc: 'A point below an entity.' });

  // ── lists, palettes, tokens
  op('list.merge', { out: 'palette', params: { k: N(1, 32, 6) }, src: PC + 'algo/src/quantize (weighted k-means)', desc: 'Merge palettes.' });
  op('palette.tokens', { out: 'tokens', params: {}, open: true, src: 'figcraft (variables and modes)', desc: 'Name palette entries as design tokens.' });

  // ── any kind
  op('*.lut', { args: ['lut'], pointwise: true, tier: 'T2', params: {}, src: FC + 'gpu/src/lut.wgsl', desc: 'Apply a LUT.' });
  op('*.at', { args: ['point'], params: {}, src: 'runtime', desc: 'Place at a point.' });
  op('*.meta.set', { args: ['params'], out: 'self', open: true, params: {}, src: LC + 'meta (XMP)', desc: 'Write metadata.' });


  // ════ the live engine's ops (ck-ops-*.js): each runs a Crafting App's crate in wasm, or JS where noted ════
  const FL = root.CK_FILTERS || { commands: [], gallery: [] };
  const parseDoc = doc => { const out = {}; if (!doc || doc === '{}') return out; const re = /"([A-Za-z0-9_]+)":((?:"[^"]*")|[^,"]+)(?:=("[^"]*"|[^,]+))?/g; let m; while ((m = re.exec(doc.replace(/^\{|\}$/g, '')))) { const k = m[1], t = m[2], d = m[3]; if (t.startsWith('"')) { const o = t.slice(1, -1).split('|'); out[k] = S(d ? d.replace(/"/g, '') : o[0], o); } else if (/^-?[\d.]+\.\.-?[\d.]+$/.test(t)) { const [lo, hi] = t.split('..').map(Number); out[k] = N(lo, hi, d !== undefined ? Number(d) : lo); } else if (t === 'bool') out[k] = { type: 'boolean', default: d === 'true' }; else if (t === 'u32') out[k] = N(0, 99999, Number(d || 0)); else out[k] = { type: t }; } return out; };
  root.CK_PARSE_DOC = parseDoc;
  const cmdBy = name => FL.commands.find(c => c.id.split('.').pop() === name);
  const ADJ = PC + 'compose/src/adjust.rs (params read by engine/src/adjust_params.rs)';
  op('image.exposure', { pointwise: true, tier: 'T2', params: { exposure: N(-20, 20, 0), offset: N(-0.5, 0.5, 0), gamma: N(0.01, 9.99, 1) }, src: ADJ, desc: 'Exposure, offset, gamma.' });
  op('image.brightnessContrast', { pointwise: true, tier: 'T2', params: { brightness: N(-150, 150, 0), contrast: N(-50, 100, 0) }, src: ADJ, desc: 'Brightness/Contrast (Photoshop CS3+ curves).' });
  op('image.posterize', { args: ['levels'], pointwise: true, tier: 'T2', params: { levels: N(2, 255, 4) }, src: ADJ, desc: 'Posterize to n levels per channel.' });
  op('image.threshold', { args: ['level'], pointwise: true, tier: 'T2', params: { level: N(0, 1, 0.5) }, src: ADJ, desc: 'Black and white at a luminance level.' });
  op('image.invert', { args: [], pointwise: true, tier: 'T2', params: {}, src: ADJ, desc: 'Invert.' });
  op('image.blackWhite', { pointwise: true, tier: 'T2', open: true, params: { reds: N(-200, 300, 40), yellows: N(-200, 300, 60), greens: N(-200, 300, 40), cyans: N(-200, 300, 60), blues: N(-200, 300, 20), magentas: N(-200, 300, 80), tint: { type: 'color' } }, src: ADJ, desc: 'Black & White mixer by hue range, optional tint.' });
  op('image.photoFilter', { args: ['color', 'params'], pointwise: true, tier: 'T2', params: { color: S('warming85'), density: N(0, 100, 25), preserveLuminosity: { type: 'boolean', default: true } }, src: ADJ, desc: 'Photo Filter: a colour or a preset (warming85, cooling80, sepia, underwater…).' });
  op('image.channelMixer', { pointwise: true, tier: 'T2', open: true, params: { red: { type: 'array' }, green: { type: 'array' }, blue: { type: 'array' }, monochrome: { type: 'boolean' } }, src: ADJ, desc: 'Channel Mixer rows [r, g, b, constant] in percent.' });
  op('image.colorBalance', { pointwise: true, tier: 'T2', params: { shadows: { type: 'array' }, midtones: { type: 'array' }, highlights: { type: 'array' }, preserveLuminosity: { type: 'boolean', default: true } }, src: ADJ, desc: 'Color Balance: [cyan–red, magenta–green, yellow–blue] per tone range.' });
  op('image.duotone', { args: ['dark', 'light'], pointwise: true, tier: 'T2', params: { dark: C('#1f2a6b'), light: C('#e2437f') }, src: ADJ + ' (Gradient Map)', desc: 'Two-colour gradient map.' });
  op('image.adjust', { args: ['kind', 'params'], pointwise: true, tier: 'T2', open: true, params: { kind: S('hueSaturation', ['brightnessContrast', 'levels', 'curves', 'exposure', 'vibrance', 'hueSaturation', 'colorBalance', 'blackWhite', 'photoFilter', 'channelMixer', 'invert', 'posterize', 'threshold', 'gradientMap']) }, src: ADJ, desc: 'Any Photoshop adjustment by kind, with its dialog params.' });
  op('image.filter', { args: ['name', 'params'], open: true, params: { name: S('oilPaint', FL.commands.map(c => c.id.split('.').pop()).concat(FL.gallery.map(g => g.key))) }, src: PC + 'algo (63 Filter-menu commands + 47 Filter Gallery effects; defaults from engine/src/filters*.rs)', desc: 'Any PhotoCraft filter by name: the Filter menu and the Filter Gallery.' });
  op('image.gallery', { args: ['name', 'params'], open: true, params: { name: S('watercolor', FL.gallery.map(g => g.key)), effects: { type: 'array' } }, src: PC + 'algo/src/artistic*.rs (Filter Gallery)', desc: 'Filter Gallery effect(s); pass { effects: [{ name, …params }] } to stack several.' });
  const SUGAR = { pixelate: ['mosaic', 'cellSize'], halftone: ['colorHalftone', 'maxRadius'], crystallize: ['crystallize', 'cellSize'], pointillize: ['pointillize', 'cellSize'], emboss: ['emboss', 'height'], findEdges: ['findEdges', null], solarize: ['solarize', null], twirl: ['twirl', 'angle'], pinch: ['pinch', 'amount'], spherize: ['spherize', 'amount'], ripple: ['ripple', 'amount'], wave: ['wave', 'generators'], wind: ['wind', 'method'], median: ['median', 'radius'], highPass: ['highPass', 'radius'], addNoise: ['addNoise', 'amount'], mezzotint: ['mezzotint', 'type'], facet: ['facet', null], fragment: ['fragment', null], diffuse: ['diffuse', 'mode'], extrude: ['extrude', 'size'], tiles: ['tiles', 'count'], polar: ['polarCoordinates', 'mode'], zigzag: ['zigZag', 'amount'], oilPaint: ['oilPaint', 'stylization'], clouds: ['clouds', 'seed'], lensFlare: ['lensFlare', 'brightness'], lighting: ['lightingEffects', 'intensity'], dustAndScratches: ['dustAndScratches', 'radius'], minimum: ['minimum', 'radius'], maximum: ['maximum', 'radius'], ntsc: ['ntscColors', null], tiltShift: ['tiltShift', 'blur'] };
  for (const [k, [cmd, key]] of Object.entries(SUGAR)) { const c = cmdBy(cmd); op('image.' + k, { args: key ? ['value', 'params'] : ['params'], params: c ? parseDoc(c.params) : {}, open: true, src: PC + `algo · ${c ? c.id : cmd}`, desc: `${c ? c.label.replace('…', '') : cmd}${key ? ` (first argument: ${key})` : ''}.` }); }
  op('image.noise', { params: { amount: N(0, 400, 12), distribution: S('gaussian', ['uniform', 'gaussian']), mono: { type: 'boolean', default: true }, seed: N(0, 99999, 0) }, src: PC + 'algo · filter.noise.addNoise', desc: 'Add noise.' });
  op('image.vignette', { args: ['amount'], pointwise: true, tier: 'T2', params: { amount: N(0, 1, 0.5), radius: N(0, 1, 0.75), softness: N(0, 1, 0.5) }, src: 'runtime (JS)', desc: 'Darken the corners.' });
  op('image.chromatic', { args: ['amount'], params: { amount: N(0, 40, 4) }, src: 'runtime (JS)', desc: 'Chromatic aberration: red and blue pushed apart from the centre.' });
  op('image.dither', { args: ['palette', 'params'], params: { colors: N(2, 64, 4), method: S('floyd', ['floyd', 'none']) }, src: 'runtime (Floyd–Steinberg in OkLab) · palette from ' + PC + 'algo/src/quantize', desc: 'Error-diffuse onto a palette (a palette value, a list of colours, or n colours found in the image).' });
  op('image.scale', { args: ['k', 'params'], params: { k: N(0.01, 8, 0.5), filter: S('bicubic', ['nearest', 'bilinear', 'bicubic', 'lanczos']) }, src: PC + 'algo/src/resample.rs', desc: 'Scale by a factor.' });
  op('image.carve', { args: ['w', 'h', 'params'], params: { w: N(0.05, 20000, 0.7), h: N(0.05, 20000, 1) }, src: PC + 'algo/src/seam.rs (seam carving)', desc: 'Content-aware scale: remove low-energy seams. Fractions or pixels; `protect` takes a mask.', roi: 'global' });
  op('image.rotate', { args: ['deg'], params: { deg: N(-360, 360, 0) }, src: 'runtime (canvas affine)', desc: 'Rotate about the centre.' });
  op('image.flip', { args: ['axis'], params: { axis: S('x', ['x', 'y']) }, src: 'runtime', desc: 'Mirror horizontally (x) or vertically (y).' });
  op('image.kaleido', { args: ['segments'], params: { segments: N(2, 32, 6) }, src: 'runtime (JS)', desc: 'Kaleidoscope: fold the image into n mirrored wedges.' });
  op('image.select.tones', { args: ['lo', 'hi', 'params'], out: 'mask', params: { lo: N(0, 1, 0.6), hi: N(0, 1, 1), falloff: N(0, 1, 0.1) }, src: 'runtime', desc: 'Luminance range selection (luminosity mask).' });
  op('image.select.all', { args: [], out: 'mask', params: {}, src: 'runtime', desc: 'Everything.' });
  op('image.select.ellipse', { args: ['box'], out: 'mask', params: {}, open: true, src: 'runtime', desc: 'Elliptical marquee; box [x, y, w, h] in fractions.' });
  op('image.select.rect', { args: ['box'], out: 'mask', params: {}, open: true, src: 'runtime', desc: 'Rectangular marquee; box in fractions.' });
  op('image.alpha', { args: [], out: 'mask', params: {}, src: 'runtime', desc: 'The alpha channel as a mask.' });
  op('image.toMask', { args: [], out: 'mask', params: {}, src: 'runtime', desc: 'Luminance (or alpha) as a mask.' });
  op('image.remove', { args: ['hole', 'params'], params: {}, open: true, src: PC + 'algo/src/content_aware.rs (PatchMatch)', desc: 'Remove what the mask covers (content-aware fill).', roi: 'global' });
  op('image.over', { args: ['other'], params: {}, src: PC + 'color/src/blend.rs', desc: 'This image over another.' });
  op('image.under', { args: ['other'], params: {}, src: PC + 'color/src/blend.rs', desc: 'Another image over this one.' });
  op('image.contours', { args: ['levels', 'params'], out: 'shapes', open: true, params: { levels: { type: 'any' }, colors: { type: 'any' }, width: N(0.1, 20, 1) }, src: 'runtime (marching squares)', desc: 'Iso-lines of the luminance.' });
  op('mask.fill', { args: ['color'], out: 'image', params: { color: C('#000000') }, src: 'runtime', desc: 'A colour where the mask is.' });
  op('mask.border', { args: ['radius'], params: { radius: N(0, 200, 4) }, src: PC + 'algo/src/selection.rs', desc: 'A band along the edge.' });
  op('mask.smooth', { args: ['radius'], params: { radius: N(0, 100, 4) }, src: PC + 'algo/src/selection.rs', desc: 'Smooth the selection.' });
  op('mask.xor', { args: ['other'], params: {}, src: 'runtime', desc: 'Symmetric difference.' });
  op('mask.toImage', { args: [], out: 'image', params: {}, src: 'runtime', desc: 'View as an image.' });
  op('mask.toField', { args: ['channels', 'init'], out: 'field', open: true, params: {}, src: 'runtime', desc: 'Reinterpret as a field.' });
  op('mask.contours', { args: ['levels', 'params'], out: 'shapes', open: true, params: { levels: { type: 'any' }, colors: { type: 'any' }, width: N(0.1, 20, 1) }, src: 'runtime (marching squares)', desc: 'Outline the mask.' });
  op('field.gradient', { args: [], out: 'field', params: {}, src: 'runtime', desc: 'Gradient (x, y) as a 2-channel field, centred on 0.5.' });
  // text
  op('text.style', { open: true, params: { family: S('Inter'), size: N(1, 2000, 48), weight: N(100, 900, 400), tracking: N(-200, 2000, 0), leading: N(1, 4000, 56), align: S('left', ['left', 'center', 'right']), width: N(0, 20000, 0) }, src: 'runtime (opentype.js metrics)', desc: 'Change the font.' });
  op('text.fill', { args: ['paint'], params: { paint: C('#1d2733') }, src: 'runtime', desc: 'Text colour.' });
  op('text.stroke', { args: ['style'], out: 'shapes', open: true, params: {}, src: 'runtime', desc: 'Outline the glyphs as strokes.' });
  op('text.add', { args: ['other', 'params'], out: 'shapes', open: true, params: {}, src: VC + 'doc', desc: 'Group with other shapes.' });
  op('text.rasterize', { args: ['size'], out: 'image', params: {}, open: true, src: 'runtime (Path2D)', desc: 'Render to pixels.' });
  op('text.toPath', { args: [], out: 'path', params: {}, src: 'runtime (opentype.js outlines)', desc: 'Glyph outlines as one path (for booleans).' });
  // vectors on shapes too
  for (const b of ['union', 'subtract', 'intersect', 'exclude']) op('shapes.' + b, { args: ['other'], out: 'path', params: {}, src: VC + 'pathops (analytic Bézier booleans)', desc: `Boolean ${b} of every shape (with another, or of themselves).` });
  op('shapes.offset', { args: ['d', 'join'], out: 'path', params: { d: N(-500, 500, 4), join: S('round', ['miter', 'round', 'bevel']) }, src: VC + 'pathops (offset)', desc: 'Offset the outlines.' });
  op('shapes.outline', { args: ['stroke'], out: 'path', params: {}, open: true, src: VC + 'pathops (outline stroke)', desc: 'Strokes to filled outlines.' });
  op('path.roundCorners', { args: ['params'], params: { radius: N(0, 500, 12), kind: S('round', ['round', 'inverted', 'chamfer']) }, src: VC + 'pathops (Live Corners)', desc: 'Round, invert or chamfer the corners.' });
  op('shapes.roundCorners', { args: ['params'], out: 'path', params: { radius: N(0, 500, 12), kind: S('round', ['round', 'inverted', 'chamfer']) }, src: VC + 'pathops (Live Corners)', desc: 'Round the corners.' });
  op('path.measure', { args: [], out: 'json', params: {}, src: VC + 'pathops', desc: 'Area, length, bounds, anchors.' });
  op('shapes.measure', { args: [], out: 'json', params: {}, src: VC + 'pathops', desc: 'Area, length, bounds, anchors.' });
  op('shapes.pathfinder', { args: ['op'], params: { op: S('divide', ['divide', 'trim', 'merge', 'crop', 'outline', 'minusFront', 'minusBack', 'unite', 'intersect', 'exclude']) }, src: VC + 'pathops (Pathfinder)', desc: 'Illustrator Pathfinder over the shapes; pieces keep their paint.' });
  op('shapes.divide', { args: [], params: {}, src: VC + 'pathops (Pathfinder Divide)', desc: 'Split overlapping shapes into pieces.' });
  op('shapes.roughen', { params: { size: N(0, 100, 4), detail: N(0, 100, 20), seed: N(0, 9999, 3) }, src: 'runtime (JS; VectorCraft effects needs text/plugin crates)', desc: 'Hand-drawn jitter.' });
  op('shapes.zigzag', { params: { size: N(0, 100, 4), ridges: N(1, 100, 10) }, src: 'runtime (JS)', desc: 'Zig zag.' });
  op('shapes.morph', { args: ['to', 't'], params: { t: N(0, 1, 0.5) }, src: 'runtime (resample + lerp)', desc: 'Morph toward another shape.' });
  op('shapes.stroke', { args: ['style'], params: {}, open: true, src: 'runtime', desc: 'Stroke every shape: { width, color, dash }.' });
  op('shapes.pointAt', { args: ['t'], out: 'point', params: { t: N(0, 1, 0) }, src: 'runtime', desc: 'Point at arc-length t.' });
  op('path.reverse', { args: [], params: {}, src: 'runtime', desc: 'Reverse direction.' });
  for (const k of ['transform', 'scale', 'rotate', 'move']) { op('path.' + k, { args: [k === 'transform' ? 'm' : k === 'scale' ? 'k' : k === 'rotate' ? 'deg' : 'by'], params: {}, open: true, src: 'runtime', desc: `${k[0].toUpperCase() + k.slice(1)} the path.` }); op('shapes.' + k, { args: [k === 'transform' ? 'm' : k === 'scale' ? 'k' : k === 'rotate' ? 'deg' : 'by'], params: {}, open: true, src: 'runtime', desc: `${k[0].toUpperCase() + k.slice(1)} the shapes.` }); }
  op('path.repeat', { args: ['params'], out: 'shapes', params: { n: N(1, 200, 6), mode: S('radial', ['radial', 'grid', 'spiral']) }, open: true, src: 'runtime (Repeat, as Illustrator)', desc: 'Radial, grid or spiral repeats.' });
  op('shapes.repeat', { args: ['params'], params: { n: N(1, 200, 6), mode: S('radial', ['radial', 'grid', 'spiral']) }, open: true, src: 'runtime (Repeat, as Illustrator)', desc: 'Radial, grid or spiral repeats; fills: [colours] cycles paint.' });
  op('path.add', { args: ['other', 'params'], out: 'shapes', open: true, params: {}, src: VC + 'doc', desc: 'Group with another shape or text.' });
  op('shapes.background', { args: ['color'], params: { color: C('#ffffff') }, src: 'runtime', desc: 'Artboard background.' });
  op('path.blend', { args: ['to', 'steps'], out: 'shapes', params: { steps: N(1, 256, 8) }, src: 'runtime (resample + lerp)', desc: 'Blend steps toward another path.' });
  op('path.rasterize', { args: ['size'], out: 'image', open: true, params: {}, src: 'runtime (Path2D)', desc: 'Rasterize.' });
  op('shapes.toPath', { args: [], out: 'path', params: {}, src: 'runtime', desc: 'All outlines as one path.' });
  op('shapes.count', { args: [], out: 'number', params: {}, src: 'runtime', desc: 'How many shapes.' });
  op('mask.trace', { out: 'shapes', open: true, params: { mode: S('outline'), colors: N(1, 2, 1) }, src: VC + 'trace', desc: 'Trace the mask.' });
  // lists
  op('list.length', { args: [], out: 'number', params: {}, src: 'runtime', desc: 'Item count.' });
  op('list.first', { args: [], out: 'same', params: {}, src: 'runtime', desc: 'First item.' });
  op('list.reverse', { args: [], params: {}, src: 'runtime', desc: 'Reverse.' });
  op('list.slice', { args: ['a', 'b'], params: {}, src: 'runtime', desc: 'A slice.' });
  op('json.count', { args: [], out: 'number', params: {}, src: 'runtime', desc: 'Number of events/items.' });
  // audio (SoundCraft dsp)
  const SC = 'soundcraft/crates/dsp';
  const fxp = id => { const p = (FL.sound || []).find(x => x.id === id); const o = {}; if (p) for (const q of p.params) o[q.id] = q.choices ? S(q.choices[Math.round(q.default)] || q.choices[0], q.choices) : N(q.min, q.max, q.default); return o; };
  for (const [k, id] of Object.entries({ eq: 'eq_7band', compress: 'compressor', reverb: 'plate_reverb', room: 'room_reverb', delay: 'mod_delay', chorus: 'chorus', flanger: 'flanger', phaser: 'phaser', saturate: 'saturator', limiter: 'maximizer', gate: 'expander_gate', lofi: 'lofi', pitch: 'pitch_shifter', deesser: 'de_esser', rectify: 'rectifier', strip: 'channel_strip' })) op('audio.' + k, { params: Object.assign(fxp(id), { tail: N(0, 20, 0) }), open: true, src: `${SC} · ${id}`, desc: `${((FL.sound || []).find(x => x.id === id) || { name: id }).name}.` });
  op('audio.process', { args: ['plugin', 'params'], open: true, params: { plugin: S('plate_reverb', (FL.sound || []).filter(p => p.kind === 'effect').map(p => p.id)) }, src: SC, desc: 'Any SoundCraft plugin by id.' });
  op('audio.chain', { args: ['chain'], open: true, params: { chain: { type: 'array' } }, src: SC, desc: 'A chain: [{ plugin, params }, …].' });
  op('audio.gain', { args: ['gain'], params: { gain: N(0, 8, 1), db: N(-60, 24, 0) }, src: 'runtime', desc: 'Gain.' });
  op('audio.reverse', { args: [], params: {}, src: 'runtime', desc: 'Reverse.' });
  op('audio.normalize', { args: ['db'], params: { db: N(-30, 0, -1) }, src: 'runtime', desc: 'Peak-normalize.' });
  op('audio.slice', { args: ['a', 'b'], params: {}, src: 'runtime', desc: 'Seconds a..b.' });
  op('audio.spectrum', { args: ['n', 'params'], out: 'json', params: { n: N(2, 128, 32), smooth: N(0, 1, 0.5) }, src: SC + ' (spectrum)', desc: 'Same as bands.' });
  op('audio.toImage', { args: ['params'], out: 'image', params: {}, open: true, src: 'runtime', desc: 'Draw the waveform.' });
  // data, CAD
  op('table.range', { args: ['ref'], out: 'json', params: {}, src: 'gridcraft/crates/calc', desc: 'Values of a range (A2:A9) or a column (B).' });
  for (const c of ['concentric', 'fix', 'radius', 'angle', 'symmetric']) op('sketch.' + c, { args: ['a', 'b', 'c'], out: 'constraint', accumulate: true, params: {}, open: true, src: 'cadcraft/crates/constraints', desc: `${c} constraint.` });
  op('sketch.point', { out: 'record', open: true, params: {}, src: 'cadcraft/crates/constraints', desc: 'A point entity.' });
  op('sketch.arc', { out: 'record', open: true, params: {}, src: 'cadcraft/crates/constraints', desc: 'An arc entity.' });
  op('audio.waveform', { args: ['params'], out: 'image', open: true, params: {}, src: 'runtime', desc: 'Draw the waveform.' });
  root.CK_CATALOG = { ops };
})(typeof self !== 'undefined' ? self : this);
