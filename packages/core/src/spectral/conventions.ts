// Physics conventions (guide §5.2): the textbook's numbers were computed under two sets of choices,
// Chromogen's and spektrafilm's. A golden number is reproducible only under its own conventions,
// so they are one explicit, versioned object. The contract's `PhysicsConventions` (engine.ts) carries
// only the version string; this is the full set behind that string.

export interface Conventions {
  /** Missing spectral samples: no light (spektrafilm) or zero density (Chromogen). */
  nan: 'opaque' | 'zero';
  /** Tabulated CIE 1931 2°, or Chromogen's Gaussian fit (legacy, tests only). */
  cmf: 'cie1931-2deg' | 'chromogen-fit';
  /** spektrafilm develop() subtracts each film curve's minimum. */
  curveMin: 'subtract' | 'keep';
  /** Paper curve: fitted 3-CDF model or the 256-point table. */
  paperCurve: 'model-3cdf' | 'table';
  printNormalise: 'midgray-geomean' | 'none';
  version: 1;
}

export const SPEKTRAFILM: Conventions = Object.freeze({
  nan: 'opaque', cmf: 'cie1931-2deg', curveMin: 'subtract', paperCurve: 'model-3cdf', printNormalise: 'midgray-geomean', version: 1,
});
/**
 * Chromogen's choices, kept to reproduce the textbook's Chromogen numbers: the golden tests
 * (packages/core/test/ch*.golden.test.ts, chb010.*) and the law harnesses in src/laws/ that compare both
 * conventions. No engine or host selects them: engines run DEFAULT_CONVENTIONS, and the fitted CMFs
 * ('chromogen-fit', spectrum.ts cmfChromogenFit) are reached only through this object.
 */
export const CHROMOGEN: Conventions = Object.freeze({
  nan: 'zero', cmf: 'chromogen-fit', curveMin: 'keep', paperCurve: 'table', printNormalise: 'none', version: 1,
});
export const DEFAULT_CONVENTIONS = SPEKTRAFILM;

/** Stable string for EngineCaps.conventions and TableKey.conventions. */
export function conventionsKey(c: Conventions): string {
  return `core-v${c.version}:${c.nan}/${c.cmf}/${c.curveMin}/${c.paperCurve}/${c.printNormalise}`;
}

