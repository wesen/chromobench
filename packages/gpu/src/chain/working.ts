// The WGSL of the working encodings and blend modes (kernels/working.wgsl) with core's matrices as constants
// (core composite/working.ts): one definition of OkLab and the working RGB for both engines. The pointwise and
// combine kernels include it (`//! include working.wgsl`, linked by linkKernel).
import { BLEND_MODES, encodingOfDomain, type BlendMode, type Domain } from '@chromobench/contract';
import workingCode from '../../kernels/working.wgsl?raw';
import type { Mat3 } from '../tables/inputs.ts';
import { linkWgsl } from './wgsl-link.ts';

export { wgslMat3 } from './wgsl-link.ts';

/** The kernel files other kernels include (`//! include <file>`, chain/wgsl-link.ts). */
const KERNEL_FILES: Readonly<Record<string, string>> = { 'working.wgsl': workingCode };

/** A kernel's WGSL with the modules it includes prepended (the engine's pipelines compile this). */
export function linkKernel(code: string): string {
  return linkWgsl(code, (name) => {
    const f = KERNEL_FILES[name];
    if (f === undefined) throw new Error(`WGSL include ${name}: not a kernel module (chain/working.ts KERNEL_FILES)`);
    return f;
  });
}

/** kernels/working.wgsl linked with its constants (tests). */
export const WORKING_WGSL: string = linkKernel(workingCode);

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
