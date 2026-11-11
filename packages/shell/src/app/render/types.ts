// Pluggable rendering: the program says *what* to show (a τ lambda returning a renderable); services say *how*.
//
//   RenderBridge  identifies and renders a renderable (studio-kit: compile(recipe) + Engine.evaluate; the demo: a
//                 procedural gradient). Equal keys mean the same pixels.
//   Presenter     places images on a canvas (CHB-009's WebGPU Display-P3 presenter, or the Canvas2D default).
//                 Structurally identical to apps/studio/src/present/presenter.ts, with shell-local types.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PresentImage {
  width: number;
  height: number;
  channels: number;
  data: Float32Array | Float64Array | Uint16Array | Uint8ClampedArray;
  /** document region covered */
  region: Rect;
  /** engine px per document px */
  scale: number;
  /** fast path for the Canvas2D default */
  bitmap?: unknown;
}

export interface ViewTransform {
  docW: number;
  docH: number;
  /** document point at the canvas centre and CSS px per document px */
  cx: number;
  cy: number;
  zoom: number;
  dpr: number;
  /** split position as a fraction of the canvas width (before on the left), or null */
  split: number | null;
}

export interface Colours {
  stage: [number, number, number];
  frame: [number, number, number];
}

export interface Presenter {
  readonly kind: 'webgpu' | '2d';
  readonly colorSpace: 'display-p3' | 'srgb';
  readonly format?: string;
  setImages(main: PresentImage, before: PresentImage | null): void;
  draw(view: ViewTransform, colours: Colours): void;
  /** the 8-bit value presented for one document pixel */
  readDocPixel(x: number, y: number): Promise<number[] | null>;
  dispose(): void;
}

export type RenderPass = 'draft' | 'screen' | 'refine';
export type Lane = 'live' | 'bg';

export interface RenderTarget {
  slot: string;
  epoch: number;
  lane: Lane;
  pass: RenderPass;
  /** the long side of the wanted image, in engine pixels */
  maxSide: number;
  region?: Rect;
  signal: AbortSignal;
}

export interface Rendered {
  image: PresentImage;
  /** the source (document) size */
  srcW: number;
  srcH: number;
  ms: number;
}

export interface RenderBridge<R = unknown> {
  readonly id: string;
  isRenderable(x: unknown): x is R;
  /** equal keys ⇒ same pixels (the content address in chromobench) */
  key(r: R): string;
  render(r: R, t: RenderTarget): Promise<Rendered>;
  naturalSize?(r: R): [number, number] | null;
  /** close bitmaps, free textures on eviction */
  release?(x: Rendered): void;
  explain?(r: R): string;
}
