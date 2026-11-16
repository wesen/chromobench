// The white balance before the film in the studio's words (CHB-048, D2): the camera file's light as a temperature and
// a tint in Lightroom's units (contract white-balance.ts), its presets (As shot, Lightroom's, None) and what the
// photographer reads. A negative has none: its colour was fixed when the film was exposed.
import { isLinked, sameWhiteBalance, WHITE_BALANCE_PRESETS, type Document, type SceneMedium, type WhiteBalance } from '@chromobench/contract';

/** The document path of the white balance (the scene medium's). */
export const WB_PATH = 'stages.scene.medium.whiteBalance';
export const TEMPERATURE_PATH = `${WB_PATH}.temperature_K`;
export const TINT_PATH = `${WB_PATH}.tint`;

/** Why a negative has no white balance control (shown where the control would be). */
export const NEGATIVE_WB_NOTE =
  'A negative has no white balance before the film: its colours were fixed when the film was exposed. Balance its print in the darkroom, with the filtration and the printer lights (or First print again).';
/** What the white balance does, in his words (under the controls). */
export const WB_NOTE =
  'The light the scene was lit by, corrected before the film is exposed (as a camera\'s white balance): the film then sees a white-balanced scene. Lightroom\'s numbers mean the same here.';

/** A camera file's white balance, or null (a negative). */
export function whiteBalanceIn(d: Document | undefined): WhiteBalance | null {
  const m = d?.stages.scene?.medium;
  if (!m || isLinked(m)) return null;
  return (m as SceneMedium).whiteBalance;
}

/** "5150 K, +8" (the tint signed, as Lightroom shows it). */
export function wbWords(wb: WhiteBalance): string {
  const t = Math.round(wb.tint);
  return `${Math.round(wb.temperature_K)} K, ${t > 0 ? '+' : t < 0 ? '−' : ''}${Math.abs(t)}`;
}

export interface WbChoice { id: string; label: string; wb: WhiteBalance | null }

/** The presets to choose from: As shot (this frame's, or unavailable), Lightroom's, None. */
export function wbChoices(asShot: WhiteBalance | null): WbChoice[] {
  return WHITE_BALANCE_PRESETS.map((p) => (p.id === 'as-shot'
    ? { id: p.id, label: asShot ? `As shot (${wbWords(asShot)})` : 'As shot (the file records none)', wb: asShot }
    : { id: p.id, label: p.id === 'none' ? p.label : `${p.label} (${wbWords(p.wb!)})`, wb: p.wb }));
}

/** Which preset a white balance is (As shot first), or null: Custom. */
export function wbPresetOf(wb: WhiteBalance, asShot: WhiteBalance | null): string | null {
  return wbChoices(asShot).find((c) => c.wb && sameWhiteBalance(c.wb, wb))?.id ?? null;
}
