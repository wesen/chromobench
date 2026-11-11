// The display path's canvas (guide §5.5): a WebGPU canvas in the display's widest colour space —
// 'display-p3' when (color-gamut: p3) matches, else 'srgb' — with rgba16float to avoid 8-bit banding in
// smooth print tones, and toneMapping 'standard' (clamped to [0, 1]). It reconfigures when the window
// moves to a monitor of another gamut, and tells the viewer, which must re-render output.display for the
// new space (compile(r, g, {displaySpace})): the viewer shows the knee into the canvas's space, not the
// file's.
export type CanvasSpace = 'srgb' | 'display-p3';

export interface CanvasConfig {
  space: CanvasSpace;
  format: GPUTextureFormat;
  /** Stops listening for gamut changes. */
  dispose(): void;
}

interface MediaLike { matches: boolean; addEventListener?(t: 'change', f: () => void): void; removeEventListener?(t: 'change', f: () => void): void }

export interface CanvasOptions {
  /** Called after a reconfiguration for another gamut (not for the first configuration). */
  onChange?: (space: CanvasSpace) => void;
  /** Force a space (tests, a user override). */
  space?: CanvasSpace;
  /** Default rgba16float; falls back to the preferred format if the device refuses it. */
  format?: GPUTextureFormat;
  /** matchMedia stand-in (tests). */
  matchMedia?: (q: string) => MediaLike;
}

export const P3_QUERY = '(color-gamut: p3)';

/** The canvas space for the current display: display-p3 where the display covers P3. */
export function displaySpace(mm?: (q: string) => MediaLike): CanvasSpace {
  const m = mm ?? (typeof matchMedia === 'function' ? matchMedia : undefined);
  return m?.(P3_QUERY).matches ? 'display-p3' : 'srgb';
}

export function configureCanvas(canvas: HTMLCanvasElement | OffscreenCanvas, device: GPUDevice, o: CanvasOptions = {}): CanvasConfig {
  const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!ctx) throw new Error('configureCanvas: no WebGPU context on this canvas');
  const mm = o.matchMedia ?? (typeof matchMedia === 'function' ? (q: string) => matchMedia(q) : undefined);
  let format: GPUTextureFormat = o.format ?? 'rgba16float';
  const apply = (space: CanvasSpace): void => {
    try {
      ctx.configure({ device, format, colorSpace: space, alphaMode: 'opaque', toneMapping: { mode: 'standard' } });
    } catch {
      format = navigator.gpu.getPreferredCanvasFormat();
      ctx.configure({ device, format, colorSpace: space, alphaMode: 'opaque' });
    }
    cfg.space = space;
    cfg.format = format;
  };
  const cfg: CanvasConfig = { space: 'srgb', format, dispose: () => undefined };
  apply(o.space ?? displaySpace(mm));
  const media = !o.space && mm ? mm(P3_QUERY) : undefined;
  if (media?.addEventListener) {
    const onChange = (): void => {
      const s: CanvasSpace = media.matches ? 'display-p3' : 'srgb';
      if (s === cfg.space) return;
      apply(s);
      o.onChange?.(s);
    };
    media.addEventListener('change', onChange);
    cfg.dispose = () => media.removeEventListener?.('change', onChange);
  }
  return cfg;
}
