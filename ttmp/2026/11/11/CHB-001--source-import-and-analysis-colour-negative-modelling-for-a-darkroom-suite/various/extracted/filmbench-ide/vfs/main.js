// main.js — the studio.
// Runs first, from scratch, whenever you press Run main. Everything the other views show is made here:
// a bench (the state), one pipeline, then looks, controls and workspace from the files it imports.
// Edit any of them and press Run main; the picture, the controls and the tiles are rebuilt.
// (Your saved looks and the open files survive a run; the undo history starts again.)

import { macros, engineer, darkroom, colourist } from './controls.js';
import { looks } from './looks.js';
import { probes, tiles, layouts } from './workspace.js';
import { zoneSystem } from './lib/zone.js';
import { pushPull } from './lib/pushpull.js';

const wb  = bench('studio');
const rig = wb.pipe('default')
  .scene('still')                       // 'chart' is the 24-patch test chart; paste or drop a picture to use your own
  .film('kodak_portra_400')             // expose, then develop        taps: log_e_film, cmy_film
  .enlarger()                           // film density to print exposure   tap: log_e_print
  .paper('kodak_portra_endura')         // print development           tap: cmy_print
  .scan();                              // scan, XYZ, sRGB             tap: out

probes(wb);                             // named rectangles other things can point at: skin, shadow, sky
wb.use(zoneSystem, pushPull);           // fragments: macros, lenses, tiles and a note for the agent, from lib/
looks(wb);                              // presets: Looks swap the stocks, Adjustments stack on top

const m = macros(wb);                   // one gesture, several parameters
engineer(wb);                           // every parameter of the model, in the order of the table
darkroom(wb, m);                        // what a printer reaches for: stops, filtration, grade, surface
colourist(wb, m);                       // warmth, tint, saturation, contrast and a colour-balance pad
wb.ctl.use('darkroom');

tiles(wb);                              // the pictures and plots of the Workspace
layouts(wb);                            // named arrangements of those tiles
wb.ws.layout.use('Study');

wb.agent({ mode: 'ask' });              // the agent proposes; you approve (Auto and Read-only are in the Agent view)
