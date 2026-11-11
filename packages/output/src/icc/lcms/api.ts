// Typed wrapper around lcms-wasm 1.0.5 (Little CMS 2.16 in WebAssembly, MIT; guide §5.7, decision D4).
// `createLcms()` runs in the calling thread (Node tests, and inside the worker); `lcmsInWorker()` is the
// same interface proxied to a dedicated module worker (worker.ts) so pages stay responsive and a
// malformed user profile is parsed by C code inside a worker's WebAssembly sandbox.
//
// Security note (guide §5.7): lcms-wasm 1.0.5 bundles Little CMS 2.16; CVE-2026-41254 (CLUT size
// overflow in cmslut.c) is reported against versions up to 2.18. Printer profiles are untrusted input:
// they are parsed and class-checked by icc/parse.ts first, and lcms runs in the worker. Switching to an
// own Emscripten build of a pinned, patched release is decision D4's fallback.
import { ChromobenchError } from '@chromobench/contract';

export type Intent = 'perceptual' | 'relative' | 'saturation' | 'absolute';
/** lcms TYPE_RGB_16, TYPE_RGB_FLT, TYPE_XYZ_FLT (XYZ with the D50 PCS white at Y = 1), TYPE_Lab_FLT. */
export type PixelFormat = 'RGB_16' | 'RGB_FLT' | 'XYZ_FLT' | 'Lab_FLT';

export type ProfileHandle = { kind: 'profile'; id: number };
export type TransformHandle = { kind: 'transform'; id: number };

export interface TransformOptions { intent: Intent; bpc: boolean; in: PixelFormat; out: PixelFormat }

export interface Lcms {
  /** Little CMS version (e.g. 2160). */
  readonly version: number;
  open(bytes: Uint8Array): Promise<ProfileHandle>;
  /** lcms's built-in XYZ (D50 PCS) and Lab v4 profiles, for round trips. */
  openXYZ(): Promise<ProfileHandle>;
  openLab(): Promise<ProfileHandle>;
  /** Description and colour-space signature as lcms reads them. */
  info(p: ProfileHandle): Promise<{ description: string; colourSpace: string | null }>;
  transform(src: ProfileHandle, dst: ProfileHandle, o: TransformOptions): Promise<TransformHandle>;
  /** Proofing transform (cmsFLAGS_SOFTPROOFING): src → printer (intent) → display (proofIntent). */
  proof(src: ProfileHandle, display: ProfileHandle, printer: ProfileHandle, o: { intent: Intent; proofIntent: 'absolute' | 'relative'; bpc: boolean; in: PixelFormat; out: PixelFormat }): Promise<TransformHandle>;
  run(t: TransformHandle, pixels: Uint16Array | Float32Array, n: number): Promise<Uint16Array | Float32Array>;
  close(h: ProfileHandle | TransformHandle): Promise<void>;
  dispose(): void;
}

const INTENT: Record<Intent, number> = { perceptual: 0, relative: 1, saturation: 2, absolute: 3 };
const FLAGS = { bpc: 0x2000, softproof: 0x4000, nocache: 0x0040 };
// lcms2.h pixel-type macros: FLOAT_SH(a) a<<22, COLORSPACE_SH(s) s<<16, CHANNELS_SH(c) c<<3, BYTES_SH(b) b
const PT_RGB = 4;
const PT_XYZ = 9;
const PT_LAB = 10;
export const PIXEL_TYPE: Record<PixelFormat, number> = {
  RGB_16: (PT_RGB << 16) | (3 << 3) | 2,
  RGB_FLT: (1 << 22) | (PT_RGB << 16) | (3 << 3) | 4,
  XYZ_FLT: (1 << 22) | (PT_XYZ << 16) | (3 << 3) | 4,
  Lab_FLT: (1 << 22) | (PT_LAB << 16) | (3 << 3) | 4,
};

/** The lcms-wasm module's surface used here (lib/api.js). */
interface LcmsModule {
  cmsOpenProfileFromMem(bytes: Uint8Array, n: number): number;
  cmsCloseProfile(h: number): void;
  cmsCreateXYZProfile(): number;
  cmsCreateLab4Profile(wp: null | number[]): number;
  cmsGetProfileInfoASCII(h: number, info: number, lang: string, country: string): string;
  cmsGetColorSpaceASCII(h: number): string | null;
  cmsCreateTransform(src: number, inFmt: number, dst: number, outFmt: number, intent: number, flags: number): number;
  cmsCreateProofingTransform(src: number, inFmt: number, dst: number, outFmt: number, proof: number, intent: number, proofIntent: number, flags: number): number;
  cmsDeleteTransform(t: number): void;
  cmsDoTransform(t: number, input: Uint16Array | Float32Array, n: number): Uint16Array | Float32Array;
}

const iccError = (message: string): ChromobenchError => new ChromobenchError({ code: 'E_ICC_INVALID', message });

