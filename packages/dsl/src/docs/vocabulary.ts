// The hand-written vocabulary layer (guide §5.7; contract 1.0): the words around the generated API, documented and
// tested like it. `counted` names the words the host counts in EvalTrace.vocabulary (telemetry's deletion
// candidates); everything else is generated from the registry, the cuts and the stages.
export interface VocabEntry {
  name: string;
  call: string;
  doc: string;
  counted?: boolean;
}

export const VOCABULARY: readonly VocabEntry[] = Object.freeze([
  { name: 'frame.cut', call: "frame.print() · frame.cut('darkroom.H') · source() scan() scene() film() negative() finished() display()", doc: 'a cut of the frame\'s compiled document: an image handle (the node the viewer and the export name)', counted: true },
  { name: 'frame.doc', call: "frame.doc · frame.get('main.params.time_s')", doc: 'the document as the eval started (read-only); get reads one path, id-anchored like set' },
  { name: 'frame.with', call: "frame.with(set('main.params.time_s', 12)).print()", doc: 'a what-if: the document with a change, compiled by the one compiler; changes nothing', counted: true },
  { name: 'frame.propose', call: "frame.propose(change, { why, label })", doc: 'validates a change now and submits it when the eval succeeds (ask: a proposal; auto: applied); the receipt has a preview what-if', counted: true },
  { name: 'frame.why', call: "frame.why('main.params.time_s') · frame.pending()", doc: 'who set a value, and from where; the proposals waiting for the photographer' },
  { name: 'frame.explain', call: 'frame.explain()', doc: 'the document: stages with media, laws and entries (with the nodes they compile to), masks, geometry' },
  { name: 'layer', call: "layer('burn', { stops: 0.5 }).amount(0.5).mask('sky') · .blend .name .enabled .params", doc: 'a layer value: an op of a stage stack with amount, mask and blend', counted: true },
  { name: 'group', call: "group('Sky', { b1: layer('burn', { stops: 0.5 }) }).amount(0.6)", doc: 'a group value: entries that act as one (keys are their ids, in order)', counted: true },
  { name: 'mask', call: "mask('sky').add('c1', 'linear', { from, to }).add('c2', 'luminance', { above: 0.5 }, 'intersect').feather(1)", doc: 'a mask value: components (add = max, subtract, intersect = product), feather in mm, invert, reads', counted: true },
  { name: 'changes', call: "set(path, v) · insert(coll, id, item, at?) · remove(id) · move(id, { into, at }) · [a, b]", doc: 'the four mutations, as change values; several changes are an array, applied in order', counted: true },
  { name: 'coll', call: "coll({ s1: { … }, s2: { … } })", doc: 'a collection (a list argument such as heal spots or paint strokes): keys are ids, in order', counted: true },
  { name: 'h.show', call: "h.show('label' | { label, box, at, size })", doc: 'shows you an image with the numbers it shows (max 4 per eval)', counted: true },
  { name: 'cb.compare', call: "cb.compare([a, b], 'label')", doc: 'one side-by-side image; each half carries its own numbers' },
  { name: 'cb.testStrip', call: "cb.testStrip(frame, { vary: 'time', steps: 7, step: 1 / 3 })", doc: 'a test strip of the negative; its image carries one reading per band', counted: true },
  { name: 'cb.ringAround', call: 'cb.ringAround(frame, { step_pt: 4 })', doc: 'a 3×3 ring-around; its image carries one reading per cell', counted: true },
  { name: 'cb.looks', call: "cb.looks.apply(name, params, { amount, to, where, why }) · whatIf(frame, name, params) · diff(a, b) · bake(link) · list()", doc: 'registered looks and presets as links on the frames: what-ifs, diffs, one proposal batch over frames, bake', counted: true },
  { name: 'units', call: 'units.pt(x) · toPt · stops · toStops · stopsFromTime(t1, t2) · stopsFromFstop(n1, n2)', doc: 'unit conversions; numbers or arrays' },
]);
