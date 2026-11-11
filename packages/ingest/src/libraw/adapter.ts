// The only module that knows the LibRaw build (DR-4): @colorhythm/libraw-wasm 1.1.1 (LibRaw 0.22.1,
// MIT wrapper, LibRaw under LGPL 2.1 / CDDL 1.0, loaded as a separate .wasm at runtime). It is
// imported dynamically, so TIFF/PNG paths never load WASM. Runs on whichever thread calls it; the
// worker (worker.ts) is the intended host.
import { ChromobenchError, type DecodeOptions } from '@chromobench/contract';
import { sourceSha256 } from '../decode/identity.ts';
import type { RawDecoder } from '../decode/registry.ts';
import { readDngColour } from '../decode/tiff.ts';
import type { RawImage } from '../decode/types.ts';
import { adobeCameraToXyz, dngCameraToXyz, type M3 } from './colour.ts';
import type { RawInfo } from './protocol.ts';
import { scanMode, type Mosaic } from './scan-mode.ts';

type LibRawModule = typeof import('@colorhythm/libraw-wasm');
type LibRawInstance = InstanceType<LibRawModule['LibRaw']>;

let modP: Promise<LibRawModule> | null = null;
let wasmSource: (() => Promise<Response | ArrayBuffer>) | null = null;

/**
 * Where to load libraw.wasm from. By default the module finds it beside itself (import.meta.url),
 * which works in Node and in production bundles; a dev server that pre-bundles dependencies (Vite's
 * optimizeDeps) moves the module, so hosts pass the URL explicitly (workerRawDecoder's `wasmUrl`).
 */
export function setLibRawWasm(source: string | URL | (() => Promise<Response | ArrayBuffer>)): void {
  wasmSource = typeof source === 'function' ? source : () => fetch(source);
  modP = null;
}

async function lib(): Promise<LibRawModule> {
  modP ??= import('@colorhythm/libraw-wasm').then(async (m) => {
    await m.LibRaw.initialize(wasmSource ? await wasmSource() : undefined);
    return m;
  });
  return modP;
}

function libRawError(e: unknown): never {
  const code = (e as { code?: number }).code;
  throw new ChromobenchError({
    code: 'E_FORMAT',
    message: `LibRaw${code !== undefined ? ` error ${code}` : ''}: ${e instanceof Error ? e.message : String(e)}`,
    hint: 'The file is not a camera RAW LibRaw 0.22 can read, or it is damaged.',
  });
}

function infoOf(lr: LibRawInstance, version: string): RawInfo {
  const ip = lr.getIParams();
  const filters = lr.getFilters() >>> 0;
  const kind: RawInfo['cfa']['kind'] = filters === 0 ? 'none' : filters === 9 ? 'xtrans' : 'bayer';
  const period = kind === 'xtrans' ? 6 : kind === 'bayer' ? 2 : 1;
  const map: number[] = [];
  for (let r = 0; r < period; r++) for (let c = 0; c < period; c++) map.push(kind === 'none' ? 0 : lr.color(r, c));
  if (kind === 'bayer') {
    // dcraw filters can encode patterns longer than 2 rows (e.g. Leaf): refuse rather than mis-bin.
    for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) {
      if (lr.color(r, c) !== map[(r % 2) * 2 + (c % 2)]) throw new ChromobenchError({ code: 'E_FORMAT', message: 'LibRaw: Bayer pattern with a period longer than 2 is not supported in scan mode' });
    }
  }
  const black = [0, 1, 2, 3].map((i) => lr.getBlack() + lr.getCblack(i));
  const rows = lr.getCblack(4), cols = lr.getCblack(5);
  const blackPattern = rows > 0 && cols > 0 && rows * cols <= 64 ? { rows, cols, values: Array.from({ length: rows * cols }, (_, i) => lr.getCblack(6 + i)) } : undefined;
  const camXyz = [0, 1, 2].map((i) => [0, 1, 2].map((j) => lr.getCamXyz(i, j)));
  const ot = lr.getImgOther();
  const info: RawInfo = {
    libraw: version,
    rawSize: [lr.getRawWidth(), lr.getRawHeight()],
    visible: { x: lr.getLeftMargin(), y: lr.getTopMargin(), w: lr.getActiveWidth(), h: lr.getActiveHeight() },
    cfa: { kind, period: period as 1 | 2 | 6, map },
    black, white: lr.getColorMaximum(),
    linearMax: [0, 1, 2, 3].map((i) => lr.getLinearMax(i)),
    camMul: [0, 1, 2, 3].map((i) => lr.getCamMul(i)),
    preMul: [0, 1, 2, 3].map((i) => lr.getPreMul(i)),
    flip: lr.getFlip(),
    camera: { make: ip.make, model: ip.model, iso: ot?.iso_speed ?? 0, exposure_s: ot?.shutter ?? 0, fnumber: ot?.aperture ?? 0 },
  };
  if (blackPattern && blackPattern.values.some((v) => v !== 0)) info.blackPattern = blackPattern;
  if (camXyz.some((r) => r.some((v) => v !== 0))) info.camXyz = camXyz;
  return info;
}

