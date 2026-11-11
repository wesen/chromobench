// LightCraft settings as state: control specs → state paths, defaults, presets, and the per-photo accessors.
import META from './lightcraft-meta.js';

export const DEFAULTS = META.defaults;
export const PRESETS = META.presets;
export const PROFILES = META.profiles;
export const BANDS = META.mixer_bands;
export const CONTROLS = new Map(META.controls.map(c => [c.id, c]));

const snake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const SPECIAL = {
  'bw.': 'bw_mix.', 'crop.angle': 'crop.geometry.angle',
  'optics.defringePurple': 'optics.defringe_purple_amount', 'optics.defringeGreen': 'optics.defringe_green_amount',
};
// 'detail.sharpenAmount' → ['detail', 'sharpen_amount']; 'bw.red' → ['bw_mix', 'red']
export function controlPath(id) {
  let p = id;
  if (SPECIAL[p]) p = SPECIAL[p];
  else if (p.startsWith('bw.')) p = 'bw_mix.' + p.slice(3);
  return p.split('.').map(snake);
}
export function spec(id) {
  const c = CONTROLS.get(id);
  if (!c) throw new Error(`No LightCraft control '${id}'`);
  return c;
}

// the settings of the photo being edited (or the defaults when none is)
export const primaryId = s => (s.ui.selection && s.ui.selection.primary) || null;
export const devOf = s => { const id = primaryId(s); return (id && s.dev[id]) || s.devDefaults; };
export const isEdited = (s, id) => s.dev[id] && s.dev[id] !== s.devDefaults;

// a section switch: LightCraft keeps the switched-off sections in disabled_sections
export const sectionOn = (dev, sec) => !(dev.disabled_sections || []).includes(sec);
// What the engine is sent: a switched-off panel's settings back at their defaults. The Studio's panels are finer
// than LightCraft's own sections (it knows light, color, detail…; the Studio switches Tone Curve, HSL and Color
// Grading one by one), so the Studio applies its switches itself and sends no disabled sections.
const SECTION_KEYS = { curve: ['curve'], mixer: ['mixer', 'bw_mix'], grading: ['grading'], detail: ['detail'], optics: ['optics'], geometry: ['geometry'], calibration: ['calibration'], effects: ['vignette', 'grain'] };
const effCache = new WeakMap();
// photo: { w, h } when known, so a straightened crop is kept inside the rotated picture (no black wedges)
export function effective(dev, photo) {
  if (!dev) return dev;
  const off = dev.disabled_sections && dev.disabled_sections.length;
  const geo = dev.crop && dev.crop.geometry, fix = photo && photo.w && geo && geo.angle ? constrainCrop(geo, photo) : geo;
  if (!off && fix === geo) return dev;
  const key = photo && photo.w ? dev : null, hit = key && effCache.get(key);
  if (hit && hit.w === photo.w && hit.h === photo.h) return hit.v;
  const out = Object.assign({}, dev);
  if (off) { out.disabled_sections = []; for (const sec of dev.disabled_sections) for (const k of SECTION_KEYS[sec] || []) out[k] = DEFAULTS[k]; }
  if (fix !== geo) out.crop = Object.assign({}, dev.crop, { geometry: fix });
  if (key) effCache.set(key, { v: out, w: photo.w, h: photo.h });
  return out;
}

// ── a straightened crop stays inside the picture ──
// The crop rectangle lives in the rotated frame (normalized to the photo's size); a frame point is inside the
// picture when, turned back by the angle about the centre, it lands inside the photo.
const insidePhoto = (x, y, a, W, H) => {
  const fx = x * W - W / 2, fy = y * H - H / 2;
  const sx = W / 2 + fx * Math.cos(a) + fy * Math.sin(a), sy = H / 2 - fx * Math.sin(a) + fy * Math.cos(a);
  return sx >= 1.5 && sx <= W - 1.5 && sy >= 1.5 && sy <= H - 1.5;   // a pixel and a half in: resampling blurs the edge
};
export function cropFits(geo, photo) {
  const r = geo.rect, a = (geo.angle || 0) * Math.PI / 180;
  return [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].every(([x, y]) => insidePhoto(x, y, a, photo.w, photo.h));
}
// the largest copy of the rectangle (same centre, same shape) that fits; if its centre is outside, it moves inward
export function constrainCrop(geo, photo) {
  if (!geo.angle || cropFits(geo, photo)) return geo;
  const r = geo.rect, a = geo.angle * Math.PI / 180;
  let cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  if (!insidePhoto(cx, cy, a, photo.w, photo.h)) { cx = 0.5; cy = 0.5; }
  const hw = (r.x1 - r.x0) / 2, hh = (r.y1 - r.y0) / 2;
  const at = k => ({ x0: cx - hw * k, y0: cy - hh * k, x1: cx + hw * k, y1: cy + hh * k });
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) { const k = (lo + hi) / 2; if (cropFits({ rect: at(k), angle: geo.angle }, photo)) lo = k; else hi = k; }
  const out = at(lo);
  return { rect: { x0: +out.x0.toFixed(5), y0: +out.y0.toFixed(5), x1: +out.x1.toFixed(5), y1: +out.y1.toFixed(5) }, angle: geo.angle };
}

// presets scale by Amount: each value moves from its default toward the preset's value (100 = the preset as
// made; 200 = twice as far); values without a numeric default are taken as they are
// Amount scales a preset's distance from the defaults. Values that are positions rather than amounts keep the
// preset's own: a grading hue (scaling teal 195° by 50% gives green 97.5°), angles, curve split points, seeds.
const KEEP = new Set(['angle', 'seed', 'split_shadows', 'split_mid', 'split_highlights', 'version', 'process', 'defringe_green_hue_lo', 'defringe_green_hue_hi', 'defringe_purple_hue_lo', 'defringe_purple_hue_hi']);
export function scalePreset(partial, defaults, k, path = []) {
  const out = {};
  for (const [key, v] of Object.entries(partial || {})) {
    const d = defaults ? defaults[key] : undefined;
    const keep = KEEP.has(key) || (key === 'hue' && path[0] === 'grading');
    if (v && typeof v === 'object' && !Array.isArray(v)) out[key] = scalePreset(v, d, k, path.concat([key]));
    else if (!keep && typeof v === 'number' && typeof d === 'number') out[key] = +(d + (v - d) * k).toFixed(3);
    else out[key] = v;
  }
  return out;
}
export function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = Object.assign({}, base);
  for (const [k, v] of Object.entries(patch)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base ? base[k] : undefined, v) : v;
  return out;
}

// copy chosen groups of settings from one photo to others (Lightroom's Sync)
export const SYNC_GROUPS = {
  'White Balance': ['wb'], 'Basic Tone': ['light'], 'Presence': ['color', 'effects'], 'Tone Curve': ['curve'],
  'Color Mixer': ['mixer', 'bw_mix'], 'Color Grading': ['grading'], 'Detail': ['detail', 'enhance'], 'Lens Corrections': ['optics'],
  'Transform': ['geometry'], 'Effects': ['vignette', 'grain'], 'Calibration': ['calibration'], 'Treatment & Profile': ['treatment', 'profile'],
  'Crop': ['crop'], 'Spot Removal': ['spots'], 'Masks': ['masks'],
};
export function syncSettings(from, to, groups) {
  const out = Object.assign({}, to);
  for (const g of groups) for (const key of SYNC_GROUPS[g] || []) out[key] = from[key];
  return out;
}

// readable names for history entries
export const fmtSigned = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(+v).toFixed(d);
