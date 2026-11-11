// The engine graphs the Studio uses, recorded once at build. Holes are lambdas: of the state for the views, of an
// item for thumbnails. Each becomes one engine input; a render sends only the holes' values.
import { ck } from '../shell/index.js';
import { devOf, primaryId, effective } from './develop-model.js';
import { primaryOf } from './catalog.js';

export const fileOf = s => { const id = primaryId(s); const p = id && s.catalog.photos.find(x => x.id === id); return p ? p.file : null; };
const uncropped = d => Object.assign({}, d, { crop: Object.assign({}, d.crop, { geometry: { rect: { x0: 0, y0: 0, x1: 1, y1: 1 }, angle: d.crop.geometry.angle } }) });

export const photo = ck.image(fileOf);                                   // the file as it came in
export const render = photo.develop(s => effective(devOf(s), primaryOf(s)));                               // what Develop shows
export const before = photo.develop(s => s.devDefaults);                  // Lightroom's "before": the import settings
export const uncroppedRender = photo.develop(s => uncropped(effective(devOf(s))));  // the crop tool works on the whole frame
export const thumb = ck.image(a => a.file).develop(a => effective(a.dev, a));   // a: { file, dev, w?, h? }          // one per photo, with its own settings
export const itemPhoto = ck.image(a => a.file);                           // an item's file, undeveloped
