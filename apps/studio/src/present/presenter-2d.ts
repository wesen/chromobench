// Canvas2D presenter: the fallback without WebGPU. Display P3 ImageData (8-bit), the same API
// Chromogen used for P3 export; the transform and split are done with drawImage and clipping.
import type { Colours, PresentImage, Presenter, ViewTransform } from './presenter.ts';

const css = (c: [number, number, number]): string => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')})`;

export class Canvas2dPresenter implements Presenter {
  readonly kind = '2d' as const;
  readonly colorSpace: 'display-p3' | 'srgb';
  readonly format = 'rgba8unorm';
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private main: { img: PresentImage; bmp: HTMLCanvasElement } | null = null;
  private before: HTMLCanvasElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    let ctx = canvas.getContext('2d', { colorSpace: 'display-p3' });
    this.colorSpace = ctx?.getContextAttributes().colorSpace === 'display-p3' ? 'display-p3' : 'srgb';
    ctx ??= canvas.getContext('2d');
    this.ctx = ctx!;
  }

  private bitmap(img: PresentImage): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext('2d', { colorSpace: this.colorSpace })!;
    const id = x.createImageData(img.width, img.height, { colorSpace: this.colorSpace });
    const ch = img.channels;
    for (let i = 0; i < img.width * img.height; i++) {
      for (let k = 0; k < 3; k++) id.data[i * 4 + k] = Math.round(Math.min(1, Math.max(0, img.data[i * ch + Math.min(k, ch - 1)]!)) * 255);
      id.data[i * 4 + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    return c;
  }

  setImages(main: PresentImage, before: PresentImage | null): void {
    this.main = { img: main, bmp: this.bitmap(main) };
    this.before = before ? this.bitmap(before) : null;
  }

  draw(v: ViewTransform, colours: Colours): void {
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = css(colours.stage);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!this.main) return;
    const s = v.zoom * v.dpr;
    const ox = canvas.width / 2 - v.cx * s;
    const oy = canvas.height / 2 - v.cy * s;
    const { img, bmp } = this.main;
    ctx.imageSmoothingEnabled = s < img.scale;
    const place = (b: HTMLCanvasElement): void => ctx.drawImage(b, ox + img.region.x * s, oy + img.region.y * s, img.region.w * s, img.region.h * s);
    place(bmp);
    if (v.split !== null && this.before) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, v.split * canvas.width, canvas.height);
      ctx.clip();
      place(this.before);
      ctx.restore();
    }
    ctx.strokeStyle = css(colours.frame);
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(ox) - 0.5, Math.round(oy) - 0.5, v.docW * s + 1, v.docH * s + 1);
    if (v.split !== null) {
      ctx.fillStyle = css(colours.frame);
      ctx.fillRect(Math.round(v.split * canvas.width), 0, 1, canvas.height);
    }
  }

  async readDocPixel(x: number, y: number): Promise<number[] | null> {
    if (!this.main) return null;
    const { img, bmp } = this.main;
    const tx = Math.floor((x - img.region.x) * img.scale);
    const ty = Math.floor((y - img.region.y) * img.scale);
    return Array.from(bmp.getContext('2d')!.getImageData(tx, ty, 1, 1).data.slice(0, 3));
  }

  dispose(): void {
    this.main = null;
  }
}
