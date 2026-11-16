// Switching the enlarger between Real and Normalised (CHB-046, CHB-028 F44: the switch darkened a print from luma
// 105 to 52). Real mode exposes the paper with the time, the aperture and the filtration (κ fixed at the calibration
// pack); normalised mode prints the grey card at the aim whatever the time (κ at the current pack, no optics). For the
// same settings the two differ by one log exposure, the same on every pixel: the mode's shift, offset(real) −
// offset(normalised) (core's modeShiftLogH, injected by the host as services.darkroomMath). The switch carries it into
// the printer lights (real → normalised: the time's density goes into the lights) and takes it back out
// (normalised → real), so the print keeps its density and a switch there and back is no change at all.
import type { Cmy, Document, LinkContext } from '@chromobench/contract';
import type { Mutation } from '@chromobench/values';
import { isNormalised, LIGHTS_PATH, lightsOf, MODE_PATH, read, shiftLights, TIME_PATH, type EnlargerMode } from './doc.ts';

/** What the main exposure's chain depends on (core's ExposeSettings without the mode): the settings the shift needs. */
export interface ExposureSettings {
  film: string;
  paper: string;
  lamp: string;
  filtration: Cmy;
  time_s: number;
  fstop: number;
  magnification: number;
  aim: 'grey-0.184' | 'midgray-normalised';
  aimView: string;
  /** a camera file (its film is exposed by the scene: the print normalises on the capture path's mid-grey) */
  capture?: true;
}

/** The host's darkroom numbers (core's): services.darkroomMath. */
export interface DarkroomMath {
  /** log H of real over normalised mode for these settings (core modeShiftLogH) */
  modeShift(s: ExposureSettings): number;
}

/** The main exposure's settings as the compiler passes them to print.expose (links resolved through `links`). */
export function exposureSettingsOf(doc: Document, links?: LinkContext): ExposureSettings {
  const r = <T>(p: string, fallback: T): T => (read(doc, p, links) as T | undefined) ?? fallback;
  const film = doc.stages.scan ? r('stages.scan.medium.stock', 'kodak_portra_400') : r('stages.film.medium.stock', 'kodak_portra_400');
  return {
    film,
    paper: r('stages.darkroom.medium.paper', ''),
    lamp: r('stages.darkroom.medium.lamp', 'TH-KG3'),
    filtration: { ...r<Cmy>('main.params.filtration', { c: 0, m: 0, y: 0 }) },
    time_s: r(TIME_PATH, 10),
    fstop: r('main.params.fstop', 8),
    magnification: r('stages.darkroom.medium.magnification', 8),
    aim: r('stages.darkroom.medium.aim', 'grey-0.184'),
    aimView: r('stages.print.medium.illuminant', 'D50'),
    ...(doc.stages.scan ? {} : { capture: true as const }),
  };
}

/** core's REFERENCE_OPTICS (the calibration: 10 s at f/8, magnification 8), where both modes print alike */
const REF = { time_s: 10, fstop: 8, magnification: 8 };

/**
 * The shift without the host's physics (the mock engine, the kit's dev host): the optics alone, core's opticsLogH. It
 * is the whole shift when the filtration is the neutral pack (κ is then the same in both modes); a filtration shift
 * adds κ's difference, which only the physics knows.
 */
export function referenceOpticsShift(s: Pick<ExposureSettings, 'time_s' | 'fstop' | 'magnification'>): number {
  return Math.log10(s.time_s / REF.time_s) - 2 * Math.log10(s.fstop / REF.fstop) - 2 * Math.log10((s.magnification + 1) / (REF.magnification + 1));
}

const LIMIT = 1.5;

/**
 * The mutations that put the document's enlarger in `mode` and keep its print: the mode, and the printer lights moved
 * by the mode's shift (up into normalised, back down into real). What the lights cannot hold (they stop at ±1.5 log H)
 * goes into the time on the way to real mode; on the way to normalised, where the time does nothing, it is lost and
 * `kept` says by how much. Nothing when the document is in `mode` already.
 */
export function modeSwitch(doc: Document, mode: EnlargerMode, shift: (s: ExposureSettings) => number, links?: LinkContext): { mutations: Mutation[]; shift: number; lost: number } {
  const now: EnlargerMode = isNormalised(doc) ? 'normalised' : 'real';
  if (now === mode) return { mutations: [], shift: 0, lost: 0 };
  const s = exposureSettingsOf(doc, links);
  const d = shift(s);
  const signed = mode === 'normalised' ? d : -d;
  const l0 = lightsOf(doc);
  const lights = shiftLights(l0, signed);
  // what the clamp kept out (the rounding to 1e-6 in shiftLights is not a loss)
  const over = l0.reduce((a, x) => a + (x + signed - Math.min(LIMIT, Math.max(-LIMIT, x + signed))), 0) / 3;
  const ms: Mutation[] = [{ op: 'set', path: MODE_PATH, value: mode }, { op: 'set', path: LIGHTS_PATH, value: lights }];
  let lost = 0;
  if (Math.abs(over) > 1e-9) {
    if (mode === 'real') ms.push({ op: 'set', path: TIME_PATH, value: Number(Math.min(600, Math.max(0.1, s.time_s * 10 ** over)).toFixed(6)) });
    else lost = over;
  }
  return { mutations: ms, shift: d, lost: Math.abs(lost) > 1e-9 ? lost : 0 };
}
