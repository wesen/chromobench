// A procedural render bridge for the demo: { fake: true, name, w, h, exposure, contrast, temp, tint, saturation }
// becomes a gradient with a few shapes, rendered at the size the viewport asks for (drafts are small, refine
// renders the visible region at full resolution). A little latency per megapixel makes the draft/screen passes
// visible. studio-kit's bridge does the same job with compile(recipe) + Engine.evaluate.

import type { PresentImage, RenderBridge, RenderTarget, Rendered } from '../src/index.ts';

export interface Picture {
  fake: true;
  name: string;
  w?: number;
  h?: number;
  exposure?: number;
  contrast?: number;
  temp?: number;
  tint?: number;
  saturation?: number;
}

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
};

export function gradientBridge(o: { msPerMP?: number } = {}): RenderBridge<Picture> & { renders: number } {
  const msPerMP = o.msPerMP ?? 30;
  const b = {
    id: 'gradient',
    renders: 0,
    isRenderable: (x: unknown): x is Picture => !!x && typeof x === 'object' && (x as Picture).fake === true,
    key: (r: Picture) => JSON.stringify(r),
    naturalSize: (r: Picture): [number, number] => [r.w ?? 1200, r.h ?? 800],
    async render(r: Picture, t: RenderTarget): Promise<Rendered> {
      const t0 = performance.now();
      const W = r.w ?? 1200;
      const H = r.h ?? 800;
      const region = t.region ?? { x: 0, y: 0, w: W, h: H };
      const scale = Math.min(1, t.maxSide / Math.max(region.w, region.h));
      const iw = Math.max(1, Math.round(region.w * scale));
      const ih = Math.max(1, Math.round(region.h * scale));
      await new Promise(res => setTimeout(res, ((iw * ih) / 1e6) * msPerMP));
      if (t.signal.aborted) throw new DOMException('aborted', 'AbortError');
      const data = new Float32Array(iw * ih * 3);
      const seed = hash(r.name);
      const gain = Math.pow(2, r.exposure ?? 0);
      const k = 1 + (r.contrast ?? 0) / 100;
      const warm = ((r.temp ?? 5500) - 5500) / 6500;
      const tint = (r.tint ?? 0) / 200;
      const sat = 1 + (r.saturation ?? 0) / 100;
      for (let y = 0; y < ih; y++) {
        const dy = (region.y + y / scale) / H;
        for (let x = 0; x < iw; x++) {
          const dx = (region.x + x / scale) / W;
          // a sky-to-ground gradient, a sun, a horizon of hills
          const hill = 0.62 + 0.06 * Math.sin(dx * 9 + seed * 20) + 0.03 * Math.sin(dx * 23 + seed * 7);
          const sun = Math.exp(-((dx - 0.3 - seed * 0.4) ** 2 + (dy - 0.3) ** 2) * 60);
          let R: number, G: number, B: number;
          if (dy > hill) {
            const g = 0.25 + 0.2 * (1 - dy);
            R = g * 0.6;
            G = g * (0.9 + seed * 0.3);
            B = g * 0.4;
          } else {
            R = 0.35 + 0.4 * dy + sun;
            G = 0.5 + 0.25 * dy + sun * 0.9;
            B = 0.85 - 0.2 * dy + sun * 0.5;
          }
          // the "develop settings"
          R = R * gain * (1 + warm * 0.3 + tint * 0.3);
          G = G * gain * (1 - tint * 0.5);
          B = B * gain * (1 - warm * 0.3 + tint * 0.3);
          const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
          R = l + (R - l) * sat;
          G = l + (G - l) * sat;
          B = l + (B - l) * sat;
          const i = (y * iw + x) * 3;
          data[i] = Math.min(1, Math.max(0, (R - 0.5) * k + 0.5));
          data[i + 1] = Math.min(1, Math.max(0, (G - 0.5) * k + 0.5));
          data[i + 2] = Math.min(1, Math.max(0, (B - 0.5) * k + 0.5));
        }
      }
      b.renders++;
      const image: PresentImage = { width: iw, height: ih, channels: 3, data, region, scale };
      return { image, srcW: W, srcH: H, ms: performance.now() - t0 };
    },
  };
  return b;
}
