// Frame handles, host side (guide §5.2; contract 1.0 cuts): `cb.sel.frame(s).print()` in a viewer names the `print`
// cut of the frame's document, the node an agent's `frame.cut('print')` names. A handle is a plain frozen object; it
// compiles nothing. The render bridge lowers it: compile(doc) → the named cut → what is shown (display RGB).
//
// What a handle can name: a cut (source, scan or scene, negative, print, finished, display), an inspection view of
// the negative (negative, dyes, classes), a test strip (bands of the print, each its own document) and a ring-around
// tile (the print with the printer lights moved).
import type { CutName, Document, Vec3 } from '@chromobench/contract';
import { set } from '@chromobench/values';
import { edit } from '@chromobench/contract';
import { strip } from '@chromobench/shell';
import { LIGHTS, LIGHTS_PATH, layerOf, lightsOf } from './model/doc.ts';
import type { ViewMode } from './model/settings.ts';

/** The cuts a handle names (the frame vocabulary; `scan` is the scene for a camera file). */
export const ACCESSORS = ['source', 'scan', 'negative', 'print', 'finished', 'display'] as const;
export type Accessor = (typeof ACCESSORS)[number];

export type HandleWhat = Accessor | 'view' | 'testStrip' | 'ringTile';

/** A renderable: what the viewer and thumbnails show. */
export interface ImageHandle {
  readonly $: 'cb.image';
  readonly frame: string;
  /** the document to compile; 'initial' is resolved by the bridge (the document as the frame was opened) */
  readonly doc: Document | 'initial';
  readonly what: HandleWhat;
  readonly args: Readonly<Record<string, unknown>>;
  /** how the agent would write it: frame.cut('print') */
  readonly expr: string;
}

export interface FrameRef {
  readonly $: 'cb.frame';
  readonly frame: string;
  readonly doc: Document | 'initial';
  readonly expr: string;
  source(): ImageHandle;
  scan(): ImageHandle;
  negative(): ImageHandle;
  print(): ImageHandle;
  finished(): ImageHandle;
  display(): ImageHandle;
  view(mode: ViewMode): ImageHandle;
  testStrip(o?: { vary?: string; step?: number; count?: number }): ImageHandle;
  ringTile(offset: Vec3): ImageHandle;
  initial(): FrameRef;
  withDoc(d: Document, expr?: string): FrameRef;
}

export const isImageHandle = (x: unknown): x is ImageHandle => !!x && typeof x === 'object' && (x as ImageHandle).$ === 'cb.image';
export const isFrameRef = (x: unknown): x is FrameRef => !!x && typeof x === 'object' && (x as FrameRef).$ === 'cb.frame';

function image(ref: Pick<FrameRef, 'frame' | 'doc'>, what: HandleWhat, args: Record<string, unknown>, expr: string): ImageHandle {
  return Object.freeze({ $: 'cb.image' as const, frame: ref.frame, doc: ref.doc, what, args: Object.freeze({ ...args }), expr });
}

/** The cut a handle names (the bridge's named node; inspection views name the negative). */
export function cutOf(h: Pick<ImageHandle, 'what'>, kind: 'negative-scan' | 'digital-raw'): CutName {
  switch (h.what) {
    case 'source': return 'source';
    case 'scan': return kind === 'negative-scan' ? 'scan' : 'scene';
    case 'negative': case 'view': return 'negative';
    case 'finished': return 'finished';
    case 'display': return 'display';
    default: return 'print';
  }
}

export function frameRef(frame: string, doc: Document | 'initial', expr = 'frame'): FrameRef {
  const self: FrameRef = Object.freeze({
    $: 'cb.frame' as const,
    frame,
    doc,
    expr,
    source: () => image(self, 'source', {}, `${expr}.cut('source')`),
    scan: () => image(self, 'scan', {}, `${expr}.cut('scan')`),
    negative: () => image(self, 'negative', {}, `${expr}.cut('negative')`),
    print: () => image(self, 'print', {}, `${expr}.print()`),
    finished: () => image(self, 'finished', {}, `${expr}.finished()`),
    display: () => image(self, 'display', {}, `${expr}.display()`),
    view: (mode: ViewMode) => (mode === 'print' ? self.print() : image(self, 'view', { mode }, `${expr}.view('${mode}')`)),
    testStrip: (o: { vary?: string; step?: number; count?: number } = {}) => image(self, 'testStrip', { vary: o.vary ?? 'time', step: o.step ?? 1 / 3, count: o.count ?? 5 }, `cb.testStrip(${expr}, ${JSON.stringify(o)})`),
    ringTile: (offset: Vec3) => image(self, 'ringTile', { offset }, `${expr}.print() /* lights ${JSON.stringify(offset)} */`),
    initial: () => frameRef(frame, 'initial', `${expr}.initial()`),
    withDoc: (d: Document, e = expr) => frameRef(frame, d, e),
  });
  return self;
}

/** The document a handle compiles: the ring tile's lights offset applied (a what-if of the printer lights). */
export function effectiveDoc(h: ImageHandle, doc: Document): Document {
  const d = strip(doc);
  if (h.what !== 'ringTile') return d;
  if (!layerOf(d, LIGHTS)) return d;
  const o = h.args['offset'] as Vec3;
  const l = lightsOf(d).map((x, i) => Number(Math.min(1.5, Math.max(-1.5, x + o[i]!)).toFixed(6)));
  return edit(d, [set(LIGHTS_PATH, l)]).doc;
}
