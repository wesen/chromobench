// looks.js — presets.
// A preset is a named set of operations on parameter paths. Two kinds:
//   look     replaces the previous look (the 'look' layer holds one): a film and a paper, with whatever the stock implies
//   adjust   stacks on top of the look and of each other
// Opacity of the look layer (Layers view) blends a look in; Clear takes it out. Your own presets, saved from the
// Layers view or by the agent, are kept in the browser and shown under Yours.

// the parameters a stock pair changes, found by diffing against the plain defaults
const flatten = (o, pre = '', out = {}) => {
  for (const k of Object.keys(o)) { const v = o[k], q = pre ? pre + '.' + k : k; if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, q, out); else out[q] = v; }
  return out;
};
const stockOps = (film, print) => {
  const base = flatten(FB.defaultParams()), now = flatten(FB.defaultParams(film, print)), ops = {};
  for (const k of Object.keys(now)) if (JSON.stringify(now[k]) !== JSON.stringify(base[k]) && typeof now[k] !== 'object') ops[k] = now[k];
  return Object.assign({ film, print }, ops);
};

const LOOKS = [
  ['Portra 400 → Portra Endura', 'kodak_portra_400', 'kodak_portra_endura', 'The reference look: neutral skin, soft shoulder, gentle contrast.'],
  ['Ektar 100 → Endura Premier', 'kodak_ektar_100', 'kodak_endura_premier', 'Fine grain, saturated and punchy.'],
  ['Pro 400H → Crystal Archive', 'fujifilm_pro_400h', 'fujifilm_crystal_archive_typeii', 'Pastel greens, cool shadows, airy highlights.'],
  ['Gold 200 → Supra Endura', 'kodak_gold_200', 'kodak_supra_endura', 'Warm consumer negative with a golden cast.'],
  ['Vision3 500T → 2383', 'kodak_vision3_500t', 'kodak_2383', 'Cine tungsten stock on release print; strong contrast, tungsten source in the head.'],
  ['Velvia 100 (slide)', 'fujifilm_velvia_100', 'kodak_portra_endura', 'Very saturated slide film scanned directly.'],
  ['Ektachrome 100 (slide)', 'kodak_ektachrome_100', 'kodak_portra_endura', 'Clean, neutral slide film.'],
  ['Portra 160 → Portra Endura', 'kodak_portra_160', 'kodak_portra_endura', 'The finest-grain Portra: softer colour and gentler contrast than Portra 400.'],
  ['Portra 800 pushed +1 → Portra Endura', 'kodak_portra_800_push1', 'kodak_portra_endura', 'Rated one stop high and pushed in development: stronger colour and more contrast.'],
  ['UltraMax 400 → Supra Endura', 'kodak_ultramax_400', 'kodak_supra_endura', 'Everyday consumer colour: a little warmer than Portra, with deeper shadows.'],
  ['X-Tra 400 → Crystal Archive', 'fujifilm_xtra_400', 'fujifilm_crystal_archive_typeii', 'Fuji consumer stock on Fuji paper: saturated colour and deep shadows.'],
  ['C200 → Crystal Archive', 'fujifilm_c200', 'fujifilm_crystal_archive_typeii', 'Fuji 200-speed colour: strong saturation and firm shadows.'],
  ['Vision3 250D → 2383', 'kodak_vision3_250d', 'kodak_2383', 'Daylight cine negative on release print: deep blacks and restrained colour.'],
  ['Vision3 50D → 2383', 'kodak_vision3_50d', 'kodak_2383', 'The finest-grain cine daylight stock on release print.'],
  ['Vision3 200T → 2383', 'kodak_vision3_200t', 'kodak_2383', 'Tungsten-balanced cine negative on release print.'],
  ['Kodachrome 64 (slide)', 'kodak_kodachrome_64', 'kodak_portra_endura', 'Warm, yellow-leaning slide film with deep blacks.'],
  ['Provia 100F (slide)', 'fujifilm_provia_100f', 'kodak_portra_endura', 'Neutral slide film with moderate saturation.'],
];

const ADJUST = [
  ['Warm filtration', 'Pull yellow filtration out: warmer print, same exposure.', { 'enlarger.y_shift': -10, 'enlarger.m_shift': 2 }],
  ['Cool filtration', 'Add yellow filtration: cooler, bluer print.', { 'enlarger.y_shift': 10, 'enlarger.m_shift': -2 }],
  ['Hard paper', 'Steeper print curves, deeper blacks.', { 'print_render.morph.active': true, 'print_render.morph.gamma': 1.3 }],
  ['Soft paper', 'Flatter print curves, more shadow and highlight detail.', { 'print_render.morph.active': true, 'print_render.morph.gamma': 0.8 }],
  ['Clean (no grain, no halation)', 'Remove the spatial effects to judge colour only.', { 'film_render.grain.active': false, 'film_render.halation.active': false }],
  ['Heavy grain', 'Large, strong grain.', { 'film_render.grain.active': true, 'film_render.grain.amount': 2.5, 'film_render.grain.size_um': 22 }],
  ['Fine grain', 'Small, light grain.', { 'film_render.grain.active': true, 'film_render.grain.amount': 0.5, 'film_render.grain.size_um': 7 }],
  ['Overexpose +1', 'Film exposed one stop over. The enlarger compensates, so you see richer shadows and softer highlights, not a brighter print.', { 'camera.ev': 1 }],
  ['Underexpose −1', 'Film exposed one stop under: thinner shadows, more grain, colour drift.', { 'camera.ev': -1 }],
  ['Underexpose −2', 'Film exposed two stops under: thin, lifted shadows and colour drift. The enlarger compensates the brightness.', { 'camera.ev': -2 }],
  ['Muted colour', 'Weaker DIR couplers: about 20% less saturation. Filtration is trimmed so greys stay neutral.', { 'film_render.dir.active': true, 'film_render.dir.amount': 0.5, 'enlarger.m_shift': -0.4, 'enlarger.y_shift': -0.7 }],
  ['Rich colour', 'Stronger DIR couplers: about 30% more saturation. Filtration is trimmed so greys stay neutral.', { 'film_render.dir.active': true, 'film_render.dir.amount': 1.5, 'enlarger.m_shift': -0.5, 'enlarger.y_shift': 2.3 }],
  ['Lighter print', 'Less enlarger exposure: a lighter, airier print from the same negative.', { 'enlarger.print_exposure': 0.75 }],
  ['Darker print', 'More enlarger exposure: a deeper, moodier print.', { 'enlarger.print_exposure': 1.3 }],
  ['Matte blacks', 'Surface glare lifts the blacks, the way a matte or scuffed print does.', { 'print_render.glare': 1.5 }],
  ['Halation glow', 'Strong red-orange bloom around bright highlights.', { 'film_render.halation.active': true, 'film_render.halation.amount': 2.4 }],
];

export function looks(wb) {
  for (const [name, film, print, desc] of LOOKS) wb.preset(name, { kind: 'look', desc, builtin: true, ops: stockOps(film, print) });
  for (const [name, desc, ops] of ADJUST) wb.preset(name, { kind: 'adjust', desc, builtin: true, ops });
}
