// The WGSL of the working encodings and blend modes (kernels/working.wgsl) with core's matrices as constants
// (core composite/working.ts): one definition of OkLab and the working RGB for both engines. Prepended to the
// pointwise and combine kernels.
import { BLEND_MODES, encodingOfDomain, type BlendMode, type Domain } from '@chromobench/contract';
import { OK_M1, OK_M1_INV, OK_M2, OK_M2_INV } from '@chromobench/core';
import workingCode from '../../kernels/working.wgsl?raw';
import type { Mat3 } from '../tables/inputs.ts';

/** A WGSL mat3x3<f32> literal of a row-major matrix (WGSL constructs column by column). */
export const wgslMat3 = (M: readonly (readonly number[])[]): string =>
  `mat3x3<f32>(${[0, 1, 2].map((c) => `vec3<f32>(${M[0]![c]}, ${M[1]![c]}, ${M[2]![c]})`).join(', ')})`;

export const WORKING_WGSL: string = [
  `const WK_M1 = ${wgslMat3(OK_M1)};`,
  `const WK_M1I = ${wgslMat3(OK_M1_INV)};`,
  `const OK_M2 = ${wgslMat3(OK_M2)};`,
  `const OK_M2I = ${wgslMat3(OK_M2_INV)};`,
  workingCode,
].join('\n');

/** The blend code of kernels/working.wgsl: the mode's index in BLEND_MODES. */
export const blendCode = (b: unknown): number => {
  const i = BLEND_MODES.indexOf(b as BlendMode);
  return i < 0 ? 0 : i;
};

/** The encoding code of a mix's domain: 1 linear RGB, 2 OkLab, 0 anything else (normal blends only). */
export function encodingCode(d: Domain): number {
  const e = encodingOfDomain(d)?.encoding;
  return e === 'linear' ? 1 : e === 'oklab' ? 2 : 0;
}

/** Row-major 3 × 3 → 9 floats. */
export const flat3 = (M: Mat3 | readonly (readonly number[])[]): number[] => [...M[0]!, ...M[1]!, ...M[2]!];
