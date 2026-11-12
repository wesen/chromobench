// Names for the ids the recipe stores (CHB-027 F9): 'kodak_portra_endura' is "Kodak Portra Endura", 'fujifilm_c200'
// is "Fujifilm C200". The recipe, the DSL and the agents keep the ids; only what a person reads changes. The data
// packs carry no display names, so the names are made from the ids, with a table for the ones the rule gets wrong.

/** Stock ids whose name the rule below would get wrong. */
const STOCK_NAMES: Record<string, string> = {
  fujifilm_crystal_archive_typeii: 'Fujifilm Crystal Archive Type II',
  fujicolor_crystal_archive_typeII: 'Fujicolor Crystal Archive Type II',
  fujifilm_xtra_400: 'Fujifilm Superia X-TRA 400',
  fujifilm_pro_400h: 'Fujifilm Pro 400H',
  fuji_pro_400h: 'Fuji Pro 400H',
  kodak_2383: 'Kodak Vision Print 2383',
  kodak_2393: 'Kodak Vision Premier 2393',
  kodak_ultramax_400: 'Kodak UltraMax 400',
  kodak_portra_800_push1: 'Kodak Portra 800 (pushed 1 stop)',
  kodak_portra_800_push2: 'Kodak Portra 800 (pushed 2 stops)',
};
const BRANDS: Record<string, string> = { kodak: 'Kodak', fujifilm: 'Fujifilm', fuji: 'Fuji', fujicolor: 'Fujicolor', ilford: 'Ilford', agfa: 'Agfa', cinestill: 'CineStill', lomography: 'Lomography' };

function word(w: string): string {
  if (/^\d+[a-z]$/i.test(w)) return w.toUpperCase(); // 100f → 100F, 200t → 200T, 250d → 250D
  if (/^[a-z]\d+$/i.test(w)) return w.toUpperCase(); // c200 → C200
  if (/^type(i+)$/i.test(w)) return `Type ${w.slice(4).toUpperCase()}`;
  const push = /^push(\d)$/.exec(w);
  if (push) return `(pushed ${push[1]} stop${push[1] === '1' ? '' : 's'})`;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** A film or paper stock's name: 'kodak_portra_endura' → "Kodak Portra Endura". Unknown shapes come back readable. */
export function stockName(id: string): string {
  if (STOCK_NAMES[id]) return STOCK_NAMES[id]!;
  const parts = id.split(/[_\s]+/).filter(Boolean);
  if (!parts.length) return id;
  return parts.map((p, i) => (i === 0 && BRANDS[p.toLowerCase()] ? BRANDS[p.toLowerCase()]! : word(p))).join(' ');
}

const ILLUMINANTS: Record<string, string> = { D50: 'Daylight D50', D55: 'Daylight D55', D65: 'Daylight D65', D75: 'Daylight D75', A: 'Tungsten (A)', F2: 'Fluorescent (F2)', F11: 'Fluorescent (F11)' };
const LAMPS: Record<string, string> = { 'TH-KG3': 'Halogen lamp (TH-KG3 filter)', 'LED-RGB': 'RGB LED head' };
const SCANNERS: Record<string, string> = {
  'xt5-fitted': 'Camera scan: X-T5, RGB LEDs (fitted)', 'xt5-rgb-led': 'Camera scan: X-T5, RGB LEDs', 'rgb-led-book': 'Camera scan: RGB LEDs (textbook)',
  'white-led': 'Camera scan: white LED', 'status-m': 'Densitometer (Status M)',
};

/**
 * The name of a value from one of the contract's lists (ArgSpec.valuesFrom): stocks, illuminants, lamps, scanners.
 * Any other list (or none) returns the id with underscores as spaces, as the menus showed it before.
 */
export function valueName(from: string | undefined, id: string): string {
  if (from === 'stocks:film' || from === 'stocks:print' || from === 'stock') return stockName(id);
  if (from === 'illuminants') return ILLUMINANTS[id] ?? id;
  if (from === 'lamps') return LAMPS[id] ?? id;
  if (from === 'scanners') return SCANNERS[id] ?? id;
  return id.replace(/_/g, ' ');
}

/** Names for enum values a person reads, by recipe path (CHB-031: the enlarger's two modes). */
export const ENUM_NAMES: Record<string, Record<string, string>> = {
  'print.enlarger.mode': { real: 'Real enlarger (time and aperture)', normalised: 'Normalised (grey card at the aim)' },
};

/** The recipe paths that hold a stock id (for code that has a path, not a control model). */
export const STOCK_PATHS = new Set(['print.paper', 'scan.stock', 'capture.stock']);
