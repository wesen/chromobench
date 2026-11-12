// suggestSource (CHB-022 guide §5.5): the spot tool's only "intelligence", PURE. On a proxy image (what the
// viewer shows, any channels), score candidate source centres on rings at 2.5r … 9r around the target by the
// sum of squared differences between the ring around the target and the ring around the candidate (the
// surroundings, not the defect itself), and return the best. The chosen source is written into the spot, so
// the engine never searches and renders stay deterministic; the photographer can move the pin.
import type { Pt } from './geometry.ts';

export interface ProxyImage {
  width: number;
  height: number;
  channels: number;
  data: ArrayLike<number>;
  /** the image covers this box of the picture (picture px) at `scale` image px per picture px */
  region: { x: number; y: number; w: number; h: number };
  scale: number;
}

/**
 * The best source centre (picture px) for a disc of radius r at `target` (picture px), or null when no
 * candidate disc lies inside `bounds` (default: the image's region). `accept` filters candidates further (a
 * source must lie inside the source frame, say).
 */
export function suggestSource(img: ProxyImage, target: Pt, r: number, o: { bounds?: { w: number; h: number; x?: number; y?: number }; accept?: (p: Pt) => boolean } = {}): Pt | null {
  const b = o.bounds ?? img.region;
  const bx = b.x ?? 0, by = b.y ?? 0;
  const c = Math.min(3, img.channels);
  const at = (x: number, y: number, k: number): number => {
    const ix = Math.min(img.width - 1, Math.max(0, Math.floor((x - img.region.x) * img.scale)));
    const iy = Math.min(img.height - 1, Math.max(0, Math.floor((y - img.region.y) * img.scale)));
    return img.data[(iy * img.width + ix) * img.channels + k]!;
  };
  const ring: Pt[] = [];
  for (const f of [1.15, 1.5]) for (let i = 0; i < 24; i++) ring.push({ x: f * r * Math.cos((2 * Math.PI * i) / 24), y: f * r * Math.sin((2 * Math.PI * i) / 24) });
  const ref = ring.map((d) => Array.from({ length: c }, (_, k) => at(target.x + d.x, target.y + d.y, k)));
  let best: { p: Pt; score: number } | null = null;
  for (const f of [2.5, 3.5, 5, 7, 9]) {
    for (let i = 0; i < 24; i++) {
      const th = (2 * Math.PI * i) / 24 + f; // stagger the rings
      const p = { x: target.x + f * r * Math.cos(th), y: target.y + f * r * Math.sin(th) };
      if (p.x - 1.5 * r < bx || p.y - 1.5 * r < by || p.x + 1.5 * r > bx + b.w || p.y + 1.5 * r > by + b.h) continue;
      if (o.accept && !o.accept(p)) continue;
      let score = 0;
      ring.forEach((d, j) => {
        for (let k = 0; k < c; k++) score += (at(p.x + d.x, p.y + d.y, k) - ref[j]![k]!) ** 2;
      });
      // prefer near sources a little (texture and light change with distance)
      score *= 1 + 0.02 * f;
      if (!best || score < best.score) best = { p, score };
    }
  }
  return best?.p ?? null;
}
