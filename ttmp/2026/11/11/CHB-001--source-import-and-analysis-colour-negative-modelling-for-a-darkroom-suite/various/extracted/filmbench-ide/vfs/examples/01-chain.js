// 01 · One pipeline as one chain
// A pipeline is a value. Nothing renders until something asks for a tap. Taps are named points in
// the pipeline, and each carries a type (Scene, LogExposure, Density, RGB), so wrong wiring is caught early.
// Press Run: three pictures appear in the Console. This file makes its own bench; the last line puts it on screen.

const wb = bench('hello');

const rig = wb.pipe('default')
  .scene('chart')                    // 24-patch chart                     tap: src
  .film('kodak_portra_400')          // expose, then develop               taps: log_e_film, cmy_film
  .enlarger()                        // film density to print exposure     tap: log_e_print
  .paper('kodak_portra_endura')      // print development                  tap: cmy_print
  .scan();                           // scan to XYZ to sRGB                tap: out

log('taps   ', rig.taps.join(' · '));
log('stages ', rig.stageNames.join(' · '));

show(rig.at('out').eval({ w: 384, h: 256 }));          // the print as the scanner sees it
show(rig.at('log_e_film').eval({ w: 160, h: 106 }));   // what the lens put on the negative (log E, as false colour)
show(rig.at('cmy_film').eval({ w: 160, h: 106 }));     // what development made of it (dye densities)

use(wb);    // the Controls, Workspace and Graph views now show this bench. Run main.js to go back to the studio.
