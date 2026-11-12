// The hand-written vocabulary layer (guide §5.7): kept under fifteen entries, documented and
// tested like the generated API. Everything else is generated from the registry.
export interface VocabEntry {
  name: string;
  call: string;
  doc: string;
}

export const VOCABULARY: readonly VocabEntry[] = Object.freeze([
  { name: 'frame.source', call: 'frame.source()', doc: 'the scan as decoded (camera-linear), the recipe\'s own node' },
  { name: 'frame.scan', call: 'frame.scan()', doc: 'scanner densities above the rebate (scanner-density)' },
  { name: 'frame.negative', call: 'frame.negative()', doc: 'the negative as dye amounts (film-dyes): what the enlarger prints' },
  { name: 'frame.print', call: 'frame.print(opts?)', doc: 'the physical print under the viewing light (print-xyz); opts as neg.print' },
  { name: 'frame.display', call: 'frame.display()', doc: 'what the viewer shows (display-rgb)' },
  { name: 'neg.print', call: 'neg.print({ paper, time_s, fstop, filtration, lights, grade, preflash, illuminant, flare })', doc: 'a what-if print of a negative; unset options come from the recipe; changes nothing' },
  { name: 'frame.edit', call: "frame.edit({ 'print.enlarger.time_s': 12.6 }, { why })", doc: 'proposes recipe changes; submitted together when the eval succeeds; returns a receipt with a preview' },
  { name: 'frame.edit.exposure', call: 'frame.edit.exposure.add({ id, kind, mask, stops }, { why }) / .remove(id)', doc: 'proposes a dodge, burn, flash or split exposure (a mask handle is stored with it)' },
  { name: 'frame.why', call: "frame.why('print.lights.logH')", doc: 'who set a recipe value, and when' },
  { name: 'cb.testStrip', call: "cb.testStrip(frame, { vary: 'time', steps: 7, step: 1 / 3 })", doc: 'a test strip; its look carries one reading per band' },
  { name: 'cb.ringAround', call: 'cb.ringAround(frame, { step_pt: 4 })', doc: 'a 3×3 ring-around; its look carries one reading per cell' },
  { name: 'cb.compare', call: "cb.compare([a, b], 'label')", doc: 'one side-by-side look; each half carries its own numbers' },
  { name: 'cb.looks', call: "cb.looks.apply(name, params, { amount, to, where, why }) · whatIf(frame, name, params) · diff(a, b) · list()", doc: 'the studio\'s looks: what-ifs, diffs, one proposal batch over frames' },
  { name: 'h.look', call: "h.look('label' | { label, box, at, size })", doc: 'queues an image for you, with the numbers it shows (max 4 per eval)' },
  { name: 'units', call: 'units.pt(x) · toPt · stops · toStops · stopsFromTime(t1, t2) · stopsFromFstop(n1, n2)', doc: 'unit conversions; numbers or arrays' },
]);
