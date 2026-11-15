/// <reference types="@webgpu/types" />
// The presenter the studio hands the shell (services.presenter, one per viewport): CHB-009's WebGPU presenter on
// one shared device, falling back to the shell's Canvas2D presenter when WebGPU is not wanted (?canvas2d), not
// available, or the device is lost (a driver reset; headless SwiftShader loses it on the first canvas present).
// A canvas keeps its first context, so the fallback swaps in a fresh canvas element in the same place and keeps its
// size in step with the one the viewport lays out.
import { Canvas2DPresenter } from '@chromobench/shell/dom';
import type { Colours, PresentImage, Presenter, ViewTransform } from '@chromobench/shell';
import type { CanvasSpace } from '@chromobench/output';
import type { Journal } from '@chromobench/shell';
import { WebGpuPresenter } from './presenter-webgpu.ts';
import { watchDevice } from '../host/capture.ts';
import type { PresentImage as GpuImage } from './presenter.ts';

export interface PresenterHost {
  /** the shared device, or null for Canvas2D only */
  device: GPUDevice | null;
  /** the space a new presenter shows in, and a change of it (the display's gamut, a fallback to sRGB) */
  onSpace(space: CanvasSpace, why: string): void;
}

/** A WebGPU device for presentation, or null (no adapter, or refused); its errors and its loss go to the journal. */
export async function presentDevice(journal: Journal): Promise<GPUDevice | null> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) return null;
  try {
    const adapter = await gpu.requestAdapter();
    const device = adapter ? await adapter.requestDevice() : null;
    if (device) watchDevice(journal, device, adapter, 'presenter');
    else journal.warn('gpu', 'no WebGPU adapter for the viewer: it draws with Canvas2D', { code: 'PRESENTER_NO_ADAPTER' });
    return device;
  } catch (e) {
    journal.warn('gpu', `the viewer's WebGPU device was refused: ${(e as Error)?.message ?? e}`, { code: 'PRESENTER_NO_DEVICE', data: e });
    return null;
  }
}

class HostPresenter implements Presenter {
  private inner: Presenter;
  private canvas: HTMLCanvasElement;
  private readonly laidOut: HTMLCanvasElement;
  private last: { main: PresentImage; before: PresentImage | null } | null = null;
  private view: { v: ViewTransform; c: Colours } | null = null;

  constructor(canvas: HTMLCanvasElement, host: PresenterHost) {
    this.canvas = this.laidOut = canvas;
    const gpu = host.device ? WebGpuPresenter.onDevice(canvas, host.device, { onSpace: (s) => host.onSpace(s, 'display') }) : null;
    if (gpu) {
      gpu.onLost = (msg) => this.fallBack(host, `WebGPU device lost (${msg || 'no reason given'}); presenting with Canvas2D`);
      this.inner = gpu as unknown as Presenter;
    } else this.inner = new Canvas2DPresenter(canvas);
  }

  get kind(): Presenter['kind'] {
    return this.inner.kind;
  }
  get colorSpace(): Presenter['colorSpace'] {
    return this.inner.colorSpace;
  }
  get format(): string {
    return this.inner.format ?? (this.inner.kind === '2d' ? '2d' : '');
  }

  private fallBack(host: PresenterHost, why: string): void {
    const fresh = document.createElement('canvas');
    fresh.className = this.laidOut.className;
    this.laidOut.replaceWith(fresh);
    this.canvas = fresh;
    this.inner = new Canvas2DPresenter(fresh);
    host.onSpace('srgb', why);
    if (this.last) this.setImages(this.last.main, this.last.before);
    if (this.view) this.draw(this.view.v, this.view.c);
  }

  setImages(main: PresentImage, before: PresentImage | null): void {
    this.last = { main, before };
    if (this.inner instanceof WebGpuPresenter) this.inner.setImages(main as unknown as GpuImage, before as unknown as GpuImage | null);
    else this.inner.setImages(main, before);
  }

  draw(view: ViewTransform, colours: Colours): void {
    this.view = { v: view, c: colours };
    if (this.canvas !== this.laidOut) {
      // the viewport lays out the canvas it made; the replacement follows it
      if (this.canvas.width !== this.laidOut.width) this.canvas.width = this.laidOut.width;
      if (this.canvas.height !== this.laidOut.height) this.canvas.height = this.laidOut.height;
      this.canvas.style.width = this.laidOut.style.width;
      this.canvas.style.height = this.laidOut.style.height;
    }
    this.inner.draw(view, colours);
  }

  readDocPixel(x: number, y: number): Promise<number[] | null> {
    return this.inner.readDocPixel(x, y);
  }

  dispose(): void {
    this.inner.dispose();
  }
}

/** services.presenter for mountStudio */
export const hostPresenter = (host: PresenterHost) => (canvas: unknown): Presenter => new HostPresenter(canvas as HTMLCanvasElement, host);
