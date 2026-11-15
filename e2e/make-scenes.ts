// Writes the synthetic scenes of e2e/scenes.ts as files (for the persona session and manual checks; CHB-037 P9):
//   node e2e/make-scenes.ts <dir>
// A 3000 × 2000 negative scan, a roll of four 1800 × 1200 negatives at different exposures, and a camera RAW
// (a 4000 × 2666 Bayer DNG). Nothing comes from the photographer's material.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cameraDng, negativeScan } from './scenes.ts';

const dir = process.argv[2] ?? '.playwright-mcp/synthetic';
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'landscape-negative.tif'), negativeScan(3000, 2000));
[0, 0.5, -0.5, 1].forEach((ev, i) => writeFileSync(join(dir, `roll-12-frame-${i + 1}.tif`), negativeScan(1800, 1200, { exposure: ev })));
writeFileSync(join(dir, 'landscape-camera.dng'), cameraDng(2000, 1333));
console.log(`wrote 6 files to ${dir}`);
