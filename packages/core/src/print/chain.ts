// The print chain as one bundle (guide §5.4–5.5): enlarger → lights → preflash → paper → view → display.
// Order is fixed: lights after the spectral sum, paper curve after lights and flash, flare before
// adaptation, the knee last.
import type { Cmy, PhysicsData } from '../data/provider.ts';
import type { Conventions } from '../spectral/conventions.ts';
import { lm, mulMV, type Vec3 } from '../spectral/linalg.ts';
import { resolveStock, type Stock } from '../spectral/stock.ts';
import { cmfChromogenFit } from '../spectral/spectrum.ts';
import {
  adaptBradford, addFlare, D50, D65, encodeSRGB, lab, observe, paperWhiteXYZ, reflectance, whiteXYZ,
  XYZ_TO_P3, XYZ_TO_REC2020, XYZ_TO_SRGB, type Viewing,
} from './colour.ts';
import { makeEnlarger, REFERENCE_OPTICS, type Enlarger, type EnlargerOptics } from './enlarger.ts';
import { compressOutput, DEFAULT_COMPRESS, type CompressSpec } from './gamut.ts';
import { Lights } from './lights.ts';
import { NO_MORPH, paperDeveloper, preflash, type PaperMorph } from './paper.ts';

export type Aim = 'grey-0.184' | 'midgray-normalised';

export function cmfFor(conv: Conventions, data: PhysicsData): [Float64Array, Float64Array, Float64Array] {
  return conv.cmf === 'chromogen-fit' ? cmfChromogenFit() : data.cmf();
}

export interface PrintChainOptions {
  data: PhysicsData;
  film: string | Stock;
  paper: string | Stock;
  conv: Conventions;
  lamp?: string;
  /** Absolute filter pack; default the database neutral pack (or [0, 65, 55]) plus `filtrationShift`. */
  filtration?: Cmy;
  filtrationShift?: Cmy;
  /**
   * The calibration pack: real mode fixes κ there, and the aim lights are fitted there in both modes,
   * so a filter change is a change of the print. Default: the absolute `filtration` when given (a
   * fixed-pack setup such as Chromogen's), else the database neutral pack.
   */
  referencePack?: Cmy;
  mode?: 'normalised' | 'real';
  /** Real mode: time, aperture and magnification (missing fields: REFERENCE_OPTICS). */
  optics?: Partial<EnlargerOptics>;
  view?: string;
  morph?: PaperMorph;
  aim?: Aim;
  /** Raw midgray override (RAW frames, CHB-012). */
  midgray?: Float64Array;
}

export interface PrintChain {
  film: Stock;
  paper: Stock;
  enlarger: Enlarger;
  viewing: Viewing;
  /** Absolute pack of this chain. */
  filtration: Cmy;
  /** The database neutral pack for (paper, film), or DEFAULT_NEUTRAL. */
  neutral: Cmy;
  /** The calibration: its pack and its enlarger (REFERENCE_OPTICS, κ fixed). */
  reference: { pack: Cmy; enlarger: Enlarger };
  /** Dye amounts of the film's grey card (log H = 0 in every layer). */
  grey: Vec3;
  /**
   * Lights that the aim adds (ℓ = 0 in the recipe means this). Fitted once at the calibration, not per
   * setting: time, f-stop and filtration then move the print as on an enlarger.
   */
  aimLights: Lights;
  /** The aim grey's paper exposure at the calibration (Chromogen aim().g): the grade's pivot. */
  aimX: Vec3;
  develop(x: ArrayLike<number>): Vec3;
  /** Paper log H → XYZ under the viewing light (Y(perfect white) = 1). */
  xyzOfX(x: ArrayLike<number>): Vec3;
  /** Film dyes → paper log H including the aim and extra lights. */
  xOfDyes(c: ArrayLike<number>, lights?: Lights): Vec3;
  print(c: ArrayLike<number>, lights?: Lights): { x: Vec3; cp: Vec3; XYZ: Vec3; lab: Vec3; Dvis: number };
  white: Vec3;
  paperWhite: Vec3;
}

export const DEFAULT_NEUTRAL: Cmy = { c: 0, m: 65, y: 55 };

