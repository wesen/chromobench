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

export interface DomViewport extends ViewportApi {
  readonly el: HTMLElement;
  readonly presenter: Presenter;
  /** document pixels ↔ screen */
  docToScreen(x: number, y: number): [number, number];
  screenToDoc(sx: number, sy: number): [number, number];
  /** what is shown now: the render, its pass and its key */
  shown(): { image: PresentImage | null; pass: string | null; key: string | null };
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
  ov: SVGElement;
  lab: HTMLElement;
  busy: HTMLElement;
  msg: HTMLElement;
  presenter: Presenter;
  colours: Colours;
  fixedStage: [number, number, number] | null;
  themeStage: () => [number, number, number];
  viewPath: string[];
  V: ViewState;
  api: DomViewport;
}
