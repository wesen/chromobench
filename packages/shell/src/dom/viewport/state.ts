// The viewport's vocabulary and the state its modules share: the zoom levels and modes, the API it registers
// (DomViewport), the local view state V, and ViewportParts, what the entry hands to every module.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NodeData } from '../../ir/node.ts';
import type { Store } from '../../core/store.ts';
import type { Runtime, ViewportApi } from '../../app/runtime.ts';
import type { Colours, PresentImage, Presenter } from '../../app/render/types.ts';
import type { MountCtx } from '../mount.ts';

export const ZOOMS = [1 / 16, 1 / 12, 1 / 8, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 2, 3, 4, 8, 11];
export type Zoom = 'fit' | 'fill' | number;
export type Compare = 'off' | 'before' | 'split' | 'lr' | 'tb';

/**
 * A cover: a one-channel render (coverage 0…1, the first channel) shown over the picture under the same view
 * transform (a mask overlay). `tint`: the colour where the coverage is, at opacity × coverage; `inverse`: the colour
 * where it is not; `mask`: the coverage alone as opaque grey (white = 1). Colour and opacity change without a render.
 */
export interface Cover {
  image: unknown;
  mode?: 'tint' | 'inverse' | 'mask';
  /** sRGB 0…1 (default red) */
  colour?: [number, number, number];
  /** 0…1 (default 0.5) */
  opacity?: number;
}

export interface DomViewport extends ViewportApi {
  readonly el: HTMLElement;
  readonly presenter: Presenter;
  /** document pixels ↔ screen */
  docToScreen(x: number, y: number): [number, number];
  screenToDoc(sx: number, sy: number): [number, number];
  /** what is shown now: the render, its pass and its key */
  shown(): { image: PresentImage | null; pass: string | null; key: string | null };
  /** the cover shown now (a mask overlay): its render, its key and how it is painted; image null when none */
  cover(): { image: PresentImage | null; key: string | null; style: Omit<Cover, 'image'> | null };
  flash(text: string, kind?: string): void;
}

/** the local view state (V): sizes, transform, the shown renders, and the view read from state */
export function viewState() {
  return {
    W: 0,
    H: 0,
    dpr: 1,
    nw: 0,
    nh: 0,
    s: 1,
    ox: 0,
    oy: 0,
    after: null as PresentImage | null,
    before: null as PresentImage | null,
    pass: null as string | null,
    zoom: 'fit' as Zoom,
    cx: 0.5,
    cy: 0.5,
    compare: 'off' as Compare,
    split: 0.5,
    key: null as string | null,
    fullKey: null as string | null,
    tool: null as string | null,
    dims: null as [number, number] | null,
    /** the cover's render, its key, and how it is painted (null: no cover) */
    cover: null as PresentImage | null,
    coverKey: null as string | null,
    coverStyle: null as Omit<Cover, 'image'> | null,
  };
}
type ViewState = ReturnType<typeof viewState>;

/** what the entry hands to every module of the viewport (the names the closure had) */
export interface ViewportParts {
  n: NodeData;
  m: MountCtx;
  p: Record<string, any>;
  rt: Runtime<any>;
  st: Store;
  vid: string;
  el: HTMLElement;
  cv: HTMLCanvasElement;
  /** the cover's canvas, above the presenter's */
  cc: HTMLCanvasElement;
  ov: SVGElement;
  lab: HTMLElement;
  busy: HTMLElement;
  msg: HTMLElement;
  /** the zoom readout, or null where the viewport shows none (small, zoomReadout: false) */
  zoom: HTMLElement | null;
  presenter: Presenter;
  colours: Colours;
  fixedStage: [number, number, number] | null;
  themeStage: () => [number, number, number];
  viewPath: string[];
  V: ViewState;
  api: DomViewport;
}
