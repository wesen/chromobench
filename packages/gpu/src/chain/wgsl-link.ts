// The kernels' module system (CHB-037 P3b): a WGSL file names what it needs with `//! include <name>` lines, and
// linkWgsl prepends each named module once (depth first, so a module's own includes come before it). A name is a
// file of packages/gpu/kernels/ or a generated module (GENERATED_WGSL: core's numbers as WGSL constants). The engine
// links its pipelines with it (chain/working.ts linkKernel, from the ?raw imports) and tools/wgsl-check links every
// kernel file the same way (from the file system), so the check compiles exactly what the engine compiles. No ?raw
// import here: Node (the check) loads this module as it is.
import { BLEND_MODES, CONTRAST_BLENDS, H_FLOOR, MASK_T_FLOOR, NON_SEPARABLE_BLENDS } from '@chromobench/contract';
import { OK_M1, OK_M1_INV, OK_M2, OK_M2_INV } from '@chromobench/core';

/** A WGSL mat3x3<f32> literal of a row-major matrix (WGSL constructs column by column). */
export const wgslMat3 = (M: readonly (readonly number[])[]): string =>
  `mat3x3<f32>(${[0, 1, 2].map((c) => `vec3<f32>(${M[0]![c]}, ${M[1]![c]}, ${M[2]![c]})`).join(', ')})`;

/** Modules without a file: core's matrices (composite/working.ts) as WGSL constants, one definition for both engines. */
export const GENERATED_WGSL: Readonly<Record<string, string>> = {
  'working-constants': [
    `const WK_M1 = ${wgslMat3(OK_M1)};`,
    `const WK_M1I = ${wgslMat3(OK_M1_INV)};`,
    `const OK_M2 = ${wgslMat3(OK_M2)};`,
    `const OK_M2I = ${wgslMat3(OK_M2_INV)};`,
  ].join('\n'),
  // the blend codes (the mode's index in the contract's BLEND_MODES: chain/working.ts blendCode), the first non-separable
  // one, and which modes are evaluated in the display encoding (D7)
  'blend-codes': [
    ...BLEND_MODES.map((m, i) => `const BL_${m.toUpperCase().replace(/-/g, '_')}: u32 = ${i}u;`),
    `const BL_FIRST_NONSEP: u32 = ${Math.min(...NON_SEPARABLE_BLENDS.map((m) => BLEND_MODES.indexOf(m)))}u;`,
    `fn blContrast(mode: u32) -> bool { return ${CONTRAST_BLENDS.map((m) => `mode == BL_${m.toUpperCase().replace(/-/g, '_')}`).join(' || ')}; }`,
  ].join('\n'),
  // the contract's floors (pixel.ts): the light law's H_FLOOR, the density mask's MASK_T_FLOOR
  'contract-constants': [
    `const H_FLOOR: f32 = ${H_FLOOR};`,
    `const MASK_T_FLOOR: f32 = ${MASK_T_FLOOR};`,
  ].join('\n'),
};

const INCLUDE = /^\/\/! include (\S+)\s*$/gm;

/** The names a WGSL text includes, in order. */
export const includesOf = (code: string): string[] => [...code.matchAll(INCLUDE)].map((m) => m[1]!);

/** `code` with every module it includes (transitively, each once) prepended; `read` returns a kernel file's text. */
export function linkWgsl(code: string, read: (name: string) => string): string {
  const done = new Set<string>();
  const parts: string[] = [];
  const visit = (src: string): void => {
    for (const name of includesOf(src)) {
      if (done.has(name)) continue;
      done.add(name);
      const dep = GENERATED_WGSL[name] ?? read(name);
      visit(dep);
      parts.push(dep);
    }
  };
  visit(code);
  return [...parts, code].join('\n');
}
