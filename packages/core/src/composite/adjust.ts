// The digital adjustments of the composite stages (contract catalog/adjust.ts), f64, per pixel; packages/gpu mirrors
// them in WGSL with parameters prepared by the same functions. Editor lab's versions (src/engine.js:231–275) work on
// sRGB numbers; these are re-defined in linear RGB (exposure, mixer, vignette) and OkLab/OkLCh (hsl, vibrance, grade).

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
export { smooth as smoothstep };

const DEG = Math.PI / 180;

// ---- hsl ------------------------------------------------------------------------------------------------------

/** Chroma below which a pixel counts as neutral: hue bands fade out towards it (no hue noise on greys). */
export const HSL_NEUTRAL_CHROMA = 0.04;

/** A band prepared for evaluation: its centre's direction, cos of its width, and its changes (hue in radians). */
export interface HslBand { cx: number; cy: number; cosW: number; hue: number; sat: number; light: number }

export function hslBands(bands: readonly Record<string, number>[]): HslBand[] {
  return bands.map((b) => ({
    cx: Math.cos(b['centre_deg']! * DEG), cy: Math.sin(b['centre_deg']! * DEG), cosW: Math.cos(b['width_deg']! * DEG),
    hue: b['hue_deg']! * DEG, sat: b['saturation']!, light: b['lightness']!,
  }));
}

/** hsl on one OkLab pixel (in place). */
export function hslAt(px: Float64Array | number[], bands: readonly HslBand[]): void {
  const a = px[1]!, b = px[2]!;
  const C = Math.hypot(a, b);
  if (!(C > 0)) return;
  const ca = a / C, sa = b / C;
  let sw = 0, dh = 0, ds = 0, dl = 0;
  for (const q of bands) {
    const w = smooth(q.cosW, 1, ca * q.cx + sa * q.cy);
    sw += w; dh += w * q.hue; ds += w * q.sat; dl += w * q.light;
  }
  const k = smooth(0, HSL_NEUTRAL_CHROMA, C) / Math.max(1, sw);
  const th = k * dh;
  const C2 = C * Math.max(0, 1 + k * ds);
  const c = Math.cos(th), s = Math.sin(th);
  px[0] = px[0]! + 0.25 * k * dl;
  px[1] = C2 * (ca * c - sa * s);
  px[2] = C2 * (sa * c + ca * s);
}

// ---- vibrance -------------------------------------------------------------------------------------------------

/** Chroma at which vibrance stops acting (about the largest chroma of sRGB primaries in OkLab). */
export const VIBRANCE_CHROMA = 0.3;

/** The chroma gain of vibrance v and saturation s at chroma C. */
export function vibranceGain(C: number, v: number, s: number): number {
  const u = 1 - C / VIBRANCE_CHROMA;
  return (C < VIBRANCE_CHROMA ? 1 + v * u * u : 1) * (1 + s);
}

export function vibranceAt(px: Float64Array | number[], v: number, s: number): void {
  const g = vibranceGain(Math.hypot(px[1]!, px[2]!), v, s);
  px[1] = px[1]! * g;
  px[2] = px[2]! * g;
}

// ---- grade ----------------------------------------------------------------------------------------------------

/** A colour-grading wheel prepared: its tint at L = 1 as an (a, b) offset, and its lightness change. */
export interface GradeWheels { tint: [number, number][]; light: number[]; exponent: number }

export function gradeWheels(p: Readonly<Record<string, unknown>>): GradeWheels {
  const wheels = ['shadows', 'midtones', 'highlights'];
  return {
    tint: wheels.map((w) => {
      const h = (p[`${w}Hue_deg`] as number) * DEG, c = p[`${w}Chroma`] as number;
      return [c * Math.cos(h), c * Math.sin(h)];
    }),
    light: wheels.map((w) => p[`${w}Lightness`] as number),
    exponent: 2 ** -(p['balance'] as number),
  };
}

/** grade on one OkLab pixel (in place): Bernstein weights of t = clamp(L, 0, 1)^(2^−balance). */
export function gradeAt(px: Float64Array | number[], g: GradeWheels): void {
  const L = px[0]!;
  const t = Math.min(1, Math.max(0, L)) ** g.exponent;
  const w = [(1 - t) * (1 - t), 2 * t * (1 - t), t * t];
  const f = Math.max(L, 0);
  let da = 0, db = 0, dl = 0;
  for (let k = 0; k < 3; k++) {
    da += w[k]! * g.tint[k]![0];
    db += w[k]! * g.tint[k]![1];
    dl += w[k]! * g.light[k]!;
  }
  px[0] = L + 0.25 * dl;
  px[1] = px[1]! + f * da;
  px[2] = px[2]! + f * db;
}

// ---- mixer, exposure, vignette (linear RGB) -----------------------------------------------------------------------

/** The mixer's 3 × 3 matrix (rows: output R, G, B); monochrome repeats the grey weights in every row. */
export function mixerMatrix(p: Readonly<Record<string, unknown>>): [number[], number[], number[]] {
  if (p['monochrome']) {
    const g = [...(p['grey'] as number[])];
    return [g, [...g], [...g]];
  }
  return [[...(p['red'] as number[])], [...(p['green'] as number[])], [...(p['blue'] as number[])]];
}

/**
 * The vignette's exposure factor at frame pixel centre (X, Y) of a W × H frame: ρ = 1 at the corners on the frame's
 * ellipse, t = smoothstep(size, size + feather·(1 − size), ρ) (a step when that width is 0), gain 2^(stops·t).
 */
export function vignetteGain(X: number, Y: number, W: number, H: number, stops: number, size: number, feather: number): number {
  const dx = (X - W / 2) / (W / 2), dy = (Y - H / 2) / (H / 2);
  const rho = Math.sqrt((dx * dx + dy * dy) / 2);
  const e1 = size + feather * (1 - size);
  const t = e1 - size > 1e-6 ? smooth(size, e1, rho) : rho >= size ? 1 : 0;
  return 2 ** (stops * t);
}
