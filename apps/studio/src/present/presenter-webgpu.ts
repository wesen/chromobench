/// <reference types="@webgpu/types" />
// WebGPU presenter (guide §5.6): a Display P3 canvas, rgba16float where the canvas supports it,
// 'standard' tone mapping (prints never exceed paper white). One full-screen triangle samples the
// engine's result through the viewport transform: nearest at or above 1:1, bilinear below.
// Before/after binds a second texture and draws the split line in the shader.
import { configureCanvas, type CanvasConfig, type CanvasSpace } from '@chromobench/output';
import { fromHalf, toHalf, toRgba, type Colours, type PresentImage, type Presenter, type ViewTransform } from './presenter.ts';

const WGSL = /* wgsl */ `
struct U { a: vec4f, b: vec4f, region: vec4f, c: vec4f, bg: vec4f, frame: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var mainTex: texture_2d<f32>;
@group(0) @binding(2) var beforeTex: texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn fetch(t: texture_2d<f32>, q: vec2f, size: vec2f) -> vec4f {
  let i = vec2i(clamp(q, vec2f(0.0), size - 1.0));
  return textureLoad(t, i, 0);
}

fn sample(t: texture_2d<f32>, tc: vec2f, size: vec2f, linear: bool) -> vec4f {
  if (!linear) { return fetch(t, floor(tc), size); }
  let p = tc - 0.5;
  let f = fract(p);
  let o = floor(p);
  let a = mix(fetch(t, o, size), fetch(t, o + vec2f(1.0, 0.0), size), f.x);
  let b = mix(fetch(t, o + vec2f(0.0, 1.0), size), fetch(t, o + vec2f(1.0, 1.0), size), f.x);
  return mix(a, b, f.y);
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let canvas = u.a.xy; let docSize = u.a.zw;
  let centre = u.b.xy; let scaleDev = u.b.z; let resScale = u.b.w;
  let split = u.c.x; let hasBefore = u.c.y; let texSize = u.c.zw;
  if (split >= 0.0 && abs(pos.x - split * canvas.x) < 0.5) { return u.frame; }
  let doc = (pos.xy - canvas * 0.5) / scaleDev + centre;
  let px = 1.0 / scaleDev;
  if (any(doc < vec2f(0.0)) || any(doc >= docSize)) {
    if (all(doc >= vec2f(-px)) && all(doc < docSize + px)) { return u.frame; }
    return u.bg;
  }
  let tc = (doc - u.region.xy) * resScale;
  let linear = scaleDev < resScale;
  var col: vec4f;
  if (split >= 0.0 && hasBefore > 0.5 && pos.x < split * canvas.x) { col = sample(beforeTex, tc, texSize, linear); }
  else { col = sample(mainTex, tc, texSize, linear); }
  return vec4f(clamp(col.rgb, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

export class WebGpuPresenter implements Presenter {
  readonly kind = 'webgpu' as const;
  private space: 'display-p3' | 'srgb';
  private fmt: GPUTextureFormat;
  private readonly device: GPUDevice;
  /** false when the device is shared (one device for every viewport of the studio): dispose() keeps it */
  private owns = true;
  private cfg: CanvasConfig | null = null;
  private readonly context: GPUCanvasContext | null;
  private readonly canvas: HTMLCanvasElement;
  private readonly pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  private readonly uniform: GPUBuffer;
  private main: { tex: GPUTexture; img: PresentImage } | null = null;
  private before: GPUTexture | null = null;
  private last: { view: ViewTransform; colours: Colours } | null = null;
  private disposed = false;
  /** Called when the device is lost for any reason but dispose() (the viewer falls back to 2D). */
  onLost: (message: string) => void = () => {};

  private constructor(device: GPUDevice, context: GPUCanvasContext | null, canvas: HTMLCanvasElement, format: GPUTextureFormat, colorSpace: 'display-p3' | 'srgb') {
    this.device = device;
    this.context = context;
    this.canvas = canvas;
    this.fmt = format;
    this.space = colorSpace;
    this.uniform = device.createBuffer({ label: 'presenter.uniform', size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    void device.lost.then((info) => {
      if (!this.disposed) this.onLost(info.message);
    });
  }

  get colorSpace(): 'display-p3' | 'srgb' {
    return this.cfg?.space ?? this.space;
  }
  get format(): GPUTextureFormat {
    return this.cfg?.format ?? this.fmt;
  }

  /**
   * A presenter on `canvas` with a device the host already holds (the shell asks for presenters synchronously, one
   * per viewport). The canvas is configured by CHB-011's configureCanvas: the display's widest space (display-p3
   * where (color-gamut: p3) matches, else srgb), rgba16float, and a reconfiguration when the window moves to a
   * display of another gamut (`onSpace`). Returns null when the canvas has no WebGPU context.
   */
  static onDevice(canvas: HTMLCanvasElement, device: GPUDevice, o: { onSpace?: (s: CanvasSpace) => void; space?: CanvasSpace } = {}): WebGpuPresenter | null {
    let cfg: CanvasConfig;
    try {
      cfg = configureCanvas(canvas, device, { ...(o.onSpace ? { onChange: o.onSpace } : {}), ...(o.space ? { space: o.space } : {}) });
    } catch {
      return null;
    }
    const context = canvas.getContext('webgpu');
    if (!context) return null;
    const p = new WebGpuPresenter(device, context, canvas, cfg.format, cfg.space);
    p.cfg = cfg;
    p.owns = false;
    return p;
  }

  /**
   * A presenter on `canvas`. With `offscreen`, the canvas is not configured and draws go to an
   * offscreen texture: the pipeline and readDocPixel() work where canvas presentation does not
   * (headless Chromium on SwiftShader loses the device on the first canvas present).
   */
  static async create(canvas: HTMLCanvasElement, opts: { offscreen?: boolean } = {}): Promise<WebGpuPresenter | null> {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
    if (!gpu) return null;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    if (opts.offscreen) return new WebGpuPresenter(device, null, canvas, 'rgba16float', 'display-p3');
    const context = canvas.getContext('webgpu');
    if (!context) return null;
    const preferred = gpu.getPreferredCanvasFormat();
    const tries: [GPUTextureFormat, 'display-p3' | 'srgb'][] = [['rgba16float', 'display-p3'], [preferred, 'display-p3'], [preferred, 'srgb']];
    for (const [format, colorSpace] of tries) {
      try {
        context.configure({ device, format, colorSpace, alphaMode: 'opaque', toneMapping: { mode: 'standard' }, usage: GPUTextureUsage.RENDER_ATTACHMENT });
        return new WebGpuPresenter(device, context, canvas, format, colorSpace);
      } catch {
        // try the next configuration
      }
    }
    return null;
  }

  private pipeline(format: GPUTextureFormat): GPURenderPipeline {
    let p = this.pipelines.get(format);
    if (!p) {
      const module = this.device.createShaderModule({ label: 'presenter', code: WGSL });
      p = this.device.createRenderPipeline({ label: `presenter ${format}`, layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
      this.pipelines.set(format, p);
    }
    return p;
  }

  private upload(img: PresentImage): GPUTexture {
    const rgba = toRgba(img);
    const half = new Uint16Array(rgba.length);
    for (let i = 0; i < rgba.length; i++) half[i] = toHalf(rgba[i]!);
    const tex = this.device.createTexture({ label: `presenter.image ${img.width}x${img.height}`, size: [img.width, img.height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.device.queue.writeTexture({ texture: tex }, half, { bytesPerRow: img.width * 8 }, [img.width, img.height]);
    return tex;
  }

  setImages(main: PresentImage, before: PresentImage | null): void {
    this.main?.tex.destroy();
    this.before?.destroy();
    this.main = { tex: this.upload(main), img: main };
    this.before = before ? this.upload(before) : null;
  }

  private uniforms(view: ViewTransform, colours: Colours, w: number, h: number): Float32Array {
    const img = this.main!.img;
    return new Float32Array([
      w, h, view.docW, view.docH,
      view.cx, view.cy, view.zoom * view.dpr, img.scale,
      img.region.x, img.region.y, img.region.w, img.region.h,
      view.split ?? -1, this.before ? 1 : 0, img.width, img.height,
      ...colours.stage, 1, ...colours.frame, 1,
    ]);
  }

  private encode(target: GPUTexture, format: GPUTextureFormat, u: Float32Array): GPUCommandEncoder {
    this.device.queue.writeBuffer(this.uniform, 0, u as Float32Array<ArrayBuffer>);
    const pipeline = this.pipeline(format);
    const bind = this.device.createBindGroup({
      label: pipeline.label, layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: this.main!.tex.createView() },
        { binding: 2, resource: (this.before ?? this.main!.tex).createView() },
      ],
    });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    return enc;
  }

  draw(view: ViewTransform, colours: Colours): void {
    this.last = { view, colours };
    if (!this.main || this.canvas.width === 0 || this.canvas.height === 0) return;
    let target: GPUTexture;
    if (this.context) target = this.context.getCurrentTexture();
    else {
      target = this.device.createTexture({ label: 'presenter.target', size: [this.canvas.width, this.canvas.height], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
    this.device.queue.submit([this.encode(target, this.format, this.uniforms(view, colours, this.canvas.width, this.canvas.height)).finish()]);
    if (!this.context) target.destroy();
  }

  async readDocPixel(x: number, y: number): Promise<number[] | null> {
    if (!this.main || !this.last) return null;
    // A 1×1 render whose single pixel centre maps to the document pixel centre (x + ½, y + ½), at 1:1.
    const view: ViewTransform = { ...this.last.view, cx: x + 0.5, cy: y + 0.5, zoom: 1, dpr: 1, split: null };
    const tex = this.device.createTexture({ label: 'presenter.readback', size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const buf = this.device.createBuffer({ label: 'presenter.readback', size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.encode(tex, 'rgba16float', this.uniforms(view, this.last.colours, 1, 1));
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: 256 }, [1, 1]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const h = new Uint16Array(buf.getMappedRange().slice(0, 8));
    buf.unmap();
    buf.destroy();
    tex.destroy();
    return [0, 1, 2].map((k) => Math.round(fromHalf(h[k]!) * 255));
  }

  dispose(): void {
    this.disposed = true;
    this.main?.tex.destroy();
    this.before?.destroy();
    this.cfg?.dispose();
    this.uniform.destroy();
    if (this.owns) this.device.destroy();
  }
}
