// lib/pushpull.js — a fragment: push and pull processing as one control.
// A fragment is a vertical slice through the planes. This one only contributes to the control plane (extends: ['ctl']).
// Model: pushing by n stops means rating the film n stops faster (camera.ev falls by n) and developing longer,
// which raises the negative's contrast. The 0.12 per stop is an eyeball figure, not a measurement: change it,
// or calibrate it against Portra 800 and its pushed profiles (examples/09 shows how calibration works).
export const pushPull = fragment('pushPull', {
  extends: ['ctl'],
  macros: {
    'pushPull.stops': (m) => m
      .drives('camera.ev', { gain: -1 })
      .drives('film_render.gamma', { gain: 0.12 }),
  },
  decorate: {
    'ctl:camera.ev': (c) => c.label('Film exposure'),
  },
});
