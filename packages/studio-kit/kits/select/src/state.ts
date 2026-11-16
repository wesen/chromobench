// cb.kits.select: the kit's view state (never undone, never saved with a document): the magic wand's options, the
// mask the selection tools last drew (Use Selection as Mask copies it; a pointer, not pixels: D3, no selection state),
// and the corners of a polygonal lasso being clicked.
import type { MaskCombine } from '@chromobench/contract';
import type { Id } from '@chromobench/values';

export interface SelectView {
  /** the magic wand's tolerance (0…1 of the image's range) and whether it selects only what is connected */
  tolerance: number;
  contiguous: boolean;
  /** the mask the selection tools or commands last drew or changed */
  last: { f: string; mask: Id } | null;
  /** a polygonal lasso's corners so far (picture px) */
  poly: { f: string | null; points: number[][]; combine: MaskCombine } | null;
}
export const SELECT_STATE: { select: SelectView } = { select: { tolerance: 0.1, contiguous: true, last: null, poly: null } };