/** LibRaw decoder in the current thread. Scan mode by default; photo mode with options.mode 'photo'. */
export class LibRawDecoder implements RawDecoder {
  readonly name = 'libraw';

  /** LibRaw version string (loads the module). */
  static async version(): Promise<string> {
    return (await lib()).LibRaw.version();
  }

  private async open(bytes: Uint8Array): Promise<{ lr: LibRawInstance; info: RawInfo }> {
    const m = await lib();
    const lr = new m.LibRaw();
    await lr.waitUntilReady();
    try {
      lr.open(bytes.slice().buffer);
      lr.unpack();
    } catch (e) {
      lr.dispose();
      libRawError(e);
    }
    return { lr, info: infoOf(lr, m.LibRaw.version()) };
  }

  async probe(bytes: Uint8Array): Promise<{ sha256: string; info: RawInfo }> {
    const { lr, info } = await this.open(bytes);
    lr.dispose();
    return { sha256: sourceSha256(bytes), info };
  }

  async decode(bytes: Uint8Array, o: Partial<DecodeOptions> = {}): Promise<RawImage> {
    const { lr, info } = await this.open(bytes);
    try {
      const img = o.mode === 'photo' ? this.photo(lr, info) : this.scan(lr, info, o.bin ?? 'cfa');
      const dng = readDngColour(bytes);
      if (dng) img.meta.dng = dng;
      img.meta.camera = {
        make: info.camera.make, model: info.camera.model, iso: info.camera.iso, exposure_s: info.camera.exposure_s, fnumber: info.camera.fnumber,
        ...(info.camMul ? { daylightMultipliers: [info.preMul![0]!, info.preMul![1]!, info.preMul![2]!] as [number, number, number] } : {}),
      };
      try {
        const c = dng?.colorMatrix1 ? dngCameraToXyz(dng) : info.camXyz ? adobeCameraToXyz(info.camXyz as M3) : null;
        if (c) {
          img.meta.camera.camToXyz = c.camToXyz;
          img.meta.camera.from = c.from;
        }
        if (dng?.asShotNeutral) img.meta.camera.asShotNeutral = [dng.asShotNeutral[0]!, dng.asShotNeutral[1]!, dng.asShotNeutral[2]!];
      } catch {
        img.meta.notes.push({ code: 'W_ENCODING_ASSUMED', message: 'The camera colour matrix is singular; no camera → XYZ mapping.' });
      }
      img.meta.orientationTag = [1, 1, 1, 3, 1, 8, 6][info.flip] ?? 1; // LibRaw flip 0/3/5/6 → EXIF 1/3/8/6
      return img;
    } catch (e) {
      if (e instanceof ChromobenchError) throw e;
      return libRawError(e);
    } finally {
      lr.dispose();
    }
  }

