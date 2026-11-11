// The default Presenter: Canvas2D, sRGB. Images arrive as PresentImage (a bitmap fast path, or float/8-bit pixels
// that are converted once into an offscreen canvas) and are placed by their document region under the view
// transform. chromobench's studio passes its WebGPU Display-P3 presenter instead (services.presenter).

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Colours, PresentImage, Presenter, ViewTransform } from '../app/render/types.ts';

interface Prepared {
  img: PresentImage;
  src: CanvasImageSource | null;
}

const to8 = (v: number, float: boolean): number => (float ? Math.max(0, Math.min(255, Math.round(v * 255))) : v);

/** turn a PresentImage into something drawImage accepts (null when there is no 2D context, as in happy-dom) */
function prepare(img: PresentImage): CanvasImageSource | null {
  if (img.bitmap) return img.bitmap as CanvasImageSource;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext?.('2d');
  if (!g || typeof ImageData === 'undefined') return null;
  const n = img.width * img.height;
  const ch = img.channels;
  const d = img.data;
  const float = d instanceof Float32Array || d instanceof Float64Array;
  const shift = d instanceof Uint16Array ? 1 / 257 : 1;
  const out = new Uint8ClampedArray(n * 4);
  if (d.length >= n * ch)
    for (let i = 0; i < n; i++) {
      const r = to8(d[i * ch]! * shift, float);
      out[i * 4] = r;
      out[i * 4 + 1] = ch >= 3 ? to8(d[i * ch + 1]! * shift, float) : r;
      out[i * 4 + 2] = ch >= 3 ? to8(d[i * ch + 2]! * shift, float) : r;
      out[i * 4 + 3] = ch === 4 ? to8(d[i * ch + 3]! * shift, float) : 255;
    }
  g.putImageData(new ImageData(out, img.width, img.height), 0, 0);
  return c;
}

const css = (c: [number, number, number]): string => `rgb(${c.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255)).join(',')})`;

export class Canvas2DPresenter implements Presenter {
  readonly kind = '2d' as const;
  readonly colorSpace = 'srgb' as const;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private main: Prepared | null = null;
  private before: Prepared | null = null;
  private last: ViewTransform | null = null;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    let g: CanvasRenderingContext2D | null = null;
    try {
      g = canvas.getContext('2d');
    } catch {
      g = null;
    }
    this.g = g;
  }
  setImages(main: PresentImage, before: PresentImage | null): void {
    if (this.main?.img !== main) this.main = { img: main, src: prepare(main) };
    if (!before) this.before = null;
    else if (this.before?.img !== before) this.before = { img: before, src: prepare(before) };
  }
  clear(): void {
    this.main = null;
    this.before = null;
  }
  draw(view: ViewTransform, colours: Colours): void {
    this.last = view;
    const g = this.g;
    if (!g) return;
    const W = this.canvas.width / view.dpr;
    const H = this.canvas.height / view.dpr;
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    g.fillStyle = css(colours.stage);
    g.fillRect(0, 0, W, H);
    if (!this.main) return;
    const place = (p: Prepared): void => {
      if (!p.src) return;
      const r = p.img.region;
      const x = W / 2 + (r.x - view.cx) * view.zoom;
      const y = H / 2 + (r.y - view.cy) * view.zoom;
      g.imageSmoothingEnabled = view.zoom * view.dpr < 2.5;
      g.drawImage(p.src, x, y, r.w * view.zoom, r.h * view.zoom);
    };
    // the frame behind the picture
    const x0 = W / 2 - view.cx * view.zoom;
    const y0 = H / 2 - view.cy * view.zoom;
    g.fillStyle = css(colours.frame);
    g.fillRect(x0, y0, view.docW * view.zoom, view.docH * view.zoom);
    place(this.main);
    if (view.split != null && this.before) {
      const sx = view.split * W;
      g.save();
      g.beginPath();
      g.rect(0, 0, sx, H);
      g.clip();
      place(this.before);
      g.restore();
      g.fillStyle = '#fff';
      g.fillRect(sx - 0.5, y0, 1, view.docH * view.zoom);
    }
  }
  async readDocPixel(x: number, y: number): Promise<number[] | null> {
    const p = this.main;
    if (!p) return null;
    const r = p.img.region;
    const ix = Math.floor((x - r.x) * p.img.scale);
    const iy = Math.floor((y - r.y) * p.img.scale);
    if (ix < 0 || iy < 0 || ix >= p.img.width || iy >= p.img.height) return null;
    const ch = p.img.channels;
    const d = p.img.data;
    const float = d instanceof Float32Array || d instanceof Float64Array;
    const i = (iy * p.img.width + ix) * ch;
    if (i + ch > d.length) return null;
    const out: number[] = [];
    for (let k = 0; k < Math.min(3, ch); k++) out.push(to8(d[i + k]! * (d instanceof Uint16Array ? 1 / 257 : 1), float));
    return out;
  }
  /** the last view drawn (tests) */
  get view(): ViewTransform | null {
    return this.last;
  }
  dispose(): void {
    this.main = null;
    this.before = null;
  }
}
