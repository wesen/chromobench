// Missing-data convention (guide §6). Packs keep NaN; the loader applies one declared policy and
// returns values with NaN replaced by a number plus a validity mask, so no consumer ever does
// arithmetic on NaN or infinities.
//
//   opaque        (default, spektrafilm): a missing density transmits no light → valid = 0 there.
//   zero-density  (Chromogen's reading, parity tests only): missing density = 0 D, valid = 1.
//   extend-flat   (experiments only): fill with the nearest measured value, valid = 1.
//
// Log sensitivities are a different kind: a missing sensitivity is zero sensitivity under every
// policy (spektrafilm nan_to_num after 10^x), so they are never extended.

export type MissingPolicy = 'opaque' | 'zero-density' | 'extend-flat';
export const MISSING_POLICIES: readonly MissingPolicy[] = ['opaque', 'zero-density', 'extend-flat'];

export type SpectrumUnit = 'D' | 'log10' | 'relMean1' | 'relPeak' | 'fraction' | 'cmf' | 'responsivity' | 'nm';

/** A spectrum on the 380–780 nm / 5 nm grid. */
export interface Spectrum81 {
  /** Missing samples hold a number chosen by the policy (0 unless extend-flat); read through `valid`. */
  values: Float64Array;
  /** 1 where the value may be used; 0 where the policy says "no light passes" or "not measured". */
  valid: Uint8Array;
  unit: SpectrumUnit;
}

/** Density semantics: NaN handled per policy. */
export function densitySpectrum(raw: ArrayLike<number>, policy: MissingPolicy, unit: SpectrumUnit = 'D'): Spectrum81 {
  const n = raw.length;
  const values = new Float64Array(n);
  const valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = raw[i]!;
    if (Number.isFinite(v)) {
      values[i] = v;
      valid[i] = 1;
    } else if (policy === 'zero-density') {
      values[i] = 0;
      valid[i] = 1;
    }
  }
  if (policy === 'extend-flat') {
    const known: number[] = [];
    for (let i = 0; i < n; i++) if (valid[i]) known.push(i);
    if (known.length) {
      for (let i = 0; i < n; i++) {
        if (valid[i]) continue;
        let best = known[0]!;
        for (const k of known) if (Math.abs(k - i) < Math.abs(best - i)) best = k;
        values[i] = values[best]!;
        valid[i] = 1;
      }
    }
  }
  return { values, valid, unit };
}

/** Values where a missing sample means "not there" (sensitivity, responsivity, filters): 0, valid 0. */
export function zeroWhereMissing(raw: ArrayLike<number>, unit: SpectrumUnit): Spectrum81 {
  const n = raw.length;
  const values = new Float64Array(n);
  const valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = raw[i]!;
    if (Number.isFinite(v)) {
      values[i] = v;
      valid[i] = 1;
    }
  }
  return { values, valid, unit };
}

/** Linear sensitivity 10^log10S with missing → 0 (zero sensitivity, under every policy). */
export function linearSensitivity(log10S: Spectrum81): Spectrum81 {
  const values = log10S.values.map((v, i) => (log10S.valid[i] ? 10 ** v : 0));
  return { values, valid: log10S.valid.slice(), unit: 'fraction' };
}

/** valid of a sum of spectra: a sample is usable only if every term is. */
export function andValid(...s: Spectrum81[]): Uint8Array {
  const n = s[0]!.valid.length;
  const out = new Uint8Array(n).fill(1);
  for (const x of s) for (let i = 0; i < n; i++) out[i] = out[i]! & x.valid[i]!;
  return out;
}

/** Transmittance 10^−D where valid, exactly 0 where not (the opaque reading). */
export function transmittance(D: ArrayLike<number>, valid: ArrayLike<number>, out = new Float64Array(D.length)): Float64Array {
  for (let i = 0; i < D.length; i++) out[i] = valid[i] ? 10 ** -D[i]! : 0;
  return out;
}
