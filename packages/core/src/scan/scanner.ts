// Scanner models (§3.1): a Channels object plus a flare fraction. The illustrative set of
// Chromogen's model.js makeScanner (05-inline.js 1645–1659).
import { fail } from '@chromobench/contract';
import type { PhysicsData } from '../data/provider.ts';
import { Channels, scannerChannels, statusM } from '../spectral/channels.ts';
import { gaussian } from '../spectral/spectrum.ts';

export interface ScannerModel {
  id: string;
  name: string;
  /** light × camera, normalised. */
  channels: Channels;
  /** Fraction of the open-gate signal added everywhere (§3.1). */
  flare: number;
  capture: 'sequential' | 'single';
}

export const SCANNER_IDS = ['xt5-fitted', 'xt5-rgb-led', 'rgb-led-book', 'white-led', 'status-m'] as const;

export function makeScanner(data: PhysicsData, id: string, o: { flare?: number; peaks?: [number, number, number]; fwhm?: number } = {}): ScannerModel {
  const flare = o.flare ?? 0;
  const led = (r: number, g: number, b: number, w: number | [number, number, number] = 20) => {
    const ws = Array.isArray(w) ? w : [w, w, w];
    return [gaussian(r, ws[0]!).values, gaussian(g, ws[1]!).values, gaussian(b, ws[2]!).values] as [Float64Array, Float64Array, Float64Array];
  };
  switch (id) {
    case 'xt5-fitted':
    case 'xt5-rgb-led':
      return { id, name: 'X-T5 + RGB LEDs 678/532/472 (fitted, App. E)', channels: scannerChannels(led(678, 532, 472), data.camera('generic-bayer'), id), flare, capture: 'sequential' };
    case 'rgb-led-book':
      return { id, name: 'RGB LEDs 660/530/450 (book)', channels: scannerChannels(led(660, 530, 450, [20, 25, 20]), data.camera('generic-bayer'), id), flare, capture: 'sequential' };
    case 'custom-led': {
      const p = o.peaks ?? [665, 530, 450];
      return { id, name: `RGB LEDs ${p.join('/')}`, channels: scannerChannels(led(p[0], p[1], p[2], o.fwhm ?? 20), data.camera('generic-bayer'), id), flare, capture: 'sequential' };
    }
    case 'white-led':
      return { id, name: 'White LED + camera (book)', channels: scannerChannels(data.light('white-led'), data.camera('generic-bayer'), id), flare, capture: 'single' };
    case 'status-m':
      return { id, name: 'Densitometer (Status M)', channels: statusM(), flare, capture: 'sequential' };
    default:
      return fail('E_DATA_SCHEMA', `unknown scanner "${id}"`, { valid: [...SCANNER_IDS, 'custom-led'] });
  }
}