export function makePrintChain(o: PrintChainOptions): PrintChain {
  const { data, conv } = o;
  const film = typeof o.film === 'string' ? resolveStock(data.stock(o.film), conv) : o.film;
  const paper = typeof o.paper === 'string' ? resolveStock(data.stock(o.paper), conv) : o.paper;
  const neutral = data.neutralFilter(paper.data.id, film.data.id) ?? DEFAULT_NEUTRAL;
  const sh = o.filtrationShift ?? { c: 0, m: 0, y: 0 };
  const filtration = o.filtration ?? { c: neutral.c + sh.c, m: neutral.m + sh.m, y: neutral.y + sh.y };
  const refPack = o.referencePack ?? o.filtration ?? neutral;
  const lampName = o.lamp ?? 'TH-KG3';
  const base = {
    film, paper, lamp: data.illuminant(lampName), lampName, dichroic: data.dichroic(), conv,
    calibration: { pack: refPack, optics: REFERENCE_OPTICS }, ...(o.midgray ? { midgray: o.midgray } : {}),
  };
  const mode = o.mode ?? 'normalised';
  const enlarger = makeEnlarger({ ...base, filtration_CC: filtration, mode, ...(o.optics ? { optics: o.optics } : {}) });
  const atReference = filtration.c === refPack.c && filtration.m === refPack.m && filtration.y === refPack.y && enlarger.optics_logH === 0;
  const refEnlarger = atReference ? enlarger : makeEnlarger({ ...base, filtration_CC: refPack, mode: 'real' });
  const viewing: Viewing = { illuminant: data.illuminant(o.view ?? paper.data.meta.viewIlluminant ?? 'D50'), cmf: cmfFor(conv, data), paper };
  const develop = paperDeveloper(paper, o.morph ?? NO_MORPH);
  const white = whiteXYZ(viewing);
  const R = new Float64Array(81);
  const xyzOfX = (x: ArrayLike<number>): Vec3 => observe(viewing, reflectance(viewing, develop(x), R));
  const grey = film.develop([0, 0, 0]);
  // The aim is fitted at the calibration (reference pack and optics), where both modes agree. Fitting it
  // per setting would let three free lights absorb every filter and time change at the grey card.
  const xRef = refEnlarger.exposure(grey);
  const aimLights = (o.aim ?? 'grey-0.184') === 'grey-0.184' ? greyPatchX(xRef, xyzOfX, white, 0.184) : Lights.zero();
  const xOfDyes = (c: ArrayLike<number>, lights?: Lights): Vec3 => {
    const x = aimLights.apply(enlarger.exposure(c));
    return lights ? lights.apply(x) : x;
  };
  return {
    film, paper, enlarger, viewing, filtration, neutral, reference: { pack: refPack, enlarger: refEnlarger }, grey,
    aimLights, aimX: aimLights.apply(xRef), develop, xyzOfX, xOfDyes, white, paperWhite: paperWhiteXYZ(viewing),
    print(c, lights) {
      const x = xOfDyes(c, lights);
      const cp = develop(x);
      const XYZ = observe(viewing, reflectance(viewing, cp));
      return { x, cp, XYZ, lab: lab(XYZ, white), Dvis: -Math.log10(XYZ[1]) };
    },
  };
}

/** Lights that print paper exposure x as a neutral of the given reflectance (Chromogen greyPatch, LM in 3 unknowns). */
export function greyPatchX(x: ArrayLike<number>, xyzOfX: (x: ArrayLike<number>) => Vec3, white: Vec3, reflectanceTarget = 0.184): Lights {
  const r = lm((L) => {
    const X = xyzOfX([x[0]! + L[0]!, x[1]! + L[1]!, x[2]! + L[2]!]);
    return [X[0] / white[0] - reflectanceTarget, X[1] / white[1] - reflectanceTarget, X[2] / white[2] - reflectanceTarget];
  }, [0, 0, 0], { tol: 1e-20, maxIt: 100 });
  return Lights.fromLogH(r.x);
}

export type OutputSpace = 'srgb' | 'display-p3' | 'rec2020' | 'adobe-rgb' | 'prophoto';
const toRGB = (space: OutputSpace) => (space === 'display-p3' ? XYZ_TO_P3 : space === 'rec2020' ? XYZ_TO_REC2020 : XYZ_TO_SRGB);

/** Display transform for D65-relative XYZ: matrix → knee (last colour op) → OETF. */
export function displayEncode(XYZ_D65: ArrayLike<number>, space: OutputSpace = 'srgb', compress: CompressSpec = DEFAULT_COMPRESS): Vec3 {
  const lin = mulMV(toRGB(space), XYZ_D65);
  const k = compressOutput(lin, compress);
  // rec2020/adobe/prophoto use the sRGB OETF here; CHB-011 owns exact per-space encodings.
  return k.map(encodeSRGB) as Vec3;
}

/** XYZ under the viewing white → flare → Bradford to D65 → display. */
export function viewToDisplay(XYZ: ArrayLike<number>, viewWhite: ArrayLike<number>, o: { flare?: number; flareWhite?: ArrayLike<number>; to?: 'D65' | 'D50'; space?: OutputSpace; compress?: CompressSpec } = {}): Vec3 {
  const f = addFlare(XYZ, o.flare ?? 0, o.flareWhite ?? viewWhite);
  const a = adaptBradford(f, viewWhite, o.to === 'D50' ? D50 : D65);
  return displayEncode(o.to === 'D50' ? adaptBradford(a, D50, D65) : a, o.space ?? 'srgb', o.compress ?? DEFAULT_COMPRESS);
}

/** spektrafilm _compute_raw_preflash: φ_k = amount · H_k through the base alone (c = 0) with the filtered lamp. */
export function preflashPhi(enl: Enlarger, amount: number): Vec3 {
  return enl.exposure([0, 0, 0]).map((x) => amount * 10 ** x) as Vec3;
}

export { preflash };
