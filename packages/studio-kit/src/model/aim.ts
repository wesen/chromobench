// The first print's colour aim (D8, CHB-046; CHB-028 t:5wjl). Until now the Roll module's first prints kept a quarter
// of each frame's cast (its ALPHA 0.75) while the studio's first print of a single negative integrated it fully to grey
// (alpha 1): the same frame printed differently from the roll and from the studio. Now there is one aim for both,
// "Neutralise 75 %" (a darkroom printer's habit: keep some of a sunset's warmth), an amount the photographer can
// change (prefs.neutralise, in percent; the Darkroom panel and the Roll panel show it), and one function that both
// first prints call.
import type { Vec3 } from '@chromobench/contract';

/** D8: how much of each frame's colour cast the first print takes out (0 keeps the cast, 1 prints the frame to grey). */
export const NEUTRALISE = 0.75;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** The amount he chose (prefs.neutralise, percent), as a share 0…1; 75 % when he has not chosen one. */
export function neutraliseOf(s: unknown): number {
  const v = (s as { prefs?: { neutralise?: unknown } } | null | undefined)?.prefs?.neutralise;
  return typeof v === 'number' && Number.isFinite(v) ? clamp01(v / 100) : NEUTRALISE;
}

/** core's integrate-to-grey with aim 0: a frame's departure from the aim (LATD, log H) and the colour share → lights */
export type IntegrateToGrey = (latd: Vec3, alpha: number) => Vec3;

/**
 * THE first print's printer lights for a frame (the Roll module's first prints and the studio's first print both
 * call it): its whole density to the aim, its colour cast taken out by `neutralise` (core's integrate-to-grey α).
 */
export function firstPrintLights(integrate: IntegrateToGrey, latd: Vec3, neutralise: number = NEUTRALISE): Vec3 {
  return integrate(latd, clamp01(neutralise));
}
