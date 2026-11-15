// The stack kit's editors' numbers (EditorMath) from packages/core: what a host passes as the service `editorMath`.
// The curve an editor draws is core's curve, the eyedropper's OkLab is core's encoding of the cut a colour mask reads.
// The dev host and the tests use this file; apps/studio's host file (engines.ts) builds the same object.
import { applyEncode, encodeTransform, evalCurve, evalLevels, toneCurve } from '@chromobench/core';
import type { EditorMath } from '../kits/stack/src/index.ts';

export function editorMath(): EditorMath {
  return {
    curve: (points) => {
      const c = toneCurve(points);
      return (x) => evalCurve(c, x);
    },
    levels: (l) => (x) => evalLevels(l, x),
    encode: (from, to, white) => {
      const t = encodeTransform(from, to, white);
      return (v) => applyEncode(t, v) as [number, number, number];
    },
  };
}
