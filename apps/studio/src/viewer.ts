// Renders a display-rgb node into a canvas. "Last request wins": a new render aborts the previous one.
import { ChromobenchError, type Engine, type Node } from '@chromobench/contract';

export class Viewer {
  private ac: AbortController | null = null;
  /** Float samples of the last completed render (for tests and the densitometer). */
  last: { node: string; width: number; height: number; data: ArrayLike<number> } | null = null;
  renders = 0;

  private readonly canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async render(engine: Engine, node: Node): Promise<boolean> {
    this.ac?.abort();
    const ac = new AbortController();
    this.ac = ac;
    try {
      const r = await engine.evaluate(node, { scale: 'full', precision: 'preview', signal: ac.signal });
      const data = await r.read();
      if (ac.signal.aborted) return false;
      const c = r.info.channels;
      this.canvas.width = r.width;
      this.canvas.height = r.height;
      const ctx = this.canvas.getContext('2d')!;
      const img = ctx.createImageData(r.width, r.height);
      for (let i = 0; i < r.width * r.height; i++) {
        for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.round(Math.min(1, Math.max(0, data[i * c + Math.min(k, c - 1)]!)) * 255);
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      this.last = { node: node.id, width: r.width, height: r.height, data };
      this.renders++;
      return true;
    } catch (e) {
      if (e instanceof ChromobenchError && e.code === 'E_CANCELLED') return false;
      throw e;
    }
  }
}
