// The preset pickers (CHB-048): one select per kind, in his words, showing which preset the frame has now (or
// "Custom") and running the command that sets one (one undo step). The white balance's presets are As shot, Lightroom's
// and None (white-balance.ts).
import type { Document } from '@chromobench/contract';
import { wbChoices, wbPresetOf, wbWords, whiteBalanceIn } from './white-balance.ts';

export type PickerKind = 'white-balance';
export const PICKER_KINDS: readonly PickerKind[] = ['white-balance'];

export interface PickerOption { value: string; label: string; group?: string; disabled?: boolean }
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

/** The picker of a kind for a frame's document (null: the frame has nothing of the kind, e.g. a negative's white balance). */
export function pickerOf(kind: PickerKind, d: Document | undefined, facts: { asShot?: { temperature_K: number; tint: number } | null } = {}): Picker | null {
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
  return null;
}