  private scan(lr: LibRawInstance, info: RawInfo, bin: 'none' | 'cfa' | 'cfa-half'): RawImage {
    const data = lr.getRawImage();
    if (data) {
      const m: Mosaic = { data, stride: info.rawSize[0], info };
      return scanMode(m, bin);
    }
    // Full-colour layouts (pixel-shift composites, Sony ARQ, Foveon): three or four components per pixel.
    const c4 = lr.getColor4Image();
    const c3 = c4 ? null : lr.getColor3Image();
    const src = c4 ?? c3;
    if (!src) throw new ChromobenchError({ code: 'E_FORMAT', message: 'LibRaw returned no raw data' });
    const n = c4 ? 4 : 3;
    const [W, H] = info.rawSize;
    const { x: vx, y: vy, w, h } = info.visible;
    const planes = [0, 1, 2].map(() => new Float32Array(w * h));
    const clipped = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const q = ((y + vy) * W + x + vx) * n;
      const g = n === 4 ? (src[q + 1]! + src[q + 3]!) / 2 : src[q + 1]!; // average the two greens (ARQ)
      const v = [src[q]!, g, src[q + 2]!];
      for (let k = 0; k < 3; k++) {
        planes[k]![y * w + x] = v[k]! - info.black[k]!;
        if (v[k]! >= info.white) clipped[y * w + x] = 1;
      }
    }
    void H;
    return {
      width: w, height: h, channels: 3, planes, sample: 'float', bits: 32,
      levels: { black: [0, 0, 0], white: [0, 1, 2].map((k) => info.white - info.black[k]!), from: 'libraw' },
      encoding: { value: 'linear', evidence: 'format' },
      meta: { format: 'raw', cfa: 'none', clipped, notes: [{ code: 'W_ENCODING_ASSUMED', message: `Full-colour raw (${n} components per pixel): no binning needed${n === 4 ? '; the two greens are averaged' : ''}.` }] },
    };
  }

  private photo(lr: LibRawInstance, info: RawInfo): RawImage {
    // Raw camera colour, unit multipliers, linear 16-bit, no auto-brightness, no maximum adjustment, clip highlights.
    lr.setOutputColor(0);
    for (let i = 0; i < 4; i++) lr.setUserMul(i, 1);
    lr.setNoAutoBright(1);
    lr.setGamma(0, 1);
    lr.setGamma(1, 1);
    lr.setOutputBps(16);
    lr.setAdjustMaximumThr(0);
    lr.setHighlight(0);
    lr.setDemosaic(3);
    lr.dcrawProcess();
    const mem = lr.dcrawMakeMemImage();
    if (mem.bits !== 16 || mem.colors < 3) throw new ChromobenchError({ code: 'E_FORMAT', message: `LibRaw photo mode returned ${mem.colors}×${mem.bits}-bit data` });
    const n = mem.width * mem.height;
    const dv = new DataView(mem.data.buffer, mem.data.byteOffset, mem.data.byteLength);
    const planes = [0, 1, 2].map(() => new Uint16Array(n));
    const le = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) planes[k]![i] = dv.getUint16((i * mem.colors + k) * 2, le);
    return {
      width: mem.width, height: mem.height, channels: 3, planes, sample: 'uint', bits: 16,
      levels: { black: [0, 0, 0], white: [65535, 65535, 65535], from: 'libraw' },
      encoding: { value: 'linear', evidence: 'format' },
      meta: { format: 'raw', cfa: info.cfa.kind, notes: [{ code: 'W_ENCODING_ASSUMED', message: 'LibRaw photo mode: demosaiced (AHD), raw camera colour, unit multipliers, linear 16-bit; black subtracted by LibRaw; white balance not applied.' }] },
    };
  }
}