/** lcms in this thread. `locateFile` finds lcms.wasm in bundlers (Vite: `lcms-wasm/dist/lcms.wasm?url`). */
export async function createLcms(o: { locateFile?: (name: string) => string } = {}): Promise<Lcms> {
  const mod = (await import('lcms-wasm')) as unknown as { instantiate: (o?: object) => Promise<LcmsModule>; LCMS_VERSION: number };
  const m = await mod.instantiate(o.locateFile ? { locateFile: o.locateFile } : {});
  const profiles = new Map<number, number>();
  const transforms = new Map<number, number>();
  let next = 1;
  const prof = (h: ProfileHandle): number => profiles.get(h.id) ?? (() => { throw iccError('closed or unknown profile handle'); })();
  const addProfile = (ptr: number, what: string): ProfileHandle => {
    if (!ptr) throw iccError(`lcms could not open ${what}`);
    const id = next++;
    profiles.set(id, ptr);
    return { kind: 'profile', id };
  };
  const addTransform = (ptr: number): TransformHandle => {
    if (!ptr) throw iccError('lcms could not create the transform (profile classes, colour spaces or intents do not fit)');
    const id = next++;
    transforms.set(id, ptr);
    return { kind: 'transform', id };
  };
  return {
    version: mod.LCMS_VERSION,
    async open(bytes) { return addProfile(m.cmsOpenProfileFromMem(bytes, bytes.byteLength), 'the profile'); },
    async openXYZ() { return addProfile(m.cmsCreateXYZProfile(), 'the XYZ profile'); },
    async openLab() { return addProfile(m.cmsCreateLab4Profile(null), 'the Lab profile'); },
    async info(p) {
      const h = prof(p);
      return { description: m.cmsGetProfileInfoASCII(h, 0, 'en', 'US'), colourSpace: m.cmsGetColorSpaceASCII(h) };
    },
    async transform(src, dst, t) {
      const flags = (t.bpc ? FLAGS.bpc : 0) | FLAGS.nocache;
      return addTransform(m.cmsCreateTransform(prof(src), PIXEL_TYPE[t.in], prof(dst), PIXEL_TYPE[t.out], INTENT[t.intent], flags));
    },
    async proof(src, display, printer, t) {
      const flags = FLAGS.softproof | (t.bpc ? FLAGS.bpc : 0) | FLAGS.nocache;
      return addTransform(m.cmsCreateProofingTransform(prof(src), PIXEL_TYPE[t.in], prof(display), PIXEL_TYPE[t.out], prof(printer), INTENT[t.intent], INTENT[t.proofIntent], flags));
    },
    async run(t, pixels, n) {
      const ptr = transforms.get(t.id);
      if (!ptr) throw iccError('closed or unknown transform handle');
      return m.cmsDoTransform(ptr, pixels, n);
    },
    async close(h) {
      if (h.kind === 'profile') { const p = profiles.get(h.id); if (p) m.cmsCloseProfile(p); profiles.delete(h.id); }
      else { const t = transforms.get(h.id); if (t) m.cmsDeleteTransform(t); transforms.delete(h.id); }
    },
    dispose() {
      for (const t of transforms.values()) m.cmsDeleteTransform(t);
      for (const p of profiles.values()) m.cmsCloseProfile(p);
      transforms.clear();
      profiles.clear();
    },
  };
}

// ---- worker proxy ---------------------------------------------------------------------------------

export type LcmsCall = { id: number; method: keyof Omit<Lcms, 'version' | 'dispose'>; args: unknown[] };
export type LcmsReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; code: string; message: string } | { id: 0; ready: true; version: number };

/** The Lcms interface over a worker running worker.ts. */
export async function lcmsInWorker(worker: Worker): Promise<Lcms> {
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  let ready!: (v: number) => void;
  const readyP = new Promise<number>((r) => { ready = r; });
  worker.onmessage = (e: MessageEvent<LcmsReply>) => {
    const r = e.data;
    if ('ready' in r) { ready(r.version); return; }
    const p = pending.get(r.id);
    if (!p) return;
    pending.delete(r.id);
    if (r.ok) p.resolve(r.value);
    else p.reject(new ChromobenchError({ code: r.code, message: r.message }));
  };
  const call = <T>(method: LcmsCall['method'], args: unknown[], transfer: Transferable[] = []): Promise<T> => new Promise<T>((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker.postMessage({ id, method, args } satisfies LcmsCall, transfer);
  });
  const version = await readyP;
  return {
    version,
    open: (bytes) => call('open', [bytes]),
    openXYZ: () => call('openXYZ', []),
    openLab: () => call('openLab', []),
    info: (p) => call('info', [p]),
    transform: (s, d, o) => call('transform', [s, d, o]),
    proof: (s, d, p, o) => call('proof', [s, d, p, o]),
    run: (t, px, n) => call('run', [t, px, n]),
    close: (h) => call('close', [h]),
    dispose: () => worker.terminate(),
  };
}
