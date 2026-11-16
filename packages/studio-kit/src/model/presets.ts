// The preset pickers (CHB-048): one select per kind, in his words, showing which preset the frame has now (or
// "Custom") and running the command that sets one (one undo step). The white balance's presets are As shot, Lightroom's
// and None (white-balance.ts); the media's are the data pack's film stocks and papers and the paper grades (contract
// media-presets.ts, LOOK-6, D6), from the stocks the host registers (setMediumStocks).
import { mediumPresets, PRESET_STAGE, presetOf, type Document, type MediumPreset, type PresetKind, type StockFacts } from '@chromobench/contract';
import { KNOWN_VALUES } from './controls.ts';
import { read } from './doc.ts';
import { stockName } from './names.ts';
import { wbChoices, wbPresetOf, wbWords, whiteBalanceIn } from './white-balance.ts';

export type PickerKind = 'white-balance' | PresetKind;
export const PICKER_KINDS: readonly PickerKind[] = ['white-balance', 'film', 'paper', 'grade'];

/** The data pack's stocks (the host's, from its packs); null: the placeholder lists of the mock (KNOWN_VALUES). */
let STOCKS: StockFacts[] | null = null;
/** Registers the data pack's stocks for the medium presets (the host, before a layout is built). */
export function setMediumStocks(stocks: readonly StockFacts[]): void {
  STOCKS = stocks.length ? [...stocks] : null;
}
/** The stocks the presets come from: the registered pack's, or the mock's placeholder ids as negative film and paper. */
export function mediumStocks(): StockFacts[] {
  if (STOCKS) return STOCKS;
  return [
    ...(KNOWN_VALUES['stocks:film'] ?? []).map((id): StockFacts => ({ id, name: stockName(id), role: 'film', type: 'negative' })),
    ...(KNOWN_VALUES['stocks:print'] ?? []).map((id): StockFacts => ({ id, name: stockName(id), role: 'paper', type: 'negative' })),
  ];
}
/** The presets of a kind (film, paper, grade). */
export const presetsOf = (kind: PresetKind): MediumPreset[] => mediumPresets(kind, mediumStocks());

/** The document path a stock control edits → the preset kind it picks (the stock selects are preset pickers). */
export const PRESET_PATHS: Readonly<Record<string, PresetKind>> = Object.freeze({ 'stages.film.medium.stock': 'film', 'stages.darkroom.medium.paper': 'paper' });

export interface PickerOption { value: string; label: string; group?: string; disabled?: boolean; tip?: string }
export interface Picker {
  label: string;
  /** what the select explains on hover */
  tip: string;
  options: PickerOption[];
  /** the option the frame has now; null: none of them (the select shows `custom`) */
  current: string | null;
  custom: string;
  /** the command and its argument for a chosen option */
  run: (value: string) => [string, unknown];
}

const TIPS: Record<PresetKind, string> = {
  film: 'The film the scene is shot on, as the data pack has it: choosing one sets the film (a pushed profile also its push). Exposure, grain and halation stay yours.',
  paper: 'The paper the print is made on, as the data pack has it.',
  grade: 'The paper\'s contrast grade: 2 is the paper as made; lower is softer, higher harder (about the grey card, which stays).',
};
const LABELS: Record<PresetKind, string> = { film: 'Film stock', paper: 'Paper', grade: 'Paper grade' };

/** The picker of a kind for a frame's document (null: the frame has nothing of the kind, e.g. a negative's white balance). */
export function pickerOf(kind: PickerKind, d: Document | undefined, facts: { asShot?: { temperature_K: number; tint: number } | null; links?: unknown } = {}): Picker | null {
  if (kind === 'white-balance') {
    const wb = whiteBalanceIn(d);
    if (!wb) return null;
    const asShot = facts.asShot ?? null;
    return {
      label: 'White balance',
      tip: 'The light the scene was lit by: As shot is the camera\'s own white balance; the others are Lightroom\'s presets; None leaves the light as it was (a daylight film sees it so).',
      options: wbChoices(asShot).map((c) => ({ value: c.id, label: c.label, ...(c.wb ? {} : { disabled: true }) })),
      current: wbPresetOf(wb, asShot),
      custom: `Custom (${wbWords(wb)})`,
      run: (value) => ['scene.whiteBalance', { preset: value }],
    };
  }
  const medium = read(d, `stages.${PRESET_STAGE[kind]}.medium`, facts.links as never) as Record<string, unknown> | undefined;
  if (!d || !medium) return null;
  const presets = presetsOf(kind);
  const now = presetOf(medium, presets);
  const custom = kind === 'grade' ? `Grade ${String(medium['grade'])}`
    : kind === 'film' ? `${stockName(String(medium['stock']))}${medium['push'] ? `, pushed ${String(medium['push'])}` : ''}`
      : stockName(String(medium['paper']));
  return {
    label: LABELS[kind],
    tip: TIPS[kind],
    options: presets.map((p) => ({ value: p.id, label: p.label, group: p.group, ...(p.note ? { tip: p.note } : {}) })),
    current: now?.id ?? null,
    custom,
    run: (value) => ['medium.preset', { kind, preset: value }],
  };
}
