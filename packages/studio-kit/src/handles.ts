// Frame handles, host side (guide §5.2): `cb.sel.frame(s).print()` in a viewer names the node `frame.print()` names in
// an agent eval. A handle is a plain frozen object; it compiles nothing. The render bridge lowers it.
//
// The accessor names and the print() options are the contract's shared frame vocabulary (contract 0.3,
// packages/contract/src/vocab.ts), the same module the DSL host uses.
import { ACCESSORS, PRINT_OPTION_PATHS, PRINT_OPTIONS, setPath, type Accessor, type FrameRecipe, type Vec3 } from '@chromobench/contract';
import type { ViewMode } from './model/recipes.ts';

export { ACCESSORS, PRINT_OPTIONS, type Accessor };
const OPTION_PATH = PRINT_OPTION_PATHS;

export type HandleWhat = Accessor | 'view' | 'testStrip' | 'ringTile';

/** A renderable: what the viewer and thumbnails show. */
export interface ImageHandle {
  readonly $: 'cb.image';
  readonly frame: string;
  /** the recipe to compile; 'initial' is resolved by the bridge from the frame's log */
  readonly recipe: FrameRecipe | 'initial';
  readonly what: HandleWhat;
  readonly args: Readonly<Record<string, unknown>>;
  /** how the agent would write it: frame.print({ time_s: 12 }) */
  readonly expr: string;
}

export interface FrameRef {
  readonly $: 'cb.frame';
  readonly frame: string;
  readonly recipe: FrameRecipe | 'initial';
  readonly expr: string;
  source(): ImageHandle;
  scan(): ImageHandle;
  negative(): ImageHandle;
  print(o?: Record<string, unknown>): ImageHandle;
  display(): ImageHandle;
  view(mode: ViewMode): ImageHandle;
  testStrip(o?: { vary?: string; step?: number; count?: number }): ImageHandle;
  ringTile(offset: Vec3): ImageHandle;
  /** The roll this frame belongs to (FrameRecipe.roll, contract 0.3): {id} or null; the roll kit's record is cb.kits.roll.of(state, id). */
  roll(): { readonly id: string } | null;
  initial(): FrameRef;
  withRecipe(r: FrameRecipe, expr?: string): FrameRef;
}

export const isImageHandle = (x: unknown): x is ImageHandle => !!x && typeof x === 'object' && (x as ImageHandle).$ === 'cb.image';
export const isFrameRef = (x: unknown): x is FrameRef => !!x && typeof x === 'object' && (x as FrameRef).$ === 'cb.frame';

const fmt = (o: Record<string, unknown>): string => (Object.keys(o).length ? JSON.stringify(o) : '');

function image(ref: Pick<FrameRef, 'frame' | 'recipe' | 'expr'>, what: HandleWhat, args: Record<string, unknown>, expr: string): ImageHandle {
  return Object.freeze({ $: 'cb.image' as const, frame: ref.frame, recipe: ref.recipe, what, args: Object.freeze({ ...args }), expr });
}

export function frameRef(frame: string, recipe: FrameRecipe | 'initial', expr = 'frame'): FrameRef {
  const self: FrameRef = Object.freeze({
    $: 'cb.frame' as const,
    frame,
    recipe,
    expr,
    source: () => image(self, 'source', {}, `${expr}.source()`),
    scan: () => image(self, 'scan', {}, `${expr}.scan()`),
    negative: () => image(self, 'negative', {}, `${expr}.negative()`),
    display: () => image(self, 'display', {}, `${expr}.display()`),
    print: (o: Record<string, unknown> = {}) => {
      for (const k of Object.keys(o)) if (!(k in PRINT_OPTIONS)) throw new Error(`print() has no option "${k}"; valid: ${Object.keys(PRINT_OPTIONS).join(', ')}`);
      return image(self, 'print', o, `${expr}.print(${fmt(o)})`);
    },
    view: (mode: ViewMode) => (mode === 'print' ? self.print() : image(self, 'view', { mode }, `${expr}.view('${mode}')`)),
    testStrip: (o: { vary?: string; step?: number; count?: number } = {}) => image(self, 'testStrip', { vary: o.vary ?? 'time', step: o.step ?? 1 / 3, count: o.count ?? 5 }, `cb.testStrip(${expr}, ${JSON.stringify(o)})`),
    ringTile: (offset: Vec3) => image(self, 'ringTile', { offset }, `${expr}.print({ lights: +${JSON.stringify(offset)} })`),
    roll: () => (recipe === 'initial' ? null : recipe.roll ?? null),
    initial: () => frameRef(frame, 'initial', `${expr}.initial()`),
    withRecipe: (r: FrameRecipe, e = expr) => frameRef(frame, r, e),
  });
  return self;
}

/** The recipe a handle compiles: print() options and the ring tile's lights offset applied (what-ifs). */
export function effectiveRecipe(h: ImageHandle, r: FrameRecipe): FrameRecipe {
  let out = r;
  if (h.what === 'print') for (const [k, v] of Object.entries(h.args)) out = setPath(out, OPTION_PATH[k]!, v);
  if (h.what === 'ringTile') {
    const o = h.args['offset'] as Vec3;
    const l = out.print.lights.logH;
    out = setPath(out, 'print.lights.logH', l.map((x, i) => Number((x + o[i]!).toFixed(6))));
  }
  return out;
}
